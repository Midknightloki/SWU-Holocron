# Public List Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Share a saved trade or wants list at `/list/<code>`: anyone can open it without an account, and it updates automatically while shared.

**Architecture:** A self-contained public copy at `artifacts/{APP_ID}/publicLists/{code}` (built by the pure `toPublicList`) is written by `ListService.shareList` and kept current by `ListView`, which calls `updatePublic` after prices load and after every change. `PublicListView` renders the copy at `/list/<code>` (routed in `main.jsx` like `/deck/<slug>`). Rules allow public read and owner-only writes. The same owner check closes a takeover hole in `publicDecks`.

**Tech Stack:** React 18, Vite, Tailwind, Firestore v9 modular, Vitest + Testing Library (happy-dom), `@firebase/rules-unit-testing` on the Firestore emulator.

**Spec:** `SWU-Holocron/docs/superpowers/specs/2026-10-06-public-lists-design.md`

## Global Constraints

- All commands run from `SWU-Holocron/` (the nested app dir).
- Commit gate on every commit: the task's tests pass, then `npx eslint src --ext js,jsx --quiet` prints nothing, then commit. The last task also runs `npm run test:unit` and `npm run build`.
- Never type the U+FEFF escape sequence in source.
- Firestore rejects `undefined` field values: public bodies omit absent fields rather than setting them to `undefined`.
- Every ListService write goes through the existing `settle()` 8 s offline timeout; services never throw and return `{ error }` on failure.
- No `console.log`, no browser `alert`/`confirm`; risky actions take two taps.
- The public copy never carries the owner's name. It carries prices only when the list has Show prices on, and unpriced lines never show $0.
- Every hook before any conditional return.

## Review Focus

1. **Another signed-in user overwriting or deleting someone's public list or deck** — rules must refuse. Task 2's rules tests cover create, update and delete takeover on both collections.
2. **Show prices turned off on a shared list**: the next public write must drop every `unitPrice`, `value` and `pricesAsOf`. Tested in Tasks 1 and 4.
3. **Deleting a shared list** must remove the public copy, not leave an orphan link. Tested in Tasks 3 and 4.
4. **A viewer opening a link after Stop sharing** sees "This list isn't shared any more.", not a crash or a spinner. Tested in Task 5.
5. **Offline while shared**: the public update fails quietly with a notice, and the list edit itself is unaffected. Tested in Task 4.

## Plan decisions (beyond the spec)

- Opening a shared list re-publishes it once prices load, so "prices as of" refreshes whenever the owner looks at the list.
- The link is shown in a read-only, selectable field, so a blocked clipboard still leaves a way to copy it.

## File map

| File | Responsibility |
|---|---|
| Modify `src/utils/cardLists.js` | `toPublicList`, `publicLines` |
| Modify `firestore.rules` | `publicLists` rules; owner check on `publicDecks` update |
| Modify `src/test/rules/firestore.rules.test.js` | Rules tests |
| Modify `src/services/ListService.js` | `newListCode`, `shareList`, `updatePublic`, `unshareList`, `deleteList(…, code)`, `getPublicList` |
| Modify `src/components/ListView.jsx` | Share link UI and auto-update |
| Modify `src/components/SavedListsPage.jsx` | "Shared" badge |
| Create `src/components/PublicListView.jsx` | Public page |
| Modify `src/main.jsx` | `/list/<code>` route |
| Modify `CLAUDE.md` (git root) | Document public lists and the rules fix |

---

### Task 1: Public copy model

**Files:**
- Modify: `src/utils/cardLists.js`
- Test: `src/test/utils/cardLists.test.js`

**Interfaces:**
- Produces:
  - `toPublicList(list, lines, { showPrices, now }) → body`, where body = `{ kind, name, showPrices, lines: [{ set, number, name, subtitle, finish, qty, note?, unitPrice? }], cards, value?, pricesAsOf? }`. It carries no `uid` and no `updatedAt`.
  - `publicLines(doc) → line[]`: lines in `listLines` shape (`key`, `unitPrice: number|null`, `value: number|null`, `priceIsFallback: false`), usable by `toListText` and `listSummary`.

- [ ] **Step 1: Write the failing tests** (append to `src/test/utils/cardLists.test.js`, and add `toPublicList, publicLines` to its import list)

```js
describe('public copy', () => {
  const items = {
    SOR_010_any: { ...cardItem(card(), 'any', 2), note: 'any art' },
    SOR_005_foil: cardItem(card({ Number: 5, Name: 'Luke', Subtitle: '' }), 'foil', 1),
  };
  const lines = listLines(items, { SOR_010_any: { market: 1.5 } });

  it('carries prices only on priced lines, with a date and value', () => {
    const body = toPublicList({ kind: 'wants', name: 'Gaps', uid: 'u1' }, lines, { showPrices: true, now: 99 });
    expect(body).toEqual({
      kind: 'wants', name: 'Gaps', showPrices: true, cards: 3, value: 3, pricesAsOf: 99,
      lines: [
        { set: 'SOR', number: '005', name: 'Luke', subtitle: null, finish: 'foil', qty: 1 },
        { set: 'SOR', number: '010', name: 'Darth Vader', subtitle: 'Dark Lord of the Sith', finish: 'any', qty: 2, note: 'any art', unitPrice: 1.5 },
      ],
    });
  });

  it('drops every price when prices are hidden', () => {
    const body = toPublicList({ kind: 'trade', name: 'T' }, lines, { showPrices: false, now: 99 });
    expect(body).not.toHaveProperty('value');
    expect(body).not.toHaveProperty('pricesAsOf');
    expect(body.lines.some((l) => 'unitPrice' in l)).toBe(false);
    expect(JSON.stringify(body)).not.toContain('undefined');
  });

  it('has no value when nothing is priced', () => {
    expect(toPublicList({ kind: 'trade', name: 'T' }, listLines(items, {}), { showPrices: true, now: 1 })).not.toHaveProperty('value');
  });

  it('turns a public copy back into text-ready lines', () => {
    const doc = toPublicList({ kind: 'wants', name: 'Gaps' }, lines, { showPrices: true, now: 99 });
    const back = publicLines(doc);
    expect(back[1]).toMatchObject({ unitPrice: 1.5, value: 3, note: 'any art' });
    expect(back[0]).toMatchObject({ unitPrice: null, value: null });
    expect(toListText(doc, back, { showPrices: true })).toContain('2× Darth Vader, Dark Lord of the Sith (SOR 010) — $1.50 ea (any art)');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/test/utils/cardLists.test.js`
Expected: FAIL — `toPublicList is not a function` (or the missing export).

- [ ] **Step 3: Implement** (append to `src/utils/cardLists.js`)

```js
/** The public copy of a list: self-contained, no owner name, prices only when shown. */
export function toPublicList(list, lines, { showPrices, now }) {
  const s = listSummary(lines);
  const body = {
    kind: list.kind,
    name: list.name,
    showPrices: Boolean(showPrices),
    lines: lines.map((l) => {
      const out = { set: l.set, number: l.number, name: l.name, subtitle: l.subtitle ?? null, finish: l.finish, qty: l.qty };
      if (l.note) out.note = l.note;
      if (showPrices && l.unitPrice !== null) out.unitPrice = l.unitPrice;
      return out;
    }),
    cards: s.cards,
  };
  if (showPrices) {
    body.pricesAsOf = now;
    if (s.priced) body.value = s.value;
  }
  return body;
}

/** A public copy's lines in listLines shape, for text and totals. */
export const publicLines = (doc) => (doc?.lines ?? []).map((l, i) => {
  const unitPrice = typeof l.unitPrice === 'number' ? l.unitPrice : null;
  return {
    key: `${i}`, ...l, subtitle: l.subtitle ?? null, unitPrice, priceIsFallback: false,
    value: unitPrice === null ? null : cents(unitPrice * l.qty),
  };
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/test/utils/cardLists.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx vitest run src/test/utils/cardLists.test.js && L=$(npx eslint src --ext js,jsx --quiet 2>/dev/null); [ -n "$L" ] && echo "$L" || { git add src/utils/cardLists.js src/test/utils/cardLists.test.js && git commit -m "feat(lists): public copy model"; }
```

---

### Task 2: Firestore rules

**Files:**
- Modify: `firestore.rules`, `src/test/rules/firestore.rules.test.js`

**Interfaces:**
- Produces: `publicLists/{code}` — read by anyone; create only with your own `uid`; update and delete only by the existing owner. `publicDecks/{slug}` update now also requires the existing owner.

- [ ] **Step 1: Write the failing tests**

In `src/test/rules/firestore.rules.test.js`, inside `describe('public decks', …)` after its last test:

```js
  it('stops a user taking over someone else’s shared deck', async () => {
    await seedDoc(p('publicDecks', 'abc12345'), { uid: 'other-uid', name: 'Theirs' });
    await assertFails(setDoc(doc(asUser('plain-uid'), p('publicDecks', 'abc12345')), { uid: 'plain-uid', name: 'Mine now' }));
  });

  it('still lets the owner update their shared deck', async () => {
    await seedDoc(p('publicDecks', 'abc12345'), { uid: 'plain-uid', name: 'Mine' });
    await assertSucceeds(setDoc(doc(asUser('plain-uid'), p('publicDecks', 'abc12345')), { uid: 'plain-uid', name: 'Renamed' }));
  });
```

After that `describe` block:

```js
describe('public lists', () => {
  const L = (uid) => ({ uid, kind: 'trade', name: 'Dupes', showPrices: false, lines: [], cards: 0, updatedAt: 1 });

  it('lets anyone read a shared list, including a signed-out visitor', async () => {
    await seedDoc(p('publicLists', 'abcd2345'), L('plain-uid'));
    await assertSucceeds(getDoc(doc(asGuest(), p('publicLists', 'abcd2345'))));
  });

  it('lets the owner share, update and stop sharing', async () => {
    const db = asUser('plain-uid');
    await assertSucceeds(setDoc(doc(db, p('publicLists', 'abcd2345')), L('plain-uid')));
    await assertSucceeds(setDoc(doc(db, p('publicLists', 'abcd2345')), { ...L('plain-uid'), name: 'New' }));
    await assertSucceeds(deleteDoc(doc(db, p('publicLists', 'abcd2345'))));
  });

  it('stops sharing under someone else’s uid', async () => {
    await assertFails(setDoc(doc(asUser('plain-uid'), p('publicLists', 'abcd2345')), L('other-uid')));
  });

  it('stops a user taking over someone else’s shared list', async () => {
    await seedDoc(p('publicLists', 'abcd2345'), L('other-uid'));
    await assertFails(setDoc(doc(asUser('plain-uid'), p('publicLists', 'abcd2345')), L('plain-uid')));
  });

  it('stops a user deleting someone else’s shared list', async () => {
    await seedDoc(p('publicLists', 'abcd2345'), L('other-uid'));
    await assertFails(deleteDoc(doc(asUser('plain-uid'), p('publicLists', 'abcd2345'))));
  });

  it('stops a signed-out visitor sharing', async () => {
    await assertFails(setDoc(doc(asGuest(), p('publicLists', 'abcd2345')), L('plain-uid')));
  });
});
```

If `asGuest` is not the name of the file's unauthenticated helper, use the one the existing `public decks` read test uses.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:rules > /tmp/rules.txt 2>&1; tail -n 20 /tmp/rules.txt`
Expected: FAIL. The deck takeover test and every `public lists` write test fail; the read test fails too, because no rule matches.

- [ ] **Step 3: Implement**

In `firestore.rules`, replace the `publicDecks` block's `allow create, update` line with:

```
      allow create: if isSignedIn()
        && request.resource.data.uid == request.auth.uid;
      // Update needs the existing owner too: checking only the new data let
      // any signed-in user take over a shared deck by writing their own uid.
      allow update: if isSignedIn()
        && resource.data.uid == request.auth.uid
        && request.resource.data.uid == request.auth.uid;
```

Then, after that block, add:

```
    // ---------------------------------------------------------------------
    // Shared trade/wants lists: a self-contained public copy of a saved list
    // (users/{uid}/lists/{id}), readable by anyone with the link.
    // ---------------------------------------------------------------------
    match /artifacts/{appId}/publicLists/{code} {
      allow read: if true;
      allow create: if isSignedIn()
        && request.resource.data.uid == request.auth.uid;
      allow update: if isSignedIn()
        && resource.data.uid == request.auth.uid
        && request.resource.data.uid == request.auth.uid;
      allow delete: if isSignedIn() && resource.data.uid == request.auth.uid;
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:rules > /tmp/rules.txt 2>&1; tail -n 8 /tmp/rules.txt`
Expected: all rules tests pass.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules src/test/rules/firestore.rules.test.js && git commit -m "fix(rules): public lists; owner check on shared deck updates"
```

---

### Task 3: ListService sharing

**Files:**
- Modify: `src/services/ListService.js`
- Test: `src/test/services/ListService.test.js`

**Interfaces:**
- Consumes: the body from Task 1.
- Produces:
  - `newListCode(rand?) → string`: 8 characters from `abcdefghjkmnpqrstuvwxyz23456789`.
  - `ListService.shareList(uid, listId, body, { makeCode } = {}) → { code } | { error }`.
  - `updatePublic(uid, code, body) → { ok } | { error }`.
  - `unshareList(uid, listId, code) → { ok } | { error }`.
  - `deleteList(uid, id, code?)`: also deletes `publicLists/{code}` when a code is given.
  - `getPublicList(code) → { list } | { error: 'not-found' } | { error }`.
  - Every public doc written is stored as `{ ...body, uid, updatedAt }`.

- [ ] **Step 1: Write the failing tests**

In `src/test/services/ListService.test.js`, extend the `firebase/firestore` mock with:

```js
    setDoc: async (ref, data) => { if (store.hang) return pending(); guard(); store.docs.set(ref.path, data); },
    deleteField: () => '__delete__',
    writeBatch: () => {
      const ops = [];
      return {
        set: (ref, data) => ops.push(() => store.docs.set(ref.path, data)),
        update: (ref, patch) => ops.push(() => {
          const next = { ...store.docs.get(ref.path), ...patch };
          for (const k of Object.keys(next)) if (next[k] === '__delete__') delete next[k];
          store.docs.set(ref.path, next);
        }),
        delete: (ref) => ops.push(() => store.docs.delete(ref.path)),
        commit: async () => { if (store.hang) return pending(); guard(); ops.forEach((op) => op()); },
      };
    },
```

Change the existing `getDoc` mock to `getDoc: async (ref) => { guard(); return { exists: () => store.docs.has(ref.path), data: () => store.docs.get(ref.path) }; },`; its behaviour is unchanged. Import `newListCode` alongside `ListService`, and add:

```js
const PUB = 'artifacts/app/publicLists';
const BODY = { kind: 'trade', name: 'Dupes', showPrices: false, lines: [], cards: 0 };

describe('sharing', () => {
  beforeEach(() => { store.docs.set(`${BASE}/l1`, { kind: 'trade', name: 'Dupes', updatedAt: 1 }); });

  it('makes 8-character codes without look-alike characters', () => {
    const code = newListCode();
    expect(code).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
  });

  it('shares: writes the public copy and records the code on the list', async () => {
    const res = await ListService.shareList('u1', 'l1', BODY, { makeCode: () => 'abcd2345' });
    expect(res).toEqual({ code: 'abcd2345' });
    expect(store.docs.get(`${PUB}/abcd2345`)).toMatchObject({ ...BODY, uid: 'u1' });
    expect(store.docs.get(`${BASE}/l1`).publicCode).toBe('abcd2345');
  });

  it('tries another code when one is taken', async () => {
    store.docs.set(`${PUB}/taken111`, { uid: 'x' });
    const codes = ['taken111', 'free2222'];
    expect(await ListService.shareList('u1', 'l1', BODY, { makeCode: () => codes.shift() })).toEqual({ code: 'free2222' });
  });

  it('updates the public copy', async () => {
    await ListService.shareList('u1', 'l1', BODY, { makeCode: () => 'abcd2345' });
    expect(await ListService.updatePublic('u1', 'abcd2345', { ...BODY, name: 'New' })).toEqual({ ok: true });
    expect(store.docs.get(`${PUB}/abcd2345`)).toMatchObject({ name: 'New', uid: 'u1' });
  });

  it('stops sharing: removes the copy and the code', async () => {
    await ListService.shareList('u1', 'l1', BODY, { makeCode: () => 'abcd2345' });
    expect(await ListService.unshareList('u1', 'l1', 'abcd2345')).toEqual({ ok: true });
    expect(store.docs.has(`${PUB}/abcd2345`)).toBe(false);
    expect(store.docs.get(`${BASE}/l1`)).not.toHaveProperty('publicCode');
  });

  it('deleting a shared list removes its public copy', async () => {
    await ListService.shareList('u1', 'l1', BODY, { makeCode: () => 'abcd2345' });
    expect(await ListService.deleteList('u1', 'l1', 'abcd2345')).toEqual({ ok: true });
    expect(store.docs.has(`${BASE}/l1`)).toBe(false);
    expect(store.docs.has(`${PUB}/abcd2345`)).toBe(false);
  });

  it('reads a public list, or not-found', async () => {
    store.docs.set(`${PUB}/abcd2345`, { ...BODY, uid: 'u1' });
    expect((await ListService.getPublicList('abcd2345')).list).toMatchObject({ code: 'abcd2345', name: 'Dupes' });
    expect(await ListService.getPublicList('nope2345')).toEqual({ error: 'not-found' });
  });

  it('returns errors instead of throwing', async () => {
    store.fail = true;
    expect(await ListService.shareList('u1', 'l1', BODY, { makeCode: () => 'abcd2345' })).toEqual({ error: 'offline' });
    expect(await ListService.updatePublic('u1', 'abcd2345', BODY)).toEqual({ error: 'offline' });
    expect(await ListService.unshareList('u1', 'l1', 'abcd2345')).toEqual({ error: 'offline' });
    expect(await ListService.getPublicList('abcd2345')).toEqual({ error: 'offline' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/test/services/ListService.test.js`
Expected: FAIL — `newListCode` / `shareList` not defined.

- [ ] **Step 3: Implement** in `src/services/ListService.js`

- Import: add `deleteField, setDoc, writeBatch` to the `firebase/firestore` import.
- After `listRef`:

```js
// Shared copies: `publicLists/{code}` is 4 segments, a valid document path.
const publicListRef = (code) => doc(db, 'artifacts', APP_ID, 'publicLists', code);
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i look-alikes
const randomValues = (n) => crypto.getRandomValues(new Uint32Array(n));
export const newListCode = (rand = randomValues) => Array.from(rand(8), (v) => CODE_CHARS[v % CODE_CHARS.length]).join('');
```

- Replace `deleteList` and add the new methods inside `ListService`:

```js
  async deleteList(uid, id, code) {
    if (!db) return { error: 'offline' };
    try {
      if (code) {
        // A shared list takes its public copy with it: no orphaned link.
        const batch = writeBatch(db);
        batch.delete(listRef(uid, id));
        batch.delete(publicListRef(code));
        await settle(batch.commit());
      } else {
        await settle(deleteDoc(listRef(uid, id)));
      }
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  },

  async shareList(uid, listId, body, { makeCode = newListCode } = {}) {
    if (!db) return { error: 'offline' };
    try {
      let code = null;
      for (let i = 0; i < 5 && !code; i++) {
        const candidate = makeCode();
        const taken = await settle(getDoc(publicListRef(candidate)));
        if (!taken.exists()) code = candidate;
      }
      if (!code) return { error: 'no-code' };
      const now = Date.now();
      const batch = writeBatch(db);
      batch.set(publicListRef(code), { ...body, uid, updatedAt: now });
      batch.update(listRef(uid, listId), { publicCode: code, updatedAt: now });
      await settle(batch.commit());
      return { code };
    } catch (err) {
      return fail(err);
    }
  },

  async updatePublic(uid, code, body) {
    if (!db) return { error: 'offline' };
    try {
      await settle(setDoc(publicListRef(code), { ...body, uid, updatedAt: Date.now() }));
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  },

  async unshareList(uid, listId, code) {
    if (!db) return { error: 'offline' };
    try {
      const batch = writeBatch(db);
      batch.delete(publicListRef(code));
      batch.update(listRef(uid, listId), { publicCode: deleteField(), updatedAt: Date.now() });
      await settle(batch.commit());
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  },

  /** Anyone can read a shared list -- no sign-in needed. */
  async getPublicList(code) {
    if (!db) return { error: 'offline' };
    try {
      const snap = await getDoc(publicListRef(code));
      return snap.exists() ? { list: { code, ...snap.data() } } : { error: 'not-found' };
    } catch (err) {
      return fail(err);
    }
  },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/test/services/ListService.test.js`
Expected: PASS (all, including the earlier tests).

- [ ] **Step 5: Commit**

```bash
npx vitest run src/test/services/ListService.test.js && L=$(npx eslint src --ext js,jsx --quiet 2>/dev/null); [ -n "$L" ] && echo "$L" || { git add src/services/ListService.js src/test/services/ListService.test.js && git commit -m "feat(lists): share, update and stop sharing a list"; }
```

---

### Task 4: Share link in ListView; Shared badge

**Files:**
- Modify: `src/components/ListView.jsx`, `src/components/SavedListsPage.jsx`
- Test: `src/components/__tests__/ListView.test.jsx`, `src/components/__tests__/SavedListsPage.test.jsx`

**Interfaces:**
- Consumes: `toPublicList` (Task 1); `shareList`, `updatePublic`, `unshareList`, `deleteList(uid, id, code)` (Task 3).
- Produces (UI contract):
  - not shared → `Share link` button;
  - shared → read-only `<input aria-label="Share link">` holding `${location.origin}/list/<code>`, a `Copy link` button (shows `role="status"` "Link copied"), and `Stop sharing` → `Tap again to stop sharing`;
  - a public update that fails → `role="status"` "Shared link not updated yet — check your connection.";
  - share or unshare failure → `role="alert"` "Couldn't update sharing — check your connection.";
  - SavedListsPage rows show `Shared` for lists with `publicCode`.

- [ ] **Step 1: Write the failing tests**

In `src/components/__tests__/ListView.test.jsx`, extend `service` in `beforeEach` with `shareList: vi.fn(async () => ({ code: 'abcd2345' })), updatePublic: vi.fn(async () => ({ ok: true })), unshareList: vi.fn(async () => ({ ok: true }))`, and add:

```jsx
  it('shares the list and shows its link', async () => {
    renderView();
    await screen.findByTestId('list-value');
    fireEvent.click(screen.getByRole('button', { name: 'Share link' }));
    expect(await screen.findByLabelText('Share link')).toHaveValue(`${window.location.origin}/list/abcd2345`);
    const [uid, id, body] = service.shareList.mock.calls[0];
    expect([uid, id]).toEqual(['u1', 'l1']);
    expect(body).toMatchObject({ kind: 'wants', name: 'Gaps', showPrices: true, cards: 4 });
  });

  it('keeps a shared list current: every edit updates the public copy', async () => {
    renderView({ ...LIST, publicCode: 'abcd2345' });
    await waitFor(() => expect(service.updatePublic).toHaveBeenCalled());
    service.updatePublic.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'More Luke' }));
    await waitFor(() => expect(service.updatePublic).toHaveBeenCalled());
    const [, code, body] = service.updatePublic.mock.calls.at(-1);
    expect(code).toBe('abcd2345');
    expect(body.lines.find((l) => l.name === 'Luke').qty).toBe(2);
  });

  it('drops prices from the public copy when they are turned off', async () => {
    renderView({ ...LIST, publicCode: 'abcd2345' });
    await waitFor(() => expect(service.updatePublic).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Show prices' }));
    await waitFor(() => expect(service.updatePublic.mock.calls.at(-1)[2].showPrices).toBe(false));
    const body = service.updatePublic.mock.calls.at(-1)[2];
    expect(JSON.stringify(body)).not.toMatch(/unitPrice|pricesAsOf|"value"/);
  });

  it('says so quietly when the public copy could not be updated', async () => {
    service.updatePublic.mockResolvedValue({ error: 'timeout' });
    renderView({ ...LIST, publicCode: 'abcd2345' });
    expect(await screen.findByRole('status')).toHaveTextContent('Shared link not updated yet');
  });

  it('stops sharing only on the second tap', async () => {
    renderView({ ...LIST, publicCode: 'abcd2345' });
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    expect(service.unshareList).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to stop sharing' }));
    await screen.findByRole('button', { name: 'Share link' });
    expect(service.unshareList).toHaveBeenCalledWith('u1', 'l1', 'abcd2345');
  });

  it('deleting a shared list deletes its public copy', async () => {
    renderView({ ...LIST, publicCode: 'abcd2345' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to delete' }));
    await waitFor(() => expect(service.deleteList).toHaveBeenCalledWith('u1', 'l1', 'abcd2345'));
  });

  it('does not touch a public copy for a list that is not shared', async () => {
    renderView();
    await screen.findByTestId('list-value');
    fireEvent.click(screen.getByRole('button', { name: 'More Luke' }));
    expect(service.updatePublic).not.toHaveBeenCalled();
  });
```

In `src/components/__tests__/SavedListsPage.test.jsx`, give the trade fixture `publicCode: 'abcd2345'` and add:

```jsx
  it('marks shared lists', async () => {
    open({ initialTab: 'trade' });
    expect(await screen.findByText('Shared')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/__tests__/ListView.test.jsx src/components/__tests__/SavedListsPage.test.jsx`
Expected: FAIL — no Share link button, no Shared badge, and `deleteList` is called without the code.

- [ ] **Step 3: Implement**

`src/components/ListView.jsx`:
- Add `Link2, Share2` to the lucide import, and `toPublicList` to the `../utils/cardLists` import.
- After `const [confirmDelete, setConfirmDelete] = useState(false);` add:

```jsx
  const [publicCode, setPublicCode] = useState(list.publicCode ?? null);
  const [syncError, setSyncError] = useState(false);
  const [shareError, setShareError] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
```

- After the `summary` useMemo:

```jsx
  const publicBody = () => toPublicList({ kind: list.kind, name: savedName }, lines, { showPrices, now: Date.now() });

  // While shared, keep the public copy current: once prices load (which also
  // refreshes "prices as of") and after every change.
  useEffect(() => {
    if (!publicCode || prices === null) return undefined;
    let cancelled = false;
    service.updatePublic(uid, publicCode, publicBody()).then((res) => {
      if (!cancelled) setSyncError(Boolean(res?.error));
    });
    return () => { cancelled = true; };
  }, [publicCode, lines, savedName, showPrices]); // eslint-disable-line react-hooks/exhaustive-deps -- publish on content change
```

- Replace `del`:

```jsx
  const del = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    const res = publicCode ? await service.deleteList(uid, list.id, publicCode) : await service.deleteList(uid, list.id);
    if (res?.error) { setSaveError(true); setConfirmDelete(false); return; }
    onDeleted();
  };

  const link = publicCode ? `${window.location.origin}/list/${publicCode}` : '';
  const share = async () => {
    setSharing(true);
    setShareError(false);
    const res = await service.shareList(uid, list.id, publicBody());
    setSharing(false);
    if (res?.code) setPublicCode(res.code); else setShareError(true);
  };
  const stopSharing = async () => {
    if (!confirmStop) { setConfirmStop(true); return; }
    setConfirmStop(false);
    const res = await service.unshareList(uid, list.id, publicCode);
    if (res?.error) { setShareError(true); return; }
    setPublicCode(null);
    setSyncError(false);
    setLinkCopied(false);
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setLinkCopied(true);
    } catch {
      // The link is in a selectable field right above.
    }
  };
```

- Directly after the closing `</div>` of the toolbar row (the one ending with `Save as PDF`), insert:

```jsx
      <div className="rounded-lg border border-gray-800 p-3 space-y-2 print:hidden">
        {publicCode ? (
          <>
            <p className="text-sm text-gray-300">Shared — anyone with the link can see this list. It updates as you edit.</p>
            <input readOnly aria-label="Share link" value={link} onFocus={(e) => e.target.select()}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm font-mono" />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={copyLink} className={btn}><Link2 className="w-4 h-4" /> Copy link</button>
              <button type="button" onClick={stopSharing} className={`${btn} text-red-300`}>
                {confirmStop ? 'Tap again to stop sharing' : 'Stop sharing'}
              </button>
            </div>
            {linkCopied && <p role="status" className="text-xs text-green-400">Link copied</p>}
            {syncError && <p role="status" className="text-xs text-yellow-300">Shared link not updated yet — check your connection.</p>}
          </>
        ) : (
          <button type="button" onClick={share} disabled={sharing} className={`${btn} disabled:opacity-40`}>
            <Share2 className="w-4 h-4" /> Share link
          </button>
        )}
        {shareError && <p role="alert" className="text-sm text-red-400">Couldn&apos;t update sharing — check your connection.</p>}
      </div>
```

`src/components/SavedListsPage.jsx`: replace
`<span className="block font-medium truncate">{l.name}</span>` with

```jsx
                      <span className="flex items-center gap-2">
                        <span className="font-medium truncate">{l.name}</span>
                        {l.publicCode && <span className="shrink-0 rounded-full bg-green-900/60 text-green-300 text-[10px] px-2 py-0.5">Shared</span>}
                      </span>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/__tests__/ListView.test.jsx src/components/__tests__/SavedListsPage.test.jsx`
Expected: PASS (all, old and new). In "says so quietly…" two `status` elements cannot coexist, because Link copied appears only after a click.

- [ ] **Step 5: Commit**

```bash
npx vitest run src/components/__tests__/ListView.test.jsx src/components/__tests__/SavedListsPage.test.jsx && L=$(npx eslint src --ext js,jsx --quiet 2>/dev/null); [ -n "$L" ] && echo "$L" || { git add src/components/ListView.jsx src/components/SavedListsPage.jsx src/components/__tests__/ListView.test.jsx src/components/__tests__/SavedListsPage.test.jsx && git commit -m "feat(lists): share link that updates as the list is edited"; }
```

---

### Task 5: Public page and route

**Files:**
- Create: `src/components/PublicListView.jsx`
- Modify: `src/main.jsx`
- Test: `src/components/__tests__/PublicListView.test.jsx`

**Interfaces:**
- Consumes: `ListService.getPublicList` (Task 3); `publicLines`, `toListText`, `listSummary`, `FINISH_LABEL` (Tasks 1 and 2a); `CardService.getCardImage(set, number)`.
- Produces: `<PublicListView code service? />`. `main.jsx` routes `/list/<code>` to it inside `ErrorBoundary label="the shared list"`.

- [ ] **Step 1: Write the failing test**

```jsx
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
vi.mock('../../services/CardService', () => ({ CardService: { getCardImage: (s, n) => `/img/${s}/${n}` } }));
import PublicListView from '../PublicListView';

const DOC = {
  code: 'abcd2345', kind: 'wants', name: 'Gaps', showPrices: true, cards: 3, value: 3, pricesAsOf: Date.UTC(2026, 9, 6),
  lines: [
    { set: 'SOR', number: '005', name: 'Luke', subtitle: null, finish: 'foil', qty: 1 },
    { set: 'SOR', number: '010', name: 'Darth Vader', subtitle: 'Dark Lord', finish: 'any', qty: 2, note: 'any art', unitPrice: 1.5 },
  ],
};
let service;
beforeEach(() => { service = { getPublicList: vi.fn(async () => ({ list: DOC })) }; });

describe('PublicListView', () => {
  it('shows the list with prices, notes and finishes', async () => {
    render(<PublicListView code="abcd2345" service={service} />);
    expect(await screen.findByRole('heading', { name: 'Wants list: Gaps' })).toBeInTheDocument();
    expect(screen.getAllByTestId('public-row')).toHaveLength(2);
    expect(screen.getByText('any art')).toBeInTheDocument();
    expect(screen.getByText(/SOR 005 · Foil/)).toBeInTheDocument();
    expect(screen.getByText('$1.50')).toBeInTheDocument();
    expect(screen.getByTestId('public-value')).toHaveTextContent('$3.00');
    expect(screen.getByText(/Prices as of/)).toBeInTheDocument();
    expect(service.getPublicList).toHaveBeenCalledWith('abcd2345');
  });

  it('shows no dollar amounts on a list without prices', async () => {
    service.getPublicList.mockResolvedValue({ list: { ...DOC, kind: 'trade', showPrices: false, value: undefined, pricesAsOf: undefined, lines: DOC.lines.map(({ unitPrice, ...l }) => l) } });
    render(<PublicListView code="abcd2345" service={service} />);
    await screen.findByRole('heading', { name: 'Trade list: Gaps' });
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('copies the list as text', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<PublicListView code="abcd2345" service={service} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy as text' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toMatch(/^Wants: Gaps/);
  });

  it('says when a list is no longer shared', async () => {
    service.getPublicList.mockResolvedValue({ error: 'not-found' });
    render(<PublicListView code="gone2345" service={service} />);
    expect(await screen.findByText("This list isn't shared any more.")).toBeInTheDocument();
  });

  it('says when it cannot load', async () => {
    service.getPublicList.mockResolvedValue({ error: 'offline' });
    render(<PublicListView code="abcd2345" service={service} />);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this list");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/__tests__/PublicListView.test.jsx`
Expected: FAIL — cannot resolve `../PublicListView`.

- [ ] **Step 3: Implement**

`src/components/PublicListView.jsx`:

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardCopy, Loader2 } from 'lucide-react';
import { ListService } from '../services/ListService';
import { CardService } from '../services/CardService';
import { FINISH_LABEL, listSummary, publicLines, toListText } from '../utils/cardLists';

const money = (v) => `$${v.toFixed(2)}`;
const HEADING = { trade: 'Trade list', wants: 'Wants list' };

/** A shared trade or wants list, for anyone with the link. No sign-in. */
export default function PublicListView({ code, service = ListService }) {
  const [state, setState] = useState({ status: 'loading' });
  const [copyState, setCopyState] = useState(null);

  useEffect(() => {
    let cancelled = false;
    service.getPublicList(code).then((res) => {
      if (cancelled) return;
      if (res.list) setState({ status: 'ok', list: res.list });
      else setState({ status: res.error === 'not-found' ? 'gone' : 'error' });
    });
    return () => { cancelled = true; };
  }, [code, service]);

  const doc = state.list;
  const lines = useMemo(() => publicLines(doc), [doc]);
  const summary = useMemo(() => listSummary(lines), [lines]);
  const heading = doc ? `${HEADING[doc.kind] ?? 'List'}: ${doc.name}` : '';
  const showPrices = Boolean(doc?.showPrices);

  useEffect(() => {
    if (heading) document.title = `${heading} — SWU Holocron`;
  }, [heading]);

  const copyText = async () => {
    const text = toListText(doc, lines, { showPrices });
    try {
      await navigator.clipboard.writeText(text);
      setCopyState({ kind: 'copied' });
    } catch {
      setCopyState({ kind: 'fallback', text });
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <main className="max-w-3xl mx-auto p-4 space-y-4">
        {state.status === 'loading' && (
          <p className="flex items-center gap-2 text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Loading list…</p>
        )}
        {state.status === 'gone' && <p className="text-gray-300">This list isn&apos;t shared any more.</p>}
        {state.status === 'error' && (
          <p role="alert" className="text-red-400">Couldn&apos;t load this list. Check your connection and try again.</p>
        )}
        {state.status === 'ok' && (
          <>
            <header className="space-y-1">
              <h1 className="text-2xl font-bold">{heading}</h1>
              <p className="text-sm text-gray-400">
                {summary.cards} cards
                {showPrices && typeof doc.value === 'number' && <> · <span data-testid="public-value">{money(doc.value)}</span></>}
              </p>
              {showPrices && doc.pricesAsOf && (
                <p className="text-xs text-gray-500">Prices as of {new Date(doc.pricesAsOf).toLocaleDateString()} (market)</p>
              )}
            </header>

            <button type="button" onClick={copyText} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-gray-800 text-sm">
              <ClipboardCopy className="w-4 h-4" /> Copy as text
            </button>
            {copyState?.kind === 'copied' && <p role="status" className="text-sm text-green-400">Copied</p>}
            {copyState?.kind === 'fallback' && (
              <textarea readOnly aria-label="List text" value={copyState.text} rows={6} onFocus={(e) => e.target.select()}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs font-mono" />
            )}

            <ul className="divide-y divide-gray-800">
              {lines.map((l) => (
                <li key={l.key} data-testid="public-row" className="flex items-center gap-3 py-2">
                  <img src={CardService.getCardImage(l.set, l.number)} alt="" loading="lazy"
                    onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                    className="w-10 h-14 object-cover rounded bg-gray-800 shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium truncate">{l.name}{l.subtitle ? `, ${l.subtitle}` : ''}</span>
                    <span className="block text-xs text-gray-500">{l.set} {l.number} · {FINISH_LABEL[l.finish] ?? l.finish}</span>
                    {l.note && <span className="block text-xs text-gray-400">{l.note}</span>}
                  </span>
                  {showPrices && l.unitPrice !== null && <span className="text-xs text-gray-400">{money(l.unitPrice)}</span>}
                  <span className="w-8 text-right font-bold">×{l.qty}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <footer className="pt-6 text-center text-xs text-gray-500">
          <a href="/" className="hover:text-gray-300">Made with SWU Holocron</a>
        </footer>
      </main>
    </div>
  );
}
```

`src/main.jsx`: import `PublicListView from './components/PublicListView.jsx'`, and after the `deck` branch add:

```jsx
  if (parts.length >= 1 && parts[0] === 'list' && parts[1]) {
    return (
      <ErrorBoundary label="the shared list">
        <PublicListView code={parts[1]} />
      </ErrorBoundary>
    );
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/__tests__/PublicListView.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx vitest run src/components/__tests__/PublicListView.test.jsx && L=$(npx eslint src --ext js,jsx --quiet 2>/dev/null); [ -n "$L" ] && echo "$L" || { git add src/components/PublicListView.jsx src/main.jsx src/components/__tests__/PublicListView.test.jsx && git commit -m "feat(lists): public page for shared lists at /list/<code>"; }
```

---

### Task 6: Docs and the full gate

**Files:**
- Modify: `CLAUDE.md` (git root)

- [ ] **Step 1: Update CLAUDE.md**
- Paths block: add `artifacts/{APP_ID}/publicLists/{code}                         shared trade/wants lists (anyone can read)`.
- In "Market reports and saved lists", replace "Public links are phase 2b." with:

  > **Share link** publishes a list at `/list/<code>`: a self-contained copy at `publicLists/{code}` (`toPublicList`: no owner name, prices only with Show prices on, frozen as "prices as of"), readable without signing in (`PublicListView.jsx`, routed in `main.jsx` like `/deck/<slug>`). While shared, `ListView` re-publishes after every change and whenever prices load. Stop sharing and deleting the list both remove the copy.

- After the Firestore-rules paragraph in "Sets are discovered", add:

  > `publicDecks` and `publicLists` updates require the existing owner as well as the new data's uid; checking only the new uid let any signed-in user take over a shared deck.

- [ ] **Step 2: Full gate**

Run: `npm run test:unit > /tmp/unit.txt 2>&1; tail -n 6 /tmp/unit.txt`
Expected: all files pass (skips unchanged).

Run: `npm run test:rules > /tmp/rules.txt 2>&1; tail -n 6 /tmp/rules.txt`
Expected: all rules tests pass.

Run: `npm run build 2>&1 | tail -n 3`
Expected: `✓ built in …`.

- [ ] **Step 3: Commit**

```bash
L=$(npx eslint src --ext js,jsx --quiet 2>/dev/null); [ -n "$L" ] && echo "$L" || { git add ../CLAUDE.md && git commit -m "docs: public list links and the shared-deck rule fix"; }
```
