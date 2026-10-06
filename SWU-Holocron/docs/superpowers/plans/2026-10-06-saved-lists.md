# Market Reports and Saved Reports/Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Named trade and wants lists (shareable in phase 2b), plus a Command Center that opens Market reports (the renamed Value report) and a Saved reports/lists page (Batches, Trade lists, Wants lists).

**Architecture:** A pure model (`src/utils/cardLists.js`) turns surplus lines, collection gaps and deck gaps into list items and renders them as lines, text and CSV. `ListService` stores lists at `users/{uid}/lists/{id}`; `listLoader` fetches prices and gap card data. UI: `SaveListDialog` (shared by Market reports and the deck Shop tab), `ListView`, `WantsFromGaps`, `SavedListsPage`; the Command Center gets two entry buttons and loses the batches panel; the binder loses its Value button.

**Tech Stack:** React 18, Vite, Tailwind, Firestore web SDK v9 modular, Vitest + Testing Library (happy-dom).

**Spec:** `SWU-Holocron/docs/superpowers/specs/2026-10-06-saved-lists-design.md`

## Global Constraints

- All commands run from `SWU-Holocron/` (the nested app dir).
- Commit gate, every commit: the task's tests pass, then `npx eslint src --ext js,jsx --quiet` prints nothing, then commit. The last task also runs `npm run test:unit` and `npm run build` first.
- Never type the escape sequence for U+FEFF in source — writing it produces a literal BOM. Use `String.fromCharCode(0xfeff)`.
- Firestore rejects `undefined` field values: items carry `subtitle: null` / `type: null` when unknown and only carry `note` once one is typed.
- No `console.log` (lint `no-console` allows only warn/error).
- Services are named object exports (`export const ListService = {}`) and never throw — they return `{ error }`.
- localStorage access is wrapped in try/catch; keys are `swu-`-prefixed.
- No browser `alert`/`confirm` in new code — use two-step buttons.
- Unpriced cards are never shown or counted as $0; with Show prices off there is no dollar amount anywhere on screen or in exports.
- Item keys: `${SET}_${NNN}_${finish}`, finish ∈ `standard | foil | any`; number padded with `String(n).padStart(3, '0')` (same as `getCollectionId`).
- Test files containing JSX use `.jsx`.
- Every hook before any conditional return.

## Review Focus

1. **Changing a wants line's finish onto a key that already exists** (e.g. `SOR_010_any` → Standard while `SOR_010_standard` exists): quantities merge, never overwrite or duplicate. Tested in Task 1 (`changeFinish`) and Task 4 (finish select).
2. **Unpadded card numbers (TS26, IBH) and F-suffixed foils (`059F`)**: gaps and deck gaps key `TS26_001_any`, and owned counts read the padded collection doc. Tested in Task 1.
3. **A save that fails mid-edit (offline)**: the edit stays on screen with an error; nothing is silently dropped. Tested in Task 4.
4. **Show prices off in a list**: no `$` on screen, in copied text or in the CSV. Tested in Tasks 1 and 4.
5. **Two printings of one title (Normal + Hyperspace)**: owning only the Hyperspace copy means the title is not missing, and playset counts both. Tested in Task 1.

## Plan decisions (beyond the spec)

- Lists store `showPrices` on the document (default `true`), so phase 2b's public page can honour it.
- List rows in the Trade/Wants tabs show card count and updated date but **no value**: a value per row would cost a price load per list. The value shows inside the list.
- `SavedListsPage` carries `id="batch-report"` only while a list is open, so a batch report opened from the Batches tab (its own `#batch-report` portal) prints alone.
- The Market reports and Saved reports/lists buttons live in the Command Center only; guests (no uid) get Market reports but not Saved reports/lists.

## File map

| File | Responsibility |
|---|---|
| Create `src/utils/cardLists.js` | Pure: items from surplus/gaps/deck gaps/a card; merge, re-key, lines, summary, text, CSV |
| Create `src/utils/downloadText.js` | Browser download of a text file |
| Create `src/services/ListService.js` | Firestore CRUD for `users/{uid}/lists` |
| Create `src/services/listLoader.js` | Prices for items; card data → gap items |
| Create `src/components/SaveListDialog.jsx` | Save items as a new list or into an existing one |
| Create `src/components/ListView.jsx` | View, edit and export one list |
| Create `src/components/WantsFromGaps.jsx` | Pick sets and mode, create a wants list from gaps |
| Create `src/components/SavedListsPage.jsx` | Full-screen tabs: Batches, Trade lists, Wants lists |
| Modify `src/components/CollectionValueReport.jsx` | Title "Market reports"; Save as trade list |
| Modify `src/components/ShoppingList.jsx` | Save as wants list |
| Modify `src/components/DeckBuilder.jsx` | Pass `uid`, `deckName` to both ShoppingList renders |
| Modify `src/components/Dashboard.jsx` | Two entry buttons; drop BatchesPanel |
| Modify `src/App.jsx` | Drop the binder Value button; open Market reports / Saved lists from the Command Center |
| Modify `CLAUDE.md` (git root) | Document lists, Market reports, the new path and keys |

---

### Task 1: Pure list model

**Files:**
- Create: `src/utils/cardLists.js`
- Test: `src/test/utils/cardLists.test.js`

**Interfaces:**
- Produces:
  - `padNumber(n) → string`; `itemKey(set, number, finish) → string`
  - `cardItem(card, finish = 'any', qty = 1) → item` (card has `Set, Number, Name, Subtitle, Type`)
  - `itemsFromSurplus(lines) → items` (lines from `buildSurplusLines`)
  - `itemsFromGaps(cardsBySet, collectionData, { mode: 'missing'|'playset' }) → items`
  - `itemsFromDeckGaps(gapCards) → items` (ShoppingList gap rows `{ gap, card }`)
  - `mergeItems(existing, incoming, { replace } = {}) → items`
  - `changeFinish(items, key, finish) → items`
  - `priceRequests(items) → [{ cardId, set, number, isFoil }]`
  - `listLines(items, pricesByKey) → line[]`, line = `{ key, ...item, unitPrice: number|null, priceIsFallback, value: number|null }`, sorted by set, number, finish
  - `listSummary(lines) → { cards, unique, value, priced }`
  - `toListText(list, lines, { showPrices }) → string`; `toListCsv(list, lines, { showPrices }) → string`
  - `FINISH_LABEL = { standard: 'Standard', foil: 'Foil', any: 'Any finish' }`
  - items = `{ [key]: item }`, item = `{ set, number, name, subtitle: string|null, type: string|null, finish, qty, note? }`; list = `{ kind: 'trade'|'wants', name, ... }`

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from 'vitest';
import {
  itemKey, cardItem, itemsFromSurplus, itemsFromGaps, itemsFromDeckGaps, mergeItems, changeFinish,
  priceRequests, listLines, listSummary, toListText, toListCsv,
} from '../../utils/cardLists';

const card = (o) => ({ Set: 'SOR', Number: '010', Name: 'Darth Vader', Subtitle: 'Dark Lord of the Sith', Type: 'Leader', ...o });
const own = (id, quantity) => ({ [id]: { quantity } });

describe('itemKey / cardItem', () => {
  it('pads numbers and names the finish', () => {
    expect(itemKey('TS26', 1, 'any')).toBe('TS26_001_any');
    expect(itemKey('SOR', '059F', 'foil')).toBe('SOR_059F_foil');
  });
  it('makes an item from a card with nulls, never undefined', () => {
    expect(cardItem({ Set: 'SOR', Number: 5, Name: 'X' })).toEqual({ set: 'SOR', number: '005', name: 'X', subtitle: null, type: null, finish: 'any', qty: 1 });
  });
});

describe('itemsFromSurplus', () => {
  it('takes the finish from isFoil and qty from the surplus', () => {
    const items = itemsFromSurplus([
      { set: 'SOR', number: '010', name: 'Vader', subtitle: 'Dark Lord', type: 'Leader', isFoil: false, qty: 2 },
      { set: 'SOR', number: '010', name: 'Vader', subtitle: 'Dark Lord', type: 'Leader', isFoil: true, qty: 1 },
    ]);
    expect(items.SOR_010_standard.qty).toBe(2);
    expect(items.SOR_010_foil).toMatchObject({ finish: 'foil', qty: 1 });
  });
});

describe('itemsFromGaps', () => {
  const sor = [
    card({ Number: '280' }), // Hyperspace printing of the same title, listed first
    card({ Number: '010' }),
    card({ Number: '050', Name: 'Battle Droid', Subtitle: '', Type: 'Unit' }),
    card({ Number: '060', Name: 'Han Solo', Subtitle: '', Type: 'Unit' }),
  ];
  it('missing: one of each title with no copy of any printing', () => {
    const items = itemsFromGaps({ SOR: sor }, { ...own('SOR_280_std', 1), ...own('SOR_060_foil', 1) }, { mode: 'missing' });
    expect(Object.keys(items)).toEqual(['SOR_050_any']);
    expect(items.SOR_050_any).toMatchObject({ name: 'Battle Droid', subtitle: null, finish: 'any', qty: 1 });
  });
  it('playset: the shortfall per title, leaders capped at 1, printings summed', () => {
    const items = itemsFromGaps({ SOR: sor }, { ...own('SOR_050_std', 1), ...own('SOR_050_foil', 1) }, { mode: 'playset' });
    expect(items.SOR_050_any.qty).toBe(1);
    expect(items.SOR_010_any.qty).toBe(1); // the representative is the lowest number
    expect(items.SOR_280_any).toBeUndefined();
    expect(items.SOR_060_any.qty).toBe(3);
  });
  it('reads padded collection docs for unpadded set numbers', () => {
    const items = itemsFromGaps({ TS26: [card({ Set: 'TS26', Number: 1, Name: 'A', Subtitle: '', Type: 'Unit' })] }, own('TS26_001_std', 3), { mode: 'playset' });
    expect(items).toEqual({});
  });
});

describe('itemsFromDeckGaps', () => {
  it('turns shop gap rows into any-finish items', () => {
    const items = itemsFromDeckGaps([{ gap: 2, card: card({ Number: 7, Name: 'Krennic', Subtitle: '', Type: 'Unit' }) }, { gap: 0, card: card() }]);
    expect(items).toEqual({ SOR_007_any: { set: 'SOR', number: '007', name: 'Krennic', subtitle: null, type: 'Unit', finish: 'any', qty: 2 } });
  });
});

describe('mergeItems / changeFinish', () => {
  const a = { SOR_010_any: cardItem(card(), 'any', 2) };
  it('adds quantities, or replaces', () => {
    expect(mergeItems(a, { SOR_010_any: cardItem(card(), 'any', 1) }).SOR_010_any.qty).toBe(3);
    expect(mergeItems(a, {}, { replace: true })).toEqual({});
  });
  it('re-keys on a finish change and merges into an existing line', () => {
    const items = { ...a, SOR_010_standard: cardItem(card(), 'standard', 1) };
    const next = changeFinish(items, 'SOR_010_any', 'standard');
    expect(Object.keys(next)).toEqual(['SOR_010_standard']);
    expect(next.SOR_010_standard).toMatchObject({ finish: 'standard', qty: 3 });
  });
});

describe('prices and lines', () => {
  const items = {
    SOR_010_any: cardItem(card(), 'any', 2),
    SOR_005_foil: cardItem(card({ Number: 5, Name: 'Luke', Subtitle: '' }), 'foil', 1),
  };
  it('asks for standard prices for any finish (the pricing service falls back to foil)', () => {
    expect(priceRequests(items)).toEqual([
      { cardId: 'SOR_010_any', set: 'SOR', number: '010', isFoil: false },
      { cardId: 'SOR_005_foil', set: 'SOR', number: '005', isFoil: true },
    ]);
  });
  it('prices lines, never as $0 when unpriced, sorted by number', () => {
    const lines = listLines(items, { SOR_010_any: { market: 1.5, isFallback: true } });
    expect(lines.map((l) => l.key)).toEqual(['SOR_005_foil', 'SOR_010_any']);
    expect(lines[0]).toMatchObject({ unitPrice: null, value: null });
    expect(lines[1]).toMatchObject({ unitPrice: 1.5, value: 3, priceIsFallback: true });
    expect(listSummary(lines)).toEqual({ cards: 3, unique: 2, value: 3, priced: 1 });
  });
});

describe('text and CSV', () => {
  const items = {
    SOR_010_any: { ...cardItem(card(), 'any', 2), note: 'any art' },
    SOR_005_standard: cardItem(card({ Number: 5, Name: 'Luke', Subtitle: '' }), 'standard', 1),
  };
  const lines = listLines(items, { SOR_010_any: { market: 1.5 } });
  it('wants text with heading, finish and note', () => {
    const text = toListText({ kind: 'wants', name: 'Gaps' }, lines, { showPrices: true });
    expect(text.split('\n')).toEqual([
      'Wants: Gaps',
      '',
      '1× Luke (SOR 005) — Standard',
      '2× Darth Vader, Dark Lord of the Sith (SOR 010) — $1.50 ea (any art)',
      'Total: 3 cards · ~$3.00',
    ]);
  });
  it('no dollar amounts with prices hidden; trade heading', () => {
    const text = toListText({ kind: 'trade', name: 'Binder' }, lines, { showPrices: false });
    expect(text.startsWith('Trade list: Binder')).toBe(true);
    expect(text).not.toContain('$');
  });
  it('CSV with and without prices, starting with a BOM', () => {
    const csv = toListCsv({ kind: 'wants', name: 'Gaps' }, lines, { showPrices: true });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Set,Number,Name,Subtitle,Finish,Qty,Unit price,Value,Note');
    expect(csv).toContain('SOR,010,Darth Vader,Dark Lord of the Sith,Any finish,2,1.50,3.00,any art');
    const bare = toListCsv({ kind: 'wants', name: 'Gaps' }, lines, { showPrices: false });
    expect(bare).not.toContain('Unit price');
    expect(bare).not.toContain('Total value');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/test/utils/cardLists.test.js`
Expected: FAIL — cannot resolve `../../utils/cardLists`.

- [ ] **Step 3: Implement `src/utils/cardLists.js`**

```js
/**
 * Saved card lists: trade lists (cards I can trade) and wants lists (cards I
 * am looking for). Pure. An item is one card in one finish; a wants item's
 * finish may be 'any'.
 */
import { getCollectionId, getPlaysetQuantity } from './collectionHelpers';

const cents = (v) => Math.round(v * 100) / 100;
const BOM = String.fromCharCode(0xfeff);

export const FINISH_LABEL = { standard: 'Standard', foil: 'Foil', any: 'Any finish' };

export const padNumber = (n) => String(n).padStart(3, '0');
export const itemKey = (set, number, finish) => `${set}_${padNumber(number)}_${finish}`;

const makeItem = (set, number, name, subtitle, type, finish, qty) => ({
  set, number: padNumber(number), name: name ?? '', subtitle: subtitle || null, type: type ?? null, finish, qty,
});

export const cardItem = (card, finish = 'any', qty = 1) =>
  makeItem(card.Set, card.Number, card.Name, card.Subtitle, card.Type, finish, qty);

export function itemsFromSurplus(lines) {
  const items = {};
  for (const l of lines ?? []) {
    if (!(l.qty > 0)) continue;
    const finish = l.isFoil ? 'foil' : 'standard';
    items[itemKey(l.set, l.number, finish)] = makeItem(l.set, l.number, l.name, l.subtitle, l.type, finish, l.qty);
  }
  return items;
}

const hasNumber = (c) => c?.Number !== undefined && c?.Number !== null && c.Number !== '';
const byNumber = (a, b) => String(a.Number).localeCompare(String(b.Number), undefined, { numeric: true });

/** Titles (name + subtitle) the collection lacks, counted as the Command Center counts them. */
export function itemsFromGaps(cardsBySet, collectionData, { mode = 'missing' } = {}) {
  const items = {};
  const owned = (set, number, foil) => Number(collectionData?.[getCollectionId(set, number, foil)]?.quantity) || 0;
  for (const [set, cards] of Object.entries(cardsBySet ?? {})) {
    const titles = new Map();
    for (const card of (cards ?? []).filter(hasNumber).sort(byNumber)) {
      const title = `${card.Name}${card.Subtitle ? ` ${card.Subtitle}` : ''}`;
      if (!titles.has(title)) titles.set(title, { card, have: 0 });
      titles.get(title).have += owned(set, card.Number, false) + owned(set, card.Number, true);
    }
    for (const { card, have } of titles.values()) {
      const want = mode === 'playset' ? getPlaysetQuantity(card.Type) : 1;
      if (have >= want) continue;
      items[itemKey(set, card.Number, 'any')] = makeItem(set, card.Number, card.Name, card.Subtitle, card.Type, 'any', want - have);
    }
  }
  return items;
}

export function mergeItems(existing, incoming, { replace = false } = {}) {
  if (replace) return { ...(incoming ?? {}) };
  const next = { ...(existing ?? {}) };
  for (const [key, item] of Object.entries(incoming ?? {})) {
    next[key] = next[key] ? { ...next[key], qty: next[key].qty + item.qty } : { ...item };
  }
  return next;
}

export function itemsFromDeckGaps(gapCards) {
  let items = {};
  for (const g of gapCards ?? []) {
    if (!g?.card || !(g.gap > 0)) continue;
    items = mergeItems(items, { [itemKey(g.card.Set, g.card.Number, 'any')]: cardItem(g.card, 'any', g.gap) });
  }
  return items;
}

export function changeFinish(items, key, finish) {
  const item = items?.[key];
  if (!item || item.finish === finish) return items;
  const rest = { ...items };
  delete rest[key];
  return mergeItems(rest, { [itemKey(item.set, item.number, finish)]: { ...item, finish } });
}

// 'any' asks for the standard price; the pricing service falls back to foil.
export const priceRequests = (items) => Object.entries(items ?? {}).map(([key, it]) => ({
  cardId: key, set: it.set, number: it.number, isFoil: it.finish === 'foil',
}));

const FINISH_ORDER = { standard: 0, foil: 1, any: 2 };
export function listLines(items, pricesByKey = {}) {
  return Object.entries(items ?? {}).map(([key, it]) => {
    const price = pricesByKey?.[key];
    const unitPrice = typeof price?.market === 'number' ? price.market : null;
    return { key, ...it, unitPrice, priceIsFallback: Boolean(price?.isFallback), value: unitPrice === null ? null : cents(unitPrice * it.qty) };
  }).sort((a, b) => a.set.localeCompare(b.set)
    || a.number.localeCompare(b.number, undefined, { numeric: true })
    || FINISH_ORDER[a.finish] - FINISH_ORDER[b.finish]);
}

export function listSummary(lines) {
  const priced = lines.filter((l) => l.unitPrice !== null);
  return {
    cards: lines.reduce((s, l) => s + l.qty, 0),
    unique: lines.length,
    value: cents(priced.reduce((s, l) => s + l.value, 0)),
    priced: priced.length,
  };
}

const heading = (list) => `${list.kind === 'trade' ? 'Trade list' : 'Wants'}: ${list.name}`;
const finishSuffix = (list, l) => {
  if (l.finish === 'foil') return ' — Foil';
  if (l.finish === 'standard' && list.kind === 'wants') return ' — Standard';
  return '';
};

export function toListText(list, lines, { showPrices }) {
  const out = [heading(list), ''];
  for (const l of lines) {
    const price = showPrices && l.unitPrice !== null ? ` — $${l.unitPrice.toFixed(2)} ea` : '';
    const note = l.note ? ` (${l.note})` : '';
    out.push(`${l.qty}× ${l.name}${l.subtitle ? `, ${l.subtitle}` : ''} (${l.set} ${l.number})${finishSuffix(list, l)}${price}${note}`);
  }
  const s = listSummary(lines);
  out.push(`Total: ${s.cards} cards${showPrices && s.priced ? ` · ~$${s.value.toFixed(2)}` : ''}`);
  return out.join('\n');
}

const field = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (values) => values.map(field).join(',');
const money = (v) => (typeof v === 'number' ? v.toFixed(2) : '');

export function toListCsv(list, lines, { showPrices }) {
  const cols = [
    ['Set', (l) => l.set], ['Number', (l) => l.number], ['Name', (l) => l.name], ['Subtitle', (l) => l.subtitle],
    ['Finish', (l) => FINISH_LABEL[l.finish]], ['Qty', (l) => l.qty],
    ...(showPrices ? [['Unit price', (l) => money(l.unitPrice)], ['Value', (l) => money(l.value)]] : []),
    ['Note', (l) => l.note ?? ''],
  ];
  const s = listSummary(lines);
  const out = [row(cols.map(([h]) => h)), ...lines.map((l) => row(cols.map(([, get]) => get(l)))), ''];
  out.push(row(['List', heading(list)]));
  out.push(row(['Cards', s.cards]));
  if (showPrices) out.push(row(['Total value', money(s.value)]));
  return `${BOM}${out.join('\r\n')}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/test/utils/cardLists.test.js`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
npx vitest run src/test/utils/cardLists.test.js && L=$(npx eslint src --ext js,jsx --quiet); [ -n "$L" ] && echo "$L" || { git add src/utils/cardLists.js src/test/utils/cardLists.test.js && git commit -m "feat(lists): pure model for trade and wants lists"; }
```

---

### Task 2: ListService

**Files:**
- Create: `src/services/ListService.js`
- Test: `src/test/services/ListService.test.js`

**Interfaces:**
- Produces: `ListService.listLists(uid, kind?) → { lists } | { error }` (newest `updatedAt` first; filtered by `kind` when given); `getList(uid, id) → { list } | { error }` (`'not-found'` when absent); `createList(uid, { kind, name, items = {}, source = null, showPrices = true }) → { id } | { error }` (blank name → `'Trade list'` / `'Wants list'`); `updateList(uid, id, patch) → { ok: true } | { error }` (stamps `updatedAt`); `deleteList(uid, id) → { ok: true } | { error }`. A list is `{ id, kind, name, items, source, showPrices, createdAt, updatedAt }`; `source` is `{ type: 'surplus'|'gaps'|'deck', label } | null`.

- [ ] **Step 1: Confirm the rules already cover the path**

Run: `grep -n "users/{userId}/{sub}/{document=\*\*}" firestore.rules`
Expected: one match (owner read/write). No rules change needed.

- [ ] **Step 2: Write the failing test**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({ docs: new Map(), fail: false, next: 0 }));
vi.mock('../../firebase', () => ({ db: {}, APP_ID: 'app' }));
vi.mock('firebase/firestore', () => {
  const path = (segs) => segs.join('/');
  const guard = () => { if (store.fail) throw new Error('offline'); };
  return {
    doc: (db, ...segs) => ({ path: path(segs) }),
    collection: (db, ...segs) => ({ path: path(segs) }),
    query: (ref) => ref,
    orderBy: () => null,
    addDoc: async (ref, data) => { guard(); const id = `l${++store.next}`; store.docs.set(`${ref.path}/${id}`, data); return { id }; },
    getDoc: async (ref) => { guard(); return { exists: () => store.docs.has(ref.path), data: () => store.docs.get(ref.path) }; },
    getDocs: async (ref) => {
      guard();
      return {
        docs: [...store.docs.entries()]
          .filter(([p]) => p.startsWith(`${ref.path}/`))
          .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
          .map(([p, d]) => ({ id: p.split('/').pop(), data: () => d })),
      };
    },
    updateDoc: async (ref, patch) => { guard(); store.docs.set(ref.path, { ...store.docs.get(ref.path), ...patch }); },
    deleteDoc: async (ref) => { guard(); store.docs.delete(ref.path); },
  };
});

import { ListService } from '../../services/ListService';

const BASE = 'artifacts/app/users/u1/lists';
beforeEach(() => { store.docs.clear(); store.fail = false; store.next = 0; });

describe('ListService', () => {
  it('creates a list with timestamps and defaults', async () => {
    const { id } = await ListService.createList('u1', { kind: 'wants', name: '  Gaps  ', items: { a: { qty: 1 } } });
    const saved = store.docs.get(`${BASE}/${id}`);
    expect(saved).toMatchObject({ kind: 'wants', name: 'Gaps', items: { a: { qty: 1 } }, source: null, showPrices: true });
    expect(saved.createdAt).toBe(saved.updatedAt);
  });

  it('names an unnamed list by kind', async () => {
    const { id } = await ListService.createList('u1', { kind: 'trade', name: ' ' });
    expect(store.docs.get(`${BASE}/${id}`).name).toBe('Trade list');
  });

  it('lists newest first, filtered by kind', async () => {
    store.docs.set(`${BASE}/a`, { kind: 'trade', name: 'A', updatedAt: 1 });
    store.docs.set(`${BASE}/b`, { kind: 'wants', name: 'B', updatedAt: 3 });
    store.docs.set(`${BASE}/c`, { kind: 'trade', name: 'C', updatedAt: 2 });
    expect((await ListService.listLists('u1', 'trade')).lists.map((l) => l.id)).toEqual(['c', 'a']);
    expect((await ListService.listLists('u1')).lists).toHaveLength(3);
  });

  it('gets one list, or not-found', async () => {
    store.docs.set(`${BASE}/a`, { kind: 'trade', name: 'A', updatedAt: 1 });
    expect((await ListService.getList('u1', 'a')).list).toMatchObject({ id: 'a', name: 'A' });
    expect(await ListService.getList('u1', 'zz')).toEqual({ error: 'not-found' });
  });

  it('updates and stamps updatedAt', async () => {
    store.docs.set(`${BASE}/a`, { kind: 'trade', name: 'A', updatedAt: 1 });
    expect(await ListService.updateList('u1', 'a', { name: 'B' })).toEqual({ ok: true });
    expect(store.docs.get(`${BASE}/a`)).toMatchObject({ name: 'B' });
    expect(store.docs.get(`${BASE}/a`).updatedAt).toBeGreaterThan(1);
  });

  it('deletes', async () => {
    store.docs.set(`${BASE}/a`, { kind: 'trade', updatedAt: 1 });
    expect(await ListService.deleteList('u1', 'a')).toEqual({ ok: true });
    expect(store.docs.has(`${BASE}/a`)).toBe(false);
  });

  it('returns errors instead of throwing', async () => {
    store.fail = true;
    expect(await ListService.createList('u1', { kind: 'wants', name: 'x' })).toEqual({ error: 'offline' });
    expect(await ListService.listLists('u1')).toEqual({ error: 'offline' });
    expect(await ListService.getList('u1', 'a')).toEqual({ error: 'offline' });
    expect(await ListService.updateList('u1', 'a', {})).toEqual({ error: 'offline' });
    expect(await ListService.deleteList('u1', 'a')).toEqual({ error: 'offline' });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/test/services/ListService.test.js`
Expected: FAIL — cannot resolve `../../services/ListService`.

- [ ] **Step 4: Implement `src/services/ListService.js`**

```js
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, updateDoc } from 'firebase/firestore';
import { db, APP_ID } from '../firebase';

/**
 * Saved trade and wants lists, one document per list under the user. Never
 * throws -- every method returns { error } on failure.
 *
 * @environment:firebase
 */
const listsRef = (uid) => collection(db, 'artifacts', APP_ID, 'users', uid, 'lists');
const listRef = (uid, id) => doc(db, 'artifacts', APP_ID, 'users', uid, 'lists', id);
const fail = (err) => ({ error: err?.message ?? 'unknown' });
const DEFAULT_NAME = { trade: 'Trade list', wants: 'Wants list' };

export const ListService = {
  async listLists(uid, kind) {
    if (!db) return { error: 'offline' };
    try {
      const snap = await getDocs(query(listsRef(uid), orderBy('updatedAt', 'desc')));
      const lists = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((l) => !kind || l.kind === kind);
      return { lists };
    } catch (err) {
      return fail(err);
    }
  },

  async getList(uid, id) {
    if (!db) return { error: 'offline' };
    try {
      const snap = await getDoc(listRef(uid, id));
      return snap.exists() ? { list: { id, ...snap.data() } } : { error: 'not-found' };
    } catch (err) {
      return fail(err);
    }
  },

  async createList(uid, { kind, name, items = {}, source = null, showPrices = true }) {
    if (!db) return { error: 'offline' };
    try {
      const now = Date.now();
      const ref = await addDoc(listsRef(uid), {
        kind, name: name?.trim() || DEFAULT_NAME[kind], items, source, showPrices, createdAt: now, updatedAt: now,
      });
      return { id: ref.id };
    } catch (err) {
      return fail(err);
    }
  },

  async updateList(uid, id, patch) {
    if (!db) return { error: 'offline' };
    try {
      await updateDoc(listRef(uid, id), { ...patch, updatedAt: Date.now() });
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  },

  async deleteList(uid, id) {
    if (!db) return { error: 'offline' };
    try {
      await deleteDoc(listRef(uid, id));
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  },
};
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/test/services/ListService.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npx vitest run src/test/services/ListService.test.js && L=$(npx eslint src --ext js,jsx --quiet); [ -n "$L" ] && echo "$L" || { git add src/services/ListService.js src/test/services/ListService.test.js && git commit -m "feat(lists): ListService for saved lists"; }
```

---

### Task 3: List loader (prices and gaps) and downloadText

**Files:**
- Create: `src/services/listLoader.js`, `src/utils/downloadText.js`
- Test: `src/test/services/listLoader.test.js`

**Interfaces:**
- Consumes: `priceRequests`, `itemsFromGaps` (Task 1).
- Produces: `loadListPrices(items, { pricing } = {}) → { prices, error?: 'prices' }`; `loadGapItems(setCodes, collectionData, { mode, loadSetImpl } = {}) → { items, failedSets }` (`failedSets` sorted); `downloadText(text, filename)` (default export none — named export).

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi } from 'vitest';
import { loadListPrices, loadGapItems } from '../../services/listLoader';

const items = { SOR_010_any: { set: 'SOR', number: '010', name: 'V', subtitle: null, type: 'Unit', finish: 'any', qty: 1 } };

describe('loadListPrices', () => {
  it('asks the pricing service for every item', async () => {
    const pricing = { getBulkPrices: vi.fn(async () => ({ SOR_010_any: { market: 2 } })), failedSets: () => [] };
    expect(await loadListPrices(items, { pricing })).toEqual({ prices: { SOR_010_any: { market: 2 } } });
    expect(pricing.getBulkPrices).toHaveBeenCalledWith([{ cardId: 'SOR_010_any', set: 'SOR', number: '010', isFoil: false }]);
  });
  it('reports a failed or partial read as a prices error', async () => {
    expect(await loadListPrices(items, { pricing: { getBulkPrices: async () => { throw new Error('x'); } } })).toEqual({ prices: {}, error: 'prices' });
    const partial = { getBulkPrices: async () => ({}), failedSets: () => ['SOR'] };
    expect((await loadListPrices(items, { pricing: partial })).error).toBe('prices');
  });
  it('asks for nothing when the list is empty', async () => {
    const pricing = { getBulkPrices: vi.fn() };
    expect(await loadListPrices({}, { pricing })).toEqual({ prices: {} });
    expect(pricing.getBulkPrices).not.toHaveBeenCalled();
  });
});

describe('loadGapItems', () => {
  it('builds gap items and names sets that would not load', async () => {
    const loadSetImpl = async (code) => {
      if (code === 'SHD') throw new Error('offline');
      return { cards: [{ Set: 'SOR', Number: '050', Name: 'Droid', Subtitle: '', Type: 'Unit' }] };
    };
    const res = await loadGapItems(['SOR', 'SHD'], {}, { mode: 'missing', loadSetImpl });
    expect(Object.keys(res.items)).toEqual(['SOR_050_any']);
    expect(res.failedSets).toEqual(['SHD']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/test/services/listLoader.test.js`
Expected: FAIL — cannot resolve `../../services/listLoader`.

- [ ] **Step 3: Implement**

`src/services/listLoader.js`:

```js
import { loadSet } from './setLoader';
import { PricingService } from './PricingService';
import { itemsFromGaps, priceRequests } from '../utils/cardLists';

/** Today's market prices for a list's items. Never throws. */
export async function loadListPrices(items, { pricing = PricingService } = {}) {
  const requests = priceRequests(items);
  if (requests.length === 0) return { prices: {} };
  try {
    const prices = await pricing.getBulkPrices(requests);
    const sets = new Set(requests.map((r) => r.set));
    // A denied or offline set read leaves cards unpriced without throwing.
    if ((pricing.failedSets?.() ?? []).some((code) => sets.has(code))) return { prices, error: 'prices' };
    return { prices };
  } catch {
    return { prices: {}, error: 'prices' };
  }
}

/** Wants items for the titles the chosen sets are missing. Never throws. */
export async function loadGapItems(setCodes, collectionData, { mode = 'missing', loadSetImpl = loadSet } = {}) {
  const cardsBySet = {};
  const failedSets = [];
  await Promise.all(setCodes.map(async (code) => {
    try {
      cardsBySet[code] = (await loadSetImpl(code)).cards ?? [];
    } catch {
      failedSets.push(code);
    }
  }));
  return { items: itemsFromGaps(cardsBySet, collectionData, { mode }), failedSets: failedSets.sort() };
}
```

`src/utils/downloadText.js` (same behaviour as the private helper in `CollectionValueReport.jsx`, which stays as it is):

```js
// @environment:web-file-api
export function downloadText(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/test/services/listLoader.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx vitest run src/test/services/listLoader.test.js && L=$(npx eslint src --ext js,jsx --quiet); [ -n "$L" ] && echo "$L" || { git add src/services/listLoader.js src/utils/downloadText.js src/test/services/listLoader.test.js && git commit -m "feat(lists): load prices and collection gaps for lists"; }
```

---

### Task 4: ListView (view, edit, export one list)

**Files:**
- Create: `src/components/ListView.jsx`
- Test: `src/components/__tests__/ListView.test.jsx`

**Interfaces:**
- Consumes: Task 1 (`listLines`, `listSummary`, `toListText`, `toListCsv`, `changeFinish`, `mergeItems`, `cardItem`, `itemKey`, `FINISH_LABEL`), Task 2 (`ListService.updateList`, `deleteList`), Task 3 (`loadListPrices`, `downloadText`), existing `CardPickerModal` (`{ collectionData, onSelect(card), onClose }`).
- Produces: `<ListView uid list collectionData onBack onDeleted service? loadPrices? />`. `list` is a ListService list. `onBack()` returns to the tab; `onDeleted()` after a successful delete. Renders a section with `aria-label={list.name}`.

UI contract (tests rely on these names):
- Name: `<input aria-label="List name">`, saved on blur when changed and not blank.
- Toggle: button `Show prices` with `aria-pressed`.
- Each row: `<li data-testid="list-row">`; buttons `Fewer <name>` (disabled at 1), `More <name>`, `Remove <name>`; wants lists also `<select aria-label="Finish for <name>">` with options Any finish / Standard / Foil; note `<input aria-label="Note for <name>">` saved on blur.
- `Add card` button (wants lists only) opens `CardPickerModal`.
- `Copy as text`, `Download CSV`, `Save as PDF` (prints via the `printing` state + `window.print()`, as in the report).
- `Delete list` → becomes `Tap again to delete` → deletes.
- Save failure: `role="alert"` "Couldn't save — check your connection." and the edit stays on screen.
- Totals: `data-testid="list-cards"` (card count); `data-testid="list-value"` only when prices are shown and any line is priced.

- [ ] **Step 1: Write the failing test**

```jsx
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
vi.mock('../CardPickerModal', () => ({
  default: ({ onSelect }) => (
    <button type="button" onClick={() => onSelect({ Set: 'SOR', Number: '099', Name: 'Picked', Subtitle: '', Type: 'Unit' })}>pick-card</button>
  ),
}));
import ListView from '../ListView';

const item = (o) => ({ set: 'SOR', number: '010', name: 'Vader', subtitle: null, type: 'Unit', finish: 'any', qty: 2, ...o });
const LIST = {
  id: 'l1', kind: 'wants', name: 'Gaps', showPrices: true,
  items: { SOR_010_any: item(), SOR_010_standard: item({ finish: 'standard', qty: 1 }), SOR_020_any: item({ number: '020', name: 'Luke', qty: 1 }) },
};
let service;
const loadPrices = vi.fn(async () => ({ prices: { SOR_010_any: { market: 1.5 } } }));

const renderView = (list = LIST) => render(
  <ListView uid="u1" list={list} collectionData={{}} onBack={vi.fn()} onDeleted={vi.fn()} service={service} loadPrices={loadPrices} />,
);

beforeEach(() => {
  vi.clearAllMocks();
  service = { updateList: vi.fn(async () => ({ ok: true })), deleteList: vi.fn(async () => ({ ok: true })) };
});

describe('ListView', () => {
  it('shows rows, card count and value', async () => {
    renderView();
    expect(await screen.findByTestId('list-value')).toHaveTextContent('$3.00');
    expect(screen.getAllByTestId('list-row')).toHaveLength(3);
    expect(screen.getByTestId('list-cards')).toHaveTextContent('4');
  });

  it('changes a quantity and saves the items', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'More Luke' }));
    expect(service.updateList).toHaveBeenCalledWith('u1', 'l1', { items: expect.objectContaining({ SOR_020_any: expect.objectContaining({ qty: 2 }) }) });
  });

  it('removes a card', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Luke' }));
    expect(screen.getAllByTestId('list-row')).toHaveLength(2);
    expect(service.updateList.mock.calls[0][2].items.SOR_020_any).toBeUndefined();
  });

  it('merges lines when a finish change lands on an existing one', async () => {
    renderView();
    const [anyRow] = screen.getAllByTestId('list-row').filter((r) => within(r).getByLabelText('Finish for Vader').value === 'any');
    fireEvent.change(within(anyRow).getByLabelText('Finish for Vader'), { target: { value: 'standard' } });
    const items = service.updateList.mock.calls[0][2].items;
    expect(items.SOR_010_any).toBeUndefined();
    expect(items.SOR_010_standard.qty).toBe(3);
  });

  it('renames on blur', async () => {
    renderView();
    const name = screen.getByLabelText('List name');
    fireEvent.change(name, { target: { value: 'My wants' } });
    fireEvent.blur(name);
    expect(service.updateList).toHaveBeenCalledWith('u1', 'l1', { name: 'My wants' });
  });

  it('saves a note on blur', async () => {
    renderView();
    const note = screen.getByLabelText('Note for Luke');
    fireEvent.change(note, { target: { value: 'any art' } });
    fireEvent.blur(note);
    expect(service.updateList.mock.calls[0][2].items.SOR_020_any.note).toBe('any art');
  });

  it('keeps an edit on screen and says so when the save fails', async () => {
    service.updateList.mockResolvedValue({ error: 'offline' });
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Luke' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save");
    expect(screen.getAllByTestId('list-row')).toHaveLength(2);
  });

  it('adds a card by search', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Add card' }));
    fireEvent.click(screen.getByText('pick-card'));
    expect(service.updateList.mock.calls[0][2].items.SOR_099_any).toMatchObject({ name: 'Picked', qty: 1 });
  });

  it('hides every dollar amount when prices are off, and saves the choice', async () => {
    renderView();
    await screen.findByTestId('list-value');
    fireEvent.click(screen.getByRole('button', { name: 'Show prices' }));
    expect(service.updateList).toHaveBeenCalledWith('u1', 'l1', { showPrices: false });
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('copies the list as text without prices when they are off', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    renderView({ ...LIST, showPrices: false });
    fireEvent.click(screen.getByRole('button', { name: 'Copy as text' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toMatch(/^Wants: Gaps/);
    expect(writeText.mock.calls[0][0]).not.toContain('$');
  });

  it('deletes only on the second tap', async () => {
    const onDeleted = vi.fn();
    render(<ListView uid="u1" list={LIST} collectionData={{}} onBack={vi.fn()} onDeleted={onDeleted} service={service} loadPrices={loadPrices} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete list' }));
    expect(service.deleteList).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to delete' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(service.deleteList).toHaveBeenCalledWith('u1', 'l1');
  });

  it('has no finish picker or Add card on a trade list', async () => {
    renderView({ ...LIST, kind: 'trade', items: { SOR_010_standard: item({ finish: 'standard' }) } });
    expect(screen.queryByLabelText('Finish for Vader')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add card' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/__tests__/ListView.test.jsx`
Expected: FAIL — cannot resolve `../ListView`.

- [ ] **Step 3: Implement `src/components/ListView.jsx`**

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ClipboardCopy, Download, FileText, Minus, Plus, Trash2, X } from 'lucide-react';
import CardPickerModal from './CardPickerModal';
import { ListService } from '../services/ListService';
import { loadListPrices } from '../services/listLoader';
import { downloadText } from '../utils/downloadText';
import {
  FINISH_LABEL, cardItem, changeFinish, itemKey, listLines, listSummary, mergeItems, toListCsv, toListText,
} from '../utils/cardLists';

const money = (v) => `$${v.toFixed(2)}`;
const btn = 'flex items-center gap-1 px-3 py-2 rounded-lg bg-gray-800 text-sm';
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list';

/** One saved list: edit it in place and share it. Every edit saves at once. */
export default function ListView({ uid, list, collectionData, onBack, onDeleted, service = ListService, loadPrices = loadListPrices }) {
  const [items, setItems] = useState(list.items ?? {});
  const [name, setName] = useState(list.name);
  const [savedName, setSavedName] = useState(list.name);
  const [showPrices, setShowPrices] = useState(list.showPrices !== false);
  const [prices, setPrices] = useState(null);
  const [priceError, setPriceError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [copyState, setCopyState] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const wants = list.kind === 'wants';

  // Re-price only when the set of cards changes, not on every quantity tap.
  const priceKey = Object.keys(items).sort().join('|');
  useEffect(() => {
    let cancelled = false;
    loadPrices(items).then((res) => {
      if (cancelled) return;
      setPrices(res.prices ?? {});
      setPriceError(Boolean(res.error));
    });
    return () => { cancelled = true; };
  }, [priceKey]); // eslint-disable-line react-hooks/exhaustive-deps -- keyed on the card set

  useEffect(() => {
    if (!printing) return;
    window.print();
    setPrinting(false);
  }, [printing]);

  const lines = useMemo(() => listLines(items, prices ?? {}), [items, prices]);
  const summary = useMemo(() => listSummary(lines), [lines]);

  const save = async (patch) => {
    setCopyState(null);
    const res = await service.updateList(uid, list.id, patch);
    setSaveError(Boolean(res?.error));
  };
  const saveItems = (next) => { setItems(next); save({ items: next }); };

  const setQty = (key, qty) => saveItems({ ...items, [key]: { ...items[key], qty } });
  const remove = (key) => { const next = { ...items }; delete next[key]; saveItems(next); };
  const setFinish = (key, finish) => saveItems(changeFinish(items, key, finish));
  const setNote = (key, note) => {
    const trimmed = note.trim();
    if ((items[key].note ?? '') === trimmed) return;
    const next = { ...items[key] };
    if (trimmed) next.note = trimmed; else delete next.note;
    saveItems({ ...items, [key]: next });
  };
  const addCard = (card) => {
    setPicking(false);
    saveItems(mergeItems(items, { [itemKey(card.Set, card.Number, 'any')]: cardItem(card, 'any', 1) }));
  };
  const rename = () => {
    const trimmed = name.trim();
    if (!trimmed) { setName(savedName); return; }
    if (trimmed === savedName) return;
    setSavedName(trimmed);
    save({ name: trimmed });
  };
  const togglePrices = () => { const next = !showPrices; setShowPrices(next); save({ showPrices: next }); };

  const current = { kind: list.kind, name: savedName };
  const copyText = async () => {
    const text = toListText(current, lines, { showPrices });
    try {
      await navigator.clipboard.writeText(text);
      setCopyState({ kind: 'copied', count: summary.cards });
    } catch {
      setCopyState({ kind: 'fallback', text });
    }
  };
  const exportCsv = () => {
    const date = new Date().toISOString().slice(0, 10);
    downloadText(toListCsv(current, lines, { showPrices }), `${slug(savedName)}-${date}.csv`);
  };
  const del = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    const res = await service.deleteList(uid, list.id);
    if (res?.error) { setSaveError(true); setConfirmDelete(false); return; }
    onDeleted();
  };

  return (
    <section aria-label={savedName} className="space-y-4">
      <div className="flex items-center gap-2 print:hidden">
        <button type="button" onClick={onBack} className={btn}><ArrowLeft className="w-4 h-4" /> Back</button>
      </div>
      <input
        aria-label="List name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={rename}
        className="w-full bg-transparent text-xl font-bold border-b border-gray-800 focus:border-yellow-500 outline-none py-1 print:border-0"
      />
      {list.source?.label && <p className="text-xs text-gray-500">From {list.source.label}</p>}

      {saveError && <p role="alert" className="text-sm text-red-400">Couldn&apos;t save — check your connection.</p>}
      {showPrices && priceError && <p className="text-sm text-yellow-300">Prices are unavailable right now.</p>}

      <div className="flex flex-wrap gap-2 print:hidden">
        <button type="button" aria-pressed={showPrices} onClick={togglePrices}
          className={`px-3 py-2 rounded-lg text-sm border ${showPrices ? 'bg-gray-800 border-gray-600 text-gray-100' : 'bg-gray-900 border-gray-700 text-gray-500'}`}>
          Show prices
        </button>
        {wants && <button type="button" onClick={() => setPicking(true)} className={btn}><Plus className="w-4 h-4" /> Add card</button>}
        <button type="button" onClick={copyText} disabled={lines.length === 0} className={`${btn} disabled:opacity-40`}><ClipboardCopy className="w-4 h-4" /> Copy as text</button>
        <button type="button" onClick={exportCsv} disabled={lines.length === 0} className={`${btn} disabled:opacity-40`}><Download className="w-4 h-4" /> Download CSV</button>
        <button type="button" onClick={() => setPrinting(true)} disabled={lines.length === 0} className={`${btn} disabled:opacity-40`}><FileText className="w-4 h-4" /> Save as PDF</button>
      </div>

      {copyState?.kind === 'copied' && <p role="status" className="text-sm text-green-400 print:hidden">Copied {copyState.count} cards</p>}
      {copyState?.kind === 'fallback' && (
        <div className="space-y-1 print:hidden">
          <p className="text-xs text-gray-400">Select and copy:</p>
          <textarea readOnly aria-label="List text" value={copyState.text} rows={6} onFocus={(e) => e.target.select()}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs font-mono" />
        </div>
      )}

      <div className="flex gap-4 text-sm">
        <span>Cards <strong data-testid="list-cards">{summary.cards}</strong></span>
        {showPrices && summary.priced > 0 && <span>Value <strong data-testid="list-value">{money(summary.value)}</strong></span>}
      </div>

      {lines.length === 0 ? (
        <p className="text-sm text-gray-500">{wants ? 'No cards yet — use Add card.' : 'No cards in this list.'}</p>
      ) : (
        <ul className="divide-y divide-gray-800">
          {lines.map((l) => (
            <li key={l.key} data-testid="list-row" className="py-2 space-y-1">
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0">
                  <span className="block font-medium truncate">{l.name}{l.subtitle ? `, ${l.subtitle}` : ''}</span>
                  <span className="block text-xs text-gray-500">{l.set} {l.number}{wants ? '' : ` · ${FINISH_LABEL[l.finish]}`}</span>
                </span>
                {showPrices && l.unitPrice !== null && (
                  <span className="text-xs text-gray-400 text-right">{money(l.unitPrice)}{l.priceIsFallback ? ' ↺' : ''}</span>
                )}
                <div className="flex items-center gap-1 print:hidden">
                  <button type="button" aria-label={`Fewer ${l.name}`} disabled={l.qty <= 1} onClick={() => setQty(l.key, l.qty - 1)}
                    className="p-1 rounded-full bg-gray-800 disabled:opacity-30"><Minus className="w-3 h-3" /></button>
                  <span className="w-6 text-center font-bold">{l.qty}</span>
                  <button type="button" aria-label={`More ${l.name}`} onClick={() => setQty(l.key, l.qty + 1)}
                    className="p-1 rounded-full bg-gray-800"><Plus className="w-3 h-3" /></button>
                  <button type="button" aria-label={`Remove ${l.name}`} onClick={() => remove(l.key)}
                    className="p-1 rounded-full text-gray-400 hover:text-red-400"><X className="w-4 h-4" /></button>
                </div>
                <span className="hidden print:inline">×{l.qty}</span>
              </div>
              <div className="flex gap-2 print:hidden">
                {wants && (
                  <select aria-label={`Finish for ${l.name}`} value={l.finish} onChange={(e) => setFinish(l.key, e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs">
                    {['any', 'standard', 'foil'].map((f) => <option key={f} value={f}>{FINISH_LABEL[f]}</option>)}
                  </select>
                )}
                <input aria-label={`Note for ${l.name}`} defaultValue={l.note ?? ''} placeholder="Note"
                  onBlur={(e) => setNote(l.key, e.target.value)}
                  className="flex-1 bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs" />
              </div>
              {l.note && <p className="hidden print:block text-xs">{l.note}</p>}
            </li>
          ))}
        </ul>
      )}

      <div className="pt-4 print:hidden">
        <button type="button" onClick={del} className={`${btn} text-red-300`}>
          <Trash2 className="w-4 h-4" /> {confirmDelete ? 'Tap again to delete' : 'Delete list'}
        </button>
      </div>

      {picking && <CardPickerModal collectionData={collectionData} onSelect={addCard} onClose={() => setPicking(false)} />}
    </section>
  );
}
```

Note for the finish-change test: two rows are named Vader; the test picks the row whose finish select currently reads `any`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/__tests__/ListView.test.jsx`
Expected: PASS. If the `$` test fails because the price element renders before prices load, it is a real defect — prices must be hidden whenever `showPrices` is false.

- [ ] **Step 5: Commit**

```bash
npx vitest run src/components/__tests__/ListView.test.jsx && L=$(npx eslint src --ext js,jsx --quiet); [ -n "$L" ] && echo "$L" || { git add src/components/ListView.jsx src/components/__tests__/ListView.test.jsx && git commit -m "feat(lists): list view with editing and exports"; }
```

---

### Task 5: SaveListDialog

**Files:**
- Create: `src/components/SaveListDialog.jsx`
- Test: `src/components/__tests__/SaveListDialog.test.jsx`

**Interfaces:**
- Consumes: `ListService.listLists/createList/updateList` (Task 2), `mergeItems` (Task 1).
- Produces: `<SaveListDialog uid kind items source defaultName onClose service? />`. Dialog `role="dialog"` named `Save as trade list` / `Save as wants list`. Choice radios: `New list` (with `<input aria-label="New list name">`), and per existing list of the kind: `Replace “<name>”` (trade) or `Add to “<name>”` (wants). Button `Save`. On success: `role="status"` `Saved to “<name>”` and a `Done` button calling `onClose`. Empty `items`: Save disabled with "Nothing to save." On failure: `role="alert"` "Couldn't save — check your connection." and the dialog stays.

- [ ] **Step 1: Write the failing test**

```jsx
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import SaveListDialog from '../SaveListDialog';

const ITEMS = { SOR_010_any: { set: 'SOR', number: '010', name: 'V', subtitle: null, type: 'Unit', finish: 'any', qty: 2 } };
const EXISTING = { id: 'w1', kind: 'wants', name: 'Old', items: { SOR_010_any: { ...ITEMS.SOR_010_any, qty: 1 } } };
let service;
beforeEach(() => {
  service = {
    listLists: vi.fn(async () => ({ lists: [EXISTING] })),
    createList: vi.fn(async () => ({ id: 'n1' })),
    updateList: vi.fn(async () => ({ ok: true })),
  };
});
const open = (props) => render(
  <SaveListDialog uid="u1" kind="wants" items={ITEMS} source={{ type: 'deck', label: 'Vader deck' }} defaultName="Wants: Vader deck" onClose={vi.fn()} service={service} {...props} />,
);

describe('SaveListDialog', () => {
  it('creates a new list with the default name', async () => {
    open();
    await screen.findByLabelText('Add to “Old”');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved to “Wants: Vader deck”');
    expect(service.createList).toHaveBeenCalledWith('u1', { kind: 'wants', name: 'Wants: Vader deck', items: ITEMS, source: { type: 'deck', label: 'Vader deck' } });
  });

  it('adds into an existing wants list', async () => {
    open();
    fireEvent.click(await screen.findByLabelText('Add to “Old”'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('status');
    expect(service.updateList.mock.calls[0][2].items.SOR_010_any.qty).toBe(3);
  });

  it('replaces an existing trade list', async () => {
    service.listLists.mockResolvedValue({ lists: [{ ...EXISTING, kind: 'trade' }] });
    open({ kind: 'trade' });
    fireEvent.click(await screen.findByLabelText('Replace “Old”'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('status');
    expect(service.updateList.mock.calls[0][2].items.SOR_010_any.qty).toBe(2);
  });

  it('stays open with an error when saving fails', async () => {
    service.createList.mockResolvedValue({ error: 'offline' });
    open();
    await screen.findByLabelText('Add to “Old”');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save");
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('cannot save an empty list', async () => {
    open({ items: {} });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText('Nothing to save.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/__tests__/SaveListDialog.test.jsx`
Expected: FAIL — cannot resolve `../SaveListDialog`.

- [ ] **Step 3: Implement `src/components/SaveListDialog.jsx`**

```jsx
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ListService } from '../services/ListService';
import { mergeItems } from '../utils/cardLists';

/**
 * Save cards as a new list, or into an existing one: a trade list is replaced
 * (it is a snapshot of the surplus), a wants list is added to.
 */
export default function SaveListDialog({ uid, kind, items, source = null, defaultName, onClose, service = ListService }) {
  const [lists, setLists] = useState([]);
  const [choice, setChoice] = useState('new');
  const [name, setName] = useState(defaultName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [savedTo, setSavedTo] = useState(null);
  const trade = kind === 'trade';
  const count = Object.values(items ?? {}).reduce((s, i) => s + i.qty, 0);

  useEffect(() => {
    let cancelled = false;
    service.listLists(uid, kind).then((res) => { if (!cancelled && res.lists) setLists(res.lists); });
    return () => { cancelled = true; };
  }, [uid, kind, service]);

  const save = async () => {
    setSaving(true);
    setError(false);
    let res;
    let label;
    if (choice === 'new') {
      label = name.trim() || defaultName;
      res = await service.createList(uid, { kind, name: label, items, source });
    } else {
      const target = lists.find((l) => l.id === choice);
      label = target.name;
      res = await service.updateList(uid, target.id, { items: mergeItems(target.items, items, { replace: trade }), source });
    }
    setSaving(false);
    if (res?.error) setError(true); else setSavedTo(label);
  };

  const title = trade ? 'Save as trade list' : 'Save as wants list';
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 print:hidden">
      <div role="dialog" aria-label={title} className="w-full max-w-md rounded-xl bg-gray-900 border border-gray-700 p-4 space-y-3 text-gray-100">
        <h3 className="text-lg font-bold">{title}</h3>
        {savedTo ? (
          <>
            <p role="status" className="text-green-400">Saved to “{savedTo}”</p>
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-yellow-500 text-black font-semibold">Done</button>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-400">{count === 0 ? 'Nothing to save.' : `${count} cards`}</p>
            <label className="flex items-center gap-2">
              <input type="radio" name="save-target" checked={choice === 'new'} onChange={() => setChoice('new')} />
              New list
            </label>
            {choice === 'new' && (
              <input aria-label="New list name" value={name} onChange={(e) => setName(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5" />
            )}
            {lists.map((l) => (
              <label key={l.id} className="flex items-center gap-2">
                <input type="radio" name="save-target" checked={choice === l.id} onChange={() => setChoice(l.id)} />
                {trade ? `Replace “${l.name}”` : `Add to “${l.name}”`}
              </label>
            ))}
            {error && <p role="alert" className="text-sm text-red-400">Couldn&apos;t save — check your connection.</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-800">Cancel</button>
              <button type="button" onClick={save} disabled={count === 0 || saving}
                className="px-4 py-2 rounded-lg bg-yellow-500 text-black font-semibold disabled:opacity-40">Save</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/__tests__/SaveListDialog.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx vitest run src/components/__tests__/SaveListDialog.test.jsx && L=$(npx eslint src --ext js,jsx --quiet); [ -n "$L" ] && echo "$L" || { git add src/components/SaveListDialog.jsx src/components/__tests__/SaveListDialog.test.jsx && git commit -m "feat(lists): save cards as a new or existing list"; }
```

---

### Task 6: WantsFromGaps and SavedListsPage

**Files:**
- Create: `src/components/WantsFromGaps.jsx`, `src/components/SavedListsPage.jsx`
- Test: `src/components/__tests__/WantsFromGaps.test.jsx`, `src/components/__tests__/SavedListsPage.test.jsx`

**Interfaces:**
- Consumes: `ListService` (Task 2), `loadGapItems` (Task 3), `ListView` (Task 4), existing `BatchesPanel` (`{ uid, refreshKey }`), `CardService.getSetRegistry() → [{ code, name, isBaseSet }]`, `LEGACY_SET_CODES` from `src/setCatalog.js`.
- Produces:
  - `<WantsFromGaps uid collectionData onCreated(listId) onClose service? loadGaps? getRegistry? />` — dialog `Fill gaps in my collection`; set checkboxes labelled by set name (base sets first, then the rest under "Other sets"); mode radios `Missing titles` (default) / `Up to a playset`; name input `List name` (default `Wants: missing titles` / `Wants: playsets`); button `Create list` (disabled with no set picked). No items → `role="status"` "No gaps in the chosen sets — you own every title." (`…every playset.` in playset mode). Failed sets with items → list is created, then `role="status"` "Couldn't load <codes> — the list was made without them." with an `Open list` button calling `onCreated(id)`; with no failures `onCreated(id)` is called at once.
  - `<SavedListsPage uid collectionData batchesRefresh onClose service? initialTab? />` — portal, `role="dialog"` named `Saved reports/lists`, `id="batch-report"` only while a list is open. Tabs (`role="tab"`, `aria-selected`): `Batches`, `Trade lists`, `Wants lists`; last tab remembered in `localStorage['swu-saved-lists-tab']`. Batches tab renders `BatchesPanel`. List tabs: one button per list (name, `source.label`, `N cards · <date>`); trade empty state "No trade lists yet. Open Market reports → Surplus and choose Save as trade list."; wants empty state "No wants lists yet."; wants tab has `New wants list` revealing `Fill gaps in my collection` and `Empty list`. Opening a list shows `ListView`; Back/delete returns and reloads.

- [ ] **Step 1: Write the failing tests**

`src/components/__tests__/WantsFromGaps.test.jsx`:

```jsx
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import WantsFromGaps from '../WantsFromGaps';

const REGISTRY = [
  { code: 'SOR', name: 'Spark of Rebellion', isBaseSet: true },
  { code: 'SHD', name: 'Shadows of the Galaxy', isBaseSet: true },
  { code: 'SOROP', name: 'SOR promos', isBaseSet: false },
  { code: 'PROMO', name: 'Promo', isBaseSet: false },
];
const ITEMS = { SOR_050_any: { set: 'SOR', number: '050', name: 'Droid', subtitle: null, type: 'Unit', finish: 'any', qty: 1 } };
let service; let loadGaps; let onCreated;
beforeEach(() => {
  service = { createList: vi.fn(async () => ({ id: 'w9' })) };
  loadGaps = vi.fn(async () => ({ items: ITEMS, failedSets: [] }));
  onCreated = vi.fn();
});
const open = () => render(
  <WantsFromGaps uid="u1" collectionData={{}} onCreated={onCreated} onClose={vi.fn()} service={service} loadGaps={loadGaps} getRegistry={async () => REGISTRY} />,
);

describe('WantsFromGaps', () => {
  it('lists real sets only and needs one picked', async () => {
    open();
    expect(await screen.findByLabelText('Spark of Rebellion')).toBeInTheDocument();
    expect(screen.queryByLabelText('Promo')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create list' })).toBeDisabled();
  });

  it('creates a playset wants list from the picked sets', async () => {
    open();
    fireEvent.click(await screen.findByLabelText('Spark of Rebellion'));
    fireEvent.click(screen.getByLabelText('Up to a playset'));
    fireEvent.click(screen.getByRole('button', { name: 'Create list' }));
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith('w9'));
    expect(loadGaps).toHaveBeenCalledWith(['SOR'], {}, { mode: 'playset' });
    expect(service.createList).toHaveBeenCalledWith('u1', {
      kind: 'wants', name: 'Wants: playsets', items: ITEMS, source: { type: 'gaps', label: 'playsets in SOR' },
    });
  });

  it('says so when there are no gaps, and creates nothing', async () => {
    loadGaps.mockResolvedValue({ items: {}, failedSets: [] });
    open();
    fireEvent.click(await screen.findByLabelText('Spark of Rebellion'));
    fireEvent.click(screen.getByRole('button', { name: 'Create list' }));
    expect(await screen.findByRole('status')).toHaveTextContent('you own every title');
    expect(service.createList).not.toHaveBeenCalled();
  });

  it('names sets that would not load, then opens the list', async () => {
    loadGaps.mockResolvedValue({ items: ITEMS, failedSets: ['SHD'] });
    open();
    fireEvent.click(await screen.findByLabelText('Spark of Rebellion'));
    fireEvent.click(screen.getByLabelText('Shadows of the Galaxy'));
    fireEvent.click(screen.getByRole('button', { name: 'Create list' }));
    expect(await screen.findByRole('status')).toHaveTextContent("Couldn't load SHD");
    fireEvent.click(screen.getByRole('button', { name: 'Open list' }));
    expect(onCreated).toHaveBeenCalledWith('w9');
  });
});
```

`src/components/__tests__/SavedListsPage.test.jsx`:

```jsx
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
vi.mock('../BatchesPanel', () => ({ default: ({ uid, refreshKey }) => <div>batches for {uid} #{refreshKey}</div> }));
vi.mock('../ListView', () => ({
  default: ({ list, onBack, onDeleted }) => (
    <div>
      viewing {list.name}
      <button type="button" onClick={onBack}>back</button>
      <button type="button" onClick={onDeleted}>deleted</button>
    </div>
  ),
}));
vi.mock('../WantsFromGaps', () => ({
  default: ({ onCreated }) => <button type="button" onClick={() => onCreated('w2')}>gaps-create</button>,
}));
import SavedListsPage from '../SavedListsPage';

const LISTS = {
  trade: [{ id: 't1', kind: 'trade', name: 'Binder dupes', items: { a: { qty: 4 } }, source: { type: 'surplus', label: 'Surplus' }, updatedAt: 1 }],
  wants: [{ id: 'w1', kind: 'wants', name: 'Gaps', items: {}, source: null, updatedAt: 1 }],
};
let service;
beforeEach(() => {
  localStorage.getItem.mockReset();
  localStorage.setItem.mockReset();
  service = {
    listLists: vi.fn(async (uid, kind) => ({ lists: LISTS[kind] })),
    getList: vi.fn(async (uid, id) => ({ list: { id, kind: 'wants', name: 'Fresh', items: {} } })),
    createList: vi.fn(async () => ({ id: 'w3' })),
  };
});
const open = (props) => render(<SavedListsPage uid="u1" collectionData={{}} batchesRefresh={2} onClose={vi.fn()} service={service} {...props} />);

describe('SavedListsPage', () => {
  it('opens on Batches by default and shows the batches panel', () => {
    open();
    expect(screen.getByRole('dialog', { name: 'Saved reports/lists' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Batches' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('batches for u1 #2')).toBeInTheDocument();
  });

  it('lists trade lists with their card count and remembers the tab', async () => {
    open();
    fireEvent.click(screen.getByRole('tab', { name: 'Trade lists' }));
    expect(await screen.findByText('Binder dupes')).toBeInTheDocument();
    expect(screen.getByText(/4 cards/)).toBeInTheDocument();
    expect(localStorage.setItem).toHaveBeenCalledWith('swu-saved-lists-tab', 'trade');
  });

  it('opens a list and comes back to the tab', async () => {
    open({ initialTab: 'trade' });
    fireEvent.click(await screen.findByText('Binder dupes'));
    expect(screen.getByText('viewing Binder dupes')).toBeInTheDocument();
    expect(document.getElementById('batch-report')).not.toBeNull();
    fireEvent.click(screen.getByText('back'));
    expect(await screen.findByText('Binder dupes')).toBeInTheDocument();
    expect(document.getElementById('batch-report')).toBeNull();
  });

  it('creates a wants list from gaps and opens it', async () => {
    open({ initialTab: 'wants' });
    fireEvent.click(await screen.findByRole('button', { name: 'New wants list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fill gaps in my collection' }));
    fireEvent.click(screen.getByText('gaps-create'));
    expect(await screen.findByText('viewing Fresh')).toBeInTheDocument();
    expect(service.getList).toHaveBeenCalledWith('u1', 'w2');
  });

  it('creates an empty wants list and opens it', async () => {
    open({ initialTab: 'wants' });
    fireEvent.click(await screen.findByRole('button', { name: 'New wants list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Empty list' }));
    expect(await screen.findByText('viewing Fresh')).toBeInTheDocument();
    expect(service.createList).toHaveBeenCalledWith('u1', { kind: 'wants', name: 'Wants list' });
  });

  it('explains how to make a trade list when there are none', async () => {
    service.listLists.mockResolvedValue({ lists: [] });
    open({ initialTab: 'trade' });
    expect(await screen.findByText(/Market reports → Surplus/)).toBeInTheDocument();
  });

  it('says when the lists cannot load', async () => {
    service.listLists.mockResolvedValue({ error: 'offline' });
    open({ initialTab: 'wants' });
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your lists");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/__tests__/WantsFromGaps.test.jsx src/components/__tests__/SavedListsPage.test.jsx`
Expected: FAIL — cannot resolve `../WantsFromGaps` / `../SavedListsPage`.

- [ ] **Step 3: Implement `src/components/WantsFromGaps.jsx`**

```jsx
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CardService } from '../services/CardService';
import { ListService } from '../services/ListService';
import { loadGapItems } from '../services/listLoader';
import { LEGACY_SET_CODES } from '../setCatalog';

const NAMES = { missing: 'Wants: missing titles', playset: 'Wants: playsets' };

/** A wants list that fills the collection's gaps in the chosen sets. */
export default function WantsFromGaps({
  uid, collectionData, onCreated, onClose,
  service = ListService, loadGaps = loadGapItems, getRegistry = () => CardService.getSetRegistry(),
}) {
  const [sets, setSets] = useState([]);
  const [picked, setPicked] = useState([]);
  const [mode, setMode] = useState('missing');
  const [name, setName] = useState(NAMES.missing);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { text, openId? } | { error }

  useEffect(() => {
    let cancelled = false;
    getRegistry().then((registry) => {
      if (cancelled) return;
      setSets((registry ?? []).filter((s) => !LEGACY_SET_CODES.includes(s.code)));
    }).catch(() => { if (!cancelled) setMessage({ error: "Couldn't load the set list." }); });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- load once

  const changeMode = (next) => {
    if (name === NAMES[mode]) setName(NAMES[next]);
    setMode(next);
  };
  const toggle = (code) => setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));

  const create = async () => {
    setBusy(true);
    setMessage(null);
    const codes = sets.map((s) => s.code).filter((c) => picked.includes(c));
    const { items, failedSets } = await loadGaps(codes, collectionData, { mode });
    if (Object.keys(items).length === 0) {
      setBusy(false);
      setMessage({ text: failedSets.length
        ? `Couldn't load ${failedSets.join(', ')}.`
        : `No gaps in the chosen sets — you own every ${mode === 'playset' ? 'playset' : 'title'}.` });
      return;
    }
    const label = `${mode === 'playset' ? 'playsets' : 'missing titles'} in ${codes.filter((c) => !failedSets.includes(c)).join(', ')}`;
    const res = await service.createList(uid, { kind: 'wants', name, items, source: { type: 'gaps', label } });
    setBusy(false);
    if (res?.error) { setMessage({ error: "Couldn't save — check your connection." }); return; }
    if (failedSets.length) {
      setMessage({ text: `Couldn't load ${failedSets.join(', ')} — the list was made without them.`, openId: res.id });
      return;
    }
    onCreated(res.id);
  };

  const group = (title, list) => list.length > 0 && (
    <fieldset className="space-y-1">
      <legend className="text-xs uppercase tracking-wide text-gray-500">{title}</legend>
      {list.map((s) => (
        <label key={s.code} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={picked.includes(s.code)} onChange={() => toggle(s.code)} aria-label={s.name} />
          {s.name} <span className="text-gray-500">{s.code}</span>
        </label>
      ))}
    </fieldset>
  );

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4">
      <div role="dialog" aria-label="Fill gaps in my collection" className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-gray-900 border border-gray-700 p-4 space-y-3 text-gray-100">
        <h3 className="text-lg font-bold">Fill gaps in my collection</h3>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="gap-mode" checked={mode === 'missing'} onChange={() => changeMode('missing')} /> Missing titles
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="gap-mode" checked={mode === 'playset'} onChange={() => changeMode('playset')} /> Up to a playset
          </label>
        </div>
        <input aria-label="List name" value={name} onChange={(e) => setName(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5" />
        {group('Sets', sets.filter((s) => s.isBaseSet))}
        {group('Other sets', sets.filter((s) => !s.isBaseSet))}
        {message?.text && <p role="status" className="text-sm text-yellow-300">{message.text}</p>}
        {message?.error && <p role="alert" className="text-sm text-red-400">{message.error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-800">Cancel</button>
          {message?.openId ? (
            <button type="button" onClick={() => onCreated(message.openId)} className="px-4 py-2 rounded-lg bg-yellow-500 text-black font-semibold">Open list</button>
          ) : (
            <button type="button" onClick={create} disabled={picked.length === 0 || busy}
              className="px-4 py-2 rounded-lg bg-yellow-500 text-black font-semibold disabled:opacity-40">Create list</button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 4: Implement `src/components/SavedListsPage.jsx`**

```jsx
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import BatchesPanel from './BatchesPanel';
import ListView from './ListView';
import WantsFromGaps from './WantsFromGaps';
import { ListService } from '../services/ListService';

const TAB_KEY = 'swu-saved-lists-tab';
const TABS = [['batches', 'Batches'], ['trade', 'Trade lists'], ['wants', 'Wants lists']];

// @environment:web-localstorage
const readTab = () => {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return TABS.some(([id]) => id === t) ? t : 'batches';
  } catch {
    return 'batches';
  }
};
const writeTab = (t) => {
  try {
    localStorage.setItem(TAB_KEY, t);
  } catch {
    // Not remembered this time.
  }
};

const cardCount = (list) => Object.values(list.items ?? {}).reduce((s, i) => s + (i.qty ?? 0), 0);

/** Batches, trade lists and wants lists, opened from the Command Center. */
export default function SavedListsPage({ uid, collectionData, batchesRefresh = 0, onClose, service = ListService, initialTab }) {
  const [tab, setTab] = useState(() => initialTab ?? readTab());
  const [lists, setLists] = useState(null); // null loading | array | 'error'
  const [openList, setOpenList] = useState(null);
  const [newMenu, setNewMenu] = useState(false);
  const [gaps, setGaps] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (tab === 'batches' || openList) return undefined;
    let cancelled = false;
    setLists(null);
    service.listLists(uid, tab).then((res) => {
      if (!cancelled) setLists(res.error ? 'error' : res.lists);
    });
    return () => { cancelled = true; };
  }, [tab, uid, service, openList, reload]);

  const changeTab = (t) => { setTab(t); setNewMenu(false); writeTab(t); };
  const openById = useCallback(async (id) => {
    setGaps(false);
    setNewMenu(false);
    const res = await service.getList(uid, id);
    if (res.list) setOpenList(res.list); else setReload((n) => n + 1);
  }, [service, uid]);
  const createEmpty = async () => {
    const res = await service.createList(uid, { kind: 'wants', name: 'Wants list' });
    if (res.id) openById(res.id); else setLists('error');
  };
  const back = () => { setOpenList(null); setReload((n) => n + 1); };

  return createPortal(
    <div
      id={openList ? 'batch-report' : undefined}
      role="dialog"
      aria-label="Saved reports/lists"
      className="fixed inset-0 z-[80] overflow-y-auto bg-gray-950 text-gray-100 print:static print:bg-white print:text-black"
    >
      <div className="max-w-4xl mx-auto p-4 space-y-4">
        <header className="flex items-start gap-3 print:hidden">
          <h2 className="flex-1 text-xl font-bold">Saved reports/lists</h2>
          <button type="button" onClick={onClose} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-gray-800 text-sm">
            <X className="w-4 h-4" /> Close
          </button>
        </header>

        {openList ? (
          <ListView uid={uid} list={openList} collectionData={collectionData} onBack={back} onDeleted={back} service={service} />
        ) : (
          <>
            <div role="tablist" className="flex rounded-lg bg-gray-800 p-1 border border-gray-700">
              {TABS.map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => changeTab(id)}
                  className={`flex-1 px-3 py-1.5 rounded-md text-sm font-semibold ${tab === id ? 'bg-yellow-500 text-black' : 'text-gray-300'}`}>
                  {label}
                </button>
              ))}
            </div>

            {tab === 'batches' && <BatchesPanel uid={uid} refreshKey={batchesRefresh} />}

            {tab === 'wants' && (
              <div className="space-y-2">
                <button type="button" onClick={() => setNewMenu((v) => !v)} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-yellow-500 text-black text-sm font-semibold">
                  <Plus className="w-4 h-4" /> New wants list
                </button>
                {newMenu && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setGaps(true)} className="px-3 py-2 rounded-lg bg-gray-800 text-sm">Fill gaps in my collection</button>
                    <button type="button" onClick={createEmpty} className="px-3 py-2 rounded-lg bg-gray-800 text-sm">Empty list</button>
                  </div>
                )}
              </div>
            )}

            {tab !== 'batches' && lists === null && <p className="text-sm text-gray-500">Loading…</p>}
            {tab !== 'batches' && lists === 'error' && (
              <p role="alert" className="text-sm text-red-400">Couldn&apos;t load your lists. Check your connection and try again.</p>
            )}
            {tab === 'trade' && Array.isArray(lists) && lists.length === 0 && (
              <p className="text-sm text-gray-500">No trade lists yet. Open Market reports → Surplus and choose Save as trade list.</p>
            )}
            {tab === 'wants' && Array.isArray(lists) && lists.length === 0 && (
              <p className="text-sm text-gray-500">No wants lists yet.</p>
            )}
            {tab !== 'batches' && Array.isArray(lists) && lists.length > 0 && (
              <ul className="divide-y divide-gray-800">
                {lists.map((l) => (
                  <li key={l.id}>
                    <button type="button" onClick={() => setOpenList(l)} className="w-full py-2 px-2 text-left hover:bg-gray-800/50 rounded-lg">
                      <span className="block font-medium truncate">{l.name}</span>
                      {l.source?.label && <span className="block text-xs text-gray-500">{l.source.label}</span>}
                      <span className="block text-xs text-gray-500">{cardCount(l)} cards · {new Date(l.updatedAt).toLocaleDateString()}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      {gaps && <WantsFromGaps uid={uid} collectionData={collectionData} onCreated={openById} onClose={() => setGaps(false)} service={service} />}
    </div>,
    document.body,
  );
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/components/__tests__/WantsFromGaps.test.jsx src/components/__tests__/SavedListsPage.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npx vitest run src/components/__tests__/WantsFromGaps.test.jsx src/components/__tests__/SavedListsPage.test.jsx && L=$(npx eslint src --ext js,jsx --quiet); [ -n "$L" ] && echo "$L" || { git add src/components/WantsFromGaps.jsx src/components/SavedListsPage.jsx src/components/__tests__/WantsFromGaps.test.jsx src/components/__tests__/SavedListsPage.test.jsx && git commit -m "feat(lists): saved reports/lists page and wants from collection gaps"; }
```

---

### Task 7: Market reports — rename and Save as trade list

**Files:**
- Modify: `src/components/CollectionValueReport.jsx`
- Test: `src/components/__tests__/CollectionValueReport.test.jsx`

**Interfaces:**
- Consumes: `SaveListDialog` (Task 5), `itemsFromSurplus` (Task 1).
- Produces: dialog named `Market reports`; `<h2>` "Market reports"; a subheading `<p data-testid="report-mode">` reading "Collection value" or "Surplus / trade list"; in Surplus mode (and only with a `uid`) a `Save as trade list` button, disabled when `noExport` or no lines, opening `SaveListDialog` with `kind="trade"`, `items={itemsFromSurplus(lines)}` (the filtered lines), `source={{ type: 'surplus', label: 'Surplus' }}`, `defaultName="Trade list"`.

- [ ] **Step 1: Update and add tests**

In `src/components/__tests__/CollectionValueReport.test.jsx`:
- Replace the assertion `expect(screen.getByRole('heading', { name: 'Surplus / trade list' })).toBeInTheDocument();` with `expect(screen.getByTestId('report-mode')).toHaveTextContent('Surplus / trade list');`.
- Run `grep -n "'Collection value'" src/components/__tests__/CollectionValueReport.test.jsx` and change any dialog/heading lookup by that name to `'Market reports'` (heading) or the `report-mode` test id (mode text).
- Add at the top, after the existing imports: `vi.mock('../SaveListDialog', () => ({ default: ({ kind, items, onClose }) => <div role="dialog" aria-label="save-dialog">{kind} {Object.keys(items).join(',')}<button type="button" onClick={onClose}>close-save</button></div> }));`
- Add these tests inside the `describe` (reuse the file's existing surplus fixture; if the surplus tests build a `load` returning `decks`, copy that `load` setup — the test below assumes a helper `openSurplus(props)` that renders with `uid="u1"`, clicks the `Surplus` mode button and waits for the surplus list, so write that helper next to the existing surplus tests using their fixture):

```jsx
  it('is titled Market reports', async () => {
    await open();
    expect(screen.getByRole('heading', { name: 'Market reports' })).toBeInTheDocument();
    expect(screen.getByTestId('report-mode')).toHaveTextContent('Collection value');
  });

  it('saves the filtered surplus as a trade list', async () => {
    await openSurplus();
    fireEvent.click(screen.getByRole('button', { name: 'Save as trade list' }));
    const dialog = screen.getByRole('dialog', { name: 'save-dialog' });
    expect(dialog).toHaveTextContent('trade');
    expect(dialog.textContent).toMatch(/_standard|_foil/);
    fireEvent.click(screen.getByText('close-save'));
    expect(screen.queryByRole('dialog', { name: 'save-dialog' })).not.toBeInTheDocument();
  });

  it('offers no Save as trade list outside Surplus mode', async () => {
    render(<CollectionValueReport uid="u1" collectionData={{}} onClose={vi.fn()} load={load} />);
    await screen.findByTestId('total-value');
    expect(screen.queryByRole('button', { name: 'Save as trade list' })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run src/components/__tests__/CollectionValueReport.test.jsx`
Expected: FAIL — no heading "Market reports", no `report-mode`, no Save as trade list.

- [ ] **Step 3: Implement**

In `src/components/CollectionValueReport.jsx`:
- Imports: add `import SaveListDialog from './SaveListDialog';` and `import { itemsFromSurplus } from '../utils/cardLists';`; add `ListPlus` to the lucide import.
- State (with the other `useState`s, before any return): `const [savingList, setSavingList] = useState(false);`
- The root `aria-label="Collection value"` becomes `aria-label="Market reports"`.
- Replace the header `<h2 ...>{surplusMode ? 'Surplus / trade list' : 'Collection value'}</h2>` with:

```jsx
          <div className="flex-1">
            <h2 className="text-xl font-bold">Market reports</h2>
            <p data-testid="report-mode" className="text-sm text-gray-400">{surplusMode ? 'Surplus / trade list' : 'Collection value'}</p>
          </div>
```

- In the export button row, after the `Save as PDF` button:

```jsx
              {surplusMode && uid && (
                <button type="button" onClick={() => setSavingList(true)} disabled={noExport || lines.length === 0} className="disabled:opacity-40 flex items-center gap-1 px-3 py-2 rounded-lg bg-gray-800 text-sm">
                  <ListPlus className="w-4 h-4" /> Save as trade list
                </button>
              )}
```

- Just before the closing `</div>` of the root dialog element:

```jsx
      {savingList && (
        <SaveListDialog uid={uid} kind="trade" items={itemsFromSurplus(lines)} source={{ type: 'surplus', label: 'Surplus' }}
          defaultName="Trade list" onClose={() => setSavingList(false)} />
      )}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/__tests__/CollectionValueReport.test.jsx`
Expected: PASS (all, old and new).

- [ ] **Step 5: Commit**

```bash
npx vitest run src/components/__tests__/CollectionValueReport.test.jsx && L=$(npx eslint src --ext js,jsx --quiet); [ -n "$L" ] && echo "$L" || { git add src/components/CollectionValueReport.jsx src/components/__tests__/CollectionValueReport.test.jsx && git commit -m "feat(lists): Market reports title and Save as trade list"; }
```

---

### Task 8: Deck Shop tab — Save as wants list

**Files:**
- Modify: `src/components/ShoppingList.jsx`, `src/components/DeckBuilder.jsx`
- Test: `src/components/__tests__/ShoppingList.test.jsx`

**Interfaces:**
- Consumes: `SaveListDialog` (Task 5), `itemsFromDeckGaps` (Task 1).
- Produces: `ShoppingList` takes `uid` and `deckName`; with a `uid` and at least one gap, the header shows `Save as wants list`, opening `SaveListDialog` with `kind="wants"`, `items={itemsFromDeckGaps(gapCards)}`, `source={{ type: 'deck', label: deckName || 'Deck' }}`, `defaultName={`Wants: ${deckName || 'Deck'}`}`.

- [ ] **Step 1: Write the failing tests**

In `src/components/__tests__/ShoppingList.test.jsx`, after the PricingService mock add:

```jsx
vi.mock('../SaveListDialog', () => ({
  default: ({ kind, items, defaultName }) => <div role="dialog" aria-label="save-dialog">{kind}|{defaultName}|{Object.keys(items).join(',')}</div>,
}));
```

and inside the `describe`, using the file's existing deck fixture with missing cards (the one used by "should render with deck missing cards" — reuse its `deck` and `collectionData` values):

```jsx
  it('saves the deck gaps as a wants list', async () => {
    render(<ShoppingList deck={deckWithGaps} collectionData={{}} cardDatabase={mockCardDatabase} uid="u1" deckName="Krennic aggro" />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Save as wants list' }));
    expect(screen.getByRole('dialog', { name: 'save-dialog' })).toHaveTextContent(/^wants\|Wants: Krennic aggro\|SOR_001_any/);
  });

  it('offers no save without a signed-in user', async () => {
    render(<ShoppingList deck={deckWithGaps} collectionData={{}} cardDatabase={mockCardDatabase} />);
    await screen.findByText(/cards needed/);
    expect(screen.queryByRole('button', { name: 'Save as wants list' })).not.toBeInTheDocument();
  });
```

Define `deckWithGaps` at the top of the `describe` as `const deckWithGaps = { cards: { SOR_001: 1 } };` if no suitable fixture exists (SOR 001 Director Krennic is in `mockCardDatabase`).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/__tests__/ShoppingList.test.jsx`
Expected: FAIL — no "Save as wants list" button.

- [ ] **Step 3: Implement**

`src/components/ShoppingList.jsx`:
- Imports: `import SaveListDialog from './SaveListDialog';`, `import { itemsFromDeckGaps } from '../utils/cardLists';`, add `ListPlus` to the lucide import.
- Signature: `export default function ShoppingList({ deck, collectionData, cardDatabase, onUpdateQuantity, uid, deckName })`; add `uid`/`deckName` to the props comment ("uid, deckName — optional; with a uid the list can be saved as a wants list").
- State, next to the other `useState`s (before the empty-state return): `const [savingList, setSavingList] = useState(false);`
- In the header, replace `<span className="ml-auto text-sm text-zinc-400">{gapCards.length} cards needed</span>` with:

```jsx
        <span className="ml-auto text-sm text-zinc-400">{gapCards.length} cards needed</span>
        {uid && gapCards.length > 0 && (
          <button type="button" onClick={() => setSavingList(true)}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 hover:border-zinc-500">
            <ListPlus size={13} /> Save as wants list
          </button>
        )}
```

- Before the final closing `</div>` of the main return:

```jsx
      {savingList && (
        <SaveListDialog uid={uid} kind="wants" items={itemsFromDeckGaps(gapCards)}
          source={{ type: 'deck', label: deckName || 'Deck' }} defaultName={`Wants: ${deckName || 'Deck'}`}
          onClose={() => setSavingList(false)} />
      )}
```

`src/components/DeckBuilder.jsx`: both `<ShoppingList ... onUpdateQuantity={onUpdateQuantity} />` renders (around lines 2021 and 2147) gain `uid={user?.uid}` and `deckName={deckName}` (`user` comes from `useAuth()` at line 41, `deckName` is state at line 57).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/__tests__/ShoppingList.test.jsx src/components/__tests__/DeckBuilder*.test.jsx`
Expected: PASS (the DeckBuilder glob may match no files or several; all must pass).

- [ ] **Step 5: Commit**

```bash
npx vitest run src/components/__tests__/ShoppingList.test.jsx && L=$(npx eslint src --ext js,jsx --quiet); [ -n "$L" ] && echo "$L" || { git add src/components/ShoppingList.jsx src/components/DeckBuilder.jsx src/components/__tests__/ShoppingList.test.jsx && git commit -m "feat(lists): save a deck's missing cards as a wants list"; }
```

---

### Task 9: Command Center buttons, binder Value removed, docs

**Files:**
- Modify: `src/components/Dashboard.jsx`, `src/App.jsx`, `CLAUDE.md` (git root, i.e. `../CLAUDE.md`)
- Test: `src/test/components/Dashboard.test.jsx`, `src/test/components/BinderValue.test.jsx` (rewritten as the Command Center wiring test)

**Interfaces:**
- Consumes: `SavedListsPage` (Task 6), `CollectionValueReport` (Task 7).
- Produces: `Dashboard` props `onOpenMarketReports`, `onOpenSavedLists` (each button renders only when its prop is given); `Dashboard` no longer takes `batchesRefresh` or renders `BatchesPanel`. `App`: no binder Value button; state `isMarketOpen`, `isSavedListsOpen`; `SavedListsPage` gets `batchesRefresh`.

- [ ] **Step 1: Update the tests**

`src/test/components/Dashboard.test.jsx`:
- Remove the `BatchesPanel` mock's dependent tests "shows the saved batches for the signed-in user" and "passes the refresh key through so the list reloads after scanning", and add:

```jsx
  it('no longer lists batches in the Command Center', () => {
    render(<Dashboard {...defaultProps} uid="u1" />);
    expect(screen.queryByText(/batches for/)).not.toBeInTheDocument();
  });

  it('opens Market reports and Saved reports/lists', () => {
    const onOpenMarketReports = vi.fn();
    const onOpenSavedLists = vi.fn();
    render(<Dashboard {...defaultProps} uid="u1" onOpenMarketReports={onOpenMarketReports} onOpenSavedLists={onOpenSavedLists} />);
    fireEvent.click(screen.getByRole('button', { name: /Market reports/ }));
    fireEvent.click(screen.getByRole('button', { name: /Saved reports\/lists/ }));
    expect(onOpenMarketReports).toHaveBeenCalled();
    expect(onOpenSavedLists).toHaveBeenCalled();
  });

  it('hides the buttons it has no handler for', () => {
    render(<Dashboard {...defaultProps} onOpenMarketReports={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Saved reports\/lists/ })).not.toBeInTheDocument();
  });
```

`src/test/components/BinderValue.test.jsx` — keep the App setup, and:
- Change the `Dashboard` mock to: `vi.mock('../../components/Dashboard', () => ({ default: ({ onOpenMarketReports, onOpenSavedLists }) => (<div>Dashboard<button type="button" onClick={onOpenMarketReports}>open-market</button>{onOpenSavedLists && <button type="button" onClick={onOpenSavedLists}>open-saved</button>}</div>) }));`
- Change the report mock's `aria-label="Collection value"` to `aria-label="Market reports"`, and add `vi.mock('../../components/SavedListsPage', () => ({ default: ({ onClose, batchesRefresh }) => (<div role="dialog" aria-label="Saved reports/lists">saved #{batchesRefresh}<button type="button" onClick={onClose}>close-saved</button></div>) }));`
- Replace the two tests with:

```jsx
describe('Market reports and saved lists', () => {
  it('has no Value button in the binder any more', async () => {
    mockDocs = { SOR_001_std: { quantity: 2, set: 'SOR', number: '001', name: 'Test Card', isFoil: false } };
    render(<App />);
    await screen.findByPlaceholderText(/search name or number/i, {}, { timeout: 5000 });
    expect(screen.queryByRole('button', { name: 'Value' })).not.toBeInTheDocument();
  });

  it('opens Market reports from the Command Center', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTitle('Dashboard', {}, { timeout: 5000 }));
    await user.click(screen.getByText('open-market'));
    expect(screen.getByRole('dialog', { name: 'Market reports' })).toBeInTheDocument();
    await user.click(screen.getByText('close-value'));
    expect(screen.queryByRole('dialog', { name: 'Market reports' })).not.toBeInTheDocument();
  });

  it('opens Saved reports/lists from the Command Center', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTitle('Dashboard', {}, { timeout: 5000 }));
    await user.click(screen.getByText('open-saved'));
    expect(screen.getByRole('dialog', { name: 'Saved reports/lists' })).toHaveTextContent('saved #0');
    await user.click(screen.getByText('close-saved'));
    expect(screen.queryByRole('dialog', { name: 'Saved reports/lists' })).not.toBeInTheDocument();
  });
});
```

Rename the file with `git mv src/test/components/BinderValue.test.jsx src/test/components/CommandCenterReports.test.jsx`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/test/components/Dashboard.test.jsx src/test/components/CommandCenterReports.test.jsx`
Expected: FAIL — Dashboard still renders batches, no Market reports button; binder still has Value.

- [ ] **Step 3: Implement**

`src/components/Dashboard.jsx`:
- Remove `import BatchesPanel from './BatchesPanel';`, the `batchesBump` state, the `batchesRefresh` prop, the `<BatchesPanel …/>` line and `onAdded={() => setBatchesBump(…)}` from `PrebuiltDecksPanel` (drop `useState` from the React import if now unused).
- Add `onOpenMarketReports, onOpenSavedLists` to the props; add `TrendingUp, ListChecks` to the lucide import.
- Right after the header block (`</div>` closing "Header & Controls"), insert:

```jsx
      {/* Collection management: reports and saved lists */}
      {(onOpenMarketReports || onOpenSavedLists) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {onOpenMarketReports && (
            <button type="button" onClick={onOpenMarketReports}
              className="flex items-center gap-3 p-4 rounded-xl bg-gray-800 border border-gray-700 hover:border-yellow-500/50 text-left transition-colors">
              <TrendingUp size={24} className="text-yellow-500 shrink-0" aria-hidden="true" />
              <span>
                <span className="block font-bold text-white">Market reports</span>
                <span className="block text-xs text-gray-400">Collection value and surplus to trade, at today&apos;s prices</span>
              </span>
            </button>
          )}
          {onOpenSavedLists && (
            <button type="button" onClick={onOpenSavedLists}
              className="flex items-center gap-3 p-4 rounded-xl bg-gray-800 border border-gray-700 hover:border-yellow-500/50 text-left transition-colors">
              <ListChecks size={24} className="text-yellow-500 shrink-0" aria-hidden="true" />
              <span>
                <span className="block font-bold text-white">Saved reports/lists</span>
                <span className="block text-xs text-gray-400">Batches, trade lists and wants lists</span>
              </span>
            </button>
          )}
        </div>
      )}
```

- Fix the stale comment `{/* Saved scanning batches */}` above `PrebuiltDecksPanel` to `{/* Prebuilt decks */}`.

`src/App.jsx`:
- Add `import SavedListsPage from './components/SavedListsPage';`.
- Rename `isValueOpen`/`setIsValueOpen` to `isMarketOpen`/`setIsMarketOpen`; add `const [isSavedListsOpen, setIsSavedListsOpen] = useState(false);` beside it.
- Delete the binder Value button block (the `{Object.keys(collectionData).length > 0 && (<button … onClick={() => setIsValueOpen(true)} …> Value</button>)}` with its comment); remove `DollarSign` from the lucide import if nothing else uses it (`grep -n DollarSign src/App.jsx`).
- In the `<Dashboard …>` props: remove `batchesRefresh={batchesRefresh}`; add `onOpenMarketReports={() => setIsMarketOpen(true)}` and `onOpenSavedLists={user?.uid ? () => setIsSavedListsOpen(true) : undefined}`.
- Replace the report render with:

```jsx
      {isMarketOpen && (
        <CollectionValueReport uid={user?.uid} collectionData={collectionData} onClose={() => setIsMarketOpen(false)} />
      )}
      {isSavedListsOpen && user?.uid && (
        <SavedListsPage uid={user.uid} collectionData={collectionData} batchesRefresh={batchesRefresh} onClose={() => setIsSavedListsOpen(false)} />
      )}
```

`CLAUDE.md` (git root):
- Paths block: add `artifacts/{APP_ID}/users/{uid}/lists/{listId}                     saved trade/wants lists (Saved reports/lists)`.
- Rename the "### Collection value" section to "### Market reports and saved lists" and rewrite its first sentence: the Command Center's **Market reports** button opens the report (the binder Value button is gone). Add a paragraph: **Saved reports/lists** (Command Center) has tabs Batches (moved from the Command Center), Trade lists and Wants lists (`SavedListsPage.jsx`). Lists live at `users/{uid}/lists` (`ListService`); the pure model is `src/utils/cardLists.js` (items keyed `SET_NNN_standard|foil|any`; a wants item's finish may be `any`, priced at standard with the foil fallback). Trade lists come from Market reports → Surplus → Save as trade list (replace or new); wants lists from collection gaps (`WantsFromGaps`, the Command Center's unique-title logic, missing or up to a playset), from a deck's Shop tab, or Add card. Public links are phase 2b.
- In the batches bullet, "Reports are listed in the Command Center (`BatchesPanel`)" becomes "Reports are listed under Saved reports/lists → Batches (`BatchesPanel`)".
- Conventions localStorage keys: add `swu-saved-lists-tab`.

- [ ] **Step 4: Run to verify it passes, then the full gate**

Run: `npx vitest run src/test/components/Dashboard.test.jsx src/test/components/CommandCenterReports.test.jsx`
Expected: PASS.

Run: `npm run test:unit > /tmp/saved-lists-unit.txt 2>&1; tail -n 15 /tmp/saved-lists-unit.txt`
Expected: all test files pass (skips unchanged).

Run: `npm run build 2>&1 | tail -n 5`
Expected: `✓ built in …`.

- [ ] **Step 5: Commit**

```bash
L=$(npx eslint src --ext js,jsx --quiet); [ -n "$L" ] && echo "$L" || { git add -A src/components/Dashboard.jsx src/App.jsx src/test/components ../CLAUDE.md && git commit -m "feat(lists): Market reports and Saved reports/lists in the Command Center"; }
```

---

## Self-review notes

- Spec coverage: Command Center buttons (T9), Market reports rename (T7), Batches moved (T6, T9), list model + service (T1, T2), trade lists from Surplus (T7), wants from gaps (T3, T6), from a deck (T8), add by search (T4), rename/qty/remove/note/finish (T4), Copy/CSV/PDF/Show prices (T1, T4), error table rows (T4 save error, T6 failed sets/no gaps, T3/T4 prices, T4 clipboard fallback), binder Value removed (T9).
- Deviations from the spec are listed under "Plan decisions" above.
