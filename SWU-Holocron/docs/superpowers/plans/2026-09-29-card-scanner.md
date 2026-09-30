# Card Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Pro or admin user scan a stack of physical cards with a phone or webcam, review the batch, and add it to their collection in one approval.

**Architecture:** A new `scanCard` callable Cloud Function checks entitlement and a daily quota, then asks Gemini 2.5 Flash to read the set code, number and name off one photo. The client resolves that read against card data it already has, and rejects it unless the name matches. Captures go into a draft batch persisted per user in `localStorage`. The user reviews the batch and commits it with additive `increment()` writes in chunks of 400.

**Tech Stack:** React 18, Vite, Tailwind, Firebase JS SDK v10 (Firestore, Functions), Cloud Functions v2 (Node 24), `@google/genai` on Vertex, Vitest + Testing Library + happy-dom, `@firebase/rules-unit-testing`.

**Spec:** `SWU-Holocron/docs/superpowers/specs/2026-09-29-card-scanner-design.md`

**Deviation from spec (deliberate):** The draft `localStorage` key is `swu-scan-draft-{uid}`, not `swu-scan-draft`. A shared key would let one account's unsaved batch be committed into another account's collection on a shared device. See Review Focus #1.

## Global Constraints

- All `npm`/`npx` commands run from the nested app directory `SWU-Holocron/` (the git root is one level up).
- Node 20+ for the app; `functions/` declares Node 24. CI does **not** install `functions/node_modules`, so any `functions/` module imported by a Vitest test must not `require` a package.
- Services are object literals exported by name: `export const ScanService = {}`.
- A test file containing JSX uses the `.jsx` extension.
- Every hook runs before any conditional return (`react-hooks/rules-of-hooks` is a CI error).
- `no-console` allows only `console.warn` / `console.error`.
- ESLint **errors** must stay at zero: `npx eslint src --ext js,jsx --quiet`.
- Firestore batch writes commit at 400 operations.
- Never introduce a hardcoded set list. Set codes come from the registry (`CardService.getSetRegistry()` / `setRegistry` state in `App.jsx`).
- `localStorage` keys are `swu-`-prefixed.
- Keep `@environment:` tags on platform-coupled code (`@environment:firebase`, `@environment:web-localstorage`, `@environment:react`; new here: `@environment:web-media` for camera/canvas).
- Tailwind dark theme: `bg-gray-950`/`bg-gray-900` grounds, `text-gray-100` base, yellow-500 accent.
- Daily scan limit default: `DEFAULT_SCAN_DAILY_LIMIT = 1000`, tunable at `artifacts/{APP_ID}/config/scanner` → `{ dailyLimit }`. Admins are exempt and uncounted.
- Scanning is allowed when `isAdmin === true || isPro === true`, and never for anonymous users.
- Every commit ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Two accounts on one device.** User A leaves an unsaved batch, signs out, and user B signs in and opens the scanner. B must see an empty batch, never A's. (Task 4: draft key is per uid; test `keeps each user's draft separate`.)
2. **Storage unavailable or full** (private mode, quota exceeded, a throwing `localStorage` accessor). Scanning must carry on and simply not persist. (Task 4: tests `saveDraft returns false instead of throwing` and `loadDraft returns an empty draft when storage throws`.)
3. **Holding Space down**, or a Bluetooth shutter that repeats. Key auto-repeat must not fire dozens of captures and burn the quota. (Task 10: test `ignores auto-repeated key presses`.)
4. **Gemini says `readable: true` but returns garbage**: an empty number, `"—"`, or a set of `"S0R"`. That must become an unidentified row, not a crash or a wrong card. (Task 3: tests `treats readable-but-empty number as unreadable` and `rejects a set code that is not in the registry`.)
5. **The same card scanned as foil and as standard** in one mixed pack must stay as two separate lines and write to two different collection docs. (Task 4: test `keeps foil and standard copies of the same card apart`; Task 9: test `shows foil and standard copies as separate lines`.)

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `firestore.rules` | modify | `isPro` is a protected role field; `config/**` and `scanUsage/**` have no client access |
| `src/test/rules/firestore.rules.test.js` | modify | Pins the above |
| `src/contexts/AuthContext.jsx` | modify | Exposes `isPro`, `canScan` |
| `src/test/contexts/AuthContextRoles.test.jsx` | create | Role/entitlement reading |
| `src/utils/scanResolve.js` | create | Pure: Gemini read → known card or unidentified reason |
| `src/test/utils/scanResolve.test.js` | create | |
| `src/utils/scanDraft.js` | create | Pure batch model + per-uid storage helpers |
| `src/test/utils/scanDraft.test.js` | create | |
| `functions/scanCard.js` | create | Dependency-injected handler: auth, entitlement, quota, validation |
| `src/test/functions/scanCard.test.js` | create | |
| `functions/index.js` | modify | Gemini reader + `exports.scanCard` |
| `src/services/ScanService.js` | create | Calls the function, resolves, commits drafts additively |
| `src/test/services/ScanService.test.js` | create | |
| `src/components/CardPickerModal.jsx` | modify | `type` optional; sets from registry |
| `src/components/__tests__/CardPickerModal.test.jsx` | create | |
| `src/components/ScanReview.jsx` | create | Review list, inline edits, pick/retry/discard, commit button |
| `src/components/__tests__/ScanReview.test.jsx` | create | |
| `src/utils/frameCapture.js` | create | Video frame → base64 JPEG (browser only) |
| `src/components/CardScanner.jsx` | create | Camera, triggers, foil switch, flash, quota; hosts review |
| `src/components/__tests__/CardScanner.test.jsx` | create | |
| `src/components/ScanButton.jsx` | create | Header button: hidden for guests, locked for non-Pro |
| `src/components/__tests__/ScanButton.test.jsx` | create | |
| `src/App.jsx` | modify | Mounts button and scanner overlay |
| `CLAUDE.md`, `SWU-Holocron/TESTING.md`, `SWU-Holocron/docs/DEPLOYMENT_RUNBOOK.md` | modify | Docs |

---

### Task 1: Rules — protect `isPro`, lock scanner config and usage

**Files:**
- Modify: `SWU-Holocron/firestore.rules:43-53` (role guard) and append two match blocks before the final closing braces
- Test: `SWU-Holocron/src/test/rules/firestore.rules.test.js` (append a `describe`)

**Interfaces:**
- Consumes: existing helpers `p`, `asUser`, `seedProfile`, `seedDoc`, `assertFails`, `assertSucceeds` in the test file.
- Produces: the paths `artifacts/{APP_ID}/config/scanner` and `artifacts/{APP_ID}/scanUsage/{uid}`, which Task 5 writes through the Admin SDK.

- [ ] **Step 1: Write the failing tests.** Append to `src/test/rules/firestore.rules.test.js`:

```js
describe('scanner entitlement and usage', () => {
  // isPro gates the card scanner, which costs real money per call. It is
  // granted by hand (or later by a Patreon webhook) through the Admin SDK,
  // never by the user themselves.

  it('denies a user granting themselves isPro', async () => {
    await assertFails(setDoc(doc(asUser('plain-uid'), p('users', 'plain-uid')), { isPro: true }, { merge: true }));
  });

  it('denies creating a profile that already declares isPro', async () => {
    await assertFails(setDoc(doc(asUser('fresh-uid'), p('users', 'fresh-uid')), { isPro: true }));
  });

  it('denies any client reading the scanner config, even an admin', async () => {
    await seedDoc(p('config', 'scanner'), { dailyLimit: 1000 });
    await assertFails(getDoc(doc(asUser('admin-uid'), p('config', 'scanner'))));
  });

  it('denies any client writing the scanner config, even an admin', async () => {
    await assertFails(setDoc(doc(asUser('admin-uid'), p('config', 'scanner')), { dailyLimit: 999999 }));
  });

  it('denies a user reading their own scan usage', async () => {
    await seedDoc(p('scanUsage', 'plain-uid'), { date: '2026-09-29', count: 5 });
    await assertFails(getDoc(doc(asUser('plain-uid'), p('scanUsage', 'plain-uid'))));
  });

  it('denies a user resetting their own scan usage', async () => {
    await assertFails(setDoc(doc(asUser('plain-uid'), p('scanUsage', 'plain-uid')), { date: '2026-09-29', count: 0 }));
  });
});
```

- [ ] **Step 2: Run the tests and confirm the `isPro` ones fail.**

Run: `npm run test:rules`
Expected: `denies a user granting themselves isPro` and `denies creating a profile that already declares isPro` FAIL. The four config/usage tests already PASS, because unmatched paths are denied by default. They are there to pin that behaviour. (If the emulator will not start, check that Java is installed and port 8085 is free; `firebase.json` fixes the port.)

- [ ] **Step 3: Implement.** In `firestore.rules`, change both role lists and update the comment:

```
    // Roles and entitlements are granted ONLY by the Admin SDK (the invite-
    // redemption Cloud Function for contributor; by hand in the console for
    // admin and isPro). They live on the user's own profile document, which the
    // user may otherwise write — so without this guard any authenticated account,
    // including an anonymous guest, could set isAdmin or isPro on itself.
    function touchesRoles() {
      return request.resource.data.diff(resource.data).affectedKeys()
        .hasAny(['isAdmin', 'isContributor', 'isPro']);
    }

    function declaresRoles() {
      return request.resource.data.keys().hasAny(['isAdmin', 'isContributor', 'isPro']);
    }
```

Then add, after the `packets` match block and inside `match /databases/{database}/documents`:

```
    // ---------------------------------------------------------------------
    // Card scanner. The daily limit and each user's usage counter are read
    // and written only by the scanCard Cloud Function (Admin SDK). A client
    // that could write its own counter could scan without limit.
    // ---------------------------------------------------------------------
    match /artifacts/{appId}/config/{document=**} {
      allow read, write: if false;
    }

    match /artifacts/{appId}/scanUsage/{document=**} {
      allow read, write: if false;
    }
```

- [ ] **Step 4: Run the tests and confirm they pass.**

Run: `npm run test:rules`
Expected: every test passes, including the existing `role fields cannot be self-granted` suite.

- [ ] **Step 5: Commit.**

```bash
git add firestore.rules src/test/rules/firestore.rules.test.js
git commit -m "feat(rules): protect isPro and lock scanner config and usage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: AuthContext exposes `isPro` and `canScan`

**Files:**
- Modify: `SWU-Holocron/src/contexts/AuthContext.jsx`
- Test: `SWU-Holocron/src/test/contexts/AuthContextRoles.test.jsx` (create)

**Interfaces:**
- Produces: `useAuth()` now also returns `isPro: boolean` and `canScan: boolean` (`isAdmin || isPro`). Both are `false` for anonymous users. Task 11 consumes `canScan`.

- [ ] **Step 1: Write the failing test.** Create `src/test/contexts/AuthContextRoles.test.jsx`:

```jsx
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const state = vi.hoisted(() => ({ user: null, profile: null }));

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: vi.fn(() => ({ setCustomParameters: vi.fn() })),
  signInWithPopup: vi.fn(),
  signInAnonymously: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: (auth, cb) => {
    cb(state.user);
    return () => {};
  },
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({
    exists: () => state.profile !== null,
    data: () => state.profile,
  })),
}));

vi.mock('../../firebase', () => ({ auth: {}, db: {}, isConfigured: true, APP_ID: 'test-app-id' }));

import { AuthProvider, useAuth } from '../../contexts/AuthContext';

function Harness() {
  // `loading` only clears after the profile read resolves, so waiting on it
  // means the role flags are final -- a falsy assertion before then is vacuous.
  const { isAdmin, isPro, canScan, loading } = useAuth();
  return (
    <div>
      <div data-testid="settled">{loading ? 'no' : 'yes'}</div>
      <div data-testid="admin">{String(isAdmin)}</div>
      <div data-testid="pro">{String(isPro)}</div>
      <div data-testid="can-scan">{String(canScan)}</div>
    </div>
  );
}

const renderWith = async (user, profile) => {
  state.user = user;
  state.profile = profile;
  render(<AuthProvider><Harness /></AuthProvider>);
  await waitFor(() => expect(screen.getByTestId('settled').textContent).toBe('yes'));
};

describe('AuthContext entitlements', () => {
  beforeEach(() => {
    state.user = null;
    state.profile = null;
  });

  it('marks a Pro user as able to scan', async () => {
    await renderWith({ uid: 'u1', isAnonymous: false }, { isPro: true });
    await waitFor(() => expect(screen.getByTestId('pro').textContent).toBe('true'));
    expect(screen.getByTestId('can-scan').textContent).toBe('true');
  });

  it('lets an admin scan without isPro', async () => {
    await renderWith({ uid: 'u2', isAnonymous: false }, { isAdmin: true });
    await waitFor(() => expect(screen.getByTestId('admin').textContent).toBe('true'));
    expect(screen.getByTestId('pro').textContent).toBe('false');
    expect(screen.getByTestId('can-scan').textContent).toBe('true');
  });

  it('does not let an ordinary user scan', async () => {
    await renderWith({ uid: 'u3', isAnonymous: false }, {});
    expect(screen.getByTestId('can-scan').textContent).toBe('false');
  });

  it('only accepts a literal true, not a truthy string', async () => {
    await renderWith({ uid: 'u4', isAnonymous: false }, { isPro: 'yes' });
    expect(screen.getByTestId('pro').textContent).toBe('false');
  });

  it('never grants scanning to an anonymous guest, whatever the profile says', async () => {
    await renderWith({ uid: 'g1', isAnonymous: true }, { isPro: true });
    expect(screen.getByTestId('pro').textContent).toBe('false');
    expect(screen.getByTestId('can-scan').textContent).toBe('false');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `npx vitest run src/test/contexts/AuthContextRoles.test.jsx`
Expected: FAIL. The `pro`/`can-scan` cells read `"undefined"`.

- [ ] **Step 3: Implement.** In `src/contexts/AuthContext.jsx`:
  - Add state: `const [isPro, setIsPro] = useState(false);` beside `isContributor`.
  - In the profile-exists branch: `setIsPro(profileData.isPro === true);`
  - In every branch that resets roles (profile missing, the `catch`, and the anonymous/signed-out `else`), add `setIsPro(false);`.
  - In `value`, add `isPro,` and `canScan: isAdmin || isPro,` after `isContributor,`.

- [ ] **Step 4: Run both AuthContext test files and confirm they pass.**

Run: `npx vitest run src/test/contexts`
Expected: PASS (the new file plus the existing `AuthContext.test.jsx`).

- [ ] **Step 5: Commit.**

```bash
git add src/contexts/AuthContext.jsx src/test/contexts/AuthContextRoles.test.jsx
git commit -m "feat(auth): expose isPro and canScan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `scanResolve` — a Gemini read becomes a known card or a reason

**Files:**
- Create: `SWU-Holocron/src/utils/scanResolve.js`
- Test: `SWU-Holocron/src/test/utils/scanResolve.test.js`

**Interfaces:**
- Consumes: `SET_CODE_MAP` from `src/utils/officialCodeUtils.js` (maps printed/official codes such as `'01'`, `'G25'` to internal codes).
- Produces:
  - `normalizeSetCode(raw: unknown, setCodes: string[]): string | null`
  - `normalizeNumber(raw: unknown): string | null`: zero-padded to 3, as `getCollectionId` does
  - `normalizeName(s: unknown): string`
  - `namesMatch(readName: string, card: { Name, Subtitle? }): boolean`
  - `resolveScan(read, { setCodes: string[], getCards: (set) => Card[] | null })` →
    `{ status: 'matched', set, number, name }` or
    `{ status: 'unidentified', reason: 'unreadable'|'unknown-set'|'no-such-card'|'name-mismatch', read }`

- [ ] **Step 1: Write the failing tests.** Create `src/test/utils/scanResolve.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  normalizeSetCode,
  normalizeNumber,
  normalizeName,
  namesMatch,
  resolveScan,
} from '../../utils/scanResolve';

const SET_CODES = ['SOR', 'SHD', 'JTL', 'PROMO'];

const CARDS = {
  SOR: [
    { Set: 'SOR', Number: '012', Name: 'Luke Skywalker', Subtitle: 'Faithful Friend', Type: 'Leader' },
    { Set: 'SOR', Number: 45, Name: 'Admiral Ackbar', Subtitle: "It's a Trap!", Type: 'Unit' },
    { Set: 'SOR', Number: '100', Name: 'Padmé Amidala', Subtitle: null, Type: 'Unit' },
  ],
};
const getCards = (set) => CARDS[set] ?? null;
const ctx = { setCodes: SET_CODES, getCards };

describe('normalizeSetCode', () => {
  it('uppercases and trims', () => {
    expect(normalizeSetCode(' sor ', SET_CODES)).toBe('SOR');
  });
  it('strips separator glyphs printed around the code', () => {
    expect(normalizeSetCode('SOR •', SET_CODES)).toBe('SOR');
  });
  it('maps an official numeric code to the internal code', () => {
    expect(normalizeSetCode('01', SET_CODES)).toBe('SOR');
  });
  it('maps a printed promo code when the internal code is registered', () => {
    expect(normalizeSetCode('G25', SET_CODES)).toBe('PROMO');
  });
  it('rejects a set code that is not in the registry', () => {
    expect(normalizeSetCode('S0R', SET_CODES)).toBeNull();
    expect(normalizeSetCode('TWI', SET_CODES)).toBeNull();
  });
  it('rejects empty and non-string input', () => {
    expect(normalizeSetCode('', SET_CODES)).toBeNull();
    expect(normalizeSetCode(undefined, SET_CODES)).toBeNull();
    expect(normalizeSetCode(12, SET_CODES)).toBeNull();
  });
});

describe('normalizeNumber', () => {
  it('pads to three digits', () => {
    expect(normalizeNumber('12')).toBe('012');
    expect(normalizeNumber(12)).toBe('012');
  });
  it('drops a printed /total suffix', () => {
    expect(normalizeNumber('012/252')).toBe('012');
  });
  it('leaves four-digit numbers alone', () => {
    expect(normalizeNumber('1122')).toBe('1122');
  });
  it('returns null for empty, zero or digit-free input', () => {
    expect(normalizeNumber('')).toBeNull();
    expect(normalizeNumber('—')).toBeNull();
    expect(normalizeNumber('0')).toBeNull();
    expect(normalizeNumber(null)).toBeNull();
  });
});

describe('namesMatch', () => {
  const luke = CARDS.SOR[0];
  it('matches the title alone', () => {
    expect(namesMatch('Luke Skywalker', luke)).toBe(true);
  });
  it('matches title plus subtitle with any punctuation between', () => {
    expect(namesMatch('Luke Skywalker - Faithful Friend', luke)).toBe(true);
    expect(namesMatch('Luke Skywalker, Faithful Friend', luke)).toBe(true);
  });
  it('ignores case and accents', () => {
    expect(namesMatch('LUKE SKYWALKER', luke)).toBe(true);
    expect(namesMatch('Padme Amidala', CARDS.SOR[2])).toBe(true);
  });
  it('rejects a different card', () => {
    expect(namesMatch('Darth Vader', luke)).toBe(false);
  });
  it('rejects an empty read', () => {
    expect(namesMatch('', luke)).toBe(false);
    expect(normalizeName(undefined)).toBe('');
  });
});

describe('resolveScan', () => {
  it('matches a clean read', () => {
    const read = { readable: true, set: 'SOR', number: '012/252', name: 'Luke Skywalker' };
    expect(resolveScan(read, ctx)).toEqual({ status: 'matched', set: 'SOR', number: '012', name: 'Luke Skywalker' });
  });

  it('matches when card data stores the number as an integer', () => {
    const read = { readable: true, set: 'SOR', number: '45', name: 'Admiral Ackbar' };
    expect(resolveScan(read, ctx)).toMatchObject({ status: 'matched', number: '045' });
  });

  it('is unreadable when Gemini says so', () => {
    const read = { readable: false, set: '', number: '', name: '' };
    expect(resolveScan(read, ctx)).toEqual({ status: 'unidentified', reason: 'unreadable', read });
  });

  it('treats readable-but-empty number as unreadable', () => {
    const read = { readable: true, set: 'SOR', number: '', name: 'Luke Skywalker' };
    expect(resolveScan(read, ctx)).toMatchObject({ status: 'unidentified', reason: 'unreadable' });
  });

  it('treats a missing read as unreadable', () => {
    expect(resolveScan(null, ctx)).toEqual({ status: 'unidentified', reason: 'unreadable', read: null });
  });

  it('reports an unknown set', () => {
    const read = { readable: true, set: 'XYZ', number: '1', name: 'Anyone' };
    expect(resolveScan(read, ctx)).toMatchObject({ status: 'unidentified', reason: 'unknown-set' });
  });

  it('reports a number with no card', () => {
    const read = { readable: true, set: 'SOR', number: '999', name: 'Nobody' };
    expect(resolveScan(read, ctx)).toMatchObject({ status: 'unidentified', reason: 'no-such-card' });
  });

  it('reports no-such-card when the set data is not loaded', () => {
    const read = { readable: true, set: 'SHD', number: '1', name: 'Anyone' };
    expect(resolveScan(read, ctx)).toMatchObject({ status: 'unidentified', reason: 'no-such-card' });
  });

  it('refuses a misread number that lands on a different card', () => {
    const read = { readable: true, set: 'SOR', number: '45', name: 'Luke Skywalker' };
    expect(resolveScan(read, ctx)).toMatchObject({ status: 'unidentified', reason: 'name-mismatch', read });
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `npx vitest run src/test/utils/scanResolve.test.js`
Expected: FAIL, "Failed to resolve import ../../utils/scanResolve".

- [ ] **Step 3: Implement.** Create `src/utils/scanResolve.js`:

```js
/**
 * Card-scanner resolution: turns what Gemini read off a photo into a card the
 * app knows, or a reason it could not.
 *
 * Pure -- no Firebase, no Vite -- so it is unit-testable and Node-safe.
 *
 * The name check is the accuracy guard. A misread collector number almost
 * never lands on a card with the same name, so requiring both to agree keeps
 * a wrong card from reaching the collection unnoticed.
 */
import { SET_CODE_MAP } from './officialCodeUtils';

export function normalizeSetCode(raw, setCodes) {
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!code) return null;
  if (setCodes.includes(code)) return code;
  const mapped = SET_CODE_MAP[code];
  if (mapped && setCodes.includes(mapped)) return mapped;
  return null;
}

export function normalizeNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const match = String(raw).match(/\d+/);
  if (!match) return null;
  const n = parseInt(match[0], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(n).padStart(3, '0');
}

export function normalizeName(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function namesMatch(readName, card) {
  const read = normalizeName(readName);
  if (!read) return false;
  const title = normalizeName(card.Name);
  const full = normalizeName(`${card.Name ?? ''} ${card.Subtitle ?? ''}`);
  return read === title || read === full;
}

const unidentified = (reason, read) => ({ status: 'unidentified', reason, read: read ?? null });

export function resolveScan(read, { setCodes, getCards }) {
  if (!read || read.readable !== true) return unidentified('unreadable', read);

  const set = normalizeSetCode(read.set, setCodes);
  if (!set) return unidentified('unknown-set', read);

  const number = normalizeNumber(read.number);
  if (!number) return unidentified('unreadable', read);

  const card = (getCards(set) ?? []).find((c) => normalizeNumber(c.Number) === number);
  if (!card) return unidentified('no-such-card', read);

  if (!namesMatch(read.name, card)) return unidentified('name-mismatch', read);

  return { status: 'matched', set, number, name: card.Name };
}
```

- [ ] **Step 4: Run and confirm they pass.**

Run: `npx vitest run src/test/utils/scanResolve.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Commit.**

```bash
git add src/utils/scanResolve.js src/test/utils/scanResolve.test.js
git commit -m "feat(scanner): resolve a Gemini read against known cards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `scanDraft` — the batch model and per-user persistence

**Files:**
- Create: `SWU-Holocron/src/utils/scanDraft.js`
- Test: `SWU-Holocron/src/test/utils/scanDraft.test.js`

**Interfaces:**
- Consumes: `getCollectionId(set, number, isFoil)` from `src/utils/collectionHelpers.js`; `normalizeNumber` from Task 3.
- Produces (all pure, returning a new `{ rows }`):
  - Row: `{ id: string, status: 'reading'|'matched'|'unidentified'|'failed', isFoil: boolean, qty: number, photo: string|null (base64 JPEG, no data: prefix), hadPhoto?: boolean, set?, number?, name?, read?, reason? }`
  - `emptyDraft()`, `draftKey(uid)`
  - `addCapture(draft, { id, isFoil, photo })`
  - `applyResult(draft, id, result)`: `result` is a `resolveScan` output, or `{ status: 'failed', error: string }`
  - `markReading(draft, id)`, `resolveManually(draft, id, card)`, `setFoil(draft, ids, isFoil)`, `removeRows(draft, ids)`
  - `groupKey(row)`, `groupRows(draft)` → `Group[]` where `Group = { key, rows, qty, status, set, number, name, isFoil, photo, hadPhoto, read, reason }`
  - `setGroupQuantity(draft, key, qty)`
  - `toWrites(draft)` → `{ collectionId, set, number, name, isFoil, qty, rowIds }[]` (matched only)
  - `countByStatus(draft)` → `{ reading, matched, unidentified, failed }` (summing `qty`)
  - `saveDraft(storage, uid, draft): boolean`, `loadDraft(storage, uid)`, `clearDraft(storage, uid)`

- [ ] **Step 1: Write the failing tests.** Create `src/test/utils/scanDraft.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  emptyDraft, draftKey, addCapture, applyResult, markReading, resolveManually,
  setFoil, removeRows, groupRows, setGroupQuantity, toWrites, countByStatus,
  saveDraft, loadDraft, clearDraft,
} from '../../utils/scanDraft';

const memoryStorage = () => {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
};
const throwingStorage = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
  removeItem: () => { throw new Error('denied'); },
};

const LUKE = { status: 'matched', set: 'SOR', number: '012', name: 'Luke Skywalker' };

const capture = (draft, id, isFoil = false) => addCapture(draft, { id, isFoil, photo: `photo-${id}` });
const matched = (draft, id, isFoil = false, result = LUKE) => applyResult(capture(draft, id, isFoil), id, result);

describe('adding and resolving captures', () => {
  it('adds a capture as a reading row with its photo', () => {
    const d = capture(emptyDraft(), 'a', true);
    expect(d.rows).toEqual([{ id: 'a', status: 'reading', isFoil: true, qty: 1, photo: 'photo-a' }]);
  });

  it('applies a matched result', () => {
    const d = matched(emptyDraft(), 'a');
    expect(d.rows[0]).toMatchObject({ status: 'matched', set: 'SOR', number: '012', name: 'Luke Skywalker' });
  });

  it('applies an unidentified result and keeps what was read', () => {
    const read = { readable: true, set: 'SOR', number: '999', name: 'Nobody' };
    const d = applyResult(capture(emptyDraft(), 'a'), 'a', { status: 'unidentified', reason: 'no-such-card', read });
    expect(d.rows[0]).toMatchObject({ status: 'unidentified', reason: 'no-such-card', read, photo: 'photo-a' });
  });

  it('applies a failure with its error as the reason', () => {
    const d = applyResult(capture(emptyDraft(), 'a'), 'a', { status: 'failed', error: 'network' });
    expect(d.rows[0]).toMatchObject({ status: 'failed', reason: 'network' });
  });

  it('marks a row reading again for a retry', () => {
    const failed = applyResult(capture(emptyDraft(), 'a'), 'a', { status: 'failed', error: 'network' });
    expect(markReading(failed, 'a').rows[0]).toMatchObject({ status: 'reading', reason: null });
  });

  it('resolves an unidentified row from a picked card', () => {
    const d = applyResult(capture(emptyDraft(), 'a'), 'a', { status: 'unidentified', reason: 'unreadable', read: null });
    const card = { Set: 'SHD', Number: 7, Name: 'Boba Fett' };
    expect(resolveManually(d, 'a', card).rows[0]).toMatchObject({ status: 'matched', set: 'SHD', number: '007', name: 'Boba Fett' });
  });

  it('does not touch other rows', () => {
    let d = capture(capture(emptyDraft(), 'a'), 'b');
    d = applyResult(d, 'a', LUKE);
    expect(d.rows[1].status).toBe('reading');
  });
});

describe('grouping and editing', () => {
  it('groups identical matched captures into one line', () => {
    let d = matched(emptyDraft(), 'a');
    d = matched(d, 'b');
    const groups = groupRows(d);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'SOR_012_std', qty: 2 });
  });

  it('keeps foil and standard copies of the same card apart', () => {
    let d = matched(emptyDraft(), 'a', false);
    d = matched(d, 'b', true);
    expect(groupRows(d).map((g) => g.key)).toEqual(['SOR_012_std', 'SOR_012_foil']);
    expect(toWrites(d).map((w) => w.collectionId)).toEqual(['SOR_012_std', 'SOR_012_foil']);
  });

  it('never groups unidentified rows together', () => {
    let d = applyResult(capture(emptyDraft(), 'a'), 'a', { status: 'unidentified', reason: 'unreadable', read: null });
    d = applyResult(capture(d, 'b'), 'b', { status: 'unidentified', reason: 'unreadable', read: null });
    expect(groupRows(d)).toHaveLength(2);
  });

  it('flips foil on the given rows', () => {
    const d = setFoil(matched(emptyDraft(), 'a'), ['a'], true);
    expect(d.rows[0].isFoil).toBe(true);
  });

  it('sets a group quantity by collapsing it onto one row', () => {
    let d = matched(emptyDraft(), 'a');
    d = matched(d, 'b');
    d = setGroupQuantity(d, 'SOR_012_std', 5);
    expect(d.rows).toHaveLength(1);
    expect(groupRows(d)[0].qty).toBe(5);
  });

  it('removes the group when its quantity is set to zero', () => {
    const d = setGroupQuantity(matched(emptyDraft(), 'a'), 'SOR_012_std', 0);
    expect(d.rows).toEqual([]);
  });

  it('removes rows by id', () => {
    const d = removeRows(capture(capture(emptyDraft(), 'a'), 'b'), ['a']);
    expect(d.rows.map((r) => r.id)).toEqual(['b']);
  });

  it('counts rows by status, summing quantity', () => {
    let d = setGroupQuantity(matched(emptyDraft(), 'a'), 'SOR_012_std', 3);
    d = capture(d, 'b');
    expect(countByStatus(d)).toEqual({ reading: 1, matched: 3, unidentified: 0, failed: 0 });
  });
});

describe('toWrites', () => {
  it('emits one write per matched group, with its row ids', () => {
    let d = matched(emptyDraft(), 'a');
    d = matched(d, 'b');
    expect(toWrites(d)).toEqual([
      { collectionId: 'SOR_012_std', set: 'SOR', number: '012', name: 'Luke Skywalker', isFoil: false, qty: 2, rowIds: ['a', 'b'] },
    ]);
  });

  it('excludes reading, unidentified and failed rows', () => {
    let d = capture(emptyDraft(), 'r');
    d = applyResult(capture(d, 'u'), 'u', { status: 'unidentified', reason: 'unreadable', read: null });
    d = applyResult(capture(d, 'f'), 'f', { status: 'failed', error: 'network' });
    expect(toWrites(d)).toEqual([]);
  });
});

describe('persistence', () => {
  it('round-trips a draft without its photos', () => {
    const storage = memoryStorage();
    const d = matched(emptyDraft(), 'a');
    expect(saveDraft(storage, 'uid-1', d)).toBe(true);
    const loaded = loadDraft(storage, 'uid-1');
    expect(loaded.rows[0]).toMatchObject({ id: 'a', status: 'matched', photo: null, hadPhoto: true });
  });

  it('turns a row still reading at reload into an interrupted failure', () => {
    const storage = memoryStorage();
    saveDraft(storage, 'uid-1', capture(emptyDraft(), 'a'));
    expect(loadDraft(storage, 'uid-1').rows[0]).toMatchObject({ status: 'failed', reason: 'interrupted', photo: null });
  });

  it('keeps each user\'s draft separate', () => {
    const storage = memoryStorage();
    saveDraft(storage, 'user-a', matched(emptyDraft(), 'a'));
    expect(loadDraft(storage, 'user-b')).toEqual(emptyDraft());
    expect(draftKey('user-a')).toBe('swu-scan-draft-user-a');
  });

  it('returns an empty draft for missing or corrupt data', () => {
    const storage = memoryStorage();
    expect(loadDraft(storage, 'uid-1')).toEqual(emptyDraft());
    storage.setItem(draftKey('uid-1'), '{not json');
    expect(loadDraft(storage, 'uid-1')).toEqual(emptyDraft());
    storage.setItem(draftKey('uid-1'), JSON.stringify({ rows: 'nope' }));
    expect(loadDraft(storage, 'uid-1')).toEqual(emptyDraft());
  });

  it('saveDraft returns false instead of throwing', () => {
    expect(saveDraft(throwingStorage, 'uid-1', matched(emptyDraft(), 'a'))).toBe(false);
    expect(saveDraft(null, 'uid-1', emptyDraft())).toBe(false);
  });

  it('loadDraft returns an empty draft when storage throws', () => {
    expect(loadDraft(throwingStorage, 'uid-1')).toEqual(emptyDraft());
    expect(() => clearDraft(throwingStorage, 'uid-1')).not.toThrow();
  });

  it('clears a saved draft', () => {
    const storage = memoryStorage();
    saveDraft(storage, 'uid-1', matched(emptyDraft(), 'a'));
    clearDraft(storage, 'uid-1');
    expect(loadDraft(storage, 'uid-1')).toEqual(emptyDraft());
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `npx vitest run src/test/utils/scanDraft.test.js`
Expected: FAIL, import not resolved.

- [ ] **Step 3: Implement.** Create `src/utils/scanDraft.js`:

```js
/**
 * Card-scanner batch ("draft"): the rows captured in a scanning session,
 * before the user approves them into their collection.
 *
 * Pure functions over an immutable { rows } value. The storage helpers take
 * the storage object as a parameter so tests need no real localStorage, and
 * they never throw -- a private window or a full quota must not stop scanning.
 *
 * The key is per uid: a shared key would let one account's unsaved batch be
 * committed into another account's collection on a shared device.
 *
 * @environment:web-localstorage (saveDraft / loadDraft / clearDraft)
 */
import { getCollectionId } from './collectionHelpers';
import { normalizeNumber } from './scanResolve';

export const DRAFT_KEY_PREFIX = 'swu-scan-draft-';
export const draftKey = (uid) => `${DRAFT_KEY_PREFIX}${uid}`;
export const emptyDraft = () => ({ rows: [] });

const mapRows = (draft, ids, fn) => {
  const wanted = new Set(ids);
  return { rows: draft.rows.map((row) => (wanted.has(row.id) ? fn(row) : row)) };
};

export function addCapture(draft, { id, isFoil, photo }) {
  return {
    rows: [...draft.rows, { id, status: 'reading', isFoil: Boolean(isFoil), qty: 1, photo: photo ?? null }],
  };
}

export function applyResult(draft, id, result) {
  return mapRows(draft, [id], (row) => {
    if (result.status === 'matched') {
      return { ...row, status: 'matched', set: result.set, number: result.number, name: result.name, reason: null, read: null };
    }
    if (result.status === 'unidentified') {
      return { ...row, status: 'unidentified', reason: result.reason, read: result.read ?? null };
    }
    return { ...row, status: 'failed', reason: result.error ?? 'unknown' };
  });
}

export function markReading(draft, id) {
  return mapRows(draft, [id], (row) => ({ ...row, status: 'reading', reason: null }));
}

export function resolveManually(draft, id, card) {
  return mapRows(draft, [id], (row) => ({
    ...row,
    status: 'matched',
    set: card.Set,
    number: normalizeNumber(card.Number),
    name: card.Name,
    reason: null,
    read: null,
  }));
}

export function setFoil(draft, ids, isFoil) {
  return mapRows(draft, ids, (row) => ({ ...row, isFoil: Boolean(isFoil) }));
}

export function removeRows(draft, ids) {
  const gone = new Set(ids);
  return { rows: draft.rows.filter((row) => !gone.has(row.id)) };
}

export const groupKey = (row) =>
  row.status === 'matched' ? getCollectionId(row.set, row.number, row.isFoil) : row.id;

export function groupRows(draft) {
  const groups = new Map();
  for (const row of draft.rows) {
    const key = groupKey(row);
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
      existing.qty += row.qty;
    } else {
      groups.set(key, {
        key,
        rows: [row],
        qty: row.qty,
        status: row.status,
        set: row.set,
        number: row.number,
        name: row.name,
        isFoil: row.isFoil,
        photo: row.photo,
        hadPhoto: Boolean(row.hadPhoto),
        read: row.read ?? null,
        reason: row.reason ?? null,
      });
    }
  }
  return [...groups.values()];
}

export function setGroupQuantity(draft, key, qty) {
  const members = draft.rows.filter((row) => groupKey(row) === key);
  if (members.length === 0) return draft;
  if (qty <= 0) return removeRows(draft, members.map((row) => row.id));
  const [keep, ...rest] = members;
  const dropped = new Set(rest.map((row) => row.id));
  return {
    rows: draft.rows
      .filter((row) => !dropped.has(row.id))
      .map((row) => (row.id === keep.id ? { ...row, qty } : row)),
  };
}

export function toWrites(draft) {
  return groupRows(draft)
    .filter((group) => group.status === 'matched')
    .map((group) => ({
      collectionId: group.key,
      set: group.set,
      number: group.number,
      name: group.name,
      isFoil: group.isFoil,
      qty: group.qty,
      rowIds: group.rows.map((row) => row.id),
    }));
}

export function countByStatus(draft) {
  const counts = { reading: 0, matched: 0, unidentified: 0, failed: 0 };
  for (const row of draft.rows) counts[row.status] += row.qty;
  return counts;
}

export function saveDraft(storage, uid, draft) {
  try {
    const rows = draft.rows.map(({ photo, ...row }) => ({ ...row, hadPhoto: Boolean(photo) || Boolean(row.hadPhoto) }));
    storage.setItem(draftKey(uid), JSON.stringify({ rows }));
    return true;
  } catch {
    return false;
  }
}

export function loadDraft(storage, uid) {
  try {
    const raw = storage.getItem(draftKey(uid));
    if (!raw) return emptyDraft();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.rows)) return emptyDraft();
    return {
      rows: parsed.rows
        .filter((row) => row && typeof row.id === 'string')
        .map((row) => ({
          ...row,
          photo: null,
          ...(row.status === 'reading' ? { status: 'failed', reason: 'interrupted' } : {}),
        })),
    };
  } catch {
    return emptyDraft();
  }
}

export function clearDraft(storage, uid) {
  try {
    storage.removeItem(draftKey(uid));
  } catch {
    // Storage unavailable: nothing was persisted, so there is nothing to clear.
  }
}
```

- [ ] **Step 4: Run and confirm they pass.**

Run: `npx vitest run src/test/utils/scanDraft.test.js`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/utils/scanDraft.js src/test/utils/scanDraft.test.js
git commit -m "feat(scanner): draft batch model with per-user persistence

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `scanCard` handler — auth, entitlement, quota, validation

**Files:**
- Create: `SWU-Holocron/functions/scanCard.js` (CommonJS, **no `require` of any package**)
- Test: `SWU-Holocron/src/test/functions/scanCard.test.js`

**Interfaces:**
- Produces (CommonJS exports):
  - `DEFAULT_SCAN_DAILY_LIMIT = 1000`
  - `createScanCardHandler({ db, appId, readCard, HttpsError, logger?, now? }) → async (request) => { readable, set, number, name }`
    - `db`: Admin Firestore (`db.doc(path).get()` → `{ exists: boolean, data() }`; `db.runTransaction(fn)` with `tx.get(ref)` / `tx.set(ref, data)`)
    - `readCard(imageBase64) → Promise<{ readable, set, number, name }>`
    - `HttpsError`: the class from `firebase-functions/v2/https`, injected so this file loads in CI without `functions/node_modules`
  - Errors: `unauthenticated`; `permission-denied` (anonymous or not entitled); `invalid-argument` (bad image); `resource-exhausted` with `details: { limit, resetsAt }` (ISO string of the next UTC midnight); `internal` (Gemini failed)

- [ ] **Step 1: Write the failing tests.** Create `src/test/functions/scanCard.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createScanCardHandler, DEFAULT_SCAN_DAILY_LIMIT } = require('../../../functions/scanCard.js');

class FakeHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const APP = 'test-app';
const profilePath = (uid) => `artifacts/${APP}/users/${uid}`;
const usagePath = (uid) => `artifacts/${APP}/scanUsage/${uid}`;
const CONFIG_PATH = `artifacts/${APP}/config/scanner`;

function fakeDb(docs = {}) {
  const store = new Map(Object.entries(docs));
  const snap = (path) => ({ exists: store.has(path), data: () => store.get(path) });
  return {
    store,
    doc: (path) => ({ path, get: async () => snap(path) }),
    runTransaction: async (fn) => fn({
      get: async (ref) => snap(ref.path),
      set: (ref, data) => { store.set(ref.path, data); },
    }),
  };
}

const IMAGE = Buffer.from('fake-jpeg-bytes').toString('base64');
const READ = { readable: true, set: 'SOR', number: '012', name: 'Luke Skywalker' };
const NOW = new Date('2026-09-29T15:00:00Z');

const request = (uid, { anonymous = false, image = IMAGE } = {}) => ({
  auth: uid ? { uid, token: { firebase: { sign_in_provider: anonymous ? 'anonymous' : 'google.com' } } } : undefined,
  data: { image },
});

const setup = (docs, readCard = vi.fn(async () => READ)) => {
  const db = fakeDb(docs);
  const handler = createScanCardHandler({ db, appId: APP, readCard, HttpsError: FakeHttpsError, now: () => NOW });
  return { db, handler, readCard };
};

const expectCode = async (promise, code) => {
  await expect(promise).rejects.toMatchObject({ code });
};

describe('scanCard handler', () => {
  it('rejects an unauthenticated caller', async () => {
    const { handler, readCard } = setup({});
    await expectCode(handler(request(null)), 'unauthenticated');
    expect(readCard).not.toHaveBeenCalled();
  });

  it('rejects an anonymous guest even with isPro on the profile', async () => {
    const { handler } = setup({ [profilePath('g')]: { isPro: true } });
    await expectCode(handler(request('g', { anonymous: true })), 'permission-denied');
  });

  it('rejects a signed-in user who is neither Pro nor admin', async () => {
    const { handler, readCard } = setup({ [profilePath('u')]: {} });
    await expectCode(handler(request('u')), 'permission-denied');
    expect(readCard).not.toHaveBeenCalled();
  });

  it('rejects a user with no profile document', async () => {
    const { handler } = setup({});
    await expectCode(handler(request('nobody')), 'permission-denied');
  });

  it('rejects a missing or malformed image', async () => {
    const { handler } = setup({ [profilePath('p')]: { isPro: true } });
    await expectCode(handler(request('p', { image: undefined })), 'invalid-argument');
    await expectCode(handler(request('p', { image: 'not base64!' })), 'invalid-argument');
  });

  it('rejects an image over 2 MB', async () => {
    const { handler } = setup({ [profilePath('p')]: { isPro: true } });
    const big = 'A'.repeat(Math.ceil((2 * 1024 * 1024 + 10) * 4 / 3));
    await expectCode(handler(request('p', { image: big })), 'invalid-argument');
  });

  it('lets a Pro user scan and counts the scan', async () => {
    const { handler, db } = setup({ [profilePath('p')]: { isPro: true } });
    await expect(handler(request('p'))).resolves.toEqual(READ);
    expect(db.store.get(usagePath('p'))).toEqual({ date: '2026-09-29', count: 1 });
  });

  it('lets an admin scan without isPro and does not count it', async () => {
    const { handler, db } = setup({ [profilePath('a')]: { isAdmin: true } });
    await expect(handler(request('a'))).resolves.toEqual(READ);
    expect(db.store.has(usagePath('a'))).toBe(false);
  });

  it('never limits an admin, even over the cap', async () => {
    const { handler } = setup({
      [profilePath('a')]: { isAdmin: true },
      [CONFIG_PATH]: { dailyLimit: 1 },
      [usagePath('a')]: { date: '2026-09-29', count: 50 },
    });
    await expect(handler(request('a'))).resolves.toEqual(READ);
  });

  it('enforces the configured daily limit with the reset time', async () => {
    const { handler, readCard } = setup({
      [profilePath('p')]: { isPro: true },
      [CONFIG_PATH]: { dailyLimit: 2 },
      [usagePath('p')]: { date: '2026-09-29', count: 2 },
    });
    await expect(handler(request('p'))).rejects.toMatchObject({
      code: 'resource-exhausted',
      details: { limit: 2, resetsAt: '2026-09-30T00:00:00.000Z' },
    });
    expect(readCard).not.toHaveBeenCalled();
  });

  it('resets the count on a new UTC day', async () => {
    const { handler, db } = setup({
      [profilePath('p')]: { isPro: true },
      [CONFIG_PATH]: { dailyLimit: 2 },
      [usagePath('p')]: { date: '2026-09-28', count: 2 },
    });
    await expect(handler(request('p'))).resolves.toEqual(READ);
    expect(db.store.get(usagePath('p'))).toEqual({ date: '2026-09-29', count: 1 });
  });

  it.each([
    ['missing config', {}],
    ['zero', { [CONFIG_PATH]: { dailyLimit: 0 } }],
    ['a string', { [CONFIG_PATH]: { dailyLimit: '50' } }],
    ['a fraction', { [CONFIG_PATH]: { dailyLimit: 2.5 } }],
  ])('falls back to %s → the default limit', async (_label, extra) => {
    const { handler } = setup({
      [profilePath('p')]: { isPro: true },
      [usagePath('p')]: { date: '2026-09-29', count: DEFAULT_SCAN_DAILY_LIMIT - 1 },
      ...extra,
    });
    await expect(handler(request('p'))).resolves.toEqual(READ);
    await expectCode(handler(request('p')), 'resource-exhausted');
    expect(DEFAULT_SCAN_DAILY_LIMIT).toBe(1000);
  });

  it('maps a Gemini failure to internal', async () => {
    const { handler } = setup({ [profilePath('p')]: { isPro: true } }, vi.fn(async () => { throw new Error('vertex down'); }));
    await expectCode(handler(request('p')), 'internal');
  });

  it('sanitises the read into four well-typed fields', async () => {
    const messy = { readable: 'yes', set: '  SOR ', number: 12, name: 'x'.repeat(500), extra: 'dropped' };
    const { handler } = setup({ [profilePath('p')]: { isPro: true } }, vi.fn(async () => messy));
    const out = await handler(request('p'));
    expect(out).toEqual({ readable: false, set: 'SOR', number: '', name: 'x'.repeat(100) });
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `npx vitest run src/test/functions/scanCard.test.js`
Expected: FAIL, "Cannot find module '../../../functions/scanCard.js'".

- [ ] **Step 3: Implement.** Create `functions/scanCard.js`:

```js
/**
 * scanCard handler -- entitlement, daily quota and input validation for the
 * card scanner. The Gemini call itself is injected as `readCard`.
 *
 * Everything is injected (Firestore, HttpsError, the reader, the clock) and this
 * file requires no package, so the app's Vitest suite can load it in CI, which
 * does not install functions/node_modules.
 */

const DEFAULT_SCAN_DAILY_LIMIT = 1000;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function utcDate(now) {
  return now.toISOString().slice(0, 10);
}

function nextUtcMidnight(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

function resolveDailyLimit(config) {
  const value = config?.dailyLimit;
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_SCAN_DAILY_LIMIT;
}

function cleanString(value) {
  return typeof value === "string" ? value.trim().slice(0, 100) : "";
}

function sanitizeRead(read) {
  return {
    readable: read?.readable === true,
    set: cleanString(read?.set),
    number: cleanString(read?.number),
    name: cleanString(read?.name),
  };
}

function createScanCardHandler({ db, appId, readCard, HttpsError, logger = console, now = () => new Date() }) {
  const validateImage = (image) => {
    if (typeof image !== "string" || image.length === 0 || !BASE64.test(image)) {
      throw new HttpsError("invalid-argument", "image must be a base64-encoded JPEG.");
    }
    if (Math.floor(image.length * 3 / 4) > MAX_IMAGE_BYTES) {
      throw new HttpsError("invalid-argument", "image is larger than 2 MB.");
    }
  };

  const chargeQuota = async (uid, at) => {
    const configSnap = await db.doc(`artifacts/${appId}/config/scanner`).get();
    const limit = resolveDailyLimit(configSnap.exists ? configSnap.data() : null);
    const usageRef = db.doc(`artifacts/${appId}/scanUsage/${uid}`);
    const today = utcDate(at);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(usageRef);
      const usage = snap.exists ? snap.data() : null;
      const count = usage && usage.date === today ? usage.count : 0;
      if (count >= limit) {
        throw new HttpsError(
          "resource-exhausted",
          `Daily scan limit of ${limit} reached.`,
          { limit, resetsAt: nextUtcMidnight(at) },
        );
      }
      tx.set(usageRef, { date: today, count: count + 1 });
    });
  };

  return async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to scan cards.");
    }
    if (request.auth.token?.firebase?.sign_in_provider === "anonymous") {
      throw new HttpsError("permission-denied", "Guest accounts cannot scan cards.");
    }

    const image = request.data?.image;
    validateImage(image);

    const uid = request.auth.uid;
    const profileSnap = await db.doc(`artifacts/${appId}/users/${uid}`).get();
    const profile = profileSnap.exists ? profileSnap.data() : {};
    const isAdmin = profile.isAdmin === true;

    if (!isAdmin && profile.isPro !== true) {
      throw new HttpsError("permission-denied", "Card scanning is a Pro feature.");
    }

    // Charged before the Gemini call, so a failed call still counts. At this
    // limit that is cheaper than a refund path, and it cannot be gamed.
    if (!isAdmin) {
      await chargeQuota(uid, now());
    }

    let read;
    try {
      read = await readCard(image);
    } catch (err) {
      logger.error("scanCard recognition failed", { uid, error: err.message });
      throw new HttpsError("internal", "Card recognition failed.");
    }

    return sanitizeRead(read);
  };
}

module.exports = { createScanCardHandler, DEFAULT_SCAN_DAILY_LIMIT };
```

- [ ] **Step 4: Run and confirm they pass.**

Run: `npx vitest run src/test/functions/scanCard.test.js`
Expected: PASS. `'sanitises…'` expects `readable: false` because `'yes'` is not `true`, and `number: ''` because `12` is not a string.

- [ ] **Step 5: Commit.**

```bash
git add functions/scanCard.js src/test/functions/scanCard.test.js
git commit -m "feat(functions): scanCard entitlement, quota and validation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Wire `scanCard` into `functions/index.js` with the Gemini reader

**Files:**
- Modify: `SWU-Holocron/functions/index.js` (add after `getCardSuggestions`, before `redeemInviteCode`)

**Interfaces:**
- Consumes: `createScanCardHandler` from Task 5; the existing `GCP_PROJECT`, `VERTEX_LOCATION`, `GEMINI_MODEL`, `APP_ID`, `admin`, `logger`, `HttpsError`, `onCall` in `index.js`.
- Produces: the callable `scanCard` (request `{ image: base64 }` → `{ readable, set, number, name }`), which Task 7 calls by name.

- [ ] **Step 1: Implement.** Add near the top, after the other `require`s:

```js
const { createScanCardHandler } = require("./scanCard");
```

Add after the `getCardSuggestions` export:

```js
/**
 * scanCard — reads one photographed card for the card scanner.
 *
 * Entitlement (isAdmin || isPro), the daily quota and input validation live in
 * scanCard.js, where they are unit-tested. This file only supplies the Gemini
 * call. It returns what was read and never writes to the user's collection:
 * the client resolves the read and the user approves the batch.
 */
const SCAN_PROMPT = `This is a photo of a Star Wars: Unlimited trading card.
Read three things from it:
- set: the set code printed in the collector line along the card's bottom edge (for example SOR, SHD, TWI, JTL, LOF), exactly as printed.
- number: the collector number from that same line, without any "/total" part.
- name: the card's title as printed, without its subtitle.
If there is no card in the photo, or you cannot read the collector line with confidence, set readable to false and leave the other fields empty. Do not guess.`;

const SCAN_SCHEMA = {
  type: "object",
  properties: {
    readable: { type: "boolean" },
    set: { type: "string" },
    number: { type: "string" },
    name: { type: "string" },
  },
  required: ["readable", "set", "number", "name"],
};

async function readCardWithGemini(imageBase64) {
  const { GoogleGenAI } = require("@google/genai");
  const ai = new GoogleGenAI({ enterprise: true, project: GCP_PROJECT, location: VERTEX_LOCATION });
  const result = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
        { text: SCAN_PROMPT },
      ],
    }],
    config: {
      maxOutputTokens: 256,
      temperature: 0,
      // Required: see getCardSuggestions. Thinking tokens count against the cap.
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: "application/json",
      responseSchema: SCAN_SCHEMA,
    },
  });
  return JSON.parse(result.text);
}

const scanCardHandler = createScanCardHandler({
  db: admin.firestore(),
  appId: APP_ID,
  readCard: readCardWithGemini,
  HttpsError,
  logger,
});

exports.scanCard = onCall({ maxInstances: 10 }, scanCardHandler);
```

- [ ] **Step 2: Verify the module loads.** This needs `functions/node_modules`, which exists locally.

Run: `node -e "const f=require('./functions/index.js'); console.log(Object.keys(f).sort().join(','))"`
Expected: output includes `getCardSuggestions,redeemInviteCode,scanCard`. There must be no exception.

- [ ] **Step 3: Re-run the handler tests** to confirm nothing regressed.

Run: `npx vitest run src/test/functions/scanCard.test.js`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add functions/index.js
git commit -m "feat(functions): expose scanCard with the Gemini card reader

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Deploying is a manual step in Task 12. No workflow deploys functions.

---

### Task 7: `ScanService` — call, resolve, commit additively

**Files:**
- Create: `SWU-Holocron/src/services/ScanService.js`
- Test: `SWU-Holocron/src/test/services/ScanService.test.js`

**Interfaces:**
- Consumes: `normalizeSetCode`, `resolveScan` (Task 3); `toWrites`, `removeRows` (Task 4); `CardService.fetchSetData(code) → Promise<{ data: Card[] }>`.
- Produces:
  - `COMMIT_CHUNK_SIZE = 400`
  - `mapScanError(err) → { error: 'quota', limit, resetsAt } | { error: 'forbidden' } | { error: 'network' } | { error: 'unknown' }`
  - `resetSetCache()`: test helper
  - `ScanService.scan(imageBase64: string, setCodes: string[]) → Promise<ScanResult>`, where `ScanResult` is a `resolveScan` output or `{ status: 'failed', error, limit?, resetsAt? }`. **Never throws.**
  - `ScanService.commitDraft(draft, collectionRef, { onProgress?: (draft) => void }) → Promise<draft>`: returns the draft minus committed rows; throws on a failed chunk after reporting progress for earlier chunks.

- [ ] **Step 1: Write the failing tests.** Create `src/test/services/ScanService.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  batchSet: vi.fn(),
  commit: vi.fn(),
  fetchSetData: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => mocks.callable),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((ref, id) => ({ id })),
  increment: vi.fn((n) => ({ __increment: n })),
  writeBatch: vi.fn(() => ({ set: mocks.batchSet, commit: mocks.commit })),
}));
vi.mock('../../firebase', () => ({ db: {}, isConfigured: true, APP_ID: 'test-app-id' }));
vi.mock('../../services/CardService', () => ({ CardService: { fetchSetData: mocks.fetchSetData } }));

import { ScanService, mapScanError, resetSetCache, COMMIT_CHUNK_SIZE } from '../../services/ScanService';
import { emptyDraft, addCapture, applyResult } from '../../utils/scanDraft';

const SET_CODES = ['SOR', 'SHD'];
const SOR = [{ Set: 'SOR', Number: '012', Name: 'Luke Skywalker', Subtitle: 'Faithful Friend' }];
const READ = { readable: true, set: 'SOR', number: '012', name: 'Luke Skywalker' };

const httpsError = (code, details) => Object.assign(new Error(code), { code: `functions/${code}`, details });

const draftOf = (count) => {
  let d = emptyDraft();
  for (let i = 1; i <= count; i += 1) {
    const id = `r${i}`;
    d = addCapture(d, { id, isFoil: false, photo: null });
    d = applyResult(d, id, { status: 'matched', set: 'SOR', number: String(i).padStart(3, '0'), name: `Card ${i}` });
  }
  return d;
};

beforeEach(() => {
  vi.clearAllMocks();
  resetSetCache();
  mocks.fetchSetData.mockResolvedValue({ data: SOR });
  mocks.commit.mockResolvedValue(undefined);
});

describe('ScanService.scan', () => {
  it('resolves a read against the set data', async () => {
    mocks.callable.mockResolvedValue({ data: READ });
    await expect(ScanService.scan('IMG', SET_CODES)).resolves.toEqual({
      status: 'matched', set: 'SOR', number: '012', name: 'Luke Skywalker',
    });
    expect(mocks.callable).toHaveBeenCalledWith({ image: 'IMG' });
  });

  it('loads each set once across scans', async () => {
    mocks.callable.mockResolvedValue({ data: READ });
    await ScanService.scan('IMG', SET_CODES);
    await ScanService.scan('IMG', SET_CODES);
    expect(mocks.fetchSetData).toHaveBeenCalledTimes(1);
  });

  it('does not load set data for an unknown set', async () => {
    mocks.callable.mockResolvedValue({ data: { ...READ, set: 'XYZ' } });
    await expect(ScanService.scan('IMG', SET_CODES)).resolves.toMatchObject({ status: 'unidentified', reason: 'unknown-set' });
    expect(mocks.fetchSetData).not.toHaveBeenCalled();
  });

  it('reports a quota error with its limit and reset time', async () => {
    mocks.callable.mockRejectedValue(httpsError('resource-exhausted', { limit: 1000, resetsAt: '2026-09-30T00:00:00.000Z' }));
    await expect(ScanService.scan('IMG', SET_CODES)).resolves.toEqual({
      status: 'failed', error: 'quota', limit: 1000, resetsAt: '2026-09-30T00:00:00.000Z',
    });
  });

  it('reports a network failure without throwing', async () => {
    mocks.callable.mockRejectedValue(httpsError('unavailable'));
    await expect(ScanService.scan('IMG', SET_CODES)).resolves.toEqual({ status: 'failed', error: 'network' });
  });

  it('reports a failed set-data load as a network failure and retries it next time', async () => {
    mocks.callable.mockResolvedValue({ data: READ });
    mocks.fetchSetData.mockRejectedValueOnce(new Error('offline'));
    await expect(ScanService.scan('IMG', SET_CODES)).resolves.toEqual({ status: 'failed', error: 'network' });
    await expect(ScanService.scan('IMG', SET_CODES)).resolves.toMatchObject({ status: 'matched' });
  });
});

describe('mapScanError', () => {
  it.each([
    ['permission-denied', { error: 'forbidden' }],
    ['unauthenticated', { error: 'forbidden' }],
    ['deadline-exceeded', { error: 'network' }],
    ['internal', { error: 'unknown' }],
  ])('maps %s', (code, expected) => {
    expect(mapScanError(httpsError(code))).toEqual(expected);
  });

  it('treats a plain network error with no code as network', () => {
    expect(mapScanError(new TypeError('Failed to fetch'))).toEqual({ error: 'network' });
  });
});

describe('ScanService.commitDraft', () => {
  it('writes increments, never absolute quantities', async () => {
    let d = draftOf(1);
    d = addCapture(d, { id: 'dup', isFoil: false, photo: null });
    d = applyResult(d, 'dup', { status: 'matched', set: 'SOR', number: '001', name: 'Card 1' });
    await ScanService.commitDraft(d, { id: 'ref' });
    expect(mocks.batchSet).toHaveBeenCalledWith(
      { id: 'SOR_001_std' },
      expect.objectContaining({ quantity: { __increment: 2 }, set: 'SOR', number: '001', name: 'Card 1', isFoil: false }),
      { merge: true },
    );
  });

  it(`commits in chunks of ${COMMIT_CHUNK_SIZE}`, async () => {
    const rest = await ScanService.commitDraft(draftOf(401), { id: 'ref' });
    expect(mocks.commit).toHaveBeenCalledTimes(2);
    expect(mocks.batchSet).toHaveBeenCalledTimes(401);
    expect(rest.rows).toEqual([]);
  });

  it('reports progress after each chunk', async () => {
    const onProgress = vi.fn();
    await ScanService.commitDraft(draftOf(401), { id: 'ref' }, { onProgress });
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls[0][0].rows).toHaveLength(1);
    expect(onProgress.mock.calls[1][0].rows).toHaveLength(0);
  });

  it('leaves exactly the uncommitted rows when a later chunk fails', async () => {
    mocks.commit.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'));
    const onProgress = vi.fn();
    await expect(ScanService.commitDraft(draftOf(401), { id: 'ref' }, { onProgress })).rejects.toThrow('offline');
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress.mock.calls[0][0].rows.map((r) => r.id)).toEqual(['r401']);
  });

  it('keeps unidentified rows in the draft', async () => {
    let d = draftOf(1);
    d = addCapture(d, { id: 'u', isFoil: false, photo: null });
    d = applyResult(d, 'u', { status: 'unidentified', reason: 'unreadable', read: null });
    const rest = await ScanService.commitDraft(d, { id: 'ref' });
    expect(rest.rows.map((r) => r.id)).toEqual(['u']);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `npx vitest run src/test/services/ScanService.test.js`
Expected: FAIL, import not resolved.

- [ ] **Step 3: Implement.** Create `src/services/ScanService.js`:

```js
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, increment, writeBatch } from 'firebase/firestore';
import { db, isConfigured } from '../firebase';
import { CardService } from './CardService';
import { normalizeSetCode, resolveScan } from '../utils/scanResolve';
import { removeRows, toWrites } from '../utils/scanDraft';

/**
 * Card scanner: sends one photo to the scanCard Cloud Function, resolves what
 * it read against the card data the app already has, and commits an approved
 * batch to the user's collection.
 *
 * Commits are additive (increment), unlike CSV import, which overwrites:
 * scanning one more copy of a card you own two of must leave you with three.
 *
 * @environment:firebase
 */

export const COMMIT_CHUNK_SIZE = 400;

const NETWORK_CODES = new Set(['unavailable', 'deadline-exceeded']);

export function mapScanError(err) {
  const code = String(err?.code ?? '').replace(/^functions\//, '');
  if (code === 'resource-exhausted') {
    return { error: 'quota', limit: err.details?.limit ?? null, resetsAt: err.details?.resetsAt ?? null };
  }
  if (code === 'permission-denied' || code === 'unauthenticated') return { error: 'forbidden' };
  if (NETWORK_CODES.has(code) || !code) return { error: 'network' };
  return { error: 'unknown' };
}

// Set data per code, shared across a scanning session. A failed load is
// dropped so the next scan retries it.
const setCache = new Map();

export function resetSetCache() {
  setCache.clear();
}

function cardsForSet(setCode) {
  if (!setCache.has(setCode)) {
    const pending = CardService.fetchSetData(setCode)
      .then((result) => result?.data ?? [])
      .catch((err) => {
        setCache.delete(setCode);
        throw err;
      });
    setCache.set(setCode, pending);
  }
  return setCache.get(setCode);
}

export const ScanService = {
  async scan(imageBase64, setCodes) {
    if (!isConfigured) return { status: 'failed', error: 'unknown' };

    let read;
    try {
      const call = httpsCallable(getFunctions(), 'scanCard');
      read = (await call({ image: imageBase64 })).data;
    } catch (err) {
      return { status: 'failed', ...mapScanError(err) };
    }

    const set = normalizeSetCode(read?.set, setCodes);
    let cards = null;
    if (set) {
      try {
        cards = await cardsForSet(set);
      } catch {
        return { status: 'failed', error: 'network' };
      }
    }

    return resolveScan(read, { setCodes, getCards: (code) => (code === set ? cards : null) });
  },

  async commitDraft(draft, collectionRef, { onProgress = () => {} } = {}) {
    const writes = toWrites(draft);
    let current = draft;

    for (let i = 0; i < writes.length; i += COMMIT_CHUNK_SIZE) {
      const chunk = writes.slice(i, i + COMMIT_CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const write of chunk) {
        batch.set(doc(collectionRef, write.collectionId), {
          quantity: increment(write.qty),
          set: write.set,
          number: write.number,
          name: write.name,
          isFoil: write.isFoil,
          timestamp: Date.now(),
        }, { merge: true });
      }
      await batch.commit();

      // Drop what just landed before touching the next chunk: an increment
      // applied twice counts the card twice, so a retry after a failure here
      // must only ever see the rows that did not make it.
      current = removeRows(current, chunk.flatMap((write) => write.rowIds));
      onProgress(current);
    }

    return current;
  },
};
```

- [ ] **Step 4: Run and confirm they pass.**

Run: `npx vitest run src/test/services/ScanService.test.js`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/services/ScanService.js src/test/services/ScanService.test.js
git commit -m "feat(scanner): ScanService with additive, chunked, retry-safe commit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `CardPickerModal` — optional `type`, sets from the registry

**Files:**
- Modify: `SWU-Holocron/src/components/CardPickerModal.jsx`
- Test: `SWU-Holocron/src/components/__tests__/CardPickerModal.test.jsx` (create)

**Interfaces:**
- Consumes: `CardService.getSetRegistry() → Promise<{ code }[]>` (never throws; falls back internally).
- Produces: `<CardPickerModal type?: string, collectionData, onSelect(card), onClose />`. With no `type`, it lists every type, only after at least 2 search characters, capped at 100 results. Task 9 uses it without `type`.

- [ ] **Step 1: Write the failing test.** Create `src/components/__tests__/CardPickerModal.test.jsx`:

```jsx
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const mocks = vi.hoisted(() => ({ getSetRegistry: vi.fn(), fetchSetData: vi.fn() }));

vi.mock('../../services/CardService', () => ({
  CardService: {
    getSetRegistry: mocks.getSetRegistry,
    fetchSetData: mocks.fetchSetData,
    getCardImage: (set, number) => `img/${set}/${number}`,
  },
}));

import CardPickerModal from '../CardPickerModal';

const CARDS = {
  SOR: [
    { Set: 'SOR', Number: '001', Name: 'Director Krennic', Type: 'Leader' },
    { Set: 'SOR', Number: '050', Name: 'Death Trooper', Type: 'Unit' },
  ],
  // IBH is not in the hardcoded SETS fallback; it only exists via the registry.
  IBH: [{ Set: 'IBH', Number: '010', Name: 'Death Star Plans', Type: 'Upgrade' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSetRegistry.mockResolvedValue([{ code: 'SOR' }, { code: 'IBH' }]);
  mocks.fetchSetData.mockImplementation(async (code) => ({ data: CARDS[code] ?? [] }));
});

describe('CardPickerModal', () => {
  it('still lists only the requested type', async () => {
    render(<CardPickerModal type="Leader" collectionData={{}} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText('Director Krennic')).toBeInTheDocument();
    expect(screen.queryByText('Death Trooper')).not.toBeInTheDocument();
  });

  it('loads sets from the registry, not the hardcoded fallback', async () => {
    render(<CardPickerModal type="Upgrade" collectionData={{}} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText('Death Star Plans')).toBeInTheDocument();
    expect(mocks.fetchSetData).toHaveBeenCalledWith('IBH');
  });

  it('without a type, asks for a search before listing anything', async () => {
    render(<CardPickerModal collectionData={{}} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(/type at least 2 letters/i)).toBeInTheDocument();
    expect(screen.queryByText('Director Krennic')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Select a card' })).toBeInTheDocument();
  });

  it('without a type, searches every type', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<CardPickerModal collectionData={{}} onSelect={onSelect} onClose={vi.fn()} />);
    await waitFor(() => expect(mocks.fetchSetData).toHaveBeenCalledTimes(2));
    await user.type(screen.getByPlaceholderText(/search/i), 'death');
    expect(await screen.findByText('Death Trooper')).toBeInTheDocument();
    expect(screen.getByText('Death Star Plans')).toBeInTheDocument();
    await user.click(screen.getByText('Death Trooper'));
    expect(onSelect).toHaveBeenCalledWith(CARDS.SOR[1]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `npx vitest run src/components/__tests__/CardPickerModal.test.jsx`
Expected: FAIL. The registry test fails because `IBH` is never fetched, and the untyped tests crash on `type.toLowerCase()`.

- [ ] **Step 3: Implement.** In `src/components/CardPickerModal.jsx`:
  - Remove `import { SETS } from '../constants';`.
  - Update the doc comment: `type` is optional; without it the picker searches every card type (used by the card scanner's review screen).
  - Replace the loader loop with:

```jsx
      const loaded = [];
      const registry = await CardService.getSetRegistry();
      for (const { code } of registry) {
        try {
          const { data } = await CardService.fetchSetData(code);
          loaded.push(...data.filter((c) => !type || c.Type === type));
        } catch {
          // Skip sets that fail to load
        }
      }
```

  - Add `const MIN_QUERY = 2;` and `const MAX_UNTYPED_RESULTS = 100;` above the component, and change `filtered`:

```jsx
  const needsQuery = !type;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (needsQuery && q.length < MIN_QUERY) return [];
    const matches = cards
      .filter(card => {
        if (!q) return true;
        return (
          card.Name?.toLowerCase().includes(q) ||
          card.Subtitle?.toLowerCase().includes(q) ||
          card.Traits?.some(t => t.toLowerCase().includes(q))
        );
      })
      .filter(card => {
        if (!collectionOnly) return true;
        return getCardQuantities(safeCollection, card.Set, card.Number).total > 0;
      });
    return needsQuery ? matches.slice(0, MAX_UNTYPED_RESULTS) : matches;
  }, [cards, search, collectionOnly, collectionData, needsQuery]);

  const noun = type ? `${type.toLowerCase()}s` : 'cards';
  const tooShort = needsQuery && search.trim().length < MIN_QUERY;
```

  - Header: `Select a {type ?? 'card'}`.
  - Loading text: `Loading {noun}…`.
  - Replace the empty-state block with:

```jsx
          {!loading && tooShort && (
            <div className="text-center py-12 text-gray-500">
              <p>Type at least 2 letters to search every card</p>
            </div>
          )}

          {!loading && !tooShort && filtered.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              <p>No {noun} found</p>
              {collectionOnly && (
                <p className="text-sm mt-1 text-gray-600">
                  Try disabling &quot;Owned only&quot;
                </p>
              )}
            </div>
          )}
```

- [ ] **Step 4: Run the picker and DeckBuilder tests and confirm they pass.** DeckBuilder is the existing caller.

Run: `npx vitest run src/components/__tests__/CardPickerModal.test.jsx src/components/__tests__/DeckBuilder.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/components/CardPickerModal.jsx src/components/__tests__/CardPickerModal.test.jsx
git commit -m "feat(picker): optional type and set registry instead of hardcoded SETS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `ScanReview` — the approve-the-batch screen

**Files:**
- Create: `SWU-Holocron/src/components/ScanReview.jsx`
- Test: `SWU-Holocron/src/components/__tests__/ScanReview.test.jsx`

**Interfaces:**
- Consumes: from Task 4, `groupRows`, `setGroupQuantity`, `setFoil`, `removeRows`, `resolveManually`, `countByStatus`; `CardPickerModal` (Task 8, untyped); `CardService.getCardImage(set, number)`.
- Produces: `<ScanReview draft onChange(draft) onRetry(rowId) onBack() onCommit() onDiscard() committing: boolean commitError: string|null />`. A purely controlled component: every edit goes through `onChange`.
  - Accessible names Task 10 relies on: foil toggle = button named `Foil` with `aria-pressed`; `Back to camera`; commit button `Add N card(s) to collection`.

- [ ] **Step 1: Write the failing tests.** Create `src/components/__tests__/ScanReview.test.jsx`:

```jsx
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

vi.mock('../CardPickerModal', () => ({
  default: ({ onSelect }) => (
    <button type="button" onClick={() => onSelect({ Set: 'SHD', Number: 7, Name: 'Boba Fett' })}>pick-mock</button>
  ),
}));

import ScanReview from '../ScanReview';
import { emptyDraft, addCapture, applyResult, groupRows } from '../../utils/scanDraft';

const LUKE = { status: 'matched', set: 'SOR', number: '012', name: 'Luke Skywalker' };

const build = (specs) => specs.reduce((d, [id, result, { isFoil = false, photo = `p-${id}` } = {}]) => {
  const next = addCapture(d, { id, isFoil, photo });
  return result ? applyResult(next, id, result) : next;
}, emptyDraft());

const renderReview = (draft, props = {}) => {
  const handlers = {
    onChange: vi.fn(), onRetry: vi.fn(), onBack: vi.fn(), onCommit: vi.fn(), onDiscard: vi.fn(),
  };
  render(<ScanReview draft={draft} committing={false} commitError={null} {...handlers} {...props} />);
  return handlers;
};

describe('ScanReview', () => {
  it('groups identical captures into one line with a count', () => {
    renderReview(build([['a', LUKE], ['b', LUKE]]));
    const line = screen.getByTestId('group-SOR_012_std');
    expect(within(line).getByText('Luke Skywalker')).toBeInTheDocument();
    expect(within(line).getByText('×2')).toBeInTheDocument();
  });

  it('shows foil and standard copies as separate lines', () => {
    renderReview(build([['a', LUKE], ['b', LUKE, { isFoil: true }]]));
    expect(screen.getByTestId('group-SOR_012_std')).toBeInTheDocument();
    expect(screen.getByTestId('group-SOR_012_foil')).toBeInTheDocument();
  });

  it('increments and decrements a line through onChange', async () => {
    const user = userEvent.setup();
    const { onChange } = renderReview(build([['a', LUKE]]));
    await user.click(screen.getByRole('button', { name: 'Increase Luke Skywalker' }));
    expect(groupRows(onChange.mock.calls[0][0])[0].qty).toBe(2);
    await user.click(screen.getByRole('button', { name: 'Decrease Luke Skywalker' }));
    expect(onChange.mock.calls[1][0].rows).toEqual([]);
  });

  it('toggles foil for a whole line', async () => {
    const user = userEvent.setup();
    const { onChange } = renderReview(build([['a', LUKE], ['b', LUKE]]));
    const foil = screen.getByRole('button', { name: 'Foil' });
    expect(foil).toHaveAttribute('aria-pressed', 'false');
    await user.click(foil);
    expect(onChange.mock.calls[0][0].rows.every((r) => r.isFoil)).toBe(true);
  });

  it('shows what was read for an unidentified card and resolves it by picking', async () => {
    const user = userEvent.setup();
    const read = { readable: true, set: 'SOR', number: '999', name: 'Nobody' };
    const { onChange } = renderReview(build([['u', { status: 'unidentified', reason: 'no-such-card', read }]]));
    expect(screen.getByText('Read as SOR 999 · Nobody')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Captured photo' })).toHaveAttribute('src', 'data:image/jpeg;base64,p-u');
    await user.click(screen.getByRole('button', { name: 'Pick card' }));
    await user.click(screen.getByText('pick-mock'));
    expect(onChange.mock.calls[0][0].rows[0]).toMatchObject({ status: 'matched', set: 'SHD', number: '007' });
  });

  it('says so when a photo was lost to a reload', () => {
    const draft = { rows: [{ id: 'u', status: 'unidentified', reason: 'unreadable', read: null, isFoil: false, qty: 1, photo: null, hadPhoto: true }] };
    renderReview(draft);
    expect(screen.getByText('Photo lost')).toBeInTheDocument();
    expect(screen.getByText("Couldn't read this card")).toBeInTheDocument();
  });

  it('offers retry for a failed row that still has its photo', async () => {
    const user = userEvent.setup();
    const { onRetry } = renderReview(build([['f', { status: 'failed', error: 'network' }]]));
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('f');
  });

  it('removes a problem row', async () => {
    const user = userEvent.setup();
    const { onChange } = renderReview(build([['f', { status: 'failed', error: 'network' }]]));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onChange.mock.calls[0][0].rows).toEqual([]);
  });

  it('labels the commit with the matched count and warns about leftovers', () => {
    renderReview(build([['a', LUKE], ['b', LUKE], ['f', { status: 'failed', error: 'network' }]]));
    expect(screen.getByRole('button', { name: 'Add 2 cards to collection' })).toBeEnabled();
    expect(screen.getByText(/1 card needs attention and will stay in the batch/)).toBeInTheDocument();
  });

  it('disables commit while any card is still reading', () => {
    renderReview(build([['a', LUKE], ['r', null]]));
    expect(screen.getByRole('button', { name: /Add 1 card to collection/ })).toBeDisabled();
  });

  it('disables commit while committing and shows the error', () => {
    renderReview(build([['a', LUKE]]), { committing: true, commitError: 'Some cards were not saved.' });
    expect(screen.getByRole('button', { name: /Adding/ })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Some cards were not saved.');
  });

  it('confirms before discarding the batch', async () => {
    const user = userEvent.setup();
    const { onDiscard } = renderReview(build([['a', LUKE]]));
    await user.click(screen.getByRole('button', { name: 'Discard batch' }));
    expect(onDiscard).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Discard 1 card' }));
    expect(onDiscard).toHaveBeenCalled();
  });

  it('goes back to the camera', async () => {
    const user = userEvent.setup();
    const { onBack } = renderReview(emptyDraft());
    await user.click(screen.getByRole('button', { name: 'Back to camera' }));
    expect(onBack).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `npx vitest run src/components/__tests__/ScanReview.test.jsx`
Expected: FAIL, import not resolved.

- [ ] **Step 3: Implement.** Create `src/components/ScanReview.jsx`:

```jsx
import React, { useState } from 'react';
import { ArrowLeft, Minus, Plus, Sparkles, Trash2, RotateCcw, Loader2, Search } from 'lucide-react';
import CardPickerModal from './CardPickerModal';
import { CardService } from '../services/CardService';
import {
  countByStatus, groupRows, removeRows, resolveManually, setFoil, setGroupQuantity,
} from '../utils/scanDraft';

/**
 * Review screen for a card-scanner batch. Controlled: every edit is a new draft
 * passed to onChange. Collection controls stay inline (house rule) -- quantity
 * and foil are edited on the line itself.
 *
 * @environment:react
 */

const REASON_TEXT = {
  unreadable: "Couldn't read this card",
  'unknown-set': 'Set not recognised',
  'no-such-card': 'No card with that number',
  'name-mismatch': "Name didn't match the number",
  interrupted: 'Scan was interrupted',
  quota: 'Daily scan limit reached',
  network: 'Network error',
  forbidden: 'Scanning not allowed',
  unknown: 'Something went wrong',
};

const plural = (n) => `${n} card${n === 1 ? '' : 's'}`;

function Photo({ group }) {
  if (group.photo) {
    return (
      <img
        src={`data:image/jpeg;base64,${group.photo}`}
        alt="Captured photo"
        className="w-16 h-[88px] object-cover rounded flex-shrink-0"
      />
    );
  }
  return (
    <div className="w-16 h-[88px] rounded bg-gray-800 text-[10px] text-gray-500 flex items-center justify-center text-center flex-shrink-0">
      {group.hadPhoto ? 'Photo lost' : 'No photo'}
    </div>
  );
}

export default function ScanReview({ draft, onChange, onRetry, onBack, onCommit, onDiscard, committing, commitError }) {
  const [pickingFor, setPickingFor] = useState(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const groups = groupRows(draft);
  const counts = countByStatus(draft);
  const attention = counts.unidentified + counts.failed;
  const total = counts.reading + counts.matched + attention;
  const canCommit = counts.matched > 0 && counts.reading === 0 && !committing;

  return (
    <div className="flex flex-col h-full bg-gray-950 text-gray-100">
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to camera"
          className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white"
        >
          <ArrowLeft size={20} />
        </button>
        <h2 className="text-lg font-bold text-white">Review batch</h2>
        <span className="ml-auto text-sm text-gray-400">{plural(total)}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {groups.length === 0 && (
          <p className="text-center text-gray-500 py-12">Nothing scanned yet.</p>
        )}

        {groups.map((group) => {
          const ids = group.rows.map((r) => r.id);

          if (group.status === 'matched') {
            return (
              <div
                key={group.key}
                data-testid={`group-${group.key}`}
                className="flex items-center gap-3 p-3 bg-gray-900 border border-gray-800 rounded-xl"
              >
                <img
                  src={CardService.getCardImage(group.set, group.number)}
                  alt=""
                  className="w-16 h-[88px] object-cover rounded flex-shrink-0"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white truncate">{group.name}</p>
                  <p className="text-xs text-gray-500">{group.set} {group.number}</p>
                </div>
                <button
                  type="button"
                  aria-pressed={group.isFoil}
                  onClick={() => onChange(setFoil(draft, ids, !group.isFoil))}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-bold border ${
                    group.isFoil
                      ? 'bg-yellow-500/20 border-yellow-500 text-yellow-400'
                      : 'bg-gray-800 border-gray-700 text-gray-400'
                  }`}
                >
                  <Sparkles size={12} aria-hidden="true" />Foil
                </button>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Decrease ${group.name}`}
                    onClick={() => onChange(setGroupQuantity(draft, group.key, group.qty - 1))}
                    className="p-1 rounded bg-gray-800 hover:bg-gray-700"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="w-8 text-center font-bold">×{group.qty}</span>
                  <button
                    type="button"
                    aria-label={`Increase ${group.name}`}
                    onClick={() => onChange(setGroupQuantity(draft, group.key, group.qty + 1))}
                    className="p-1 rounded bg-gray-800 hover:bg-gray-700"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            );
          }

          if (group.status === 'reading') {
            return (
              <div key={group.key} className="flex items-center gap-3 p-3 bg-gray-900 border border-gray-800 rounded-xl text-gray-400">
                <Photo group={group} />
                <Loader2 size={16} className="animate-spin" />
                <span>Reading…</span>
              </div>
            );
          }

          const read = group.read;
          const detail = read && read.readable
            ? `Read as ${read.set} ${read.number} · ${read.name}`
            : REASON_TEXT[group.reason] ?? REASON_TEXT.unknown;

          return (
            <div key={group.key} className="flex items-center gap-3 p-3 bg-gray-900 border border-red-500/40 rounded-xl">
              <Photo group={group} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-red-300">{detail}</p>
                {read && read.readable && (
                  <p className="text-xs text-gray-500">{REASON_TEXT[group.reason] ?? ''}</p>
                )}
              </div>
              {group.status === 'failed' && group.photo && (
                <button
                  type="button"
                  onClick={() => onRetry(group.rows[0].id)}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs"
                >
                  <RotateCcw size={12} aria-hidden="true" />Retry
                </button>
              )}
              <button
                type="button"
                onClick={() => setPickingFor(group.rows[0].id)}
                className="flex items-center gap-1 px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold"
              >
                <Search size={12} aria-hidden="true" />Pick card
              </button>
              <button
                type="button"
                onClick={() => onChange(removeRows(draft, ids))}
                className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs"
              >
                <Trash2 size={12} aria-hidden="true" />Remove
              </button>
            </div>
          );
        })}
      </div>

      <div className="px-4 py-3 bg-gray-900 border-t border-gray-800 space-y-2">
        {commitError && (
          <p role="alert" className="text-sm text-red-400">{commitError}</p>
        )}
        {attention > 0 && (
          <p className="text-xs text-gray-400">
            {plural(attention)} {attention === 1 ? 'needs' : 'need'} attention and will stay in the batch.
          </p>
        )}
        {confirmingDiscard ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onDiscard}
              className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold"
            >
              Discard {plural(total)}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDiscard(false)}
              className="flex-1 py-2 rounded-lg bg-gray-800 hover:bg-gray-700"
            >
              Keep
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmingDiscard(true)}
              disabled={total === 0 || committing}
              className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm disabled:opacity-40"
            >
              Discard batch
            </button>
            <button
              type="button"
              onClick={onCommit}
              disabled={!canCommit}
              className="flex-1 py-2 rounded-lg bg-yellow-500 hover:bg-yellow-400 text-black font-bold disabled:opacity-40"
            >
              {committing ? 'Adding…' : `Add ${plural(counts.matched)} to collection`}
            </button>
          </div>
        )}
      </div>

      {pickingFor && (
        <CardPickerModal
          collectionData={{}}
          onSelect={(card) => {
            onChange(resolveManually(draft, pickingFor, card));
            setPickingFor(null);
          }}
          onClose={() => setPickingFor(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run and confirm they pass.**

Run: `npx vitest run src/components/__tests__/ScanReview.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/components/ScanReview.jsx src/components/__tests__/ScanReview.test.jsx
git commit -m "feat(scanner): batch review screen with inline edits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: `CardScanner` — camera, triggers, foil stack, flash, quota

**Files:**
- Create: `SWU-Holocron/src/utils/frameCapture.js`
- Create: `SWU-Holocron/src/components/CardScanner.jsx`
- Test: `SWU-Holocron/src/components/__tests__/CardScanner.test.jsx`

**Interfaces:**
- Consumes: `ScanService.scan`, `ScanService.commitDraft` (Task 7); from Task 4, `addCapture`, `applyResult`, `markReading`, `loadDraft`, `saveDraft`, `clearDraft`, `emptyDraft`, `countByStatus`; `ScanReview` (Task 9).
- Produces:
  - `captureFrame(video, { maxEdge = 1024, quality = 0.8 }) → string | null`: base64 JPEG, no `data:` prefix
  - `<CardScanner uid collectionRef setCodes onClose />`, a full-screen overlay (`z-50`). Task 11 mounts it.

- [ ] **Step 1: Write the failing tests.** Create `src/components/__tests__/CardScanner.test.jsx`:

```jsx
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const mocks = vi.hoisted(() => ({ scan: vi.fn(), commitDraft: vi.fn(), captureFrame: vi.fn() }));

vi.mock('../../services/ScanService', () => ({
  ScanService: { scan: mocks.scan, commitDraft: mocks.commitDraft },
}));
vi.mock('../../utils/frameCapture', () => ({ captureFrame: mocks.captureFrame }));
vi.mock('../CardPickerModal', () => ({ default: () => null }));

import CardScanner from '../CardScanner';

const LUKE = { status: 'matched', set: 'SOR', number: '012', name: 'Luke Skywalker' };

const stubCamera = (impl) => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(impl) },
  });
};

const renderScanner = (props = {}) => render(
  <CardScanner uid="uid-1" collectionRef={{ id: 'ref' }} setCodes={['SOR']} onClose={vi.fn()} {...props} />,
);

const pressSpace = (target = window, init = {}) =>
  fireEvent.keyDown(target, { key: ' ', code: 'Space', ...init });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.getItem.mockReturnValue(null);
  mocks.captureFrame.mockReturnValue('IMG');
  mocks.scan.mockResolvedValue(LUKE);
  stubCamera(async () => ({ getTracks: () => [{ stop: vi.fn() }] }));
});

describe('CardScanner', () => {
  it('captures on Space and counts the card', async () => {
    renderScanner();
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    pressSpace();
    expect(mocks.scan).toHaveBeenCalledWith('IMG', ['SOR']);
    expect(await screen.findByRole('button', { name: 'Review (1)' })).toBeInTheDocument();
  });

  it('captures on Enter', async () => {
    renderScanner();
    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' });
    expect(mocks.scan).toHaveBeenCalledTimes(1);
  });

  it('captures on a tap anywhere on the preview', async () => {
    const user = userEvent.setup();
    renderScanner();
    await user.click(screen.getByTestId('scan-preview'));
    expect(mocks.scan).toHaveBeenCalledTimes(1);
  });

  it('ignores auto-repeated key presses', async () => {
    renderScanner();
    pressSpace();
    pressSpace(window, { repeat: true });
    pressSpace(window, { repeat: true });
    expect(mocks.scan).toHaveBeenCalledTimes(1);
  });

  it('Space with the foil switch focused captures instead of toggling it', async () => {
    renderScanner();
    const foil = screen.getByRole('button', { name: 'Foil stack' });
    foil.focus();
    const event = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    foil.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(mocks.scan).toHaveBeenCalledTimes(1);
    expect(foil).toHaveAttribute('aria-pressed', 'false');
  });

  it('marks captures foil while the foil stack switch is on', async () => {
    const user = userEvent.setup();
    renderScanner();
    await user.click(screen.getByRole('button', { name: 'Foil stack' }));
    pressSpace();
    await user.click(await screen.findByRole('button', { name: 'Review (1)' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Foil' })).toHaveAttribute('aria-pressed', 'true'));
  });

  it('flashes when a card cannot be identified', async () => {
    mocks.scan.mockResolvedValue({ status: 'unidentified', reason: 'unreadable', read: null });
    renderScanner();
    pressSpace();
    expect(await screen.findByTestId('scan-flash')).toBeInTheDocument();
  });

  it('flashes when the frame cannot be captured, without calling the function', async () => {
    mocks.captureFrame.mockReturnValue(null);
    renderScanner();
    pressSpace();
    expect(await screen.findByTestId('scan-flash')).toBeInTheDocument();
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it('stops capturing at the daily limit and says when it resets', async () => {
    mocks.scan.mockResolvedValue({ status: 'failed', error: 'quota', limit: 1000, resetsAt: '2026-09-30T00:00:00.000Z' });
    renderScanner();
    pressSpace();
    expect(await screen.findByText(/Daily scan limit of 1000 reached/)).toBeInTheDocument();
    pressSpace();
    expect(mocks.scan).toHaveBeenCalledTimes(1);
  });

  it('explains a denied camera and does not capture', async () => {
    stubCamera(async () => { throw Object.assign(new Error('nope'), { name: 'NotAllowedError' }); });
    renderScanner();
    expect(await screen.findByText(/Camera access was denied/)).toBeInTheDocument();
    pressSpace();
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it('persists the batch under the user\'s own key', async () => {
    renderScanner();
    pressSpace();
    await waitFor(() => {
      const calls = localStorage.setItem.mock.calls.filter(([key]) => key === 'swu-scan-draft-uid-1');
      expect(calls.length).toBeGreaterThan(0);
      expect(JSON.parse(calls.at(-1)[1]).rows).toHaveLength(1);
    });
  });

  it('commits from review, saving progress as it goes, and closes when empty', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mocks.commitDraft.mockImplementation(async (draft, ref, { onProgress }) => {
      onProgress({ rows: [] });
      return { rows: [] };
    });
    renderScanner({ onClose });
    pressSpace();
    await user.click(await screen.findByRole('button', { name: 'Review (1)' }));
    await user.click(await screen.findByRole('button', { name: 'Add 1 card to collection' }));
    expect(mocks.commitDraft).toHaveBeenCalledWith(expect.any(Object), { id: 'ref' }, expect.any(Object));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(localStorage.removeItem).toHaveBeenCalledWith('swu-scan-draft-uid-1');
  });

  it('keeps the batch and explains when a commit fails', async () => {
    const user = userEvent.setup();
    mocks.commitDraft.mockRejectedValue(new Error('offline'));
    renderScanner();
    pressSpace();
    await user.click(await screen.findByRole('button', { name: 'Review (1)' }));
    await user.click(await screen.findByRole('button', { name: 'Add 1 card to collection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/won't be added twice/);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `npx vitest run src/components/__tests__/CardScanner.test.jsx`
Expected: FAIL, import not resolved.

- [ ] **Step 3: Implement `frameCapture`.** Create `src/utils/frameCapture.js`:

```js
/**
 * Grab the current frame of a <video> as a base64 JPEG (no data: prefix),
 * scaled so its long edge is at most maxEdge. About 1024px is enough for
 * Gemini to read the collector line and keeps each upload near 100-150 KB.
 *
 * Browser only: happy-dom has no real canvas, so this is verified by hand
 * (see TESTING.md) and mocked in component tests.
 *
 * @environment:web-media
 */
export function captureFrame(video, { maxEdge = 1024, quality = 0.8 } = {}) {
  const width = video?.videoWidth;
  const height = video?.videoHeight;
  if (!width || !height) return null;

  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? null;
}
```

- [ ] **Step 4: Implement `CardScanner`.** Create `src/components/CardScanner.jsx`:

```jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Sparkles } from 'lucide-react';
import { ScanService } from '../services/ScanService';
import { captureFrame } from '../utils/frameCapture';
import {
  addCapture, applyResult, clearDraft, countByStatus, emptyDraft, loadDraft, markReading, saveDraft,
} from '../utils/scanDraft';
import ScanReview from './ScanReview';

/**
 * Card scanner overlay: camera preview, capture on tap / Space / Enter, a
 * foil-stack switch, and the review screen. Captures are sent without waiting
 * for the previous one, so a stack can be passed through at hand speed.
 *
 * @environment:web-media @environment:web-localstorage @environment:react
 */

// Bare `localStorage`, not `window.localStorage`: identical in a browser, and
// it resolves to the global the test setup stubs. The accessor itself can
// throw (blocked site data), hence the try.
const getStorage = () => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

// crypto.randomUUID is missing on older iOS Safari; the id only has to be
// unique within one batch.
const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const CAPTURE_KEYS = new Set(['Space', 'Enter']);

const formatReset = (iso) => {
  if (!iso) return 'midnight UTC';
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

export default function CardScanner({ uid, collectionRef, setCodes, onClose }) {
  const [draft, setDraft] = useState(() => loadDraft(getStorage(), uid));
  const [mode, setMode] = useState('camera');
  const [foilStack, setFoilStack] = useState(false);
  const [flash, setFlash] = useState(false);
  const [quota, setQuota] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState(null);

  const videoRef = useRef(null);
  const mountedRef = useRef(false);
  const flashTimer = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(flashTimer.current);
    };
  }, []);

  useEffect(() => {
    saveDraft(getStorage(), uid, draft);
  }, [uid, draft]);

  useEffect(() => {
    if (mode !== 'camera') return undefined;
    let stream = null;
    let cancelled = false;

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('This browser cannot use a camera.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraError(null);
      } catch (err) {
        if (cancelled) return;
        setCameraError(err?.name === 'NotAllowedError'
          ? 'Camera access was denied. Allow it in your browser settings to scan cards.'
          : 'No camera is available on this device.');
      }
    };

    start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [mode]);

  const signalProblem = useCallback(() => {
    setFlash(true);
    navigator.vibrate?.(150);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      if (mountedRef.current) setFlash(false);
    }, 600);
  }, []);

  const runScan = useCallback(async (id, image) => {
    const result = await ScanService.scan(image, setCodes);
    if (!mountedRef.current) return;
    if (result.status !== 'matched') signalProblem();
    if (result.error === 'quota') setQuota({ limit: result.limit, resetsAt: result.resetsAt });
    setDraft((d) => applyResult(d, id, result));
  }, [setCodes, signalProblem]);

  const capture = useCallback(() => {
    if (quota || cameraError) return;
    let image = null;
    try {
      image = captureFrame(videoRef.current);
    } catch {
      image = null;
    }
    if (!image) {
      signalProblem();
      return;
    }
    const id = newId();
    setDraft((d) => addCapture(d, { id, isFoil: foilStack, photo: image }));
    runScan(id, image);
  }, [quota, cameraError, foilStack, runScan, signalProblem]);

  useEffect(() => {
    if (mode !== 'camera') return undefined;
    const onKey = (e) => {
      if (!CAPTURE_KEYS.has(e.code) && e.key !== ' ' && e.key !== 'Enter') return;
      // Always swallow the key: Space on a focused button would otherwise
      // also toggle it, and a held key would fire a capture per repeat.
      e.preventDefault();
      if (e.repeat) return;
      capture();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, capture]);

  const retry = useCallback((id) => {
    const row = draft.rows.find((r) => r.id === id);
    if (!row?.photo || quota) return;
    setDraft((d) => markReading(d, id));
    runScan(id, row.photo);
  }, [draft, quota, runScan]);

  const commit = useCallback(async () => {
    if (!collectionRef) {
      setCommitError('Not connected to cloud storage.');
      return;
    }
    setCommitting(true);
    setCommitError(null);
    try {
      const rest = await ScanService.commitDraft(draft, collectionRef, {
        onProgress: (next) => {
          // Persist synchronously: if the overlay closes mid-commit, the saved
          // batch must not still hold rows that were already added.
          saveDraft(getStorage(), uid, next);
          if (mountedRef.current) setDraft(next);
        },
      });
      if (!mountedRef.current) return;
      setDraft(rest);
      if (rest.rows.length === 0) {
        clearDraft(getStorage(), uid);
        onClose();
      }
    } catch (err) {
      console.error('Scan commit failed:', err);
      if (mountedRef.current) {
        setCommitError("Some cards weren't saved. Try again — cards already added won't be added twice.");
      }
    } finally {
      if (mountedRef.current) setCommitting(false);
    }
  }, [collectionRef, draft, uid, onClose]);

  const discard = useCallback(() => {
    clearDraft(getStorage(), uid);
    setDraft(emptyDraft());
    setMode('camera');
  }, [uid]);

  const counts = countByStatus(draft);
  const total = counts.reading + counts.matched + counts.unidentified + counts.failed;
  const attention = counts.unidentified + counts.failed;

  if (mode === 'review') {
    return (
      <div className="fixed inset-0 z-50">
        <ScanReview
          draft={draft}
          onChange={setDraft}
          onRetry={retry}
          onBack={() => setMode('camera')}
          onCommit={commit}
          onDiscard={discard}
          committing={committing}
          commitError={commitError}
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-gray-100">
      <div className="flex items-center gap-2 px-4 py-3 bg-gray-900/90 border-b border-gray-800">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close scanner"
          className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white"
        >
          <X size={20} />
        </button>
        <button
          type="button"
          aria-pressed={foilStack}
          onClick={() => setFoilStack((v) => !v)}
          className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-bold border ${
            foilStack
              ? 'bg-yellow-500/20 border-yellow-500 text-yellow-400'
              : 'bg-gray-800 border-gray-700 text-gray-400'
          }`}
        >
          <Sparkles size={14} aria-hidden="true" />Foil stack
        </button>
        <button
          type="button"
          onClick={() => setMode('review')}
          className="ml-auto px-3 py-2 rounded-lg bg-yellow-500 hover:bg-yellow-400 text-black text-sm font-bold"
        >
          Review ({total})
        </button>
      </div>

      <div
        data-testid="scan-preview"
        onClick={capture}
        className="relative flex-1 overflow-hidden cursor-pointer select-none"
      >
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-contain" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-[12%] border-2 border-yellow-500/70 rounded-xl" />
        {flash && <div data-testid="scan-flash" className="pointer-events-none absolute inset-0 bg-red-600/40" />}
        {cameraError && (
          <div role="alert" className="absolute inset-0 flex items-center justify-center p-6 text-center bg-black/80">
            {cameraError}
          </div>
        )}
        {quota && (
          <div role="alert" className="absolute inset-x-4 bottom-4 p-4 rounded-xl bg-gray-900 border border-yellow-500/50 text-sm text-center">
            Daily scan limit of {quota.limit} reached. It resets at {formatReset(quota.resetsAt)}.
            Your batch is kept — review it and add it now.
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 px-4 py-3 bg-gray-900/90 border-t border-gray-800 text-sm text-gray-400">
        <span>{total} scanned</span>
        {counts.reading > 0 && <span>{counts.reading} reading…</span>}
        {attention > 0 && <span className="text-red-400">{attention} need attention</span>}
        <span className="ml-auto hidden sm:inline">Tap or press Space to capture</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run and confirm they pass.**

Run: `npx vitest run src/components/__tests__/CardScanner.test.jsx`
Expected: PASS. If the `Space with the foil switch focused` test shows `defaultPrevented` false, check that the listener is on `window` and is not passive.

- [ ] **Step 6: Commit.**

```bash
git add src/utils/frameCapture.js src/components/CardScanner.jsx src/components/__tests__/CardScanner.test.jsx
git commit -m "feat(scanner): camera overlay with tap/keyboard capture and foil stack

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Mount the scanner in `App.jsx`

**Files:**
- Create: `SWU-Holocron/src/components/ScanButton.jsx`
- Test: `SWU-Holocron/src/components/__tests__/ScanButton.test.jsx`
- Modify: `SWU-Holocron/src/App.jsx` (the `useAuth` destructure at line ~70, state declarations, the header's "View Toggle" group at line ~655, and the overlays after Advanced Search at line ~1157)

**Interfaces:**
- Consumes: `canScan` (Task 2); `CardScanner` (Task 10); `setRegistry`, `availableSets`, `getCollectionRef`, `legacySyncCode`, `useLegacyPath` already in `App.jsx`.
- Produces: `<ScanButton isAnonymous canScan onOpen />`, which renders nothing for guests and is locked for non-Pro users.

- [ ] **Step 1: Write the failing test.** Create `src/components/__tests__/ScanButton.test.jsx`:

```jsx
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ScanButton from '../ScanButton';

describe('ScanButton', () => {
  it('opens the scanner for a user who can scan', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<ScanButton isAnonymous={false} canScan onOpen={onOpen} />);
    await user.click(screen.getByRole('button', { name: 'Scan cards' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('is locked, and says why, for a signed-in user without Pro', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<ScanButton isAnonymous={false} canScan={false} onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: 'Card scanning is a Pro feature' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('is not shown to a guest', () => {
    render(<ScanButton isAnonymous canScan={false} onOpen={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `npx vitest run src/components/__tests__/ScanButton.test.jsx`
Expected: FAIL, import not resolved.

- [ ] **Step 3: Implement `ScanButton`.** Create `src/components/ScanButton.jsx`:

```jsx
import React from 'react';
import { ScanLine, Lock } from 'lucide-react';

/**
 * Header entry point for the card scanner. Guests never see it: scanning needs
 * a durable account, and the server rejects anonymous callers anyway. Signed-in
 * users without Pro see it locked, so the feature is discoverable.
 *
 * @environment:react
 */
export default function ScanButton({ isAnonymous, canScan, onOpen }) {
  if (isAnonymous) return null;
  const label = canScan ? 'Scan cards' : 'Card scanning is a Pro feature';
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!canScan}
      aria-label={label}
      title={label}
      className="relative flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-all border border-gray-700 hover:border-yellow-500/50 disabled:opacity-50 disabled:hover:bg-gray-800 disabled:hover:border-gray-700 disabled:cursor-not-allowed"
    >
      <ScanLine className="text-yellow-500" size={18} />
      {!canScan && <Lock size={10} className="absolute top-1 right-1 text-gray-400" aria-hidden="true" />}
      <span className="text-sm font-medium hidden lg:inline">Scan</span>
    </button>
  );
}
```

- [ ] **Step 4: Run it and confirm it passes.**

Run: `npx vitest run src/components/__tests__/ScanButton.test.jsx`
Expected: PASS.

- [ ] **Step 5: Wire into `App.jsx`.**
  - Imports, next to the other component imports:

```jsx
import CardScanner from './components/CardScanner';
import ScanButton from './components/ScanButton';
```

  - Add `canScan` to the `useAuth()` destructure on line ~70.
  - Add state beside `isSearchOpen`: `const [isScannerOpen, setIsScannerOpen] = useState(false);` It must sit with the other hooks, **above** the `if (!user) return <LandingScreen …>` early return.
  - In the header's "View Toggle" group, insert immediately before the Advanced Search button:

```jsx
              <ScanButton
                isAnonymous={Boolean(user?.isAnonymous)}
                canScan={canScan}
                onOpen={() => setIsScannerOpen(true)}
              />
```

  - After the Advanced Search overlay block, add:

```jsx
      {/* Card Scanner - full-screen overlay */}
      {isScannerOpen && canScan && (
        <ErrorBoundary
          label="the scanner"
          fallback={<OverlayError what="scanner" onDismiss={() => setIsScannerOpen(false)} />}
        >
          <CardScanner
            uid={user.uid}
            collectionRef={getCollectionRef(user, legacySyncCode, useLegacyPath)}
            setCodes={setRegistry.length > 0 ? setRegistry.map((s) => s.code) : availableSets}
            onClose={() => setIsScannerOpen(false)}
          />
        </ErrorBoundary>
      )}
```

  The existing `onSnapshot` listener picks up the committed cards, so nothing else in `App.jsx` needs to refresh.

- [ ] **Step 6: Run the full suite, the lint gate and a build.**

Run: `npm run test:unit`
Expected: PASS, with no new failures; the documented skips are unchanged.

Run: `npx eslint src --ext js,jsx --quiet`
Expected: no output (zero errors).

Run: `npm run build`
Expected: the build succeeds.

- [ ] **Step 7: Commit.**

```bash
git add src/components/ScanButton.jsx src/components/__tests__/ScanButton.test.jsx src/App.jsx
git commit -m "feat(scanner): scan button and overlay in the app header

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Docs, deploy, and real-device verification

**Files:**
- Modify: `CLAUDE.md` (git root)
- Modify: `SWU-Holocron/TESTING.md`
- Modify: `SWU-Holocron/docs/DEPLOYMENT_RUNBOOK.md`

**Interfaces:**
- Consumes: everything above. No code changes.

- [ ] **Step 1: Update `CLAUDE.md`.**
  - Add to the Firestore path listing:

```
artifacts/{APP_ID}/config/scanner                             { dailyLimit } for the card scanner (function-only)
artifacts/{APP_ID}/scanUsage/{uid}                            per-user daily scan counter (function-only)
```

  - In "Auth and roles", add a paragraph: `isPro` is a third profile flag, protected in the rules like the other two and granted by hand in the console for now. `canScan = isAdmin || isPro`. Anonymous users are never entitled.
  - Add a "Card scanner" subsection under Architecture:
    - The `scanCard` function reads set, number and name through Gemini.
    - The client resolves the read and rejects it on a name mismatch (`src/utils/scanResolve.js`).
    - The draft is kept per uid in `localStorage` (`swu-scan-draft-{uid}`, `src/utils/scanDraft.js`).
    - Commits are **additive** (`increment`), unlike CSV import, which overwrites.
    - The daily limit defaults to 1000, is tuned at `config/scanner` without a redeploy, and admins are exempt.
    - `functions/scanCard.js` requires no packages so CI can test it.
  - Add `swu-scan-draft-{uid}` to the `localStorage` key list in Conventions.

- [ ] **Step 2: Update `TESTING.md`.** Add a "Card scanner — manual checks" section, since happy-dom has no camera or canvas:
  - Camera opens on Android Chrome and iOS Safari, in both the browser and the installed PWA.
  - A tap captures; Space and Enter capture on a laptop webcam.
  - Holding Space captures once.
  - A mixed stack of 30+ cards (standard, hyperspace, showcase, a promo, foils) scanned in stand-mounted conditions. Record the misread rate: the share of rows that came back unidentified, and **any card that matched wrongly**, which should be zero.
  - Close the overlay mid-batch, reopen it, and check the rows are still there and photos show "Photo lost".
  - Commit, then check the collection counts went **up** by the scanned amounts rather than being replaced.
  - A non-Pro account sees the locked button; a guest sees no button.

- [ ] **Step 3: Update `DEPLOYMENT_RUNBOOK.md`.** Add a "Card scanner" section:
  - Functions are deployed by hand: `firebase deploy --only functions:scanCard`, run from `SWU-Holocron/`.
  - Rules deploy through CI when `firestore.rules` changes on `main`.
  - To grant Pro, set `isPro: true` on `artifacts/swu-holocron-v1/users/{uid}` in the Firebase console.
  - To tune the limit, create or edit `artifacts/swu-holocron-v1/config/scanner` → `{ dailyLimit: <int> }`. It takes effect on the next scan.

- [ ] **Step 4: Commit the docs.**

```bash
git add ../CLAUDE.md TESTING.md docs/DEPLOYMENT_RUNBOOK.md
git commit -m "docs: card scanner architecture, manual checks and runbook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Hand off to the human for deploy and device testing.** These need the user's credentials and their hands:
  1. Deploy the function: `firebase deploy --only functions:scanCard`
  2. Open a PR. On merge, CI deploys the rules and the web app.
  3. Set `isPro: true` on a test account, or use the admin account.
  4. Run the manual checks from `TESTING.md` with real cards and record the misread rate in the PR.

  Do **not** claim the feature works until step 4 is done: the unit suite cannot see the camera, the canvas, or Gemini's real accuracy.
