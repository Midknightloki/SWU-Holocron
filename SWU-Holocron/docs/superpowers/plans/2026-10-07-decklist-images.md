# Precon Decks from Official Decklist Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin pastes an official decklist image link (or uploads the image). Gemini reads its decks, each line is resolved to a card by number + name, the admin fixes any line that didn't resolve, and the decks are saved to Prebuilt Decks in review.

**Architecture:**
- **Reading:** an admin-only callable, `readDecklist`. Its package-free core lives in `functions/readDecklist.js` (injected deps, tested in CI like `scanCard.js`), and `index.js` supplies the CDN fetch and the Gemini call.
- **Resolving:** the client side is the pure `src/utils/decklistImage.js` (set from file name, name normalisation, line resolution, deck building).
- **Saving:** `PrebuiltDeckService.readDecklistImage` / `addFromImage`.
- **Admin UI:** a `DecklistImageImport` component inside `AdminPrebuiltDecks`.

**Tech Stack:** Firebase Functions v2 (`onCall`), `@google/genai` (Vertex, `enterprise: true`), React 18, Firestore v9, Vitest.

**Spec:** `SWU-Holocron/docs/superpowers/specs/2026-10-07-decklist-images-design.md`

## Global Constraints

- All commands run from `SWU-Holocron/`.
- Commit gate: the task's tests pass, then `npx eslint src --ext js,jsx --quiet` prints nothing, then commit. The last task also runs `npm run test:unit` and `npm run build`.
- `functions/readDecklist.js` requires **no package**: CI doesn't install `functions/node_modules`.
- Gemini calls use `thinkingConfig: { thinkingBudget: 0 }` and a `responseSchema`.
- Links are fetched only when `new URL(link)` has protocol `https:` and hostname `cdn.starwarsunlimited.com`. The check runs in both the browser and the function. No redirects are followed.
- The function accepts images of type `image/png`, `image/jpeg` or `image/webp`, up to 8 MB.
- A line is never accepted on number alone: the normalised names must agree.
- No `undefined` in Firestore writes. Services never throw. No `alert`, `confirm` or `console.log`.
- Deploying the function is a manual step that needs the user's OK. **It is not part of any task.**

## Review Focus

1. **Same name, different card** (`9 Boba Fett` leader vs `189 Boba Fett` unit): resolution must follow the number. Tested in Task 2.
2. **A `*` line whose number also exists in the deck's own set** (with a different name): it must resolve in an earlier set, never to the same-number card in this set. Tested in Task 2.
3. **Hostile or odd links** (`https://cdn.starwarsunlimited.com.evil.com/x.png`, `http://…`, a userinfo trick): refused. Tested in Task 1.
4. **Saving a deck whose id already exists** (re-importing the same image): refused per deck, and the other deck in the image still saves. Tested in Tasks 3 and 4.
5. **Changing the set after reading:** lines re-resolve without reading the image again. Tested in Task 4.

---

### Task 1: The `readDecklist` function

**Files:**
- Create: `functions/readDecklist.js`
- Modify: `functions/index.js`
- Test: `src/test/functions/readDecklist.test.js`

**Interfaces:**
- Produces: `createReadDecklistHandler({ db, appId, HttpsError, readImage, fetchImage, logger })` → `async (request) => ({ decks: [{ title, lines: [{ number, fromPreviousSet, name, qty }] }] })`; `isOfficialImageUrl(url) → boolean`; `sanitizeDecklist(output)`.
  - `readImage(base64, mimeType)` resolves to the raw Gemini JSON.
  - `fetchImage(url)` resolves to `{ contentType, bytes: Buffer }`.

- [ ] **Step 1: Write the failing test** (`src/test/functions/readDecklist.test.js`)

```js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createReadDecklistHandler, isOfficialImageUrl, sanitizeDecklist } = require('../../../functions/readDecklist.js');

class FakeHttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const APP = 'test-app';
const fakeDb = (docs = {}) => ({ doc: (path) => ({ get: async () => ({ exists: path in docs, data: () => docs[path] }) }) });
const ADMIN = { [`artifacts/${APP}/users/a1`]: { isAdmin: true } };
const URL_OK = 'https://cdn.starwarsunlimited.com//large_SWH_04_Article_Spotlight_Decks_Decklist_v02_1f4852aef7.jpg';
const READ = { decks: [{ title: 'BOBA FETT', lines: [{ number: '9', fromPreviousSet: false, name: 'Boba Fett', qty: 1 }] }] };

const make = (o = {}) => {
  const deps = {
    db: fakeDb(ADMIN), appId: APP, HttpsError: FakeHttpsError, logger: { error: vi.fn() },
    readImage: vi.fn(async () => READ),
    fetchImage: vi.fn(async () => ({ contentType: 'image/jpeg', bytes: Buffer.from('abc') })),
    ...o,
  };
  return { deps, handler: createReadDecklistHandler(deps) };
};
const call = (handler, data, auth = { uid: 'a1', token: {} }) => handler({ auth, data });

describe('isOfficialImageUrl', () => {
  it('accepts only https links on the official CDN', () => {
    expect(isOfficialImageUrl(URL_OK)).toBe(true);
    expect(isOfficialImageUrl('http://cdn.starwarsunlimited.com/x.png')).toBe(false);
    expect(isOfficialImageUrl('https://cdn.starwarsunlimited.com.evil.com/x.png')).toBe(false);
    expect(isOfficialImageUrl('https://evil.com@cdn.starwarsunlimited.com/x.png')).toBe(false);
    expect(isOfficialImageUrl('https://evil.com/?u=https://cdn.starwarsunlimited.com/x.png')).toBe(false);
    expect(isOfficialImageUrl('not a url')).toBe(false);
  });
});

describe('readDecklist', () => {
  it('requires a signed-in admin', async () => {
    const { handler } = make({ db: fakeDb({ [`artifacts/${APP}/users/u1`]: { isPro: true } }) });
    await expect(call(handler, { imageUrl: URL_OK }, null)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(call(handler, { imageUrl: URL_OK }, { uid: 'u1', token: {} })).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('reads an official link: fetches it and returns the sanitised decks', async () => {
    const { deps, handler } = make();
    expect(await call(handler, { imageUrl: URL_OK })).toEqual(READ);
    expect(deps.fetchImage).toHaveBeenCalledWith(URL_OK);
    expect(deps.readImage).toHaveBeenCalledWith(Buffer.from('abc').toString('base64'), 'image/jpeg');
  });

  it('refuses other links without fetching them', async () => {
    const { deps, handler } = make();
    await expect(call(handler, { imageUrl: 'https://evil.com/x.png' })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(deps.fetchImage).not.toHaveBeenCalled();
  });

  it('takes exactly one of a link or an uploaded image', async () => {
    const { handler } = make();
    await expect(call(handler, {})).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call(handler, { imageUrl: URL_OK, image: 'YWJj', mimeType: 'image/png' })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('reads an uploaded image of an allowed type', async () => {
    const { deps, handler } = make();
    expect(await call(handler, { image: 'YWJj', mimeType: 'image/png' })).toEqual(READ);
    expect(deps.readImage).toHaveBeenCalledWith('YWJj', 'image/png');
    await expect(call(handler, { image: 'YWJj', mimeType: 'image/gif' })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call(handler, { image: 'not base64!', mimeType: 'image/png' })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('refuses a fetched file that is not an image or is too large', async () => {
    const html = make({ fetchImage: vi.fn(async () => ({ contentType: 'text/html', bytes: Buffer.from('<html>') })) });
    await expect(call(html.handler, { imageUrl: URL_OK })).rejects.toMatchObject({ code: 'invalid-argument' });
    const big = make({ fetchImage: vi.fn(async () => ({ contentType: 'image/png', bytes: Buffer.alloc(8 * 1024 * 1024 + 1) })) });
    await expect(call(big.handler, { imageUrl: URL_OK })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('maps download and reading failures to errors', async () => {
    const down = make({ fetchImage: vi.fn(async () => { throw new Error('404'); }) });
    await expect(call(down.handler, { imageUrl: URL_OK })).rejects.toMatchObject({ code: 'unavailable' });
    const bad = make({ readImage: vi.fn(async () => { throw new Error('vertex'); }) });
    await expect(call(bad.handler, { imageUrl: URL_OK })).rejects.toMatchObject({ code: 'internal' });
  });
});

describe('sanitizeDecklist', () => {
  it('cleans numbers and quantities, keeps the star as fromPreviousSet, drops empty rows and decks', () => {
    expect(sanitizeDecklist({ decks: [
      { title: ' LEIA ORGANA ', lines: [
        { number: '93*', fromPreviousSet: false, name: ' C-3PO ', qty: 2 },
        { number: '010', fromPreviousSet: false, name: 'Leia Organa', qty: '1' },
        { number: '', fromPreviousSet: false, name: 'x', qty: 1 },
        { number: '5', fromPreviousSet: false, name: 'Big', qty: 99 },
      ] },
      { title: 'EMPTY', lines: [] },
    ] })).toEqual({ decks: [{ title: 'LEIA ORGANA', lines: [
      { number: '93', fromPreviousSet: true, name: 'C-3PO', qty: 2 },
      { number: '010', fromPreviousSet: false, name: 'Leia Organa', qty: 1 },
      { number: '5', fromPreviousSet: false, name: 'Big', qty: 9 },
    ] }] });
    expect(sanitizeDecklist(null)).toEqual({ decks: [] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/test/functions/readDecklist.test.js`
Expected: FAIL — cannot find `functions/readDecklist.js`.

- [ ] **Step 3: Implement `functions/readDecklist.js`**

```js
/**
 * readDecklist -- reads an official Star Wars: Unlimited decklist image (two
 * decks per image, "<NAME> DECK LIST") for the Prebuilt Decks admin tab.
 * Admin-only. Links are fetched only from the official CDN.
 *
 * Everything is injected (Firestore, HttpsError, the fetch, the Gemini reader)
 * and this file requires no package, so the app's Vitest suite can load it in
 * CI, which does not install functions/node_modules.
 */

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const CDN_HOST = "cdn.starwarsunlimited.com";

function isOfficialImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === CDN_HOST && !url.username && !url.password;
  } catch {
    return false;
  }
}

const clean = (value, max) => (typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, max) : "");

function sanitizeDecklist(output) {
  const decks = Array.isArray(output?.decks) ? output.decks.slice(0, 4) : [];
  return {
    decks: decks.map((d) => ({
      title: clean(d?.title, 80),
      lines: (Array.isArray(d?.lines) ? d.lines.slice(0, 80) : []).map((l) => {
        const raw = clean(l?.number, 12);
        const qty = Math.min(9, Math.max(1, Math.round(Number(l?.qty)) || 1));
        return { number: raw.replace(/[^0-9A-Za-z]/g, ""), fromPreviousSet: l?.fromPreviousSet === true || raw.includes("*"), name: clean(l?.name, 100), qty };
      }).filter((l) => l.number && l.name),
    })).filter((d) => d.lines.length > 0),
  };
}

function createReadDecklistHandler({ db, appId, HttpsError, readImage, fetchImage, logger = console }) {
  return async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to read decklists.");
    const profileSnap = await db.doc(`artifacts/${appId}/users/${request.auth.uid}`).get();
    if (!(profileSnap.exists && profileSnap.data().isAdmin === true)) {
      throw new HttpsError("permission-denied", "Reading decklists is for admins.");
    }

    const { imageUrl, image, mimeType } = request.data ?? {};
    if (Boolean(imageUrl) === Boolean(image)) {
      throw new HttpsError("invalid-argument", "Send an image link or an uploaded image.");
    }

    let data;
    let type;
    if (imageUrl) {
      if (!isOfficialImageUrl(imageUrl)) {
        throw new HttpsError("invalid-argument", "Only official starwarsunlimited.com images can be read.");
      }
      let fetched;
      try {
        fetched = await fetchImage(imageUrl);
      } catch (err) {
        logger.error("readDecklist download failed", { error: err.message });
        throw new HttpsError("unavailable", "Couldn't download the image.");
      }
      type = String(fetched?.contentType ?? "").split(";")[0].trim();
      if (!IMAGE_TYPES.includes(type)) throw new HttpsError("invalid-argument", "That link is not an image.");
      if (!fetched.bytes || fetched.bytes.length > MAX_IMAGE_BYTES) throw new HttpsError("invalid-argument", "The image is larger than 8 MB.");
      data = fetched.bytes.toString("base64");
    } else {
      if (typeof image !== "string" || !BASE64.test(image)) throw new HttpsError("invalid-argument", "image must be base64.");
      if (!IMAGE_TYPES.includes(mimeType)) throw new HttpsError("invalid-argument", "Upload a PNG, JPEG or WebP image.");
      if (Math.floor(image.length * 3 / 4) > MAX_IMAGE_BYTES) throw new HttpsError("invalid-argument", "The image is larger than 8 MB.");
      data = image;
      type = mimeType;
    }

    let output;
    try {
      output = await readImage(data, type);
    } catch (err) {
      logger.error("readDecklist reading failed", { error: err.message });
      throw new HttpsError("internal", "Couldn't read the decklist.");
    }
    return sanitizeDecklist(output);
  };
}

module.exports = { createReadDecklistHandler, isOfficialImageUrl, sanitizeDecklist };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/test/functions/readDecklist.test.js`
Expected: PASS.

- [ ] **Step 5: Wire it in `functions/index.js`**

- Give `askGemini` an options argument: `async function askGemini(imageBase64, prompt, schema, { mimeType = "image/jpeg", maxOutputTokens = 256 } = {})`. Use `mimeType` in `inlineData` and `maxOutputTokens` in `config`. The existing callers are unchanged.
- After the `locateCard` export, add:

```js
/**
 * readDecklist -- reads an official decklist image for the Prebuilt Decks
 * admin tab. Admin-only; links only from the official CDN. See
 * functions/readDecklist.js. Returns lines; the client resolves them to cards.
 */
const { createReadDecklistHandler } = require("./readDecklist");

const DECKLIST_PROMPT = `This image is an official Star Wars: Unlimited decklist graphic. It holds one or more deck lists, each under a heading like "LEIA ORGANA DECK LIST".
For each deck return:
- title: the heading without the words "DECK LIST".
- lines: every card row, reading the left column top to bottom, then the right column top to bottom.
Each row shows a small icon, a collector number that may end in an asterisk (*), the card name, and a quantity such as "x3".
For each row return number (the digits exactly as printed, keeping leading zeros, without the asterisk), fromPreviousSet (true only if the number has an asterisk), name (exactly as printed) and qty (the number after "x").
Ignore footnotes, QR codes, rules text and anything that is not a card row.`;

const DECKLIST_SCHEMA = {
  type: "object",
  properties: {
    decks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          lines: {
            type: "array",
            items: {
              type: "object",
              properties: {
                number: { type: "string" },
                fromPreviousSet: { type: "boolean" },
                name: { type: "string" },
                qty: { type: "integer" },
              },
              required: ["number", "fromPreviousSet", "name", "qty"],
            },
          },
        },
        required: ["title", "lines"],
      },
    },
  },
  required: ["decks"],
};

async function fetchOfficialImage(url) {
  // Never follow a redirect off the checked host.
  const res = await fetch(url, { redirect: "error" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { contentType: res.headers.get("content-type") ?? "", bytes: Buffer.from(await res.arrayBuffer()) };
}

const readDecklistHandler = createReadDecklistHandler({
  db: admin.firestore(),
  appId: APP_ID,
  HttpsError,
  logger,
  fetchImage: fetchOfficialImage,
  readImage: (data, mimeType) => askGemini(data, DECKLIST_PROMPT, DECKLIST_SCHEMA, { mimeType, maxOutputTokens: 4096 }),
});

exports.readDecklist = onCall({ maxInstances: 2, timeoutSeconds: 120, memory: "512MiB" }, readDecklistHandler);
```

Run: `node -e "require('./functions/readDecklist.js'); console.log('ok')"`
Expected: `ok`. (`index.js` needs `functions/node_modules`, which may be absent locally; it is checked at deploy.)

- [ ] **Step 6: Commit**

```bash
npx vitest run src/test/functions/readDecklist.test.js && L=$(npx eslint src --ext js,jsx --quiet 2>/dev/null); [ -n "$L" ] && echo "$L" || { git add functions/readDecklist.js functions/index.js src/test/functions/readDecklist.test.js && git commit -m "feat(precons): readDecklist function reads official decklist images"; }
```

---

### Task 2: Resolving lines to cards

**Files:**
- Create: `src/utils/decklistImage.js`
- Test: `src/test/utils/decklistImage.test.js`

**Interfaces:**
- Produces:
  - `isOfficialImageUrl(url)`: the browser copy of Task 1's check.
  - `setFromImageUrl(url, registry) → setCode | null`, where `registry` = `[{ code, isBaseSet, releaseDate }]`.
  - `normalizeName(s)`.
  - `earlierBaseSets(setCode, registry) → setCode[]` (newest first).
  - `resolveDecklistLine(line, { setCode, cardsBySet, earlierSets })` → `{ card }` | `{ error: 'name-mismatch', candidate }` | `{ error: 'not-found' }`.
  - `titleCase(s)`.
  - `deckCounts(entries)` where entries = `[{ card, qty }]` → `{ leaders, bases, main }`.
  - `buildPrebuiltDeck({ title, entries, setCode })` → `{ sourceId, sourceName, leaders, base, cards: [{ id, qty }] }`.
  - Card objects are card-database records `{ Set, Number, Name, Subtitle, Type }`.

- [ ] **Step 1: Write the failing test** (`src/test/utils/decklistImage.test.js`)

```js
import { describe, it, expect } from 'vitest';
import {
  isOfficialImageUrl, setFromImageUrl, normalizeName, earlierBaseSets, resolveDecklistLine, titleCase, deckCounts, buildPrebuiltDeck,
} from '../../utils/decklistImage';

const REGISTRY = [
  { code: 'SOR', isBaseSet: true, releaseDate: '2024-03-08' },
  { code: 'SHD', isBaseSet: true, releaseDate: '2024-07-12' },
  { code: 'TWI', isBaseSet: true, releaseDate: '2024-11-08' },
  { code: 'JTL', isBaseSet: true, releaseDate: '2025-03-14' },
  { code: 'JTLOP', isBaseSet: false, releaseDate: '2025-03-14' },
  { code: 'LAW', isBaseSet: true, releaseDate: '2026-03-13' },
];
const c = (Set, Number, Name, Type = 'Unit') => ({ Set, Number, Name, Subtitle: '', Type });
const CARDS = {
  JTL: [c('JTL', '009', 'Boba Fett', 'Leader'), c('JTL', '189', 'Boba Fett'), c('JTL', '240', "Fett's Firespray"), c('JTL', '130', 'Somebody Else'), c('JTL', '024', 'Echo Base', 'Base')],
  TWI: [c('TWI', '184', "Fett's Firespray")],
  SHD: [c('SHD', '130', 'First Legion Snowtrooper'), c('SHD', '184', 'Not It')],
  SOR: [],
};
const ctx = { setCode: 'JTL', cardsBySet: CARDS, earlierSets: ['TWI', 'SHD', 'SOR'] };
const line = (number, name, fromPreviousSet = false, qty = 1) => ({ number, name, fromPreviousSet, qty });

describe('links and sets', () => {
  it('accepts only official CDN links', () => {
    expect(isOfficialImageUrl('https://cdn.starwarsunlimited.com//large_SWH_04_x.jpg')).toBe(true);
    expect(isOfficialImageUrl('https://cdn.starwarsunlimited.com.evil.com/x.png')).toBe(false);
  });
  it('reads the set number from the file name', () => {
    expect(setFromImageUrl('https://cdn.starwarsunlimited.com//large_SWH_04_Article_Spotlight_Decks_Decklist_v02_1f4852aef7.jpg', REGISTRY)).toBe('JTL');
    expect(setFromImageUrl('https://cdn.starwarsunlimited.com//large_SWH_07_P2_Spotlight.png', REGISTRY)).toBe('LAW');
    expect(setFromImageUrl('https://cdn.starwarsunlimited.com/other.png', REGISTRY)).toBeNull();
    expect(setFromImageUrl(null, REGISTRY)).toBeNull();
  });
  it('lists earlier base sets, newest first', () => {
    expect(earlierBaseSets('JTL', REGISTRY)).toEqual(['TWI', 'SHD', 'SOR']);
  });
  it('normalises names', () => {
    expect(normalizeName("LEIA’S DISGUISE")).toBe(normalizeName("Leia's Disguise"));
    expect(normalizeName('Daimyo’s Palace')).toBe(normalizeName("Daimyo's Palace"));
    expect(normalizeName('BoShek')).toBe(normalizeName('Bo-Shek'));
  });
  it('title-cases a shouted heading', () => {
    expect(titleCase('BOBA FETT')).toBe('Boba Fett');
    expect(titleCase('THE MANDALORIAN')).toBe('The Mandalorian');
  });
});

describe('resolveDecklistLine', () => {
  it('resolves a plain line in the deck set by number and name', () => {
    expect(resolveDecklistLine(line('9', 'Boba Fett'), ctx).card.Number).toBe('009');
    expect(resolveDecklistLine(line('189', 'BOBA FETT'), ctx).card.Number).toBe('189');
  });
  it('resolves a starred line in an earlier set, even when the number exists in this set', () => {
    const r = resolveDecklistLine(line('130', 'First Legion Snowtrooper', true), ctx);
    expect(r.card).toMatchObject({ Set: 'SHD', Number: '130' });
  });
  it('takes the newest earlier set that agrees on number and name', () => {
    expect(resolveDecklistLine(line('184', "Fett's Firespray", true), ctx).card.Set).toBe('TWI');
  });
  it('never accepts a number whose name disagrees', () => {
    const r = resolveDecklistLine(line('240', 'Boba Fett'), ctx);
    expect(r).toMatchObject({ error: 'name-mismatch' });
    expect(r.candidate.Name).toBe("Fett's Firespray");
  });
  it('falls back to earlier sets for an unstarred line, and says not-found otherwise', () => {
    expect(resolveDecklistLine(line('130', 'First Legion Snowtrooper'), ctx).card.Set).toBe('SHD');
    expect(resolveDecklistLine(line('777', 'Nobody'), ctx)).toEqual({ error: 'not-found' });
  });
});

describe('building the deck', () => {
  const entries = [
    { card: CARDS.JTL[0], qty: 1 }, { card: CARDS.JTL[4], qty: 1 },
    { card: CARDS.JTL[1], qty: 2 }, { card: CARDS.TWI[0], qty: 1 }, { card: CARDS.JTL[1], qty: 1 },
  ];
  it('counts leaders, bases and the main deck', () => {
    expect(deckCounts(entries)).toEqual({ leaders: 1, bases: 1, main: 4 });
  });
  it('builds a prebuilt deck with merged quantities, leaders and base', () => {
    expect(buildPrebuiltDeck({ title: 'BOBA FETT', entries, setCode: 'JTL' })).toEqual({
      sourceId: 'img-jtl-boba-fett',
      sourceName: 'Boba Fett',
      leaders: ['JTL_009'],
      base: 'JTL_024',
      cards: [{ id: 'JTL_009', qty: 1 }, { id: 'JTL_024', qty: 1 }, { id: 'JTL_189', qty: 3 }, { id: 'TWI_184', qty: 1 }],
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/test/utils/decklistImage.test.js`
Expected: FAIL — cannot resolve `../../utils/decklistImage`.

- [ ] **Step 3: Implement `src/utils/decklistImage.js`**

```js
/**
 * Official decklist images (two decks per image, "<NAME> DECK LIST") read by
 * the readDecklist function, resolved here to cards. The image never prints a
 * set code: a plain number is in the deck's set, an asterisked one is "a card
 * from a previous set". Like the scanner, a line is only accepted when the
 * number and the name agree. Pure.
 */
import { SET_CODE_MAP } from './officialCodeUtils';
import { cardKey } from './prebuiltDecks';

const CDN_HOST = 'cdn.starwarsunlimited.com';

export function isOfficialImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === CDN_HOST && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** "…/large_SWH_04_…" -> the registry's code for official set 04 (JTL). */
export function setFromImageUrl(url, registry) {
  const match = String(url ?? '').match(/SWH_(\d{2})/);
  if (!match) return null;
  const codes = Object.entries(SET_CODE_MAP).filter(([k, v]) => /^[A-Z]/.test(k) && v === match[1]).map(([k]) => k);
  const known = new Set((registry ?? []).map((s) => s.code));
  return codes.find((code) => known.has(code)) ?? null;
}

export const normalizeName = (s) => String(s ?? '')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

export function earlierBaseSets(setCode, registry) {
  const own = (registry ?? []).find((s) => s.code === setCode);
  return (registry ?? [])
    .filter((s) => s.isBaseSet && s.code !== setCode && (!own?.releaseDate || (s.releaseDate ?? '') < own.releaseDate))
    .sort((a, b) => String(b.releaseDate ?? '').localeCompare(String(a.releaseDate ?? '')))
    .map((s) => s.code);
}

const pad = (n) => (/^\d+$/.test(String(n)) ? String(n).padStart(3, '0') : String(n));
const atNumber = (cards, number) => (cards ?? []).find((card) => pad(card.Number) === pad(number));

export function resolveDecklistLine(line, { setCode, cardsBySet, earlierSets }) {
  const wanted = normalizeName(line.name);
  const agrees = (card) => card && normalizeName(card.Name) === wanted;
  const own = line.fromPreviousSet ? null : atNumber(cardsBySet[setCode], line.number);
  if (agrees(own)) return { card: own };
  for (const code of earlierSets ?? []) {
    const card = atNumber(cardsBySet[code], line.number);
    if (agrees(card)) return { card };
  }
  if (own) return { error: 'name-mismatch', candidate: own };
  return { error: 'not-found' };
}

export const titleCase = (s) => String(s ?? '').trim().toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());

const isLeader = (card) => card?.Type === 'Leader';
const isBase = (card) => card?.Type === 'Base';

export function deckCounts(entries) {
  const sum = (pred) => (entries ?? []).filter((e) => pred(e.card)).reduce((s, e) => s + e.qty, 0);
  return { leaders: sum(isLeader), bases: sum(isBase), main: sum((card) => !isLeader(card) && !isBase(card)) };
}

const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck';

export function buildPrebuiltDeck({ title, entries, setCode }) {
  const qty = new Map();
  for (const { card, qty: n } of entries ?? []) {
    const id = cardKey(card.Set, card.Number);
    qty.set(id, (qty.get(id) ?? 0) + n);
  }
  const ids = (pred) => [...new Set((entries ?? []).filter((e) => pred(e.card)).map((e) => cardKey(e.card.Set, e.card.Number)))];
  return {
    sourceId: `img-${String(setCode).toLowerCase()}-${slug(title)}`,
    sourceName: titleCase(title),
    leaders: ids(isLeader),
    base: ids(isBase)[0] ?? null,
    cards: [...qty].map(([id, n]) => ({ id, qty: n })).sort((a, b) => a.id.localeCompare(b.id)),
  };
}
```

Note: the accent-stripping character class above is the combining-mark range U+0300–U+036F. Write it as `/[̀-ͯ]/g`. That escape is safe; only the U+FEFF escape is forbidden. The plan text shows the literal characters only because of how it was rendered.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/test/utils/decklistImage.test.js`
Expected: PASS. If `cardKey` is not exported from `prebuiltDecks.js`, export it there (it already exists as `export const cardKey`).

- [ ] **Step 5: Commit**

```bash
npx vitest run src/test/utils/decklistImage.test.js && L=$(npx eslint src --ext js,jsx --quiet 2>/dev/null); [ -n "$L" ] && echo "$L" || { git add src/utils/decklistImage.js src/test/utils/decklistImage.test.js && git commit -m "feat(precons): resolve decklist image lines by number and name"; }
```

---

### Task 3: Service — read an image, save a deck for review

**Files:**
- Modify: `src/services/PrebuiltDeckService.js`
- Test: `src/test/services/PrebuiltDeckService.test.js`

**Interfaces:**
- Consumes: the `readDecklist` callable (Task 1); `buildPrebuiltDeck` output (Task 2).
- Produces:
  - `PrebuiltDeckService.readDecklistImage(input, { callable } = {})` → `{ decks }` | `{ error: message }`, where `input` = `{ imageUrl }` | `{ image, mimeType }`.
  - `addFromImage(deck, { url = null, setCode })` → `{ ok: true, id }` | `{ error: 'exists' }` | `{ error }`. The stored document is `{ ...deck, issues: [], sourceUpdatedAt: null, typeId: null, suggestedProduct: null, product: null, name: deck.sourceName, status: 'review', fetchedAt, source: { type: 'image', url, setCode } }`.

- [ ] **Step 1: Write the failing tests** (add inside the existing `describe('PrebuiltDeckService', …)`)

```js
  const IMG_DECK = { sourceId: 'img-jtl-boba-fett', sourceName: 'Boba Fett', leaders: ['JTL_009'], base: 'JTL_024', cards: [{ id: 'JTL_009', qty: 1 }] };

  it('saves a deck read from an image for review, with its source', async () => {
    expect(await PrebuiltDeckService.addFromImage(IMG_DECK, { url: 'https://cdn.starwarsunlimited.com/x.png', setCode: 'JTL' })).toEqual({ ok: true, id: 'img-jtl-boba-fett' });
    expect(store.docs.get(`${P}/img-jtl-boba-fett`)).toMatchObject({
      status: 'review', name: 'Boba Fett', issues: [], product: null, leaders: ['JTL_009'],
      source: { type: 'image', url: 'https://cdn.starwarsunlimited.com/x.png', setCode: 'JTL' },
    });
  });

  it('never overwrites a deck already stored under that id', async () => {
    store.docs.set(`${P}/img-jtl-boba-fett`, { status: 'published' });
    expect(await PrebuiltDeckService.addFromImage(IMG_DECK, { setCode: 'JTL' })).toEqual({ error: 'exists' });
    expect(store.docs.get(`${P}/img-jtl-boba-fett`).status).toBe('published');
  });

  it('reads a decklist image through the function, and reports its error', async () => {
    const callable = vi.fn(async () => ({ data: { decks: [{ title: 'X', lines: [] }] } }));
    expect(await PrebuiltDeckService.readDecklistImage({ imageUrl: 'u' }, { callable })).toEqual({ decks: [{ title: 'X', lines: [] }] });
    expect(callable).toHaveBeenCalledWith({ imageUrl: 'u' });
    const failing = vi.fn(async () => { throw Object.assign(new Error('Only official starwarsunlimited.com images can be read.'), { code: 'functions/invalid-argument' }); });
    expect(await PrebuiltDeckService.readDecklistImage({ imageUrl: 'u' }, { callable: failing })).toEqual({ error: 'Only official starwarsunlimited.com images can be read.' });
  });
```

(`P` is the file's existing prebuiltDecks path constant. Use whatever that file names it.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/test/services/PrebuiltDeckService.test.js`
Expected: FAIL — `addFromImage` / `readDecklistImage` are not functions.

- [ ] **Step 3: Implement** — add `import { getFunctions, httpsCallable } from 'firebase/functions';` and these methods to `PrebuiltDeckService`:

```js
  /** An official decklist image, read by the readDecklist function (admins). */
  async readDecklistImage(input, { callable } = {}) {
    try {
      const call = callable ?? httpsCallable(getFunctions(), 'readDecklist');
      const res = await call(input);
      return { decks: res?.data?.decks ?? [] };
    } catch (err) {
      return { error: err?.message || "Couldn't read the decklist." };
    }
  },

  /** A deck resolved from a decklist image, saved for review. Never overwrites. */
  async addFromImage(deck, { url = null, setCode }) {
    try {
      if ((await getDoc(deckRef(deck.sourceId))).exists()) return { error: 'exists' };
      await setDoc(deckRef(deck.sourceId), {
        ...deck, issues: [], sourceUpdatedAt: null, typeId: null, suggestedProduct: null, product: null,
        name: deck.sourceName, status: 'review', fetchedAt: new Date().toISOString(),
        source: { type: 'image', url, setCode },
      });
      return { ok: true, id: deck.sourceId };
    } catch (err) {
      return fail(err);
    }
  },
```

If the service test file's `firebase/functions` is not mocked, add `vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(), httpsCallable: vi.fn() }));` at its top.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/test/services/PrebuiltDeckService.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx vitest run src/test/services/PrebuiltDeckService.test.js && L=$(npx eslint src --ext js,jsx --quiet 2>/dev/null); [ -n "$L" ] && echo "$L" || { git add src/services/PrebuiltDeckService.js src/test/services/PrebuiltDeckService.test.js && git commit -m "feat(precons): read decklist images and save their decks for review"; }
```

---

### Task 4: Admin UI — Add from decklist image

**Files:**
- Create: `src/components/DecklistImageImport.jsx`
- Modify: `src/components/AdminPrebuiltDecks.jsx`
- Test: `src/components/__tests__/DecklistImageImport.test.jsx`, `src/components/__tests__/AdminPrebuiltDecks.test.jsx`

**Interfaces:**
- Consumes: Tasks 2 and 3; `CardPickerModal` (`{ collectionData, onSelect(card), onClose, initialSearch }`); `CardService.getSetRegistry()`; `loadSet(code) → { cards }`.
- Produces: `<DecklistImageImport onSaved service? loadSetImpl? getRegistry? />`, a section labelled "Add from decklist image". It contains:
  - a link input `aria-label="Decklist image link"`, the buttons **Read image** and **Upload image** (a file input with `aria-label="Decklist image file"`), and a set `<select aria-label="Deck set">`;
  - one `<section aria-label="<deck title>">` per deck, with an editable `aria-label="Deck name"` input and counts `data-testid="deck-counts"`;
  - rows `data-testid="decklist-row"`. A resolved row shows `SET NNN Name`. An unresolved row shows a red reason plus **Pick card** and **Remove**;
  - a warning "Main deck has N cards (usually 50)" when the main count isn't 50;
  - **Save as review**, disabled while any row is unresolved;
  - after saving, a status line per deck: "Saved <name>" or "<name> is already in Prebuilt Decks".

- [ ] **Step 1: Write the failing test** (`src/components/__tests__/DecklistImageImport.test.jsx`)

```jsx
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import React from 'react';
vi.mock('../CardPickerModal', () => ({
  default: ({ onSelect }) => <button type="button" onClick={() => onSelect({ Set: 'JTL', Number: '200', Name: 'Shuttle Tydirium', Type: 'Unit' })}>pick-it</button>,
}));
import DecklistImageImport from '../DecklistImageImport';

const URL = 'https://cdn.starwarsunlimited.com//large_SWH_04_Article_Spotlight_Decks_Decklist_v02_1f4852aef7.jpg';
const REGISTRY = [
  { code: 'TWI', isBaseSet: true, releaseDate: '2024-11-08' },
  { code: 'JTL', isBaseSet: true, releaseDate: '2025-03-14' },
];
const card = (Set, Number, Name, Type = 'Unit') => ({ Set, Number, Name, Type });
const SETS = {
  JTL: [card('JTL', '017', 'Han Solo', 'Leader'), card('JTL', '024', 'Echo Base', 'Base'), card('JTL', '249', 'Millennium Falcon')],
  TWI: [card('TWI', '114', 'Clone Commander Cody')],
};
const DECKS = [{ title: 'HAN SOLO', lines: [
  { number: '17', fromPreviousSet: false, name: 'Han Solo', qty: 1 },
  { number: '024', fromPreviousSet: false, name: 'Echo Base', qty: 1 },
  { number: '249', fromPreviousSet: false, name: 'Millennium Falcon', qty: 3 },
  { number: '114', fromPreviousSet: true, name: 'Clone Commander Cody', qty: 1 },
  { number: '200', fromPreviousSet: false, name: 'Shuttle Tydirium', qty: 3 },
] }];
let service; let loadSetImpl; let onSaved;
beforeEach(() => {
  service = {
    readDecklistImage: vi.fn(async () => ({ decks: DECKS })),
    addFromImage: vi.fn(async (deck) => ({ ok: true, id: deck.sourceId })),
  };
  loadSetImpl = vi.fn(async (code) => ({ cards: SETS[code] ?? [] }));
  onSaved = vi.fn();
});
const open = () => render(<DecklistImageImport onSaved={onSaved} service={service} loadSetImpl={loadSetImpl} getRegistry={async () => REGISTRY} />);
const read = async () => {
  fireEvent.change(screen.getByLabelText('Decklist image link'), { target: { value: URL } });
  fireEvent.click(screen.getByRole('button', { name: 'Read image' }));
  return screen.findByRole('region', { name: 'Han Solo' });
};

describe('DecklistImageImport', () => {
  it('reads an official image, guesses the set and resolves the lines', async () => {
    open();
    const deck = await read();
    expect(service.readDecklistImage).toHaveBeenCalledWith({ imageUrl: URL });
    expect(screen.getByLabelText('Deck set')).toHaveValue('JTL');
    await waitFor(() => expect(within(deck).getByText('TWI 114 Clone Commander Cody')).toBeInTheDocument());
    expect(within(deck).getByText('JTL 017 Han Solo')).toBeInTheDocument();
    expect(within(deck).getByText(/not found/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save as review' })).toBeDisabled();
  });

  it('refuses a link that is not on the official CDN without calling the function', async () => {
    open();
    fireEvent.change(screen.getByLabelText('Decklist image link'), { target: { value: 'https://evil.com/x.png' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read image' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only official starwarsunlimited.com images');
    expect(service.readDecklistImage).not.toHaveBeenCalled();
  });

  it('fixes an unresolved line with the card picker, warns on the count, then saves', async () => {
    open();
    const deck = await read();
    await within(deck).findByText(/not found/i);
    fireEvent.click(within(deck).getByRole('button', { name: /Pick card/ }));
    fireEvent.click(screen.getByText('pick-it'));
    expect(within(deck).getByText('JTL 200 Shuttle Tydirium')).toBeInTheDocument();
    expect(within(deck).getByText(/Main deck has 7 cards/)).toBeInTheDocument();
    fireEvent.change(within(deck).getByLabelText('Deck name'), { target: { value: 'HAN SOLO SPOTLIGHT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as review' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [saved, meta] = service.addFromImage.mock.calls[0];
    expect(saved).toMatchObject({ sourceId: 'img-jtl-han-solo-spotlight', leaders: ['JTL_017'], base: 'JTL_024' });
    expect(saved.cards).toContainEqual({ id: 'JTL_200', qty: 3 });
    expect(meta).toEqual({ url: URL, setCode: 'JTL' });
    expect(screen.getByText('Saved Han Solo Spotlight')).toBeInTheDocument();
  });

  it('can remove a line instead', async () => {
    open();
    const deck = await read();
    await within(deck).findByText(/not found/i);
    fireEvent.click(within(deck).getByRole('button', { name: /Remove/ }));
    expect(screen.getByRole('button', { name: 'Save as review' })).not.toBeDisabled();
  });

  it('re-resolves when the set is changed, without reading the image again', async () => {
    open();
    await read();
    await waitFor(() => expect(loadSetImpl).toHaveBeenCalledWith('JTL'));
    fireEvent.change(screen.getByLabelText('Deck set'), { target: { value: 'TWI' } });
    await waitFor(() => expect(screen.getAllByText(/not found|doesn't match/i).length).toBeGreaterThan(1));
    expect(service.readDecklistImage).toHaveBeenCalledTimes(1);
  });

  it('says when a deck is already stored', async () => {
    service.addFromImage.mockResolvedValue({ error: 'exists' });
    open();
    const deck = await read();
    await within(deck).findByText(/not found/i);
    fireEvent.click(within(deck).getByRole('button', { name: /Remove/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save as review' }));
    expect(await screen.findByText('Han Solo is already in Prebuilt Decks')).toBeInTheDocument();
  });
});
```

In `AdminPrebuiltDecks.test.jsx`, mock the importer (`vi.mock('../DecklistImageImport', () => ({ default: () => <div>decklist-importer</div> }))`) and add a test that the tab renders `decklist-importer`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/__tests__/DecklistImageImport.test.jsx src/components/__tests__/AdminPrebuiltDecks.test.jsx`
Expected: FAIL — cannot resolve `../DecklistImageImport`; the importer is not in the tab.

- [ ] **Step 3: Implement `src/components/DecklistImageImport.jsx`**

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import CardPickerModal from './CardPickerModal';
import { PrebuiltDeckService } from '../services/PrebuiltDeckService';
import { CardService } from '../services/CardService';
import { loadSet } from '../services/setLoader';
import {
  buildPrebuiltDeck, deckCounts, earlierBaseSets, isOfficialImageUrl, resolveDecklistLine, setFromImageUrl, titleCase,
} from '../utils/decklistImage';

const REASON = { 'not-found': 'Not found in this set or earlier ones', 'name-mismatch': "Number found, but the name doesn't match" };
const btn = 'px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-40';

// @environment:web-file-api
const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

/** Precons from an official decklist image: read, resolve, fix, save for review. */
export default function DecklistImageImport({
  onSaved, service = PrebuiltDeckService, loadSetImpl = loadSet, getRegistry = () => CardService.getSetRegistry(),
}) {
  const [url, setUrl] = useState('');
  const [registry, setRegistry] = useState([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState(null);
  const [source, setSource] = useState(null); // { url } of what was read
  const [decks, setDecks] = useState([]); // [{ title, lines }]
  const [setCode, setSetCode] = useState('');
  const [cardsBySet, setCardsBySet] = useState({});
  const [titles, setTitles] = useState({});
  const [overrides, setOverrides] = useState({}); // "d:i" -> card | 'removed'
  const [picking, setPicking] = useState(null); // { key, name }
  const [saved, setSaved] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getRegistry().then((r) => setRegistry(r ?? [])).catch(() => setRegistry([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- load once

  const earlier = useMemo(() => (setCode ? earlierBaseSets(setCode, registry) : []), [setCode, registry]);

  // Card data for the deck's set and the earlier ones (IndexedDB cache).
  useEffect(() => {
    if (!setCode || decks.length === 0) return undefined;
    let cancelled = false;
    const codes = [setCode, ...earlier].filter((code) => !(code in cardsBySet));
    Promise.all(codes.map((code) => Promise.resolve().then(() => loadSetImpl(code)).then((r) => [code, r?.cards ?? []]).catch(() => [code, []])))
      .then((pairs) => { if (!cancelled && pairs.length) setCardsBySet((prev) => ({ ...prev, ...Object.fromEntries(pairs) })); });
    return () => { cancelled = true; };
  }, [setCode, earlier, decks]); // eslint-disable-line react-hooks/exhaustive-deps -- cardsBySet only grows

  const resolved = useMemo(() => decks.map((deck, d) => deck.lines.map((line, i) => {
    const key = `${d}:${i}`;
    const override = overrides[key];
    if (override === 'removed') return { key, line, removed: true };
    if (override) return { key, line, card: override };
    if (!setCode || !(setCode in cardsBySet)) return { key, line, pending: true };
    return { key, line, ...resolveDecklistLine(line, { setCode, cardsBySet, earlierSets: earlier }) };
  })), [decks, overrides, setCode, cardsBySet, earlier]);

  const allResolved = resolved.length > 0 && resolved.every((rows) => rows.every((r) => r.removed || r.card));

  const start = async (input, linkUrl) => {
    setError(null);
    setSaved([]);
    setReading(true);
    const res = await service.readDecklistImage(input);
    setReading(false);
    if (res.error) { setError(res.error); return; }
    if (!res.decks?.length) { setError("Couldn't find a decklist in this image."); return; }
    setDecks(res.decks);
    setOverrides({});
    setTitles({});
    setSource({ url: linkUrl });
    setSetCode(setFromImageUrl(linkUrl, registry) ?? '');
  };

  const readLink = () => {
    if (!isOfficialImageUrl(url.trim())) { setError('Only official starwarsunlimited.com images can be read.'); return; }
    start({ imageUrl: url.trim() }, url.trim());
  };
  const readFile = async (file) => {
    if (!file) return;
    try {
      start({ image: await fileToBase64(file), mimeType: file.type }, null);
    } catch {
      setError("Couldn't read that file.");
    }
  };

  const save = async () => {
    setSaving(true);
    const out = [];
    for (let d = 0; d < decks.length; d++) {
      const title = titles[d] ?? decks[d].title;
      const entries = resolved[d].filter((r) => r.card).map((r) => ({ card: r.card, qty: r.line.qty }));
      const deck = buildPrebuiltDeck({ title, entries, setCode });
      const res = await service.addFromImage(deck, { url: source?.url ?? null, setCode });
      out.push(res.ok ? `Saved ${deck.sourceName}` : res.error === 'exists' ? `${deck.sourceName} is already in Prebuilt Decks` : `Couldn't save ${deck.sourceName}`);
    }
    setSaving(false);
    setSaved(out);
    onSaved?.();
  };

  return (
    <section aria-label="Add from decklist image" className="rounded-xl bg-gray-800 border border-gray-700 p-3 space-y-3">
      <p className="text-sm text-gray-300">
        Official decklist images (starwarsunlimited.com articles) list two decks each. Paste the image link or upload it.
      </p>
      <div className="flex flex-wrap gap-2">
        <input aria-label="Decklist image link" value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://cdn.starwarsunlimited.com/…Decklist….png"
          className="flex-1 min-w-0 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm" />
        <button type="button" disabled={reading} onClick={readLink} className={`${btn} bg-blue-600 hover:bg-blue-500 text-white`}>
          {reading ? 'Reading…' : 'Read image'}
        </button>
        <label className={`${btn} bg-gray-700 hover:bg-gray-600 cursor-pointer`}>
          Upload image
          <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Decklist image file" className="hidden"
            onChange={(e) => readFile(e.target.files?.[0])} />
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}

      {decks.length > 0 && (
        <>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            Set
            <select aria-label="Deck set" value={setCode} onChange={(e) => setSetCode(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1">
              <option value="">Choose…</option>
              {registry.map((s) => <option key={s.code} value={s.code}>{s.code}{s.name ? ` — ${s.name}` : ''}</option>)}
            </select>
          </label>

          {decks.map((deck, d) => {
            const title = titleCase(titles[d] ?? deck.title);
            const counts = deckCounts(resolved[d].filter((r) => r.card).map((r) => ({ card: r.card, qty: r.line.qty })));
            return (
              <section key={d} aria-label={title} className="rounded-lg border border-gray-700 p-2 space-y-2">
                <input aria-label="Deck name" value={titles[d] ?? deck.title} onChange={(e) => setTitles((t) => ({ ...t, [d]: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-sm font-semibold" />
                <p data-testid="deck-counts" className="text-xs text-gray-400">
                  Leader {counts.leaders} · Base {counts.bases} · Main deck {counts.main}
                </p>
                {counts.main !== 50 && <p className="text-xs text-yellow-300">Main deck has {counts.main} cards (usually 50)</p>}
                <ul className="divide-y divide-gray-700">
                  {resolved[d].map((r) => (
                    <li key={r.key} data-testid="decklist-row" className={`py-1 flex flex-wrap items-center gap-2 text-sm ${r.removed ? 'opacity-40 line-through' : ''}`}>
                      <span className="w-48 shrink-0 text-gray-400">{r.line.number}{r.line.fromPreviousSet ? '*' : ''} {r.line.name} ×{r.line.qty}</span>
                      {r.card && <span className="text-gray-100">{`${r.card.Set} ${String(r.card.Number).padStart(3, '0')} ${r.card.Name}`}</span>}
                      {r.pending && <span className="text-gray-500">Loading cards…</span>}
                      {r.error && !r.removed && (
                        <>
                          <span className="text-red-300">{REASON[r.error]}</span>
                          <button type="button" onClick={() => setPicking({ key: r.key, name: r.line.name })} className="text-blue-300 underline">Pick card for {r.line.name}</button>
                          <button type="button" onClick={() => setOverrides((o) => ({ ...o, [r.key]: 'removed' }))} className="text-gray-300 underline">Remove {r.line.name}</button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          <button type="button" disabled={!allResolved || !setCode || saving} onClick={save} className={`${btn} bg-yellow-500 text-black`}>
            Save as review
          </button>
          {saved.map((msg) => <p key={msg} role="status" className="text-sm text-green-300">{msg}</p>)}
        </>
      )}

      {picking && (
        <CardPickerModal collectionData={{}} initialSearch={picking.name}
          onSelect={(card) => { setOverrides((o) => ({ ...o, [picking.key]: card })); setPicking(null); }}
          onClose={() => setPicking(null)} />
      )}
    </section>
  );
}
```

`AdminPrebuiltDecks.jsx`: import `DecklistImageImport` and render `<DecklistImageImport onSaved={load} />` directly after the paste-a-link box. Use the tab's existing reload function, the one that calls `PrebuiltDeckService.listDecks()`, whatever it is named.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/__tests__/DecklistImageImport.test.jsx src/components/__tests__/AdminPrebuiltDecks.test.jsx`
Expected: PASS. Where the plan's expected text differs from the component in a harmless way (e.g. the exact "not found" reason wording), align the test to the component's text and ledger it.

- [ ] **Step 5: Commit**

```bash
L=$(npx eslint src --ext js,jsx --quiet 2>/dev/null); [ -n "$L" ] && echo "$L" || { git add src/components/DecklistImageImport.jsx src/components/AdminPrebuiltDecks.jsx src/components/__tests__/DecklistImageImport.test.jsx src/components/__tests__/AdminPrebuiltDecks.test.jsx && git commit -m "feat(precons): add precons from an official decklist image"; }
```

---

### Task 5: Docs and the full gate

**Files:**
- Modify: `CLAUDE.md` (git root)

- [ ] **Step 1: CLAUDE.md**
  - In "Prebuilt decks", add a bullet:
    > **Official decklist images.** Most precons (Spotlight decks, Two-Player Starters) are published only as images in official articles (`cdn.starwarsunlimited.com/…SWH_0N…Decklist…`, two decks each). **Add from decklist image** in the admin tab sends the link (CDN only) or an upload to the admin-only `readDecklist` function (`functions/readDecklist.js`, Gemini). It resolves each line by number + name (`src/utils/decklistImage.js`): a plain number is in the deck's set, guessed from `SWH_0N`; `*` means an earlier base set, newest first. The admin fixes unresolved lines, and the decks are saved for review as `img-<set>-<name>`. The weekly sync never touches them.
  - Add `functions:readDecklist` to the "Functions are deployed by hand" bullet.

- [ ] **Step 2: Full gate**

Run: `npm run test:unit > /tmp/unit.txt 2>&1; tail -n 6 /tmp/unit.txt`
Expected: all pass.

Run: `npm run build 2>&1 | tail -n 3`
Expected: `✓ built in …`.

- [ ] **Step 3: Commit**

```bash
L=$(npx eslint src --ext js,jsx --quiet 2>/dev/null); [ -n "$L" ] && echo "$L" || { git add ../CLAUDE.md && git commit -m "docs: precons from official decklist images"; }
```

**After merge (needs the user's OK, not part of the plan):** `firebase deploy --only functions:readDecklist`. Then read the eight images in production and review each deck.
