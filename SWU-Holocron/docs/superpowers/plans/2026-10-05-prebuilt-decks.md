# Prebuilt Decks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Precon decks arrive weekly from sw-unlimited-db for an admin to review and publish. Collectors add a published deck (or a whole product) to their collection in one tap, recorded as a finished batch with a report.

**Architecture:**
- **Pure module:** `src/utils/prebuiltDecks.js` handles parsing, card ids, the precon product filter and product suggestion. It is Vite-free so the sync script can import it.
- **Sync step:** `scripts/prebuiltDecks.js` runs inside the weekly `cardDbSync.js` and writes `public/data/prebuiltDecks/{sourceId}` plus a precon product list at `cardDatabase/preconProducts`.
- **Client service:** `PrebuiltDeckService` covers the admin actions (review, publish, add from link) and the collector action, which reuses `ScanService.commitDraft` for the additive collection write and `BatchService` for the report.
- **UI:** an admin tab `AdminPrebuiltDecks.jsx` and a Command Center panel `PrebuiltDecksPanel.jsx`.

**Tech Stack:** Node 20 + firebase-admin (sync), React 18, Firestore v10, Vitest + Testing Library, the Firestore emulator for the rules tests.

**Spec:** `SWU-Holocron/docs/superpowers/specs/2026-10-05-prebuilt-decks-design.md`

## Global Constraints

- **Where to run things:**
  - npm/npx run from `SWU-Holocron/`.
  - Lint in the Bash tool: `npx eslint src --ext js,jsx --quiet`.
  - Gated commit: tests, then lint, then `git add` and `git commit`.
  - Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Firestore paths** (document paths, even segment counts):
  - `artifacts/{APP_ID}/public/data/prebuiltDecks/{sourceId}`
  - `artifacts/{APP_ID}/public/data/cardDatabase/preconProducts`
  - `artifacts/{APP_ID}/users/{uid}/prebuiltAdds/{sourceId}`
- **Printings:** a prebuilt deck is always the standard printing, so every collection id is `SET_NNN_std`.
- **Source:**
  - sw-unlimited-db user **3671**.
  - Deck API: `https://sw-unlimited-db.com/umbraco/api/deckapi/get?id={id}` (CORS `*`).
  - Listing: `POST https://sw-unlimited-db.com/api/proxy/api/decks/query` (server only).
  - Requests are 1 s apart, with User-Agent `SWU-Holocron/1.0.1`.
- **Failure handling:** services never throw (they return `{ error }`), and the sync step never fails the card sync (it returns `degraded`).
- **Code rules:** every hook before any conditional return, no `console.log` in `src/`, and the scripts may log.

## Review Focus

1. **A deck published by the owner and edited later** must not change what collectors add until an admin accepts it. (Task 2: `marks an edited published deck changed and keeps its published cards`.)
2. **A card in a deck that is not in our database** must be flagged and skipped when added, never added under a wrong id. (Task 1: `flags cards missing from the database`; Task 5: `skips cards flagged missing and says which`.)
3. **Bundle products** (Display, Pair, Case, 4 Deck Bundle) and single cards named "… Deck Officer" must never be suggested as a deck's product. (Task 1: `keeps only single-deck precon products`.)
4. **Adding a deck the user already added** must ask first, and must add again (not replace) when confirmed. (Task 6: `asks before adding a deck again, then adds on top`.)
5. **Twin Suns decks have two leaders, one of them in the deck list.** Both must count, once each. (Task 1: `collects both leaders of a Twin Suns deck once each`.)

---

### Task 1: Pure deck utilities (`src/utils/prebuiltDecks.js`)

**Files:** Create `src/utils/prebuiltDecks.js`; test in `src/test/utils/prebuiltDecks.test.js`.

**Interfaces (produces):**
- `SOURCE_USER_ID = 3671`
- `deckApiUrl(id)`
- `parseDeckLink(text) → number | null`
- `splitCardId('ASH_118') → { set: 'ASH', number: '118' }`
- `parseDeckApi(json, sourceId) → { sourceId, sourceName, leaders: string[], base: string|null, cards: [{ id, qty }] }`
  - `cards` holds every card, including the leaders and base.
- `findMissingCards(cards, knownIds: Set<string>) → [{ id, problem: 'unknown-card' }]`
- `isPreconProduct(name) → boolean`
- `deckSetCode(deck) → string | null`
- `suggestProduct(deck, products) → product | null`
  - `products` are `[{ tcgplayerProductId, name, setCode, imageUrl, releasedOn }]`.
- `planSync(listed, stored) → [{ sourceId, reason: 'new' | 'changed' }]`
  - `listed` is `[{ id, updatedDate }]`.
  - `stored` is `{ [sourceId]: { status, sourceUpdatedAt } }`.

- [ ] **Step 1: Failing tests**

```js
import { describe, it, expect } from 'vitest';
import {
  parseDeckLink, splitCardId, parseDeckApi, findMissingCards, isPreconProduct,
  deckSetCode, suggestProduct, planSync, deckApiUrl,
} from '../../utils/prebuiltDecks';

const PALPATINE = {
  metadata: { name: 'Emperor Palpatine (ASH)' },
  leader: { id: 'ASH_015', count: 1 },
  base: { id: 'ASH_021', count: 1 },
  deck: [
    { unit: 'Unit', id: 'ASH_118', count: 1 },
    { unit: 'Unit', id: 'SEC_185', count: 2 },
    { unit: 'Upgrade', id: 'LOF_091', count: 1 },
  ],
};
const TWIN_SUNS = {
  metadata: { name: 'Aggresive Negotiations (TS26)' },
  leader: { id: 'TS26_002', count: 1 },
  base: { id: 'TS26_011', count: 1 },
  deck: [{ unit: 'Leader', id: 'TS26_004', count: 1 }, { unit: 'Unit', id: 'SOR_160', count: 1 }],
};

describe('links and ids', () => {
  it('reads a deck id from a link or a bare number', () => {
    expect(parseDeckLink('https://sw-unlimited-db.com/decks/151901')).toBe(151901);
    expect(parseDeckLink('https://www.sw-unlimited-db.com/decks/151901/emperor-palpatine/')).toBe(151901);
    expect(parseDeckLink(' 151901 ')).toBe(151901);
    expect(parseDeckLink('https://swudb.com/deck/abc')).toBeNull();
    expect(parseDeckLink('')).toBeNull();
  });

  it('splits a card id at the last underscore', () => {
    expect(splitCardId('ASH_118')).toEqual({ set: 'ASH', number: '118' });
    expect(splitCardId('SOROP_010')).toEqual({ set: 'SOROP', number: '010' });
    expect(splitCardId('nope')).toBeNull();
  });

  it('builds the deck API url', () => {
    expect(deckApiUrl(151901)).toBe('https://sw-unlimited-db.com/umbraco/api/deckapi/get?id=151901');
  });
});

describe('parseDeckApi', () => {
  it('merges leader, base and deck into one card list', () => {
    expect(parseDeckApi(PALPATINE, 151901)).toEqual({
      sourceId: 151901,
      sourceName: 'Emperor Palpatine (ASH)',
      leaders: ['ASH_015'],
      base: 'ASH_021',
      cards: [
        { id: 'ASH_015', qty: 1 }, { id: 'ASH_021', qty: 1 },
        { id: 'ASH_118', qty: 1 }, { id: 'SEC_185', qty: 2 }, { id: 'LOF_091', qty: 1 },
      ],
    });
  });

  it('collects both leaders of a Twin Suns deck once each', () => {
    const deck = parseDeckApi(TWIN_SUNS, 147115);
    expect(deck.leaders).toEqual(['TS26_002', 'TS26_004']);
    expect(deck.cards.filter((c) => c.id === 'TS26_004')).toEqual([{ id: 'TS26_004', qty: 1 }]);
  });

  it('adds up a card listed twice, and rejects a response with no cards', () => {
    const twice = { ...PALPATINE, deck: [{ id: 'ASH_118', count: 1 }, { id: 'ASH_118', count: 2 }] };
    expect(parseDeckApi(twice, 1).cards.find((c) => c.id === 'ASH_118').qty).toBe(3);
    expect(parseDeckApi({ metadata: { name: 'x' } }, 1)).toBeNull();
    expect(parseDeckApi(null, 1)).toBeNull();
  });
});

describe('findMissingCards', () => {
  it('flags cards missing from the database', () => {
    const known = new Set(['ASH_015', 'ASH_021', 'ASH_118', 'SEC_185']);
    expect(findMissingCards(parseDeckApi(PALPATINE, 1).cards, known)).toEqual([{ id: 'LOF_091', problem: 'unknown-card' }]);
  });
});

describe('products', () => {
  const P = (name, setCode, tcgplayerProductId = name.length) => ({ tcgplayerProductId, name, setCode, imageUrl: 'i', releasedOn: 'r' });
  const PRODUCTS = [
    P('Ashes of the Empire - Spotlight Deck: Luke Skywalker', 'ASH', 1),
    P('Ashes of the Empire - Spotlight Deck: Emperor Palpatine', 'ASH', 2),
    P('Twin Suns - Aggressive Negotiations Deck', 'TS26', 3),
    P('Twin Suns - Blood Brothers Deck', 'TS26', 4),
    P('Intro Battle: Hoth - Learn to Play Kit', 'IBH', 5),
    P('Spark of Rebellion - Two-Player Starter', 'SOR', 6),
  ];

  it('keeps only single-deck precon products', () => {
    expect(isPreconProduct('Ashes of the Empire - Spotlight Deck: Emperor Palpatine')).toBe(true);
    expect(isPreconProduct('Twin Suns - Master and Apprentice Deck')).toBe(true);
    expect(isPreconProduct('Shadows of the Galaxy - Two-Player Starter')).toBe(true);
    expect(isPreconProduct('Intro Battle: Hoth - Learn to Play Kit')).toBe(true);
    expect(isPreconProduct('Ashes of the Empire - Spotlight Deck Display')).toBe(false);
    expect(isPreconProduct('Ashes of the Empire - Spotlight Deck Pair: Emperor Palpatine & Luke Skywalker')).toBe(false);
    expect(isPreconProduct('Shadows of the Galaxy - Two-Player Starter Case')).toBe(false);
    expect(isPreconProduct('Twin Suns - 4 Deck Bundle')).toBe(false);
    expect(isPreconProduct('Imperial Deck Officer')).toBe(false);
    expect(isPreconProduct('Greef Karga - Introductions are in Order')).toBe(false);
  });

  it('takes the set code from the name, else from the leader', () => {
    expect(deckSetCode(parseDeckApi(PALPATINE, 1))).toBe('ASH');
    expect(deckSetCode({ sourceName: 'Master and Apprentice', leaders: ['TS26_001'] })).toBe('TS26');
  });

  it('suggests the product with the same set and the most shared name words', () => {
    expect(suggestProduct(parseDeckApi(PALPATINE, 1), PRODUCTS).tcgplayerProductId).toBe(2);
    expect(suggestProduct(parseDeckApi(TWIN_SUNS, 1), PRODUCTS).tcgplayerProductId).toBe(3); // despite the typo
    expect(suggestProduct({ sourceName: 'Intro Battle: Hoth Vader Preset', leaders: ['IBH_053'] }, PRODUCTS).tcgplayerProductId).toBe(5);
  });

  it('suggests nothing without a product in the same set or any shared word', () => {
    expect(suggestProduct({ sourceName: 'Boba Aggression', leaders: ['JTL_010'] }, PRODUCTS)).toBeNull();
    expect(suggestProduct({ sourceName: 'Zzz (ASH)', leaders: ['ASH_001'] }, PRODUCTS)).toBeNull();
  });
});

describe('planSync', () => {
  it('fetches new decks and decks edited since they were stored, and skips ignored ones', () => {
    const listed = [
      { id: 1, updatedDate: '2026-07-01T00:00:00Z' },
      { id: 2, updatedDate: '2026-07-02T00:00:00Z' },
      { id: 3, updatedDate: '2026-09-01T00:00:00Z' },
      { id: 4, updatedDate: '2026-09-01T00:00:00Z' },
    ];
    const stored = {
      2: { status: 'published', sourceUpdatedAt: '2026-07-02T00:00:00Z' },
      3: { status: 'published', sourceUpdatedAt: '2026-07-01T00:00:00Z' },
      4: { status: 'ignored', sourceUpdatedAt: '2026-07-01T00:00:00Z' },
    };
    expect(planSync(listed, stored)).toEqual([{ sourceId: 1, reason: 'new' }, { sourceId: 3, reason: 'changed' }]);
  });
});
```

  The Intro Battle preset matches the only IBH product: the set code agrees and the product is the only candidate, even though "Vader Preset" shares no words with it. The `suggestProduct` rule below handles this: a lone candidate in the set wins outright.

- [ ] **Step 2: Run** `npx vitest run src/test/utils/prebuiltDecks.test.js`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `src/utils/prebuiltDecks.js`:

```js
/**
 * Prebuilt (precon) decks: parsing sw-unlimited-db's deck API, and matching a
 * deck to the TCGplayer product it ships in. Pure and Vite-free -- the weekly
 * sync (scripts/prebuiltDecks.js) imports it too.
 *
 * Precons always contain the standard printing of every card, so a deck's
 * `SET_NNN` ids map straight to `SET_NNN_std` collection ids.
 */
export const SOURCE_USER_ID = 3671;
const DECK_API = 'https://sw-unlimited-db.com/umbraco/api/deckapi/get?id=';

export const deckApiUrl = (id) => `${DECK_API}${id}`;

export function parseDeckLink(text) {
  const s = String(text ?? '').trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = /sw-unlimited-db\.com\/decks\/(\d+)/i.exec(s);
  return m ? Number(m[1]) : null;
}

export function splitCardId(id) {
  const i = String(id ?? '').lastIndexOf('_');
  if (i <= 0) return null;
  return { set: id.slice(0, i), number: id.slice(i + 1) };
}

export function parseDeckApi(json, sourceId) {
  if (!json?.leader?.id || !Array.isArray(json.deck)) return null;
  const qty = new Map();
  const add = (id, n) => qty.set(id, (qty.get(id) ?? 0) + (Number(n) || 1));
  add(json.leader.id, json.leader.count);
  if (json.base?.id) add(json.base.id, json.base.count);
  json.deck.forEach((c) => add(c.id, c.count));
  // Twin Suns: the second leader sits in the deck list as a "Leader" entry.
  const leaders = [json.leader.id, ...json.deck.filter((c) => c.unit === 'Leader').map((c) => c.id)];
  return {
    sourceId,
    sourceName: json.metadata?.name ?? `Deck ${sourceId}`,
    leaders: [...new Set(leaders)],
    base: json.base?.id ?? null,
    cards: [...qty].map(([id, n]) => ({ id, qty: n })),
  };
}

export function findMissingCards(cards, knownIds) {
  return cards.filter((c) => !knownIds.has(c.id)).map((c) => ({ id: c.id, problem: 'unknown-card' }));
}

// "<Set> - Spotlight Deck: X", "Twin Suns - X Deck", "<Set> - Two-Player
// Starter", "Intro Battle: Hoth - Learn to Play Kit" -- never a bundle of them.
const PRECON = /^.+ - (spotlight deck: .+|.+ deck|two-player starter|learn to play kit)$/i;
const BUNDLE = /\b(display|pair|case|bundle|box)\b/i;
export const isPreconProduct = (name) => PRECON.test(name ?? '') && !BUNDLE.test(name ?? '');

export function deckSetCode(deck) {
  const m = /\(([A-Z0-9]+)\)\s*$/.exec(deck.sourceName ?? '');
  if (m) return m[1];
  return splitCardId(deck.leaders?.[0])?.set ?? null;
}

const STOP = new Set(['deck', 'spotlight', 'the', 'and', 'of', 'preset', 'two', 'player', 'starter']);
const words = (s) => new Set(String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z0-9]+/)
  .filter((w) => w.length > 2 && !STOP.has(w)));

export function suggestProduct(deck, products) {
  const set = deckSetCode(deck);
  const candidates = products.filter((p) => p.setCode === set);
  if (candidates.length === 1) return candidates[0];
  const mine = words(deck.sourceName);
  let best = null;
  let bestScore = 0;
  for (const p of candidates) {
    const theirs = words(p.name.split(' - ').slice(1).join(' - '));
    const score = [...mine].filter((w) => theirs.has(w)).length;
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}

export function planSync(listed, stored) {
  const out = [];
  for (const deck of listed) {
    const prior = stored[deck.id];
    if (!prior) out.push({ sourceId: deck.id, reason: 'new' });
    else if (prior.status !== 'ignored' && deck.updatedDate > (prior.sourceUpdatedAt ?? '')) {
      out.push({ sourceId: deck.id, reason: 'changed' });
    }
  }
  return out;
}
```

  Checks against the tests:
  - **TS26 typo:** "aggresive" shares no word with "aggressive", but "negotiations" is shared (score 1). "Blood Brothers" scores 0, so product 3 wins.
  - **"Zzz (ASH)":** there are two ASH candidates and neither shares a word, so the result is null.
  - **"Boba Aggression":** the set is JTL and no product is in JTL, so the result is null.

- [ ] **Step 4: Run.** Expected: PASS. **Step 5: Commit** — gated, `feat(prebuilt): deck parsing and product matching`.

---

### Task 2: Weekly sync step (`scripts/prebuiltDecks.js`)

**Files:**
- Create `scripts/prebuiltDecks.js`; test in `src/test/scripts/prebuiltDecksSync.test.js`.
- Modify `scripts/cardDbSync.js`.

**Interfaces:**
- Consumes Task 1.
- Produces `syncPrebuiltDecks({ db, appId, fetchImpl = fetch, wait = sleep, now = () => new Date().toISOString() }) → { success: true, degraded?, added: number[], changed: number[], products: number, error? }`.
- Writes:
  - `prebuiltDecks/{id}`, as `{ sourceId, sourceName, sourceUpdatedAt, typeId, leaders, base, cards, issues, suggestedProduct, name, status, fetchedAt }` (Spec §1).
  - `cardDatabase/preconProducts`, as `{ products, updatedAt }`.

  The rules for `prebuiltDecks/{id}` writes:
  - **New deck:** `status: 'review'`, `product: null`.
  - **Changed deck:** writes `pending: { cards, leaders, base, issues, sourceUpdatedAt }` and `status: 'changed'`, and leaves the published `cards` untouched.

- [ ] **Step 1: Failing tests.** Use a fake Admin-SDK Firestore (`collection().doc().get()/set()`, path-keyed map) and a scripted `fetchImpl`:

```js
import { describe, it, expect, vi } from 'vitest';
import { syncPrebuiltDecks } from '../../../scripts/prebuiltDecks.js';

function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const ref = (path) => ({
    collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`), get: async () => ({ docs: [...docs].filter(([p]) => p.startsWith(`${path}/${name}/`) && p.split('/').length === path.split('/').length + 2).map(([p, d]) => ({ id: p.split('/').pop(), data: () => d })) }) }),
    doc: (id) => ref(`${path}/${id}`),
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    set: async (data, opts) => { docs.set(path, opts?.merge ? { ...docs.get(path), ...data } : data); },
  });
  return { docs, collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }) };
}

const BASE = 'artifacts/app/public/data';
const json = (body, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body, text: async () => JSON.stringify(body) });
const PALPATINE = { metadata: { name: 'Emperor Palpatine (ASH)' }, leader: { id: 'ASH_015', count: 1 }, base: { id: 'ASH_021', count: 1 }, deck: [{ unit: 'Unit', id: 'ASH_118', count: 3 }] };

function fetcher({ listed, decks, groups = [], products = {} }) {
  return vi.fn(async (url, init) => {
    if (url.includes('/decks/query')) return json({ items: listed, totalPages: 1 });
    const id = /deckapi\/get\?id=(\d+)/.exec(url)?.[1];
    if (id) return json(decks[id]);
    if (url.endsWith('/groups')) return json({ results: groups });
    const g = /\/79\/(\d+)\/products/.exec(url)?.[1];
    if (g) return json({ results: products[g] ?? [] });
    return json({}, false);
  });
}

const seedCards = {
  [`${BASE}/cardDatabase/sets`]: { sets: [{ code: 'ASH' }] },
  [`${BASE}/cardDatabase/sets/ASH/data`]: { cards: [{ Set: 'ASH', Number: '015' }, { Set: 'ASH', Number: '021' }] },
};
const groups = [{ groupId: 9, name: 'Ashes of the Empire', abbreviation: 'ASH' }];
const products = { 9: [
  { productId: 2, name: 'Ashes of the Empire - Spotlight Deck: Emperor Palpatine', imageUrl: 'img', presaleInfo: { releasedOn: '2026-07-24T00:00:00' } },
  { productId: 7, name: 'Ashes of the Empire - Spotlight Deck Display', imageUrl: 'x', presaleInfo: {} },
] };

describe('syncPrebuiltDecks', () => {
  it('stores a new deck for review, with issues and a suggested product', async () => {
    const db = fakeDb(seedCards);
    const fetchImpl = fetcher({ listed: [{ id: 151901, updatedDate: '2026-07-23T08:22:33Z', typeId: 1 }], decks: { 151901: PALPATINE }, groups, products });
    const res = await syncPrebuiltDecks({ db, appId: 'app', fetchImpl, wait: async () => {}, now: () => 'NOW' });
    expect(res).toMatchObject({ success: true, added: [151901], changed: [], products: 1 });
    const doc = db.docs.get(`${BASE}/prebuiltDecks/151901`);
    expect(doc).toMatchObject({
      status: 'review', sourceName: 'Emperor Palpatine (ASH)', sourceUpdatedAt: '2026-07-23T08:22:33Z', typeId: 1,
      leaders: ['ASH_015'], base: 'ASH_021', name: 'Emperor Palpatine (ASH)', product: null, fetchedAt: 'NOW',
      issues: [{ id: 'ASH_118', problem: 'unknown-card' }],
      suggestedProduct: { tcgplayerProductId: 2, setCode: 'ASH', imageUrl: 'img', releasedOn: '2026-07-24T00:00:00' },
    });
    expect(db.docs.get(`${BASE}/cardDatabase/preconProducts`).products.map((p) => p.tcgplayerProductId)).toEqual([2]);
    const query = fetchImpl.mock.calls.find(([u]) => u.includes('/decks/query'));
    expect(JSON.parse(query[1].body)).toMatchObject({ userId: 3671, status: 1 });
    expect(query[1].headers['User-Agent']).toMatch(/SWU-Holocron/);
  });

  it('marks an edited published deck changed and keeps its published cards', async () => {
    const published = { status: 'published', sourceUpdatedAt: '2026-07-01T00:00:00Z', cards: [{ id: 'ASH_015', qty: 1 }] };
    const db = fakeDb({ ...seedCards, [`${BASE}/prebuiltDecks/151901`]: published });
    const fetchImpl = fetcher({ listed: [{ id: 151901, updatedDate: '2026-08-01T00:00:00Z' }], decks: { 151901: PALPATINE }, groups, products });
    const res = await syncPrebuiltDecks({ db, appId: 'app', fetchImpl, wait: async () => {} });
    expect(res.changed).toEqual([151901]);
    const doc = db.docs.get(`${BASE}/prebuiltDecks/151901`);
    expect(doc.status).toBe('changed');
    expect(doc.cards).toEqual([{ id: 'ASH_015', qty: 1 }]);
    expect(doc.pending.cards).toHaveLength(3);
    expect(doc.pending.sourceUpdatedAt).toBe('2026-08-01T00:00:00Z');
  });

  it('leaves ignored and unchanged decks alone', async () => {
    const db = fakeDb({ ...seedCards, [`${BASE}/prebuiltDecks/1`]: { status: 'ignored', sourceUpdatedAt: '2026-01-01' } });
    const fetchImpl = fetcher({ listed: [{ id: 1, updatedDate: '2026-09-01' }], decks: {}, groups, products });
    const res = await syncPrebuiltDecks({ db, appId: 'app', fetchImpl, wait: async () => {} });
    expect(res).toMatchObject({ added: [], changed: [] });
    expect(fetchImpl.mock.calls.some(([u]) => u.includes('deckapi'))).toBe(false);
  });

  it('degrades instead of failing when sw-unlimited-db is down', async () => {
    const db = fakeDb(seedCards);
    const fetchImpl = vi.fn(async () => json({}, false));
    const res = await syncPrebuiltDecks({ db, appId: 'app', fetchImpl, wait: async () => {} });
    expect(res).toMatchObject({ success: true, degraded: true });
    expect(res.error).toMatch(/HTTP 500/);
  });

  it('waits between requests to sw-unlimited-db', async () => {
    const db = fakeDb(seedCards);
    const wait = vi.fn(async () => {});
    const fetchImpl = fetcher({ listed: [{ id: 1, updatedDate: 'a' }, { id: 2, updatedDate: 'a' }], decks: { 1: PALPATINE, 2: PALPATINE }, groups, products });
    await syncPrebuiltDecks({ db, appId: 'app', fetchImpl, wait });
    expect(wait).toHaveBeenCalledWith(1000);
    expect(wait.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
```

  The fake `collection(...).get()` is only for reading every stored deck. The sync lists `prebuiltDecks` through `db.collection('artifacts').doc(appId).collection('public').doc('data').collection('prebuiltDecks').get()`.

- [ ] **Step 2: Run.** Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `scripts/prebuiltDecks.js`:

```js
/**
 * Weekly sync step: prebuilt (precon) decks from sw-unlimited-db.
 *
 * The site owner (user 3671) publishes each precon as it releases. New or
 * edited decks are stored for an admin to review (status 'review' / 'changed');
 * nothing reaches collectors until it is published in the admin console. The
 * TCGplayer precon product list (via TCGCSV) is stored alongside, for the
 * product a deck ships in. Never fails the card sync: on any error it reports
 * `degraded`.
 */
import {
  SOURCE_USER_ID, deckApiUrl, parseDeckApi, findMissingCards, isPreconProduct, suggestProduct, planSync,
} from '../src/utils/prebuiltDecks.js';
import { buildGroupsUrl, buildProductsUrl, buildRequestHeaders } from '../src/tcgPrices.js';

const QUERY_URL = 'https://sw-unlimited-db.com/api/proxy/api/decks/query';
const GAP_MS = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(fetchImpl, url, init, label) {
  const res = await fetchImpl(url, init);
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  return res.json();
}

export async function syncPrebuiltDecks({ db, appId, fetchImpl = fetch, wait = sleep, now = () => new Date().toISOString() }) {
  const added = [];
  const changed = [];
  const headers = buildRequestHeaders();
  const data = db.collection('artifacts').doc(appId).collection('public').doc('data');
  try {
    // Precon products (TCGCSV), for product suggestions and the admin picker.
    const groups = (await getJson(fetchImpl, buildGroupsUrl(), { headers }, 'groups')).results ?? [];
    const products = [];
    for (const g of groups) {
      const list = (await getJson(fetchImpl, buildProductsUrl(g.groupId), { headers }, 'products')).results ?? [];
      for (const p of list) {
        if (!isPreconProduct(p.name)) continue;
        products.push({
          tcgplayerProductId: p.productId, name: p.name, setCode: g.abbreviation ?? null,
          imageUrl: p.imageUrl ?? null, releasedOn: p.presaleInfo?.releasedOn ?? null,
        });
      }
    }
    await data.collection('cardDatabase').doc('preconProducts').set({ products, updatedAt: now() });

    // Every card id we know, to flag deck cards our database lacks.
    const registry = (await data.collection('cardDatabase').doc('sets').get()).data()?.sets ?? [];
    const known = new Set();
    for (const { code } of registry) {
      const snap = await data.collection('cardDatabase').doc('sets').collection(code).doc('data').get();
      for (const c of (snap.exists ? snap.data()?.cards : null) ?? []) known.add(`${c.Set}_${c.Number}`);
    }

    // The owner's published decks, and what we already hold.
    const listed = [];
    for (let page = 1; ; page += 1) {
      const body = JSON.stringify({ userId: SOURCE_USER_ID, status: 1, take: 100, page, cards: [] });
      const res = await getJson(fetchImpl, QUERY_URL, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body }, 'deck query');
      listed.push(...(res.items ?? []));
      await wait(GAP_MS);
      if (page >= (res.totalPages ?? 1)) break;
    }
    const storedSnap = await data.collection('prebuiltDecks').get();
    const stored = Object.fromEntries(storedSnap.docs.map((d) => [d.id, d.data()]));

    for (const { sourceId, reason } of planSync(listed, stored)) {
      const meta = listed.find((d) => d.id === sourceId);
      const deck = parseDeckApi(await getJson(fetchImpl, deckApiUrl(sourceId), { headers }, `deck ${sourceId}`), sourceId);
      await wait(GAP_MS);
      if (!deck) continue;
      const issues = findMissingCards(deck.cards, known);
      const ref = data.collection('prebuiltDecks').doc(String(sourceId));
      if (reason === 'new') {
        await ref.set({
          ...deck, sourceUpdatedAt: meta.updatedDate ?? null, typeId: meta.typeId ?? null, issues,
          suggestedProduct: suggestProduct(deck, products), product: null, name: deck.sourceName,
          status: 'review', fetchedAt: now(),
        });
        added.push(sourceId);
      } else {
        // Edited at the source: hold the new list for review, keep serving the published one.
        await ref.set({
          status: 'changed', fetchedAt: now(),
          pending: { cards: deck.cards, leaders: deck.leaders, base: deck.base, issues, sourceUpdatedAt: meta.updatedDate ?? null },
        }, { merge: true });
        changed.push(sourceId);
      }
    }
    return { success: true, added, changed, products: products.length };
  } catch (error) {
    return { success: true, degraded: true, added, changed, products: 0, error: error.message };
  }
}
```

  `seedCardDatabase.js` stores each set's data doc as `{ cards: [...] }`. Confirm this by reading how `reconcile()` reads `dataSnap.data()`, and use the same field. If it differs, record a ruling and match the real field.

- [ ] **Step 4: Wire into `cardDbSync.js`.**
  - Import `syncPrebuiltDecks` from `./prebuiltDecks.js`.
  - After `steps.prices = await syncPrices();`, add:

```js
  // Step 6 - Prebuilt decks. Never fails the run.
  steps.prebuilt = await (async () => {
    const { APP_ID } = await import('../src/firebase.js');
    const start = Date.now();
    const res = await syncPrebuiltDecks({ db: await initFirestore(), appId: APP_ID });
    return { ...res, duration_ms: Date.now() - start };
  })();
```

  - Add `prebuilt: { success, degraded, duration_ms, added, changed, products, error }` to `logData.steps`.
  - Add the summary line:

```js
  console.log(`  Prebuilt decks: ${steps.prebuilt.degraded ? 'DEGRADED' : 'OK'} (+${steps.prebuilt.added.length} for review, ${steps.prebuilt.changed.length} changed)`);
```

- [ ] **Step 5: Run** the tests, then `node --check scripts/cardDbSync.js`. Expected: PASS and no syntax error. **Commit** — gated, `feat(prebuilt): weekly sync of precon decks from sw-unlimited-db`.

---

### Task 3: Firestore rules

**Files:** Modify `firestore.rules`; test in `src/test/rules/firestore.rules.test.js`.

- [ ] **Step 1: Failing tests.** Add the following:

```js
describe('prebuilt decks', () => {
  beforeEach(async () => {
    await seedDoc(p('public', 'data', 'prebuiltDecks', '151901'), { status: 'published', name: 'X' });
  });

  it('is readable by any signed-in user, not by a signed-out visitor', async () => {
    await assertSucceeds(getDoc(doc(asUser('plain-uid'), p('public', 'data', 'prebuiltDecks', '151901'))));
    await assertFails(getDoc(doc(asGuest(), p('public', 'data', 'prebuiltDecks', '151901'))));
  });

  it('is writable by an admin only', async () => {
    await assertSucceeds(setDoc(doc(asUser('admin-uid'), p('public', 'data', 'prebuiltDecks', '1')), { status: 'review' }));
    await assertFails(setDoc(doc(asUser('plain-uid'), p('public', 'data', 'prebuiltDecks', '1')), { status: 'review' }));
  });
});
```

  Use the existing `admin-uid` seeding (check the file's `beforeEach`, which seeds the `admin-uid` profile with `isAdmin: true`; reuse it).

- [ ] **Step 2: Run** `npm run test:rules`. Expected: the new tests FAIL with no matching rule. If the emulator can't start on this machine, record a ruling: CI's rules job runs it on push, so verify there.

- [ ] **Step 3: Add** after the `cardDatabase` block:

```
    // Prebuilt (precon) decks: written by the weekly sync (Admin SDK) and
    // reviewed/published by admins in the admin console.
    match /artifacts/{appId}/public/data/prebuiltDecks/{deckId} {
      allow read: if isSignedIn();
      allow write: if isAdmin(appId);
    }
```

- [ ] **Step 4: Run.** Expected: PASS. **Commit** — gated, `feat(prebuilt): rules for prebuilt decks`.

---

### Task 4: `PrebuiltDeckService`: admin actions

**Files:** Create `src/services/PrebuiltDeckService.js`; test in `src/test/services/PrebuiltDeckService.test.js`.

**Interfaces (produces):**
- `PrebuiltDeckService.listDecks() → [{ id, ...doc }]`, all statuses, for admins.
- `listPublished() → published decks only`, through `where('status', 'in', ['published', 'changed'])`.
  - A `changed` deck still serves its published `cards`.
- `listProducts() → products from cardDatabase/preconProducts`
- `addFromLink(text, { fetchImpl = fetch, knownIds }) → { ok, id } | { error }`
  - Stores `review`.
  - `knownIds` is a `Set` of card ids, built by the caller from `CardService`.
  - Returns `{ error: 'exists' }` if the doc exists, and `{ error: 'bad-link' }` or `{ error: 'not-found' }` otherwise.
- `publish(id, { product, name }, uid)`
- `ignore(id)`
- `unpublish(id)` (back to `review`)
- `acceptChanges(id)`: moves `pending` into `cards`, `leaders`, `base`, `issues` and `sourceUpdatedAt`, clears `pending`, sets `status: 'published'`.

All of them return `{ ok: true }` or `{ error }` and never throw.

- [ ] **Step 1: Failing tests.** Use a hoisted fake Firestore, as in `BatchService.test.js`, with `where`/`query` pass-through filtering on `status`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({ docs: new Map(), fail: false }));
vi.mock('../../firebase', () => ({ db: {}, APP_ID: 'app' }));
vi.mock('firebase/firestore', () => ({
  doc: (db, ...s) => ({ path: s.join('/') }),
  collection: (db, ...s) => ({ path: s.join('/') }),
  query: (ref, ...filters) => ({ ...ref, filters }),
  where: (field, op, value) => ({ field, op, value }),
  getDoc: async (ref) => ({ exists: () => store.docs.has(ref.path), data: () => store.docs.get(ref.path) }),
  getDocs: async (ref) => ({
    docs: [...store.docs].filter(([p, d]) => p.startsWith(`${ref.path}/`) && (ref.filters ?? []).every((f) => f.value.includes(d[f.field])))
      .map(([p, d]) => ({ id: p.split('/').pop(), data: () => d })),
  }),
  setDoc: async (ref, data) => { if (store.fail) throw new Error('offline'); store.docs.set(ref.path, data); },
  updateDoc: async (ref, patch) => { if (store.fail) throw new Error('offline'); store.docs.set(ref.path, { ...store.docs.get(ref.path), ...patch }); },
  deleteField: () => undefined,
}));

import { PrebuiltDeckService } from '../../services/PrebuiltDeckService';

const P = 'artifacts/app/public/data/prebuiltDecks';
const API = { metadata: { name: 'Emperor Palpatine (ASH)' }, leader: { id: 'ASH_015', count: 1 }, base: { id: 'ASH_021', count: 1 }, deck: [{ id: 'ASH_118', count: 3 }] };
const ok = (body) => ({ ok: true, json: async () => body });

beforeEach(() => { store.docs.clear(); store.fail = false; });

describe('PrebuiltDeckService', () => {
  it('adds a deck from a link for review, flagging unknown cards', async () => {
    const fetchImpl = vi.fn(async () => ok(API));
    const res = await PrebuiltDeckService.addFromLink('https://sw-unlimited-db.com/decks/151901', { fetchImpl, knownIds: new Set(['ASH_015', 'ASH_021']) });
    expect(res).toEqual({ ok: true, id: 151901 });
    expect(fetchImpl).toHaveBeenCalledWith('https://sw-unlimited-db.com/umbraco/api/deckapi/get?id=151901');
    expect(store.docs.get(`${P}/151901`)).toMatchObject({ status: 'review', name: 'Emperor Palpatine (ASH)', issues: [{ id: 'ASH_118', problem: 'unknown-card' }], product: null });
  });

  it('refuses a bad link, a missing deck and a deck already stored', async () => {
    expect(await PrebuiltDeckService.addFromLink('nope', { knownIds: new Set() })).toEqual({ error: 'bad-link' });
    expect(await PrebuiltDeckService.addFromLink('5', { fetchImpl: async () => ({ ok: false, status: 404 }), knownIds: new Set() })).toEqual({ error: 'not-found' });
    store.docs.set(`${P}/5`, { status: 'published' });
    expect(await PrebuiltDeckService.addFromLink('5', { fetchImpl: async () => ok(API), knownIds: new Set() })).toEqual({ error: 'exists' });
  });

  it('publishes with a product and a name, ignores, and unpublishes', async () => {
    store.docs.set(`${P}/1`, { status: 'review' });
    const product = { tcgplayerProductId: 2, name: 'ASH - Spotlight Deck: Emperor Palpatine' };
    await PrebuiltDeckService.publish('1', { product, name: 'Emperor Palpatine Spotlight' }, 'admin');
    expect(store.docs.get(`${P}/1`)).toMatchObject({ status: 'published', product, name: 'Emperor Palpatine Spotlight', publishedBy: 'admin', publishedAt: expect.any(Number) });
    await PrebuiltDeckService.unpublish('1');
    expect(store.docs.get(`${P}/1`).status).toBe('review');
    await PrebuiltDeckService.ignore('1');
    expect(store.docs.get(`${P}/1`).status).toBe('ignored');
  });

  it('accepts a changed deck by moving the pending list in', async () => {
    store.docs.set(`${P}/1`, { status: 'changed', cards: [{ id: 'A_001', qty: 1 }], pending: { cards: [{ id: 'B_001', qty: 2 }], leaders: ['B_001'], base: null, issues: [], sourceUpdatedAt: 'T2' } });
    await PrebuiltDeckService.acceptChanges('1');
    expect(store.docs.get(`${P}/1`)).toMatchObject({ status: 'published', cards: [{ id: 'B_001', qty: 2 }], leaders: ['B_001'], sourceUpdatedAt: 'T2', pending: undefined });
  });

  it('lists published decks (including changed ones) and products', async () => {
    store.docs.set(`${P}/1`, { status: 'published' });
    store.docs.set(`${P}/2`, { status: 'review' });
    store.docs.set(`${P}/3`, { status: 'changed' });
    store.docs.set('artifacts/app/public/data/cardDatabase/preconProducts', { products: [{ tcgplayerProductId: 2 }] });
    expect((await PrebuiltDeckService.listPublished()).map((d) => d.id).sort()).toEqual(['1', '3']);
    expect((await PrebuiltDeckService.listDecks()).map((d) => d.id).sort()).toEqual(['1', '2', '3']);
    expect(await PrebuiltDeckService.listProducts()).toEqual([{ tcgplayerProductId: 2 }]);
  });

  it('returns errors instead of throwing', async () => {
    store.fail = true;
    await expect(PrebuiltDeckService.publish('1', {}, 'a')).resolves.toEqual({ error: 'offline' });
  });
});
```

- [ ] **Step 2: Fail. Step 3: Implement:**

```js
import { collection, deleteField, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { db, APP_ID } from '../firebase';
import { deckApiUrl, findMissingCards, parseDeckApi, parseDeckLink } from '../utils/prebuiltDecks';

/**
 * Prebuilt (precon) decks: admin review and publishing, and the published
 * list collectors add from. Decks arrive from the weekly sync, or from a
 * pasted sw-unlimited-db link (its deck API allows browser requests).
 * Never throws.
 *
 * @environment:firebase
 */
const decksRef = () => collection(db, 'artifacts', APP_ID, 'public', 'data', 'prebuiltDecks');
const deckRef = (id) => doc(db, 'artifacts', APP_ID, 'public', 'data', 'prebuiltDecks', String(id));
const fail = (err) => ({ error: err?.message ?? 'unknown' });
const rows = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

export const PrebuiltDeckService = {
  async listDecks() {
    try { return rows(await getDocs(decksRef())); } catch (err) { return fail(err); }
  },

  async listPublished() {
    try { return rows(await getDocs(query(decksRef(), where('status', 'in', ['published', 'changed'])))); } catch (err) { return fail(err); }
  },

  async listProducts() {
    try {
      const snap = await getDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'cardDatabase', 'preconProducts'));
      return snap.exists() ? snap.data().products ?? [] : [];
    } catch {
      return [];
    }
  },

  async addFromLink(text, { fetchImpl = fetch, knownIds }) {
    const id = parseDeckLink(text);
    if (!id) return { error: 'bad-link' };
    try {
      if ((await getDoc(deckRef(id))).exists()) return { error: 'exists' };
      const res = await fetchImpl(deckApiUrl(id));
      const deck = res.ok ? parseDeckApi(await res.json(), id) : null;
      if (!deck) return { error: 'not-found' };
      await setDoc(deckRef(id), {
        ...deck, sourceUpdatedAt: null, typeId: null, issues: findMissingCards(deck.cards, knownIds),
        suggestedProduct: null, product: null, name: deck.sourceName, status: 'review', fetchedAt: new Date().toISOString(),
      });
      return { ok: true, id };
    } catch (err) {
      return fail(err);
    }
  },

  async publish(id, { product = null, name }, uid) {
    try {
      await updateDoc(deckRef(id), { status: 'published', product, ...(name ? { name } : {}), publishedAt: Date.now(), publishedBy: uid });
      return { ok: true };
    } catch (err) { return fail(err); }
  },

  async ignore(id) {
    try { await updateDoc(deckRef(id), { status: 'ignored' }); return { ok: true }; } catch (err) { return fail(err); }
  },

  async unpublish(id) {
    try { await updateDoc(deckRef(id), { status: 'review' }); return { ok: true }; } catch (err) { return fail(err); }
  },

  async acceptChanges(id) {
    try {
      const snap = await getDoc(deckRef(id));
      const pending = snap.exists() ? snap.data().pending : null;
      if (!pending) return { error: 'nothing-pending' };
      await updateDoc(deckRef(id), { ...pending, pending: deleteField(), status: 'published' });
      return { ok: true };
    } catch (err) { return fail(err); }
  },
};
```

- [ ] **Step 4: Pass. Step 5: Commit** — gated, `feat(prebuilt): admin service for reviewing and publishing decks`.

---

### Task 5: Adding a prebuilt deck to a collection

**Files:**
- Create `src/services/prebuiltAdd.js`; test in `src/test/services/prebuiltAdd.test.js`.
- Modify `src/services/ScanService.js` (`cardDetails` gains `name`), plus its test.

**Interfaces (produces):**
- `addPrebuiltToCollection({ uid, collectionRef, collectionData, decks, name, pricePaid, now = Date.now, newId }) → { ok: true, batchId, skipped: string[] } | { error, batchId? }`. It works in this order:
  1. **Combine:** merge `decks[].cards` (adding quantities); skip any id in a deck's `issues`.
  2. **Write the collection:** build a draft whose rows are `{ id: newId(), status: 'matched', set, number, name, isFoil: false, qty }`, using `ScanService.cardDetails` for names (falling back to the id). Call `ScanService.commitDraft(draft, collectionRef)`.
  3. **Build report lines,** with `PricingService.getBulkPrices` for `priceAtAdd` and `priceIsFallback`, and `isNew` from `collectionData` before the write.
  4. **Record the batch:** `BatchService.appendToBatch(uid, { id: batchId, name, pricePaid, createdAt }, lines)`, then `closeBatch`.
  5. **Remember the add:** for each deck, `setDoc(users/{uid}/prebuiltAdds/{sourceId}, { addedAt, count: increment(1) }, { merge: true })`.
- `PrebuiltAdds.list(uid) → { [sourceId]: { addedAt, count } }`, exported from the same file.
- `ScanService.cardDetails(set, number) → { name, type, rarity, aspects, variant } | null`.

- [ ] **Step 1: Failing tests.**
  - **In `ScanService.test.js`:** extend the existing `cardDetails` expectation to include `name: 'Luke'`.
  - **In `prebuiltAdd.test.js`**, mock `ScanService`, `PricingService`, `BatchService`, `../firebase` and `firebase/firestore` (`doc`, `setDoc`, `getDocs`, `collection`, `increment`):

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  commitDraft: vi.fn(), cardDetails: vi.fn(), getBulkPrices: vi.fn(),
  appendToBatch: vi.fn(), closeBatch: vi.fn(), setDoc: vi.fn(), getDocs: vi.fn(),
}));
vi.mock('../../firebase', () => ({ db: {}, APP_ID: 'app' }));
vi.mock('firebase/firestore', () => ({
  doc: (db, ...s) => ({ path: s.join('/') }), collection: (db, ...s) => ({ path: s.join('/') }),
  setDoc: m.setDoc, getDocs: m.getDocs, increment: (n) => ({ inc: n }),
}));
vi.mock('../../services/ScanService', () => ({ ScanService: { commitDraft: m.commitDraft, cardDetails: m.cardDetails } }));
vi.mock('../../services/PricingService', () => ({ PricingService: { getBulkPrices: m.getBulkPrices } }));
vi.mock('../../services/BatchService', () => ({ BatchService: { appendToBatch: m.appendToBatch, closeBatch: m.closeBatch } }));

import { addPrebuiltToCollection, PrebuiltAdds } from '../../services/prebuiltAdd';

const PALP = { id: '151901', sourceId: 151901, cards: [{ id: 'ASH_015', qty: 1 }, { id: 'ASH_118', qty: 3 }, { id: 'XYZ_001', qty: 1 }], issues: [{ id: 'XYZ_001', problem: 'unknown-card' }] };
const LUKE = { id: '151902', sourceId: 151902, cards: [{ id: 'ASH_118', qty: 1 }], issues: [] };
let n = 0;
const args = (o = {}) => ({ uid: 'u1', collectionRef: { id: 'ref' }, collectionData: { ASH_015_std: { quantity: 1 } }, decks: [PALP], name: 'Emperor Palpatine Spotlight', pricePaid: 25, now: () => 1000, newId: () => `id${++n}`, ...o });

beforeEach(() => {
  vi.clearAllMocks();
  m.commitDraft.mockImplementation(async () => ({ rows: [] }));
  m.cardDetails.mockImplementation(async (set, number) => ({ name: `${set}-${number}`, type: 'Unit', rarity: 'Common', aspects: [], variant: 'Normal' }));
  m.getBulkPrices.mockResolvedValue({ ASH_118_std: { market: 0.5 } });
  m.appendToBatch.mockResolvedValue({ ok: true });
  m.closeBatch.mockResolvedValue({ ok: true });
  m.setDoc.mockResolvedValue();
});

describe('addPrebuiltToCollection', () => {
  it('adds every standard printing additively and records a finished batch', async () => {
    const res = await addPrebuiltToCollection(args());
    const [draft, ref] = m.commitDraft.mock.calls[0];
    expect(ref).toEqual({ id: 'ref' });
    expect(draft.rows.map(({ set, number, qty, isFoil, status }) => ({ set, number, qty, isFoil, status }))).toEqual([
      { set: 'ASH', number: '015', qty: 1, isFoil: false, status: 'matched' },
      { set: 'ASH', number: '118', qty: 3, isFoil: false, status: 'matched' },
    ]);
    expect(draft.rows[0].name).toBe('ASH-015');
    const [uid, batch, lines] = m.appendToBatch.mock.calls[0];
    expect(uid).toBe('u1');
    expect(batch).toMatchObject({ name: 'Emperor Palpatine Spotlight', pricePaid: 25, createdAt: 1000 });
    expect(lines.find((l) => l.id === 'ASH_015_std')).toMatchObject({ isNew: false, qty: 1, priceAtAdd: null });
    expect(lines.find((l) => l.id === 'ASH_118_std')).toMatchObject({ isNew: true, qty: 3, priceAtAdd: 0.5 });
    expect(m.closeBatch).toHaveBeenCalledWith('u1', batch.id);
    expect(res).toEqual({ ok: true, batchId: batch.id, skipped: ['XYZ_001'] });
  });

  it('skips cards flagged missing and says which', async () => {
    const res = await addPrebuiltToCollection(args());
    expect(m.commitDraft.mock.calls[0][0].rows.some((r) => r.set === 'XYZ')).toBe(false);
    expect(res.skipped).toEqual(['XYZ_001']);
  });

  it('adds several decks as one batch, summing shared cards', async () => {
    await addPrebuiltToCollection(args({ decks: [PALP, LUKE], name: 'Pair' }));
    expect(m.commitDraft.mock.calls[0][0].rows.find((r) => r.number === '118').qty).toBe(4);
    expect(m.setDoc).toHaveBeenCalledTimes(2);
    expect(m.setDoc).toHaveBeenCalledWith({ path: 'artifacts/app/users/u1/prebuiltAdds/151902' }, { addedAt: 1000, count: { inc: 1 } }, { merge: true });
  });

  it('reports a failed collection write without recording a batch', async () => {
    m.commitDraft.mockRejectedValue(new Error('offline'));
    expect(await addPrebuiltToCollection(args())).toEqual({ error: 'offline' });
    expect(m.appendToBatch).not.toHaveBeenCalled();
  });

  it('keeps the cards added when the report cannot be saved', async () => {
    m.appendToBatch.mockResolvedValue({ error: 'offline' });
    const res = await addPrebuiltToCollection(args());
    expect(res).toMatchObject({ error: 'report', batchId: expect.any(String) });
    expect(m.commitDraft).toHaveBeenCalled();
  });
});

describe('PrebuiltAdds.list', () => {
  it('maps deck ids to when they were added', async () => {
    m.getDocs.mockResolvedValue({ docs: [{ id: '151901', data: () => ({ addedAt: 5, count: 2 }) }] });
    expect(await PrebuiltAdds.list('u1')).toEqual({ 151901: { addedAt: 5, count: 2 } });
  });
});
```

- [ ] **Step 2: Fail. Step 3: Implement.**
  - `ScanService.cardDetails` adds `name: card.Name ?? null`.
  - `src/services/prebuiltAdd.js`:

```js
import { collection, doc, getDocs, increment, setDoc } from 'firebase/firestore';
import { db, APP_ID } from '../firebase';
import { ScanService } from './ScanService';
import { PricingService } from './PricingService';
import { BatchService } from './BatchService';
import { getCardQuantities, getCollectionId } from '../utils/collectionHelpers';
import { splitCardId } from '../utils/prebuiltDecks';

/**
 * One tap: a prebuilt deck (or every deck in a product) into the collection.
 * The standard printing of each card is added -- increments, like the scanner,
 * never a replace -- and recorded as a finished batch with a report. Cards the
 * deck's review flagged as missing from our database are skipped and named.
 *
 * @environment:firebase
 */
const addsRef = (uid) => collection(db, 'artifacts', APP_ID, 'users', uid, 'prebuiltAdds');

export const PrebuiltAdds = {
  async list(uid) {
    try {
      const snap = await getDocs(addsRef(uid));
      return Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
    } catch {
      return {};
    }
  },
};

export async function addPrebuiltToCollection({
  uid, collectionRef, collectionData = {}, decks, name, pricePaid = null, now = Date.now,
  newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
}) {
  const skipped = new Set();
  const qty = new Map();
  for (const deck of decks) {
    const missing = new Set((deck.issues ?? []).map((i) => i.id));
    for (const c of deck.cards) {
      if (missing.has(c.id)) { skipped.add(c.id); continue; }
      qty.set(c.id, (qty.get(c.id) ?? 0) + c.qty);
    }
  }
  const cards = [...qty].map(([id, n]) => ({ ...splitCardId(id), qty: n })).filter((c) => c.set);
  const details = await Promise.all(cards.map((c) => ScanService.cardDetails(c.set, c.number)));

  const draft = {
    rows: cards.map((c, i) => ({
      id: newId(), status: 'matched', set: c.set, number: c.number,
      name: details[i]?.name ?? `${c.set} ${c.number}`, type: details[i]?.type ?? null, isFoil: false, qty: c.qty,
    })),
  };
  try {
    await ScanService.commitDraft(draft, collectionRef);
  } catch (err) {
    return { error: err?.message ?? 'unknown' };
  }

  const prices = await PricingService.getBulkPrices(cards.map((c) => ({
    cardId: getCollectionId(c.set, c.number, false), set: c.set, number: c.number, isFoil: false,
  }))).catch(() => ({}));
  const lines = cards.map((c, i) => {
    const id = getCollectionId(c.set, c.number, false);
    return {
      id, set: c.set, number: c.number, name: draft.rows[i].name,
      type: details[i]?.type ?? null, rarity: details[i]?.rarity ?? null, aspects: details[i]?.aspects ?? [],
      variant: details[i]?.variant ?? null, isFoil: false, qty: c.qty,
      isNew: getCardQuantities(collectionData, c.set, c.number).total === 0,
      priceAtAdd: typeof prices?.[id]?.market === 'number' ? prices[id].market : null,
      priceIsFallback: Boolean(prices?.[id]?.isFallback),
    };
  });

  const batch = { id: newId(), name, pricePaid, createdAt: now() };
  await Promise.all(decks.map((d) => setDoc(doc(addsRef(uid), String(d.sourceId ?? d.id)), { addedAt: now(), count: increment(1) }, { merge: true }).catch(() => {})));
  const appended = await BatchService.appendToBatch(uid, batch, lines);
  if (appended?.error) return { error: 'report', batchId: batch.id, skipped: [...skipped] };
  await BatchService.closeBatch(uid, batch.id);
  return { ok: true, batchId: batch.id, skipped: [...skipped] };
}
```

  `getCollectionId` lives in `collectionHelpers` (check its signature; the scanner uses it). The `PALP` test expects `skipped: ['XYZ_001']`, and `ASH_015` is owned before the add, so its line has `isNew: false`.

- [ ] **Step 4: Pass** (both files). **Step 5: Commit** — gated, `feat(prebuilt): add a prebuilt deck to the collection as a batch`.

---

### Task 6: Command Center panel (`PrebuiltDecksPanel.jsx`)

**Files:**
- Create `src/components/PrebuiltDecksPanel.jsx`; test in `src/components/__tests__/PrebuiltDecksPanel.test.jsx`.
- Modify `src/components/Dashboard.jsx` (props `collectionRef`, `collectionData` already exists) and `src/App.jsx` (pass `collectionRef={getCollectionRef(user, legacySyncCode, useLegacyPath)}` to `<Dashboard>`).

**Interface:** `<PrebuiltDecksPanel uid collectionRef collectionData onAdded />`.
- **List:** published decks grouped by `product.tcgplayerProductId`, or alone if there is no product. Each group shows the product image, the product name (or the deck name) and the deck names. A search box filters by deck, product or leader name.
- **Per deck:** an **Add** button. A product with several decks also gets **Add all (N)**.
- **Add flow:**
  - A price-paid input, then **Add to collection**, which calls `addPrebuiltToCollection` with `name = product?.name ?? deck.name`.
  - On success it opens `<BatchReport uid batchId onClose onDeleted>` and calls `onAdded()`.
  - When some cards were skipped, it shows "N cards weren't added: not in our card database yet (XYZ_001)".
  - On `error: 'report'`, it shows "Cards added — the batch report couldn't be saved."
- **Already added:** shows "Added <date>" (from `PrebuiltAdds.list`). Pressing Add opens a confirmation, "You added this on <date>. Add another copy?", before the add.
- Renders nothing without a `uid`.

- [ ] **Step 1: Failing tests.** Mock `PrebuiltDeckService.listPublished`, `PrebuiltAdds.list`, `addPrebuiltToCollection`, and `../BatchReport` (a dialog showing its `batchId`):

```jsx
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const m = vi.hoisted(() => ({ listPublished: vi.fn(), list: vi.fn(), add: vi.fn() }));
vi.mock('../../services/PrebuiltDeckService', () => ({ PrebuiltDeckService: { listPublished: m.listPublished } }));
vi.mock('../../services/prebuiltAdd', () => ({ PrebuiltAdds: { list: m.list }, addPrebuiltToCollection: m.add }));
vi.mock('../BatchReport', () => ({ default: ({ batchId }) => <div role="dialog" aria-label="Batch report">report {batchId}</div> }));

import PrebuiltDecksPanel from '../PrebuiltDecksPanel';

const PRODUCT = { tcgplayerProductId: 9, name: 'Intro Battle: Hoth - Learn to Play Kit', imageUrl: 'img' };
const DECKS = [
  { id: '149318', sourceId: 149318, name: 'Vader Preset', product: PRODUCT, cards: [{ id: 'IBH_053', qty: 1 }], issues: [] },
  { id: '149317', sourceId: 149317, name: 'Leia Preset', product: PRODUCT, cards: [{ id: 'IBH_001', qty: 1 }], issues: [] },
  { id: '151901', sourceId: 151901, name: 'Emperor Palpatine Spotlight', product: null, cards: [{ id: 'ASH_015', qty: 1 }], issues: [] },
];

beforeEach(() => {
  vi.clearAllMocks();
  m.listPublished.mockResolvedValue(DECKS);
  m.list.mockResolvedValue({});
  m.add.mockResolvedValue({ ok: true, batchId: 'b9', skipped: [] });
});

const renderPanel = (props = {}) => render(<PrebuiltDecksPanel uid="u1" collectionRef={{ id: 'ref' }} collectionData={{}} onAdded={vi.fn()} {...props} />);

describe('PrebuiltDecksPanel', () => {
  it('groups decks by product and searches them', async () => {
    renderPanel();
    expect(await screen.findByText('Intro Battle: Hoth - Learn to Play Kit')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add all (2)' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search prebuilt decks'), { target: { value: 'palpatine' } });
    expect(screen.queryByText('Vader Preset')).not.toBeInTheDocument();
    expect(screen.getByText('Emperor Palpatine Spotlight')).toBeInTheDocument();
  });

  it('adds a deck with the price paid and opens its report', async () => {
    const onAdded = vi.fn();
    renderPanel({ onAdded });
    fireEvent.click(await screen.findByRole('button', { name: 'Add Emperor Palpatine Spotlight' }));
    fireEvent.change(screen.getByLabelText('Price paid'), { target: { value: '24.99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to collection' }));
    expect(await screen.findByRole('dialog', { name: 'Batch report' })).toHaveTextContent('report b9');
    expect(m.add).toHaveBeenCalledWith(expect.objectContaining({ uid: 'u1', collectionRef: { id: 'ref' }, decks: [DECKS[2]], name: 'Emperor Palpatine Spotlight', pricePaid: 24.99 }));
    expect(onAdded).toHaveBeenCalled();
  });

  it('adds every deck of a product as one batch named after the product', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Add all (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to collection' }));
    await waitFor(() => expect(m.add).toHaveBeenCalledWith(expect.objectContaining({ decks: [DECKS[0], DECKS[1]], name: PRODUCT.name })));
  });

  it('asks before adding a deck again, then adds on top', async () => {
    m.list.mockResolvedValue({ 151901: { addedAt: Date.UTC(2026, 9, 1), count: 1 } });
    renderPanel();
    expect(await screen.findByText(/Added/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Emperor Palpatine Spotlight' }));
    expect(screen.getByText(/You added this on .*Add another copy\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add to collection' }));
    await waitFor(() => expect(m.add).toHaveBeenCalled());
  });

  it('says which cards were skipped, and when the report could not be saved', async () => {
    m.add.mockResolvedValueOnce({ ok: true, batchId: 'b9', skipped: ['XYZ_001'] });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Emperor Palpatine Spotlight' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to collection' }));
    expect(await screen.findByText(/1 card wasn.t added.*XYZ_001/)).toBeInTheDocument();
    m.add.mockResolvedValueOnce({ error: 'report', batchId: 'b9', skipped: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Add Emperor Palpatine Spotlight' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to collection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/batch report couldn.t be saved/i);
  });

  it('renders nothing without a user', () => {
    const { container } = render(<PrebuiltDecksPanel uid={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

  In the skipped-cards test, the report dialog opens after the first add. The skipped notice stays in the panel, and so do the deck's buttons, because the mocked report is rendered alongside the panel rather than replacing it.

- [ ] **Step 2: Fail.**

- [ ] **Step 3: Implement** the panel:
  - All hooks first (`decks`, `adds`, `search`, `pending` = `{ decks, name, addedAt? }`, `price`, `busy`, `notice`, `error`, `reportId`); then `if (!uid) return null;`.
  - Load `listPublished` (treat `{ error }` as `[]`) and `PrebuiltAdds.list(uid)` on mount.
  - Group with a `useMemo` keyed on the product id, and filter by search over the deck name, product name and leader ids.
  - The confirm section renders when `pending` is set:
    - an `aria-label="Price paid"` input, parsed with `parsePricePaid` from `../utils/scanDraft`;
    - the duplicate warning text, if any deck in `pending.decks` has an add record;
    - **Add to collection** and **Cancel** buttons.
  - On success:
    - set `notice` when anything was skipped: `${n} ${n === 1 ? 'card' : 'cards'} ${n === 1 ? "wasn't" : "weren't"} added: not in our card database yet (${ids.join(', ')})`;
    - set `reportId`;
    - reload the adds;
    - call `onAdded?.()`.
  - On `error: 'report'`, set an alert ("Cards added — the batch report couldn't be saved."). On any other error, set "Couldn't add the deck. Try again."
  - Render `<BatchReport uid batchId={reportId} onClose={() => setReportId(null)} onDeleted={() => setReportId(null)} />` when set.
  - Card styling follows `BatchesPanel` (`bg-gray-900 rounded-2xl border border-gray-800`), with a heading "Prebuilt decks".
  - In **`Dashboard`**, render `{uid && <PrebuiltDecksPanel uid={uid} collectionRef={collectionRef} collectionData={collectionData} onAdded={() => setBatchesBump((n) => n + 1)} />}` above `BatchesPanel`. Use a local `batchesBump` state, added to the `refreshKey` passed to `BatchesPanel`: `refreshKey={batchesRefresh + batchesBump}`.
  - Add a Dashboard test: with a `uid`, the panel renders (mock `../../components/PrebuiltDecksPanel`).

- [ ] **Step 4: Pass**, including `Dashboard.test.jsx`. **Step 5: Commit** — gated, `feat(prebuilt): one-tap prebuilt decks in the Command Center`.

---

### Task 7: Admin tab (`AdminPrebuiltDecks.jsx`)

**Files:**
- Create `src/components/AdminPrebuiltDecks.jsx`; test in `src/components/__tests__/AdminPrebuiltDecks.test.jsx`.
- Modify `src/components/AdminPanel.jsx`: add the tab `{ id: 'prebuilt', label: 'Prebuilt Decks', icon: Layers }` for admins, and `{activeTab === 'prebuilt' && isAdmin && <AdminPrebuiltDecks uid={user?.uid} />}`.

**Interface:** `<AdminPrebuiltDecks uid knownIds? />`.
- **Loading:** `listDecks()` and `listProducts()`.
- **Sections, in order:**
  1. "Needs review" (`review` and `changed`, with a "Changed at source" badge on changed ones);
  2. "Published";
  3. "Not precons" (collapsed).
- **Each deck shows:**
  - its name input (`aria-label="Display name for <sourceName>"`);
  - its `sourceName`;
  - its card count, totalling `cards` quantities;
  - its issues ("Not in our database: XYZ_001");
  - a product `<select aria-label="Product for <sourceName>">`, listing all products, pre-selected to `product ?? suggestedProduct`, with a "No product" option.
- **Actions per status:**
  - **review:** Publish and Not a precon.
  - **changed:** Accept changes, which shows a pending card-count diff.
  - **published:** Unpublish.
  - **ignored:** Restore to review (`unpublish`).
- **Add from link:** an `aria-label="sw-unlimited-db deck link"` input, then **Fetch deck**, which calls `addFromLink(text, { knownIds })` and reloads.
  - `knownIds` is passed in, or built by loading the card registry. To keep the component testable, use a `loadKnownIds` prop defaulting to a function that walks `CardService.getSetRegistry()` and `CardService.fetchSetData` into a `Set` of `${Set}_${Number}`.
  - Errors map to: `bad-link` → "That isn't a sw-unlimited-db deck link."; `exists` → "That deck is already here."; `not-found` → "No published deck at that link."

- [ ] **Step 1: Failing tests:**

```jsx
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

const m = vi.hoisted(() => ({ listDecks: vi.fn(), listProducts: vi.fn(), publish: vi.fn(), ignore: vi.fn(), unpublish: vi.fn(), acceptChanges: vi.fn(), addFromLink: vi.fn() }));
vi.mock('../../services/PrebuiltDeckService', () => ({ PrebuiltDeckService: m }));

import AdminPrebuiltDecks from '../AdminPrebuiltDecks';

const PRODUCTS = [
  { tcgplayerProductId: 2, name: 'Ashes of the Empire - Spotlight Deck: Emperor Palpatine', setCode: 'ASH' },
  { tcgplayerProductId: 1, name: 'Ashes of the Empire - Spotlight Deck: Luke Skywalker', setCode: 'ASH' },
];
const DECKS = [
  { id: '151901', sourceName: 'Emperor Palpatine (ASH)', name: 'Emperor Palpatine (ASH)', status: 'review', cards: [{ id: 'ASH_015', qty: 1 }, { id: 'ASH_118', qty: 50 }], issues: [{ id: 'XYZ_001', problem: 'unknown-card' }], suggestedProduct: PRODUCTS[0], product: null },
  { id: '2963', sourceName: 'Aggression', name: 'Aggression', status: 'review', cards: [], issues: [], suggestedProduct: null, product: null },
  { id: '149318', sourceName: 'Vader Preset', name: 'Vader Preset', status: 'changed', cards: [{ id: 'A_1', qty: 1 }], pending: { cards: [{ id: 'A_1', qty: 2 }] }, issues: [], product: null },
  { id: '147115', sourceName: 'TS deck', name: 'TS deck', status: 'published', cards: [], issues: [], product: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  m.listDecks.mockResolvedValue(DECKS);
  m.listProducts.mockResolvedValue(PRODUCTS);
  for (const k of ['publish', 'ignore', 'unpublish', 'acceptChanges']) m[k].mockResolvedValue({ ok: true });
  m.addFromLink.mockResolvedValue({ ok: true, id: 5 });
});

const renderTab = () => render(<AdminPrebuiltDecks uid="admin" loadKnownIds={async () => new Set(['ASH_015'])} />);

describe('AdminPrebuiltDecks', () => {
  it('lists decks needing review first, with issues, card count and the suggested product', async () => {
    renderTab();
    const review = await screen.findByRole('region', { name: 'Needs review' });
    expect(within(review).getByText('Emperor Palpatine (ASH)')).toBeInTheDocument();
    expect(within(review).getByText(/51 cards/)).toBeInTheDocument();
    expect(within(review).getByText(/Not in our database: XYZ_001/)).toBeInTheDocument();
    expect(within(review).getByLabelText('Product for Emperor Palpatine (ASH)')).toHaveValue('2');
    expect(within(review).getByText('Changed at source')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Published' })).getByText('TS deck')).toBeInTheDocument();
  });

  it('publishes with the chosen product and display name', async () => {
    renderTab();
    fireEvent.change(await screen.findByLabelText('Display name for Emperor Palpatine (ASH)'), { target: { value: 'Emperor Palpatine Spotlight' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish Emperor Palpatine (ASH)' }));
    await waitFor(() => expect(m.publish).toHaveBeenCalledWith('151901', { product: PRODUCTS[0], name: 'Emperor Palpatine Spotlight' }, 'admin'));
    expect(m.listDecks).toHaveBeenCalledTimes(2);
  });

  it('marks a personal deck as not a precon, and accepts a changed deck', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Not a precon: Aggression' }));
    await waitFor(() => expect(m.ignore).toHaveBeenCalledWith('2963'));
    fireEvent.click(screen.getByRole('button', { name: 'Accept changes to Vader Preset' }));
    await waitFor(() => expect(m.acceptChanges).toHaveBeenCalledWith('149318'));
  });

  it('adds a deck from a link and explains a bad one', async () => {
    renderTab();
    const input = await screen.findByLabelText('sw-unlimited-db deck link');
    fireEvent.change(input, { target: { value: 'https://sw-unlimited-db.com/decks/5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fetch deck' }));
    await waitFor(() => expect(m.addFromLink).toHaveBeenCalledWith('https://sw-unlimited-db.com/decks/5', { knownIds: new Set(['ASH_015']) }));
    m.addFromLink.mockResolvedValueOnce({ error: 'bad-link' });
    fireEvent.click(screen.getByRole('button', { name: 'Fetch deck' }));
    expect(await screen.findByText("That isn't a sw-unlimited-db deck link.")).toBeInTheDocument();
  });
});
```

  The count of 51 is ASH_015 ×1 plus ASH_118 ×50. Each section is a `<section aria-labelledby>` with its heading as the name, so `role="region"` works.

- [ ] **Step 2: Fail. Step 3: Implement** to the interface above (hooks first; reload after each action). **Step 4: Pass**, and also run `src/test/components/AdminPanel.test.jsx`, mocking `../../components/AdminPrebuiltDecks` there if its imports pull in Firestore. **Step 5: Commit** — gated, `feat(prebuilt): admin review tab for prebuilt decks`.

---

### Task 8: Docs, full gate and build

- [ ] **`CLAUDE.md`:**
  - Add `public/data/prebuiltDecks/{sourceId}`, `cardDatabase/preconProducts` and `users/{uid}/prebuiltAdds` to the Firestore path list.
  - Add a **Prebuilt decks** section covering:
    - the source (sw-unlimited-db user 3671, the deck API with CORS, the query API server-only);
    - review statuses;
    - standard printings only;
    - the sync step being non-fatal;
    - add-from-link for backfill;
    - the collector add being a finished batch.
  - Add the step to the "Pipeline order" line: seed → scrape → reconcile → placeholders → prices → **prebuilt decks** → verify.
- [ ] **`TESTING.md`** manual checks:
  - run the sync via `workflow_dispatch` and check the 2026 decks appear for review;
  - publish one;
  - backfill one older Spotlight by link;
  - add it on the phone and check the counts went up and the report opened.
- [ ] **Gate:** `npm run test:unit`, lint, `npm run build`. **Commit** — `docs: prebuilt decks`.
