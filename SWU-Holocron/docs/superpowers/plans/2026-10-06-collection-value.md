# Collection Value Report and Card Prices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A filterable collection value report opened from the binder, plus market prices on the card detail view, both from today's TCGplayer prices.

**Architecture:**
- **Pure model:** `src/utils/collectionValue.js` builds lines, applies filters, summarises, sorts and writes the CSV. It reuses a breakdown helper extracted from `batchReport.js` into `src/utils/breakdown.js`.
- **Loader:** `src/services/collectionValueLoader.js` gathers card details (through `loadSet`) and prices (`PricingService.getBulkPrices`).
- **UI:** `CollectionValueReport.jsx` (a full-screen overlay, printable like the batch report), and `CardPricePanel.jsx` inside `CardModal`.
- **Entry point:** a **Value** button in the binder row.

**Tech Stack:** React 18, Tailwind, Vitest + Testing Library.

**Spec:** `SWU-Holocron/docs/superpowers/specs/2026-10-06-collection-value-design.md`

## Global Constraints

- **Where to run things:** npm/npx from `SWU-Holocron/`, lint in Bash (`npx eslint src --ext js,jsx --quiet`), gated commits (`npm run test:unit && lint && build && git commit`), commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Money:** rounded to cents. **Unpriced is never $0.** Other-finish prices are flagged (`priceIsFallback`).
- **Collection ids:** `SET_NNN_std` / `SET_NNN_foil`. Docs carry `{ quantity, set, number, name, isFoil }`. Skip quantity ≤ 0.
- **localStorage:** key `swu-value-filters`, every access in try/catch.
- **Code rules:** every hook before any conditional return; no `console.log` in `src/`.

## Review Focus

1. **Unpriced cards never count as $0**, under any filter, and `minPrice` excludes them. (Task 2: `minimum price excludes unpriced lines`; `values skip unpriced lines and report the priced share`.)
2. **A dual-aspect card** must match a filter on either aspect and count in both aspect rows. (Task 2: `aspect filter matches any aspect; Neutral matches none`.)
3. **A set whose card data fails to load** must still list its cards (stored names), not drop them. (Task 3: `keeps cards from a set that failed to load, by their stored name`.)
4. **Stale or corrupt stored filters** must fall back to the defaults instead of breaking the report. (Task 5: `ignores stored filters it cannot read`.)
5. **The card price panel** must never block the modal and must show a state for every case (loading, prices, other-finish, none, error). (Task 4: `shows each price state`.)

---

### Task 1: Extract the breakdown helper

**Files:**
- Create `src/utils/breakdown.js`; test in `src/test/utils/breakdown.test.js`.
- Modify `src/utils/batchReport.js` to import it.

**Interface:** `breakdown(lines, keysOf, valueOf) → [{ key, count, value }]`.
- `count` is the sum of `qty`.
- `value` is the sum of `valueOf(line)` over lines where it is a finite number, rounded to cents.
- Results sort by value descending, then count descending, then key.

- [ ] **Step 1: Failing test:**

```js
import { describe, it, expect } from 'vitest';
import { breakdown } from '../../utils/breakdown';

describe('breakdown', () => {
  it('groups by every key a line has, summing quantity and priced value', () => {
    const lines = [
      { qty: 2, k: ['A', 'B'], v: 1.005 },
      { qty: 1, k: ['A'], v: null },
      { qty: 3, k: ['C'], v: 0.1 },
    ];
    expect(breakdown(lines, (l) => l.k, (l) => (l.v === null ? null : l.v * l.qty))).toEqual([
      { key: 'A', count: 3, value: 2.01 },
      { key: 'B', count: 2, value: 2.01 },
      { key: 'C', count: 3, value: 0.3 },
    ]);
  });
});
```

  Check: A and B both total 2.01 and count 3 vs 2, so A comes first. C totals 0.3.

- [ ] **Step 2: Fail.**

- [ ] **Step 3: Implement** `src/utils/breakdown.js`:

```js
/**
 * Group report lines by one or more keys each (a dual-aspect card counts in
 * both), summing quantity and priced value. Unpriced lines add to the count,
 * never to the value. Shared by the batch and collection value reports.
 */
const cents = (v) => Math.round(v * 100) / 100;
const isPriced = (v) => typeof v === 'number' && Number.isFinite(v);

export function breakdown(lines, keysOf, valueOf) {
  const groups = new Map();
  for (const line of lines) {
    const value = valueOf(line);
    for (const key of keysOf(line)) {
      const g = groups.get(key) ?? { key, count: 0, value: 0 };
      g.count += line.qty;
      if (isPriced(value)) g.value += value;
      groups.set(key, g);
    }
  }
  return [...groups.values()]
    .map((g) => ({ ...g, value: cents(g.value) }))
    .sort((a, b) => b.value - a.value || b.count - a.count || a.key.localeCompare(b.key));
}
```

  In `batchReport.js`, delete the local `breakdown` and import this one. At each call site, pass `(l) => (isPriced(l.priceAtAdd) ? l.priceAtAdd * l.qty : null)` as `valueOf`.

- [ ] **Step 4: Run** the new test and `src/test/utils/batchReport.test.js`. Expected: all pass, unchanged. **Commit:** `refactor(reports): share the breakdown helper`.

---

### Task 2: Collection value model (`src/utils/collectionValue.js`)

**Files:** Create `src/utils/collectionValue.js`; test in `src/test/utils/collectionValue.test.js`.

**Interfaces (produces):**
- `buildCollectionLines(collectionData, cardsBySet, pricesById) → Line[]`.
  - `Line` is `{ id, set, number, name, subtitle, type, rarity, aspects, variant, isFoil, qty, unitPrice, priceIsFallback, value, url }`.
- `DEFAULT_FILTERS`
- `applyFilters(lines, filters) → Line[]`
- `filterOptions(lines) → { sets, rarities, types, aspects, variants }`. Each is `[{ key, count }]`, sorted by key; `aspects` includes `'Neutral'`.
- `summarize(lines) → { cards, unique, value, pricedShare, standardValue, foilValue, bySet, byRarity, byType, byAspect, byVariant, unpriced, otherFinish }`
- `sortLines(lines, by, dir = 'desc') → Line[]`
- `toCollectionCsv(lines, summary, filters) → string`

- [ ] **Step 1: Failing tests:**

```js
import { describe, it, expect } from 'vitest';
import {
  buildCollectionLines, applyFilters, summarize, sortLines, filterOptions, toCollectionCsv, DEFAULT_FILTERS,
} from '../../utils/collectionValue';

const CARDS = {
  SOR: [
    { Set: 'SOR', Number: '010', Name: 'Darth Vader', Subtitle: 'Dark Lord', Type: 'Leader', Rarity: 'Common', Aspects: ['Aggression', 'Villainy'], VariantType: 'Normal' },
    { Set: 'SOR', Number: '050', Name: 'Battle Droid', Type: 'Unit', Rarity: 'Common', Aspects: [], VariantType: 'Normal' },
    { Set: 'SOR', Number: '300', Name: 'Luke Skywalker', Subtitle: 'Faithful Friend', Type: 'Unit', Rarity: 'Legendary', Aspects: ['Vigilance', 'Heroism'], VariantType: 'Hyperspace' },
  ],
};
const COLLECTION = {
  SOR_010_std: { quantity: 2, set: 'SOR', number: '010', name: 'Darth Vader', isFoil: false },
  SOR_010_foil: { quantity: 1, set: 'SOR', number: '010', name: 'Darth Vader', isFoil: true },
  SOR_050_std: { quantity: 10, set: 'SOR', number: '050', name: 'Battle Droid', isFoil: false },
  SOR_300_std: { quantity: 1, set: 'SOR', number: '300', name: 'Luke Skywalker', isFoil: false },
  SHD_001_std: { quantity: 1, set: 'SHD', number: '001', name: 'Mystery Card', isFoil: false },
  SOR_099_std: { quantity: 0, set: 'SOR', number: '099', name: 'Gone', isFoil: false },
};
const PRICES = {
  SOR_010_std: { market: 1.5, url: 'u1' },
  SOR_010_foil: { market: 6, url: 'u2', isFallback: false },
  SOR_050_std: { market: 0.05 },
  SOR_300_std: { market: 40, isFallback: true },
  SHD_001_std: null,
};
const lines = buildCollectionLines(COLLECTION, CARDS, PRICES);
const byId = (id) => lines.find((l) => l.id === id);

describe('buildCollectionLines', () => {
  it('builds one priced line per owned doc, with card details', () => {
    expect(lines.map((l) => l.id).sort()).toEqual(['SHD_001_std', 'SOR_010_foil', 'SOR_010_std', 'SOR_050_std', 'SOR_300_std']);
    expect(byId('SOR_010_std')).toEqual({
      id: 'SOR_010_std', set: 'SOR', number: '010', name: 'Darth Vader', subtitle: 'Dark Lord', type: 'Leader',
      rarity: 'Common', aspects: ['Aggression', 'Villainy'], variant: 'Normal', isFoil: false, qty: 2,
      unitPrice: 1.5, priceIsFallback: false, value: 3, url: 'u1',
    });
    expect(byId('SOR_300_std')).toMatchObject({ priceIsFallback: true, value: 40 });
  });

  it('keeps a card whose set details are missing, by its stored name', () => {
    expect(byId('SHD_001_std')).toMatchObject({ name: 'Mystery Card', type: 'Unknown', rarity: 'Unknown', aspects: [], variant: 'Unknown', unitPrice: null, value: null });
  });
});

describe('summarize', () => {
  it('values skip unpriced lines and report the priced share', () => {
    const s = summarize(lines);
    expect(s).toMatchObject({ cards: 15, unique: 4, value: 49.5, standardValue: 43.5, foilValue: 6 });
    expect(s.pricedShare).toBeCloseTo(14 / 15);
    expect(s.unpriced.map((l) => l.id)).toEqual(['SHD_001_std']);
    expect(s.otherFinish.map((l) => l.id)).toEqual(['SOR_300_std']);
    expect(s.bySet).toEqual([{ key: 'SOR', count: 14, value: 49.5 }, { key: 'SHD', count: 1, value: 0 }]);
    expect(s.byAspect.find((g) => g.key === 'Villainy')).toEqual({ key: 'Villainy', count: 3, value: 9 });
    expect(s.byAspect.find((g) => g.key === 'Neutral')).toEqual({ key: 'Neutral', count: 11, value: 0.5 });
  });

  it('is all zeros for no lines', () => {
    expect(summarize([])).toMatchObject({ cards: 0, unique: 0, value: 0, pricedShare: 0 });
  });
});

describe('applyFilters', () => {
  const ids = (f) => applyFilters(lines, { ...DEFAULT_FILTERS, ...f }).map((l) => l.id).sort();

  it('passes everything with the defaults', () => {
    expect(ids({})).toHaveLength(5);
  });

  it('filters by set, rarity, type, variant and finish', () => {
    expect(ids({ sets: ['SHD'] })).toEqual(['SHD_001_std']);
    expect(ids({ rarities: ['Legendary'] })).toEqual(['SOR_300_std']);
    expect(ids({ types: ['Leader'] })).toEqual(['SOR_010_foil', 'SOR_010_std']);
    expect(ids({ variants: ['Hyperspace'] })).toEqual(['SOR_300_std']);
    expect(ids({ finish: 'foil' })).toEqual(['SOR_010_foil']);
    expect(ids({ finish: 'standard' })).toHaveLength(4);
  });

  it('aspect filter matches any aspect; Neutral matches none', () => {
    expect(ids({ aspects: ['Heroism'] })).toEqual(['SOR_300_std']);
    expect(ids({ aspects: ['Neutral'] })).toEqual(['SHD_001_std', 'SOR_050_std']);
    expect(ids({ aspects: ['Villainy', 'Heroism'] })).toEqual(['SOR_010_foil', 'SOR_010_std', 'SOR_300_std']);
  });

  it('filters by price status, and minimum price excludes unpriced lines', () => {
    expect(ids({ price: 'unpriced' })).toEqual(['SHD_001_std']);
    expect(ids({ price: 'priced' })).toHaveLength(4);
    expect(ids({ minPrice: 1 })).toEqual(['SOR_010_foil', 'SOR_010_std', 'SOR_300_std']);
  });

  it('searches name and subtitle, ignoring case, and combines filters', () => {
    expect(ids({ search: 'faithful' })).toEqual(['SOR_300_std']);
    expect(ids({ search: 'vader', finish: 'standard' })).toEqual(['SOR_010_std']);
  });
});

describe('filterOptions and sortLines', () => {
  it('lists each field with counts', () => {
    const o = filterOptions(lines);
    expect(o.sets).toEqual([{ key: 'SHD', count: 1 }, { key: 'SOR', count: 14 }]);
    expect(o.aspects.find((a) => a.key === 'Neutral')).toEqual({ key: 'Neutral', count: 11 });
  });

  it('sorts by value with unpriced last, and by name, quantity and set', () => {
    expect(sortLines(lines, 'value').map((l) => l.id)).toEqual(['SOR_300_std', 'SOR_010_foil', 'SOR_010_std', 'SOR_050_std', 'SHD_001_std']);
    expect(sortLines(lines, 'value', 'asc').at(-1).id).toBe('SHD_001_std');
    expect(sortLines(lines, 'qty')[0].id).toBe('SOR_050_std');
    expect(sortLines(lines, 'name', 'asc')[0].name).toBe('Battle Droid');
    expect(sortLines(lines, 'set', 'asc')[0].set).toBe('SHD');
  });
});

describe('toCollectionCsv', () => {
  it('writes a BOM, a header, quoted rows, and a summary with the filters', () => {
    const csv = toCollectionCsv(lines, summarize(lines), { ...DEFAULT_FILTERS, sets: ['SOR'] });
    const rows = csv.split('\r\n');
    expect(rows[0]).toBe('﻿Set,Number,Name,Subtitle,Type,Rarity,Aspects,Variant,Finish,Qty,Unit price,Value,Price note');
    expect(rows).toContain('SOR,300,Luke Skywalker,Faithful Friend,Unit,Legendary,Vigilance/Heroism,Hyperspace,Standard,1,40.00,40.00,from other finish');
    expect(rows).toContain('SHD,001,Mystery Card,,Unknown,Unknown,,Unknown,Standard,1,,,no price data');
    expect(rows).toContain('Total value,49.50');
    expect(rows).toContain('Filters,Set: SOR');
  });
});
```

  Arithmetic check:
  - **Values:** Vader std 2 × 1.5 = 3; Vader foil 6; Droid 10 × 0.05 = 0.5; Luke 40. Total 49.5. Standard 43.5, foil 6.
  - **Copies:** 15 in all, 14 priced, so pricedShare is 14/15.
  - **Unique:** SOR_010 is one card across both finishes. Unique = SOR_010, SOR_050, SOR_300, SHD_001 = 4.
  - **Villainy:** count 3 (2 std + 1 foil), value 9.
  - **Neutral:** Droid 10 + Mystery 1 = 11, value 0.5.
  - **Value order:** Luke 40 > Vader foil 6 > Vader std 3 (by line value) > Droid 0.5, then unpriced last.

- [ ] **Step 2: Fail.**

- [ ] **Step 3: Implement** `src/utils/collectionValue.js`:

```js
/**
 * The collection value report's model: one line per owned collection doc,
 * priced at today's market, plus the filters, summary, sorting and CSV.
 * Pure. Unpriced lines are listed, never counted as $0.
 */
import { breakdown } from './breakdown';

const cents = (v) => Math.round(v * 100) / 100;
const isPriced = (v) => typeof v === 'number' && Number.isFinite(v);
const padNumber = (n) => (/^\d+$/.test(String(n)) ? String(n).padStart(3, '0') : String(n));

export const DEFAULT_FILTERS = {
  sets: [], rarities: [], types: [], aspects: [], variants: [],
  finish: 'all', price: 'all', minPrice: null, search: '',
};

export function buildCollectionLines(collectionData, cardsBySet, pricesById) {
  const lines = [];
  for (const [id, doc] of Object.entries(collectionData ?? {})) {
    const qty = Number(doc?.quantity) || 0;
    if (qty <= 0) continue;
    const set = doc.set;
    const number = padNumber(doc.number);
    const card = (cardsBySet?.[set] ?? []).find((c) => padNumber(c.Number) === number);
    const price = pricesById?.[id] ?? null;
    const unitPrice = isPriced(price?.market) ? price.market : null;
    lines.push({
      id, set, number,
      name: card?.Name ?? doc.name ?? `${set} ${number}`,
      subtitle: card?.Subtitle ?? null,
      type: card?.Type ?? 'Unknown',
      rarity: card?.Rarity ?? 'Unknown',
      aspects: card?.Aspects ?? [],
      variant: card?.VariantType ?? 'Unknown',
      isFoil: Boolean(doc.isFoil ?? id.endsWith('_foil')),
      qty,
      unitPrice,
      priceIsFallback: Boolean(price?.isFallback),
      value: unitPrice === null ? null : cents(unitPrice * qty),
      url: price?.url ?? null,
    });
  }
  return lines;
}

const aspectKeys = (l) => (l.aspects.length ? l.aspects : ['Neutral']);
const inList = (list, value) => list.length === 0 || list.includes(value);

export function applyFilters(lines, filters) {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const q = f.search.trim().toLowerCase();
  return lines.filter((l) => {
    if (!inList(f.sets, l.set) || !inList(f.rarities, l.rarity) || !inList(f.types, l.type) || !inList(f.variants, l.variant)) return false;
    if (f.aspects.length && !aspectKeys(l).some((a) => f.aspects.includes(a))) return false;
    if (f.finish === 'foil' && !l.isFoil) return false;
    if (f.finish === 'standard' && l.isFoil) return false;
    if (f.price === 'priced' && l.unitPrice === null) return false;
    if (f.price === 'unpriced' && l.unitPrice !== null) return false;
    if (isPriced(f.minPrice) && (l.unitPrice === null || l.unitPrice < f.minPrice)) return false;
    if (q && !`${l.name} ${l.subtitle ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

const count = (lines, keysOf) => {
  const m = new Map();
  for (const l of lines) for (const k of keysOf(l)) m.set(k, (m.get(k) ?? 0) + l.qty);
  return [...m].map(([key, n]) => ({ key, count: n })).sort((a, b) => a.key.localeCompare(b.key));
};

export function filterOptions(lines) {
  return {
    sets: count(lines, (l) => [l.set]),
    rarities: count(lines, (l) => [l.rarity]),
    types: count(lines, (l) => [l.type]),
    aspects: count(lines, aspectKeys),
    variants: count(lines, (l) => [l.variant]),
  };
}

export function summarize(lines) {
  const valueOf = (l) => l.value;
  const cards = lines.reduce((s, l) => s + l.qty, 0);
  const priced = lines.filter((l) => l.value !== null);
  const sum = (ls) => cents(ls.reduce((s, l) => s + l.value, 0));
  return {
    cards,
    unique: new Set(lines.map((l) => `${l.set}_${l.number}`)).size,
    value: sum(priced),
    pricedShare: cards ? priced.reduce((s, l) => s + l.qty, 0) / cards : 0,
    standardValue: sum(priced.filter((l) => !l.isFoil)),
    foilValue: sum(priced.filter((l) => l.isFoil)),
    bySet: breakdown(lines, (l) => [l.set], valueOf),
    byRarity: breakdown(lines, (l) => [l.rarity], valueOf),
    byType: breakdown(lines, (l) => [l.type], valueOf),
    byAspect: breakdown(lines, aspectKeys, valueOf),
    byVariant: breakdown(lines, (l) => [l.variant], valueOf),
    unpriced: lines.filter((l) => l.unitPrice === null),
    otherFinish: lines.filter((l) => l.priceIsFallback && l.unitPrice !== null),
  };
}

const COMPARE = {
  value: (a, b) => (a.value ?? 0) - (b.value ?? 0),
  qty: (a, b) => a.qty - b.qty,
  name: (a, b) => a.name.localeCompare(b.name),
  set: (a, b) => a.set.localeCompare(b.set) || a.number.localeCompare(b.number, undefined, { numeric: true }),
};

export function sortLines(lines, by = 'value', dir = 'desc') {
  const cmp = COMPARE[by] ?? COMPARE.value;
  const sign = dir === 'asc' ? 1 : -1;
  return [...lines].sort((a, b) => {
    // Unpriced always sort last when ordering by value.
    if (by === 'value' && (a.value === null) !== (b.value === null)) return a.value === null ? 1 : -1;
    return sign * cmp(a, b) || a.id.localeCompare(b.id);
  });
}

const field = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const money = (v) => (isPriced(v) ? v.toFixed(2) : '');
const row = (values) => values.map(field).join(',');

export function describeFilters(filters) {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const parts = [];
  if (f.sets.length) parts.push(`Set: ${f.sets.join('/')}`);
  if (f.rarities.length) parts.push(`Rarity: ${f.rarities.join('/')}`);
  if (f.types.length) parts.push(`Type: ${f.types.join('/')}`);
  if (f.aspects.length) parts.push(`Aspect: ${f.aspects.join('/')}`);
  if (f.variants.length) parts.push(`Printing: ${f.variants.join('/')}`);
  if (f.finish !== 'all') parts.push(`Finish: ${f.finish}`);
  if (f.price !== 'all') parts.push(`Price: ${f.price}`);
  if (isPriced(f.minPrice)) parts.push(`Min price: ${money(f.minPrice)}`);
  if (f.search.trim()) parts.push(`Search: ${f.search.trim()}`);
  return parts.join('; ') || 'None';
}

export function toCollectionCsv(lines, summary, filters) {
  const out = [row(['Set', 'Number', 'Name', 'Subtitle', 'Type', 'Rarity', 'Aspects', 'Variant', 'Finish', 'Qty', 'Unit price', 'Value', 'Price note'])];
  for (const l of sortLines(lines, 'set', 'asc')) {
    const note = l.unitPrice === null ? 'no price data' : l.priceIsFallback ? 'from other finish' : '';
    out.push(row([l.set, l.number, l.name, l.subtitle, l.type, l.rarity, l.aspects.join('/'), l.variant,
      l.isFoil ? 'Foil' : 'Standard', l.qty, money(l.unitPrice), money(l.value), note]));
  }
  out.push('');
  out.push(row(['Total value', money(summary.value)]));
  out.push(row(['Cards', summary.cards]));
  out.push(row(['Unique cards', summary.unique]));
  out.push(row(['Priced share', `${Math.round(summary.pricedShare * 100)}%`]));
  out.push(row(['Filters', describeFilters(filters)]));
  return `﻿${out.join('\r\n')}`;
}
```

  Two notes on the CSV test:
  - **Leading zeros:** the rows start `SOR,300` and `SHD,001`. `number` is kept padded, and `field()` writes it as text, so the zeros survive.
  - **Filter text:** with `sets: ['SOR']`, `describeFilters` gives `Set: SOR`.

- [ ] **Step 4: Pass. Step 5: Commit** — `feat(value): collection value model`.

---

### Task 3: Loader (`src/services/collectionValueLoader.js`)

**Files:** Create `src/services/collectionValueLoader.js`; test in `src/test/services/collectionValueLoader.test.js`.

**Interface:** `loadCollectionValue(collectionData, { loadSetImpl = loadSet, pricing = PricingService } = {}) → { lines, missingSets, error? }`. It never throws.

- [ ] **Step 1: Failing tests:**

```js
import { describe, it, expect, vi } from 'vitest';
import { loadCollectionValue } from '../../services/collectionValueLoader';

const COLLECTION = {
  SOR_010_std: { quantity: 1, set: 'SOR', number: '010', name: 'Darth Vader', isFoil: false },
  SOR_010_foil: { quantity: 1, set: 'SOR', number: '010', name: 'Darth Vader', isFoil: true },
  SHD_001_std: { quantity: 2, set: 'SHD', number: '001', name: 'Stored Name', isFoil: false },
};

describe('loadCollectionValue', () => {
  it('loads each owned set once and prices every owned id', async () => {
    const loadSetImpl = vi.fn(async (code) => ({ cards: code === 'SOR' ? [{ Set: 'SOR', Number: '010', Name: 'Darth Vader', Rarity: 'Common' }] : [{ Set: 'SHD', Number: '001', Name: 'Real Name' }] }));
    const pricing = { getBulkPrices: vi.fn(async () => ({ SOR_010_std: { market: 2 } })) };
    const res = await loadCollectionValue(COLLECTION, { loadSetImpl, pricing });
    expect(loadSetImpl.mock.calls.map(([c]) => c).sort()).toEqual(['SHD', 'SOR']);
    expect(pricing.getBulkPrices.mock.calls[0][0]).toEqual(expect.arrayContaining([
      { cardId: 'SOR_010_std', set: 'SOR', number: '010', isFoil: false },
      { cardId: 'SOR_010_foil', set: 'SOR', number: '010', isFoil: true },
      { cardId: 'SHD_001_std', set: 'SHD', number: '001', isFoil: false },
    ]));
    expect(res.missingSets).toEqual([]);
    expect(res.lines.find((l) => l.id === 'SOR_010_std')).toMatchObject({ rarity: 'Common', value: 2 });
  });

  it('keeps cards from a set that failed to load, by their stored name', async () => {
    const loadSetImpl = vi.fn(async (code) => { if (code === 'SHD') throw new Error('offline'); return { cards: [] }; });
    const res = await loadCollectionValue(COLLECTION, { loadSetImpl, pricing: { getBulkPrices: async () => ({}) } });
    expect(res.missingSets).toEqual(['SHD']);
    expect(res.lines.find((l) => l.id === 'SHD_001_std')).toMatchObject({ name: 'Stored Name', rarity: 'Unknown', qty: 2 });
  });

  it('shows cards without values when prices fail, and never throws', async () => {
    const res = await loadCollectionValue(COLLECTION, {
      loadSetImpl: async () => ({ cards: [] }),
      pricing: { getBulkPrices: async () => { throw new Error('denied'); } },
    });
    expect(res.lines).toHaveLength(3);
    expect(res.lines.every((l) => l.value === null)).toBe(true);
    expect(res.error).toBe('prices');
  });
});
```

- [ ] **Step 2: Fail. Step 3: Implement:**

```js
import { loadSet } from './setLoader';
import { PricingService } from './PricingService';
import { buildCollectionLines } from '../utils/collectionValue';

/**
 * Everything the collection value report needs: card details for each owned
 * set (through the IndexedDB cache) and today's market price for each owned
 * card. A set that won't load keeps its cards by their stored name; failed
 * prices leave every line unpriced. Never throws.
 */
export async function loadCollectionValue(collectionData, { loadSetImpl = loadSet, pricing = PricingService } = {}) {
  const owned = Object.entries(collectionData ?? {}).filter(([, d]) => (Number(d?.quantity) || 0) > 0);
  const setCodes = [...new Set(owned.map(([, d]) => d.set).filter(Boolean))];
  const cardsBySet = {};
  const missingSets = [];
  await Promise.all(setCodes.map(async (code) => {
    try {
      cardsBySet[code] = (await loadSetImpl(code)).cards ?? [];
    } catch {
      missingSets.push(code);
    }
  }));
  let prices = {};
  let error;
  try {
    prices = await pricing.getBulkPrices(owned.map(([id, d]) => ({
      cardId: id, set: d.set, number: String(d.number), isFoil: Boolean(d.isFoil ?? id.endsWith('_foil')),
    })));
  } catch {
    error = 'prices';
  }
  return { lines: buildCollectionLines(collectionData, cardsBySet, prices), missingSets: missingSets.sort(), ...(error ? { error } : {}) };
}
```

  `String(d.number)`: the test expects `'010'`, and the collection docs store padded strings. Use `String(d.number)` as-is.

- [ ] **Step 4: Pass. Step 5: Commit** — `feat(value): load card details and prices for the collection`.

---

### Task 4: Card price panel (`CardPricePanel.jsx`) in `CardModal`

**Files:**
- Create `src/components/CardPricePanel.jsx`; test in `src/components/__tests__/CardPricePanel.test.jsx`.
- Modify `src/components/CardModal.jsx`: render `<CardPricePanel card={currentCard} collectionData={collectionData} />` below the text box, unless the card is a placeholder.

**Interface:** `<CardPricePanel card collectionData getCardPrice={PricingService.getCardPrice} />`.
- **Loading:** it calls `getCardPrice(card.Set, card.Number, false)` and `(…, true)` whenever the card changes, ignoring late replies for a previous card.
- **Each finish's row:**
  - **`$x.xx`**, as a link (`target="_blank" rel="noopener noreferrer"`) when there's a `url`;
  - **"(from foil)" / "(from standard)"** when `isFallback`;
  - **"No price data"** when null.
- **"Your copies"** (only when owned, via `getCardQuantities`): `"{std} + {foil}F = $total"`. "≈" goes before the total when any owned finish is unpriced.
- **Other states:** "Loading…" while waiting; "Price unavailable" if either call throws.

- [ ] **Step 1: Failing tests:**

```jsx
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import CardPricePanel from '../CardPricePanel';

const CARD = { Set: 'SOR', Number: '010', Name: 'Darth Vader' };
const price = (std, foil) => vi.fn(async (set, number, isFoil) => (isFoil ? foil : std));

describe('CardPricePanel', () => {
  it('shows each price state', async () => {
    const { unmount } = render(<CardPricePanel card={CARD} collectionData={{}} getCardPrice={price({ market: 1.5, url: 'https://t/std' }, { market: 6, url: 'https://t/foil' })} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '$1.50' })).toHaveAttribute('href', 'https://t/std');
    expect(screen.getByRole('link', { name: '$6.00' })).toHaveAttribute('target', '_blank');
    unmount();

    const { unmount: u2 } = render(<CardPricePanel card={CARD} collectionData={{}} getCardPrice={price({ market: 1.5 }, { market: 1.5, isFallback: true })} />);
    expect(await screen.findByText(/\(from standard\)/)).toBeInTheDocument();
    u2();

    const { unmount: u3 } = render(<CardPricePanel card={CARD} collectionData={{}} getCardPrice={price(null, null)} />);
    expect(await screen.findAllByText('No price data')).toHaveLength(2);
    u3();

    render(<CardPricePanel card={CARD} collectionData={{}} getCardPrice={vi.fn(async () => { throw new Error('x'); })} />);
    expect(await screen.findByText('Price unavailable')).toBeInTheDocument();
  });

  it('values the copies you own', async () => {
    const owned = { SOR_010_std: { quantity: 3 }, SOR_010_foil: { quantity: 2 } };
    render(<CardPricePanel card={CARD} collectionData={owned} getCardPrice={price({ market: 1.5 }, { market: 6 })} />);
    expect(await screen.findByText('3 + 2F = $16.50')).toBeInTheDocument();
  });

  it('marks the copies total approximate when a finish you own has no price', async () => {
    const owned = { SOR_010_std: { quantity: 3 }, SOR_010_foil: { quantity: 1 } };
    render(<CardPricePanel card={CARD} collectionData={owned} getCardPrice={price({ market: 1.5 }, null)} />);
    expect(await screen.findByText('3 + 1F = ≈$4.50')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fail. Step 3: Implement** to the interface above: hooks first, a `cancelled` flag in the effect, money as `$x.xx`.

  **In `CardModal.jsx`**, import it and render it after the text box, inside the non-placeholder branch:

```jsx
               <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
                 <p className="whitespace-pre-wrap">{isFlipped && hasBack ? currentCard.BackText : currentCard.FrontText}</p>
               </div>
```

  …followed by `<CardPricePanel card={currentCard} collectionData={collectionData} />`. Wrap both in a fragment.

  In `src/test/components/CardModal.test.jsx`, add `vi.mock('../../components/CardPricePanel', () => ({ default: () => <div>price panel</div> }))`, and a test that a normal card shows "price panel" while a placeholder card doesn't. (Check how the existing tests build a placeholder card; `isPlaceholder` comes from `PLACEHOLDER_FLAG` on the card.)

- [ ] **Step 4: Pass** (both files). **Step 5: Commit** — `feat(value): market price on the card detail view`.

---

### Task 5: Report (`CollectionValueReport.jsx`)

**Files:** Create `src/components/CollectionValueReport.jsx`; test in `src/components/__tests__/CollectionValueReport.test.jsx`.

**Interface:** `<CollectionValueReport collectionData onClose load={loadCollectionValue} />`.
- **Structure:** a portal to `document.body`, with `id="batch-report"`, `role="dialog"` and `aria-label="Collection value"`.
- **On mount:** `load(collectionData)`. While waiting it shows "Loading prices…".
- **Filters:**
  - State is `{ ...DEFAULT_FILTERS, ...stored }`, where `stored` is read from `swu-value-filters` (try/catch).
  - The stored value is only used if it's an object whose list fields are arrays; anything else falls back to the defaults.
  - Every change writes it back.
- **Totals** (`data-testid`s):
  - `total-value`: money;
  - `priced-share`: "N% of copies priced";
  - `total-cards`;
  - `total-unique`;
  - the standard and foil values.
- **Filter bar:**
  - a `<select multiple>` per list field, labelled "Set", "Rarity", "Type", "Aspect" and "Printing", with options from `filterOptions(allLines)` shown as `key (count)`;
  - "Finish" and "Price" `<select>`s (All / Standard / Foil; All / Priced / Unpriced);
  - "Minimum price" (`parsePricePaid`);
  - "Search cards".
  - Native multi-selects keep this compact and accessible on phones.
- **Chips:** one button per active value, named `Remove <Field>: <value>`, plus **Clear all**.
- **Breakdowns:** sections By set, By rarity, By type, By aspect and By printing. Each row is a button named `Filter by <field> <key>`, which adds that key to the field's list.
- **Card list:**
  - "Sort by" `<select>` (Value, Quantity, Name, Set) and a direction toggle;
  - rows show name, set and number, finish, qty, unit price and value ("—" if unpriced, and a "↺" mark for an other-finish price);
  - the first 100 rows, then a **Show more** button that adds 100.
- **Exports:** **Download CSV** (`toCollectionCsv` of the filtered lines; filename `collection-value-yyyy-mm-dd.csv`) and **Save as PDF** (`window.print()`).
- **Notes:**
  - `missingSets` gives "Couldn't load card details for X, Y — their cards show without rarity or type."
  - `error === 'prices'` gives "Prices are unavailable right now."

- [ ] **Step 1: Failing tests:**

```jsx
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import CollectionValueReport from '../CollectionValueReport';

const L = (id, o) => ({ id, set: 'SOR', number: id.split('_')[1], name: id, subtitle: null, type: 'Unit', rarity: 'Common', aspects: [], variant: 'Normal', isFoil: id.endsWith('foil'), qty: 1, unitPrice: 1, priceIsFallback: false, value: 1, url: null, ...o });
const LINES = [
  L('SOR_010_std', { name: 'Darth Vader', rarity: 'Rare', aspects: ['Villainy'], unitPrice: 5, value: 10, qty: 2 }),
  L('SOR_050_std', { name: 'Battle Droid', qty: 10, unitPrice: 0.05, value: 0.5 }),
  L('SHD_001_std', { set: 'SHD', name: 'Mystery', unitPrice: null, value: null }),
];
const load = vi.fn(async () => ({ lines: LINES, missingSets: [] }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.getItem.mockReset();
  localStorage.setItem.mockReset();
});

const open = async () => {
  render(<CollectionValueReport collectionData={{}} onClose={vi.fn()} load={load} />);
  return screen.findByTestId('total-value');
};

describe('CollectionValueReport', () => {
  it('shows totals and the priced share', async () => {
    expect(await open()).toHaveTextContent('$10.50');
    expect(screen.getByTestId('priced-share')).toHaveTextContent('92% of copies priced');
    expect(screen.getByTestId('total-cards')).toHaveTextContent('13');
  });

  it('filters, and every number follows', async () => {
    await open();
    const set = screen.getByLabelText('Set');
    fireEvent.change(set, { target: { selectedOptions: [set.querySelector('option[value="SHD"]')] } });
    await waitFor(() => expect(screen.getByTestId('total-cards')).toHaveTextContent('1'));
    expect(screen.getByTestId('total-value')).toHaveTextContent('$0.00');
    expect(screen.getByRole('button', { name: 'Remove Set: SHD' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Set: SHD' }));
    await waitFor(() => expect(screen.getByTestId('total-cards')).toHaveTextContent('13'));
  });

  it('drills down from a breakdown row, and clears all', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Filter by rarity Rare' }));
    await waitFor(() => expect(screen.getByTestId('total-value')).toHaveTextContent('$10.00'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(screen.getByTestId('total-value')).toHaveTextContent('$10.50'));
  });

  it('sorts the card list and pages it', async () => {
    const many = Array.from({ length: 150 }, (_, i) => L(`SOR_${String(i).padStart(3, '0')}_std`, { value: i, unitPrice: i }));
    render(<CollectionValueReport collectionData={{}} onClose={vi.fn()} load={async () => ({ lines: many, missingSets: [] })} />);
    const list = await screen.findByRole('list', { name: 'Cards' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(100);
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('SOR_149_std');
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(150);
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'name' } });
    fireEvent.click(screen.getByRole('button', { name: /Ascending|Descending/ }));
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('SOR_000_std');
  });

  it('remembers filters, and ignores stored filters it cannot read', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Search cards'), { target: { value: 'vader' } });
    expect(localStorage.setItem).toHaveBeenLastCalledWith('swu-value-filters', expect.stringContaining('"search":"vader"'));
    localStorage.getItem.mockImplementation(() => '{"sets":"oops"');
    render(<CollectionValueReport collectionData={{}} onClose={vi.fn()} load={load} />);
    expect((await screen.findAllByTestId('total-cards')).at(-1)).toHaveTextContent('13');
  });

  it('exports CSV and prints', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(click).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save as PDF' }));
    expect(print).toHaveBeenCalled();
    click.mockRestore(); print.mockRestore();
  });

  it('notes sets it could not load and missing prices', async () => {
    render(<CollectionValueReport collectionData={{}} onClose={vi.fn()} load={async () => ({ lines: LINES, missingSets: ['SHD'], error: 'prices' })} />);
    expect(await screen.findByText(/Couldn.t load card details for SHD/)).toBeInTheDocument();
    expect(screen.getByText('Prices are unavailable right now.')).toBeInTheDocument();
  });
});
```

  Arithmetic check:
  - **Total:** 10 + 0.5 = 10.5. Cards: 2 + 10 + 1 = 13.
  - **Priced share:** 12/13 = 92%.
  - **Filtered to SHD:** cards 1, value $0.00.
  - **Rare only:** Vader, $10.00.
  - **Sort by value descending:** `SOR_149_std` comes first.
  - **Name ascending:** `SOR_000_std` comes first (names equal ids).
  - **Toggling direction:** the toggle starts as Descending, and one click switches it to Ascending.

  On the multi-select change: happy-dom supports `selectedOptions` set through `fireEvent.change(el, { target: { selectedOptions } })` only partly. If it doesn't work, implement `onChange` as reading `[...e.target.options].filter(o => o.selected)`, and in the test set `option.selected = true` before `fireEvent.change(set)`. Adjust the test the same way and record a ruling.

- [ ] **Step 2: Fail. Step 3: Implement** to the interface (hooks first; `useMemo` for filtered lines, summary and sorted lines; `downloadText` as in `BatchReport.jsx`, with the BOM already included by `toCollectionCsv`). **Step 4: Pass. Step 5: Commit** — `feat(value): collection value report with filters`.

---

### Task 6: The binder's Value button

**Files:**
- Modify `src/App.jsx`.
- Test in `src/test/components/BinderValue.test.jsx`, reusing the App mock setup from `src/test/components/UserMenu.test.jsx`: copy its mocks, `mockAuthState` and the `localStorage` visit flag. Mock `../../components/CollectionValueReport` as a dialog showing "value report" with a close button.

**Change:** in the binder's first row, before the My Collection button, add the following (state `isValueOpen`, declared with the other `useState`s):

```jsx
                {Object.keys(collectionData).length > 0 && (
                  <button
                    type="button"
                    onClick={() => setIsValueOpen(true)}
                    className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-full text-xs font-medium border bg-gray-800 border-gray-700 text-gray-300 hover:text-white hover:border-gray-500"
                  >
                    <DollarSign size={14} aria-hidden="true" /> Value
                  </button>
                )}
```

Then, near the other overlays:

```jsx
      {isValueOpen && (
        <CollectionValueReport collectionData={collectionData} onClose={() => setIsValueOpen(false)} />
      )}
```

- [ ] **Step 1: Failing tests:**
  - with a non-empty collection, **Value** shows in the binder, and clicking it opens the report;
  - closing the report removes it;
  - with an empty collection there's no **Value** button.

  `collectionData` comes from the Firestore `onSnapshot` mock in the copied setup: set it to deliver one doc for the first test and none for the second, following how `UserMenu.test.jsx` mocks `onSnapshot`. If that setup can't feed collection docs, record a ruling and test the button through a small exported `ValueButton` component instead.

- [ ] **Step 2: Fail. Step 3: Implement. Step 4: Pass**, plus the full suite. **Step 5: Commit** — `feat(value): Value button in the binder`.

---

### Task 7: Docs, full gate and build

- [ ] **`CLAUDE.md`:** a short **Collection value** note under the Card scanner and batches material covering:
  - the pure model (`collectionValue.js`), the loader, and the report (filters persist in `swu-value-filters`; print via `#batch-report`);
  - the card price panel;
  - prices from the weekly price sync (only some sets are priced; unpriced cards are listed, never $0).

  Also add `swu-value-filters` and `swu-deck-owned-only` to the localStorage key list.
- [ ] **`TESTING.md`** manual checks:
  - open Value on the phone;
  - slice by set and rarity;
  - drill down;
  - export a CSV and a PDF;
  - compare a card's price with TCGplayer.
- [ ] **Gate:** `npm run test:unit`, lint, build. **Commit** — `docs: collection value`.
