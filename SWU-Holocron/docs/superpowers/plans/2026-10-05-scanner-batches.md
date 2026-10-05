# Scanner Batches and Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Name each scanning batch, save a per-batch report as cards are added (value at the time, value now, value vs. price paid, breakdowns, top pulls, new cards), list past batches in the Command Center, and export reports as CSV and PDF.

**Architecture:**
- **Pure modules:** `batchReport.js` (the report) and `batchCsv.js` (the CSV export).
- **Draft:** carries `batch` metadata.
- **`BatchService`:** keeps one Firestore document per batch under the user.
- **`CardScanner`:** on every Add, appends the committed lines (with details, prices and `isNew`), and closes the batch when the draft empties.
- **UI:** `BatchReport.jsx` shows the report (CSV download, print-to-PDF, rename, delete); `BatchesPanel.jsx` lists batches in the Dashboard.

**Tech Stack:** React 18, Firestore v10 (`runTransaction`), Vitest + Testing Library, Tailwind (including a print stylesheet in `index.css`).

**Spec:** `SWU-Holocron/docs/superpowers/specs/2026-10-05-scanner-batches-design.md`

## Global Constraints

- Run npm/npx from `SWU-Holocron/`. Lint with the Bash tool: `npx eslint src --ext js,jsx --quiet`.
- Gate commits: `npm run test:unit && npx eslint src --ext js,jsx --quiet && git add … && git commit …`.
- Hooks before any conditional return; no `console.log`; services never throw (they return `{ error }`).
- Money is rounded to cents (`Math.round(v * 100) / 100`). Unpriced lines are never counted as $0.
- Firestore path: `artifacts/{APP_ID}/users/{uid}/batches/{batchId}`. No rules change is needed.
- Draft helpers must **preserve every draft field** (`{ ...draft, rows }`), or the batch metadata is lost.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A box added in several goes** must produce one batch whose quantities add up, while keeping the first `isNew` and price of each line. (Task 4: `merges quantities across appends, keeping the first isNew and price`.)
2. **Draft edits** (capture, result, foil, quantity, remove) must keep the batch metadata. (Task 3: `every draft operation keeps the batch metadata`.)
3. **Cards with no price data** must not drag value down as $0, and must be listed. (Task 1: `leaves unpriced lines out of values and lists them`.)
4. **A failed report write** must never fail or undo the collection commit. (Task 9: `keeps the cards added when the report cannot be updated`.)
5. **CSV quoting** of card names with commas and quotes must round-trip. (Task 2: `quotes fields with commas and doubles quotes`.)

---

### Task 1: `batchReport` (pure)

**Files:** Create `src/utils/batchReport.js`; test in `src/test/utils/batchReport.test.js`.

**Interfaces:**
- A batch has the shape `{ name, createdAt, closedAt, pricePaid, cards: { [id]: Line } }`.
- `Line = { set, number, name, type, rarity, aspects, variant, isFoil, qty, isNew, priceAtAdd }`.
- `buildReport(batch, currentPrices = null)` returns:
  - `{ name, createdAt, closedAt, pricePaid, lines, cards, unique, newUnique, newCards, valueAtAdd, valueNow, unpriced, net, multiple, byRarity, byType, byAspect, byVariant, topPulls }`;
  - `lines` are sorted by set, then number, and each carries `id` and `priceNow`;
  - `currentPrices` is `{ [id]: number }`, or `null` when not loaded, in which case `valueNow` is `null`.

- [ ] **Step 1: Failing tests:**

```js
import { describe, it, expect } from 'vitest';
import { buildReport } from '../../utils/batchReport';

const line = (o) => ({ set: 'SOR', number: '001', name: 'X', type: 'Unit', rarity: 'Common', aspects: ['Vigilance'], variant: 'Normal', isFoil: false, qty: 1, isNew: false, priceAtAdd: 0.1, ...o });

const BATCH = {
  name: 'eBay SOR box', createdAt: 1, closedAt: 2, pricePaid: 100,
  cards: {
    SOR_010_std: line({ number: '010', name: 'Luke Skywalker', type: 'Leader', rarity: 'Rare', aspects: ['Vigilance', 'Heroism'], qty: 2, isNew: true, priceAtAdd: 5 }),
    SOR_010_foil: line({ number: '010', name: 'Luke Skywalker', type: 'Leader', rarity: 'Rare', aspects: ['Vigilance', 'Heroism'], isFoil: true, variant: 'Foil', priceAtAdd: 20 }),
    SOR_200_std: line({ number: '200', name: 'Darth Vader', rarity: 'Legendary', aspects: ['Aggression', 'Villainy'], variant: 'Hyperspace', priceAtAdd: 80 }),
    SOR_050_std: line({ number: '050', name: 'Battle Droid', qty: 10, priceAtAdd: 0.05 }),
    SOR_051_std: line({ number: '051', name: 'Mystery', priceAtAdd: null, qty: 3 }),
  },
};

describe('buildReport', () => {
  const r = buildReport(BATCH);

  it('totals cards, unique cards and new unique cards', () => {
    expect(r.cards).toBe(17);
    expect(r.unique).toBe(4); // SOR 010 in two finishes counts once
    expect(r.newUnique).toBe(1);
    expect(r.newCards.map((l) => l.id)).toEqual(['SOR_010_std']);
  });

  it('leaves unpriced lines out of values and lists them', () => {
    expect(r.valueAtAdd).toBe(110.5); // 5*2 + 20 + 80 + 0.05*10
    expect(r.unpriced.map((l) => l.id)).toEqual(['SOR_051_std']);
  });

  it('compares value with the price paid', () => {
    expect(r.net).toBe(10.5);
    expect(r.multiple).toBe(1.1);
    const unpaid = buildReport({ ...BATCH, pricePaid: null });
    expect(unpaid.net).toBeNull();
    expect(unpaid.multiple).toBeNull();
  });

  it('computes value now only when current prices are loaded', () => {
    expect(r.valueNow).toBeNull();
    const now = buildReport(BATCH, { SOR_010_std: 6, SOR_200_std: 90 });
    expect(now.valueNow).toBe(102); // only lines with a current price
    expect(now.lines.find((l) => l.id === 'SOR_010_std').priceNow).toBe(6);
  });

  it('breaks down by rarity, type, aspect (dual aspects in both) and variant', () => {
    expect(r.byRarity).toEqual([
      { key: 'Legendary', count: 1, value: 80 },
      { key: 'Rare', count: 3, value: 30 },
      { key: 'Common', count: 13, value: 0.5 },
    ]);
    expect(r.byType.map((g) => g.key)).toEqual(['Unit', 'Leader']);
    const vigilance = r.byAspect.find((g) => g.key === 'Vigilance');
    const heroism = r.byAspect.find((g) => g.key === 'Heroism');
    expect(vigilance.count).toBe(16);
    expect(heroism).toEqual({ key: 'Heroism', count: 3, value: 30 });
    expect(r.byVariant.find((g) => g.key === 'Hyperspace')).toEqual({ key: 'Hyperspace', count: 1, value: 80 });
  });

  it('lists the top pulls by price', () => {
    expect(r.topPulls.map((l) => l.id)).toEqual(['SOR_200_std', 'SOR_010_foil', 'SOR_010_std', 'SOR_050_std']);
  });

  it('sorts lines by set then number', () => {
    expect(r.lines.map((l) => l.id)).toEqual(['SOR_010_foil', 'SOR_010_std', 'SOR_050_std', 'SOR_051_std', 'SOR_200_std']);
  });

  it('handles an empty batch', () => {
    const empty = buildReport({ name: 'x', createdAt: 1, cards: {} });
    expect(empty).toMatchObject({ cards: 0, unique: 0, valueAtAdd: 0, topPulls: [], net: null });
  });
});
```

  Arithmetic check:
  - **byRarity:** Common = Battle Droid ×10 plus Mystery ×3 → count 13, value 0.5.
  - **byType:** Unit = 14 cards (Vader 1 + Droid 10 + Mystery 3), worth 80.5; Leader = 3 cards, worth 30. Both sorts below put Unit first.
  - **Vigilance:** Luke 2 + Luke foil 1 + Droid 10 + Mystery 3 = 16.
  - **valueNow:** 6 × 2 + 90 = 102.
  - **Line order:** sort by `${set}|${number.padStart(4)}|${isFoil}`, so `010` foil and std tie on number, and `false` < `true` would put std first. The test expects foil first, so make the tiebreak id order (`localeCompare` on id): `SOR_010_foil` < `SOR_010_std`.

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement** `src/utils/batchReport.js`:

```js
/**
 * Batch report: what a scanning batch (a box, a pre-release) produced and what
 * it is worth. Pure -- built from the saved batch record and, optionally, the
 * current prices. Lines with no price are listed, never counted as $0.
 */
const cents = (v) => Math.round(v * 100) / 100;
const isPriced = (v) => typeof v === 'number' && Number.isFinite(v);
const cardKey = (l) => `${l.set}_${l.number}`;

function breakdown(lines, keysOf) {
  const groups = new Map();
  for (const l of lines) {
    for (const key of keysOf(l)) {
      const g = groups.get(key) ?? { key, count: 0, value: 0 };
      g.count += l.qty;
      if (isPriced(l.priceAtAdd)) g.value += l.priceAtAdd * l.qty;
      groups.set(key, g);
    }
  }
  return [...groups.values()]
    .map((g) => ({ ...g, value: cents(g.value) }))
    .sort((a, b) => b.value - a.value || b.count - a.count || a.key.localeCompare(b.key));
}

export function buildReport(batch, currentPrices = null) {
  const lines = Object.entries(batch.cards ?? {})
    .map(([id, l]) => ({
      id,
      ...l,
      qty: l.qty ?? 0,
      priceNow: currentPrices && isPriced(currentPrices[id]) ? currentPrices[id] : null,
    }))
    .sort((a, b) => a.set.localeCompare(b.set)
      || String(a.number).localeCompare(String(b.number), undefined, { numeric: true })
      || a.id.localeCompare(b.id));

  const priced = lines.filter((l) => isPriced(l.priceAtAdd));
  const valueAtAdd = cents(priced.reduce((s, l) => s + l.priceAtAdd * l.qty, 0));
  const valueNow = currentPrices
    ? cents(lines.reduce((s, l) => s + (isPriced(l.priceNow) ? l.priceNow * l.qty : 0), 0))
    : null;
  const pricePaid = isPriced(batch.pricePaid) ? batch.pricePaid : null;
  const newCards = lines.filter((l) => l.isNew);

  return {
    name: batch.name,
    createdAt: batch.createdAt,
    closedAt: batch.closedAt ?? null,
    pricePaid,
    lines,
    cards: lines.reduce((s, l) => s + l.qty, 0),
    unique: new Set(lines.map(cardKey)).size,
    newUnique: new Set(newCards.map(cardKey)).size,
    newCards,
    valueAtAdd,
    valueNow,
    unpriced: lines.filter((l) => !isPriced(l.priceAtAdd)),
    net: pricePaid === null ? null : cents(valueAtAdd - pricePaid),
    multiple: pricePaid ? cents(valueAtAdd / pricePaid) : null,
    byRarity: breakdown(lines, (l) => [l.rarity ?? 'Unknown']),
    byType: breakdown(lines, (l) => [l.type ?? 'Unknown']),
    byAspect: breakdown(lines, (l) => (l.aspects?.length ? l.aspects : ['Neutral'])),
    byVariant: breakdown(lines, (l) => [l.variant ?? 'Unknown']),
    topPulls: [...priced]
      .sort((a, b) => b.priceAtAdd - a.priceAtAdd || a.name.localeCompare(b.name))
      .slice(0, 10),
  };
}
```

- [ ] **Step 4: Run and confirm pass. Step 5: Commit** — gated, `feat(batches): batch report`.

---

### Task 2: `batchCsv` (pure)

**Files:** Create `src/utils/batchCsv.js`; test in `src/test/utils/batchCsv.test.js`.

**Interfaces:**
- `BATCH_CSV_HEADER`;
- `toBatchCsv(report) → string` (CRLF line endings);
- `batchCsvFilename(name, createdAt) → 'ebay-sor-box-2026-10-05.csv'`.

- [ ] **Step 1: Failing tests:**

```js
import { describe, it, expect } from 'vitest';
import { toBatchCsv, batchCsvFilename, BATCH_CSV_HEADER } from '../../utils/batchCsv';
import { buildReport } from '../../utils/batchReport';

const batch = {
  name: 'eBay, "SOR" box', createdAt: Date.UTC(2026, 9, 5), pricePaid: 10,
  cards: {
    SOR_010_std: { set: 'SOR', number: '010', name: 'Luke Skywalker, "Faithful"', type: 'Leader', rarity: 'Rare', aspects: ['Vigilance', 'Heroism'], variant: 'Normal', isFoil: false, qty: 2, isNew: true, priceAtAdd: 5 },
    SOR_051_std: { set: 'SOR', number: '051', name: 'Mystery', type: 'Unit', rarity: 'Common', aspects: [], variant: 'Normal', isFoil: false, qty: 1, isNew: false, priceAtAdd: null },
  },
};

describe('toBatchCsv', () => {
  const rows = toBatchCsv(buildReport(batch, { SOR_010_std: 6 })).split('\r\n');

  it('starts with the header', () => {
    expect(rows[0]).toBe(BATCH_CSV_HEADER.join(','));
  });

  it('quotes fields with commas and doubles quotes', () => {
    expect(rows[1]).toBe('SOR,010,"Luke Skywalker, ""Faithful""",Leader,Rare,Vigilance/Heroism,Normal,No,2,Yes,5.00,10.00,6.00');
  });

  it('leaves null prices blank', () => {
    expect(rows[2]).toBe('SOR,051,Mystery,Unit,Common,,Normal,No,1,No,,,');
  });

  it('appends summary rows after a blank line', () => {
    expect(rows[3]).toBe('');
    expect(rows).toContain('Batch,"eBay, ""SOR"" box"');
    expect(rows).toContain('Value at add,10.00');
    expect(rows).toContain('Price paid,10.00');
    expect(rows).toContain('Net,0.00');
    expect(rows).toContain('Multiple,1x');
  });
});

describe('batchCsvFilename', () => {
  it('slugs the name and adds the date', () => {
    expect(batchCsvFilename('eBay, "SOR" box!', Date.UTC(2026, 9, 5))).toBe('ebay-sor-box-2026-10-05.csv');
    expect(batchCsvFilename('', Date.UTC(2026, 9, 5))).toBe('batch-2026-10-05.csv');
  });
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement** `src/utils/batchCsv.js`:

```js
/**
 * CSV export of a batch report: one row per card line, then summary rows.
 * Quoting follows RFC 4180 (fields with a comma, quote or newline are quoted,
 * quotes doubled), the same standard csvParser.js reads.
 */
export const BATCH_CSV_HEADER = ['Set', 'Number', 'Name', 'Type', 'Rarity', 'Aspects', 'Variant', 'Foil', 'Qty', 'New', 'Price at add', 'Value at add', 'Price now'];

const field = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const money = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : '');
const row = (values) => values.map(field).join(',');

export function toBatchCsv(report) {
  const lines = [row(BATCH_CSV_HEADER)];
  for (const l of report.lines) {
    lines.push(row([
      l.set, l.number, l.name, l.type, l.rarity, (l.aspects ?? []).join('/'), l.variant,
      l.isFoil ? 'Yes' : 'No', l.qty, l.isNew ? 'Yes' : 'No',
      money(l.priceAtAdd), money(typeof l.priceAtAdd === 'number' ? l.priceAtAdd * l.qty : null), money(l.priceNow),
    ]));
  }
  lines.push('');
  lines.push(row(['Batch', report.name]));
  lines.push(row(['Cards', report.cards]));
  lines.push(row(['Unique cards', report.unique]));
  lines.push(row(['New unique cards', report.newUnique]));
  lines.push(row(['Value at add', money(report.valueAtAdd)]));
  lines.push(row(['Value now', money(report.valueNow)]));
  lines.push(row(['Price paid', money(report.pricePaid)]));
  lines.push(row(['Net', money(report.net)]));
  lines.push(row(['Multiple', report.multiple === null ? '' : `${report.multiple}x`]));
  return lines.join('\r\n');
}

export function batchCsvFilename(name, createdAt) {
  const slug = String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'batch';
  const date = new Date(createdAt).toISOString().slice(0, 10);
  return `${slug}-${date}.csv`;
}
```

- [ ] **Step 4: Run and confirm pass. Step 5: Commit** — gated, `feat(batches): CSV export`.

---

### Task 3: Batch metadata on the draft

**Files:** Modify `src/utils/scanDraft.js`; test in `src/test/utils/scanDraft.test.js`.

**Interfaces:**
- `ensureBatch(draft, now, id)` → the draft with `batch = { id, name: defaultBatchName(now), pricePaid: null, createdAt: now }` if it had none; unchanged otherwise.
- `defaultBatchName(ms)` → `'Batch Oct 5'` (en-US, short month).
- `setBatchName(draft, name)`; `setPricePaid(draft, amount)`, where an amount that isn't a finite number ≥ 0 becomes `null`.
- `saveDraft` and `loadDraft` round-trip `batch` (dropped unless it's an object with a string `id`).
- **Every existing helper returns `{ ...draft, rows }`.**

- [ ] **Step 1: Failing tests,** appended to `scanDraft.test.js`, with `ensureBatch, setBatchName, setPricePaid, defaultBatchName` added to the import list:

```js
describe('batch metadata', () => {
  const NOW = Date.UTC(2026, 9, 5, 12);
  const withBatch = () => ensureBatch(emptyDraft(), NOW, 'b1');

  it('creates the batch lazily with a dated default name, once', () => {
    const d = withBatch();
    expect(d.batch).toEqual({ id: 'b1', name: defaultBatchName(NOW), pricePaid: null, createdAt: NOW });
    expect(defaultBatchName(NOW)).toBe('Batch Oct 5');
    expect(ensureBatch(d, NOW + 1, 'b2').batch.id).toBe('b1');
  });

  it('renames and prices the batch; a bad price becomes null', () => {
    let d = setBatchName(withBatch(), 'eBay SOR box');
    d = setPricePaid(d, 89.99);
    expect(d.batch).toMatchObject({ name: 'eBay SOR box', pricePaid: 89.99 });
    expect(setPricePaid(d, -1).batch.pricePaid).toBeNull();
    expect(setPricePaid(d, NaN).batch.pricePaid).toBeNull();
  });

  it('every draft operation keeps the batch metadata', () => {
    let d = capture(withBatch(), 'a');
    d = applyResult(d, 'a', LUKE);
    d = setFoil(d, ['a'], true);
    d = setGroupQuantity(d, 'SOR_012_foil', 3);
    d = markReading(d, 'a');
    d = removeRows(d, ['a']);
    expect(d.batch.id).toBe('b1');
  });

  it('round-trips the batch through storage', () => {
    const storage = memoryStorage();
    saveDraft(storage, 'uid-1', setBatchName(withBatch(), 'Pre-release'));
    expect(loadDraft(storage, 'uid-1').batch).toMatchObject({ id: 'b1', name: 'Pre-release' });
  });
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement.** In `scanDraft.js`:
  - Change `mapRows`, `addCapture`, `removeRows` and `setGroupQuantity` to return `{ ...draft, rows: … }`.
  - Add:

```js
export const defaultBatchName = (ms) => `Batch ${new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

export function ensureBatch(draft, now, id) {
  if (draft.batch) return draft;
  return { ...draft, batch: { id, name: defaultBatchName(now), pricePaid: null, createdAt: now } };
}

export function setBatchName(draft, name) {
  return draft.batch ? { ...draft, batch: { ...draft.batch, name } } : draft;
}

export function setPricePaid(draft, amount) {
  const pricePaid = typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 ? amount : null;
  return draft.batch ? { ...draft, batch: { ...draft.batch, pricePaid } } : draft;
}
```

  - `saveDraft`: `JSON.stringify({ rows: draft.rows, batch: draft.batch ?? null })`.
  - `loadDraft`: `const batch = parsed.batch && typeof parsed.batch.id === 'string' ? parsed.batch : undefined;` and return `{ rows, ...(batch ? { batch } : {}) }`.

- [ ] **Step 4: Run and confirm pass** (the whole `scanDraft.test.js`). **Step 5: Commit** — gated, `feat(batches): batch metadata on the scan draft`.

---

### Task 4: `BatchService`

**Files:** Create `src/services/BatchService.js`; test in `src/test/services/BatchService.test.js`.

**Interfaces:**
- `mergeLines(cards, lines)` (pure);
- `summarize(cards)` (pure) → `{ cards, unique, newUnique, valueAtAdd }`.
- `BatchService`:
  - `appendToBatch(uid, batch, lines)`;
  - `closeBatch(uid, id)`;
  - `listBatches(uid)` → `[{ id, name, createdAt, closedAt, pricePaid, summary }]`;
  - `getBatch(uid, id)` → `{ id, ...data } | null`;
  - `renameBatch(uid, id, name)`;
  - `setBatchPricePaid(uid, id, amount)`;
  - `deleteBatch(uid, id)`.
- The write methods return `{ ok: true }` or `{ error }`.
- `lines` are `[{ id, set, number, name, type, rarity, aspects, variant, isFoil, qty, isNew, priceAtAdd }]`.

- [ ] **Step 1: Failing tests:**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({ docs: new Map(), fail: false }));
vi.mock('../../firebase', () => ({ db: {}, APP_ID: 'app' }));
vi.mock('firebase/firestore', () => {
  const path = (segs) => segs.join('/');
  return {
    doc: (db, ...segs) => ({ path: path(segs) }),
    collection: (db, ...segs) => ({ path: path(segs) }),
    query: (ref) => ref,
    orderBy: () => null,
    getDoc: async (ref) => ({ exists: () => store.docs.has(ref.path), data: () => store.docs.get(ref.path) }),
    getDocs: async (ref) => ({
      docs: [...store.docs.entries()]
        .filter(([p]) => p.startsWith(`${ref.path}/`))
        .sort(([, a], [, b]) => b.createdAt - a.createdAt)
        .map(([p, d]) => ({ id: p.split('/').pop(), data: () => d })),
    }),
    updateDoc: async (ref, patch) => {
      if (store.fail) throw new Error('offline');
      store.docs.set(ref.path, { ...store.docs.get(ref.path), ...patch });
    },
    deleteDoc: async (ref) => { store.docs.delete(ref.path); },
    runTransaction: async (db, fn) => {
      if (store.fail) throw new Error('offline');
      return fn({
        get: async (ref) => ({ exists: () => store.docs.has(ref.path), data: () => store.docs.get(ref.path) }),
        set: (ref, data) => store.docs.set(ref.path, data),
      });
    },
  };
});

import { BatchService, mergeLines, summarize } from '../../services/BatchService';

const BATCH = { id: 'b1', name: 'eBay SOR box', pricePaid: 90, createdAt: 100 };
const L = (o) => ({ id: 'SOR_010_std', set: 'SOR', number: '010', name: 'Luke', type: 'Leader', rarity: 'Rare', aspects: [], variant: 'Normal', isFoil: false, qty: 1, isNew: true, priceAtAdd: 5, ...o });
const PATH = 'artifacts/app/users/u1/batches/b1';

beforeEach(() => { store.docs.clear(); store.fail = false; });

describe('BatchService', () => {
  it('creates the batch on the first append, with a summary', async () => {
    expect(await BatchService.appendToBatch('u1', BATCH, [L({ qty: 2 })])).toEqual({ ok: true });
    const doc = store.docs.get(PATH);
    expect(doc).toMatchObject({ name: 'eBay SOR box', pricePaid: 90, createdAt: 100, closedAt: null });
    expect(doc.cards.SOR_010_std).toMatchObject({ qty: 2, isNew: true, priceAtAdd: 5 });
    expect(doc.summary).toEqual({ cards: 2, unique: 1, newUnique: 1, valueAtAdd: 10 });
  });

  it('merges quantities across appends, keeping the first isNew and price', async () => {
    await BatchService.appendToBatch('u1', BATCH, [L()]);
    await BatchService.appendToBatch('u1', { ...BATCH, name: 'Renamed' }, [L({ qty: 3, isNew: false, priceAtAdd: 9 }), L({ id: 'SOR_011_std', number: '011', name: 'Leia', isNew: false, priceAtAdd: null })]);
    const doc = store.docs.get(PATH);
    expect(doc.cards.SOR_010_std).toMatchObject({ qty: 4, isNew: true, priceAtAdd: 5 });
    expect(doc.name).toBe('Renamed');
    expect(doc.summary).toEqual({ cards: 5, unique: 2, newUnique: 1, valueAtAdd: 20 });
  });

  it('closes, lists, gets, renames, prices and deletes', async () => {
    await BatchService.appendToBatch('u1', BATCH, [L()]);
    await BatchService.appendToBatch('u1', { ...BATCH, id: 'b0', createdAt: 50 }, [L()]);
    await BatchService.closeBatch('u1', 'b1');
    expect(store.docs.get(PATH).closedAt).toEqual(expect.any(Number));
    const list = await BatchService.listBatches('u1');
    expect(list.map((b) => b.id)).toEqual(['b1', 'b0']);
    expect(list[0]).toMatchObject({ name: 'eBay SOR box', summary: { cards: 1 } });
    expect(list[0].cards).toBeUndefined();
    expect(await BatchService.getBatch('u1', 'b1')).toMatchObject({ id: 'b1', cards: expect.any(Object) });
    await BatchService.renameBatch('u1', 'b1', 'Box #2');
    await BatchService.setBatchPricePaid('u1', 'b1', 75);
    expect(store.docs.get(PATH)).toMatchObject({ name: 'Box #2', pricePaid: 75 });
    await BatchService.deleteBatch('u1', 'b1');
    expect(await BatchService.getBatch('u1', 'b1')).toBeNull();
  });

  it('returns errors instead of throwing', async () => {
    store.fail = true;
    await expect(BatchService.appendToBatch('u1', BATCH, [L()])).resolves.toEqual({ error: 'offline' });
    await expect(BatchService.closeBatch('u1', 'b1')).resolves.toEqual({ error: 'offline' });
  });

  it('mergeLines and summarize are pure', () => {
    const cards = mergeLines({}, [L(), L()]);
    expect(cards.SOR_010_std.qty).toBe(2);
    expect(summarize(cards)).toEqual({ cards: 2, unique: 1, newUnique: 1, valueAtAdd: 10 });
  });
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement** `src/services/BatchService.js`:

```js
import { collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, runTransaction, updateDoc } from 'firebase/firestore';
import { db, APP_ID } from '../firebase';

/**
 * Scanning batches (a booster box, a pre-release): one Firestore document per
 * batch under the user, appended to on every Add, so a box added in several
 * goes is still one report. Never throws -- a report is never worth failing a
 * collection commit over.
 *
 * @environment:firebase
 */
const cents = (v) => Math.round(v * 100) / 100;
const batchesRef = (uid) => collection(db, 'artifacts', APP_ID, 'users', uid, 'batches');
const batchRef = (uid, id) => doc(db, 'artifacts', APP_ID, 'users', uid, 'batches', id);
const fail = (err) => ({ error: err?.message ?? 'unknown' });

/** Add lines into a batch's card map. A line's first isNew and price stick. */
export function mergeLines(cards, lines) {
  const next = { ...cards };
  for (const { id, ...line } of lines) {
    const prev = next[id];
    next[id] = prev ? { ...prev, qty: prev.qty + line.qty } : { ...line };
  }
  return next;
}

export function summarize(cards) {
  const lines = Object.values(cards);
  const key = (l) => `${l.set}_${l.number}`;
  return {
    cards: lines.reduce((s, l) => s + l.qty, 0),
    unique: new Set(lines.map(key)).size,
    newUnique: new Set(lines.filter((l) => l.isNew).map(key)).size,
    valueAtAdd: cents(lines.reduce((s, l) => s + (typeof l.priceAtAdd === 'number' ? l.priceAtAdd * l.qty : 0), 0)),
  };
}

export const BatchService = {
  async appendToBatch(uid, batch, lines) {
    if (!db) return { error: 'offline' };
    try {
      const ref = batchRef(uid, batch.id);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists() ? snap.data() : { createdAt: batch.createdAt, closedAt: null, cards: {} };
        const cards = mergeLines(data.cards ?? {}, lines);
        tx.set(ref, {
          ...data,
          name: batch.name,
          pricePaid: batch.pricePaid ?? null,
          cards,
          summary: summarize(cards),
          updatedAt: Date.now(),
        });
      });
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  },

  async closeBatch(uid, id) {
    try {
      await updateDoc(batchRef(uid, id), { closedAt: Date.now() });
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  },

  async listBatches(uid) {
    try {
      const snap = await getDocs(query(batchesRef(uid), orderBy('createdAt', 'desc')));
      return snap.docs.map((d) => {
        const { name, createdAt, closedAt, pricePaid, summary } = d.data();
        return { id: d.id, name, createdAt, closedAt: closedAt ?? null, pricePaid: pricePaid ?? null, summary };
      });
    } catch (err) {
      return fail(err);
    }
  },

  async getBatch(uid, id) {
    try {
      const snap = await getDoc(batchRef(uid, id));
      return snap.exists() ? { id, ...snap.data() } : null;
    } catch {
      return null;
    }
  },

  async renameBatch(uid, id, name) {
    try { await updateDoc(batchRef(uid, id), { name }); return { ok: true }; } catch (err) { return fail(err); }
  },

  async setBatchPricePaid(uid, id, pricePaid) {
    try { await updateDoc(batchRef(uid, id), { pricePaid }); return { ok: true }; } catch (err) { return fail(err); }
  },

  async deleteBatch(uid, id) {
    try { await deleteDoc(batchRef(uid, id)); return { ok: true }; } catch (err) { return fail(err); }
  },
};
```

- [ ] **Step 4: Run and confirm pass. Step 5: Commit** — gated, `feat(batches): batch service`.

---

### Task 5: `ScanService.cardDetails`

**Files:** Modify `src/services/ScanService.js`; test in `src/test/services/ScanService.test.js`.

**Interface:** `ScanService.cardDetails(set, number) → { type, rarity, aspects, variant } | null`. It uses the per-session set cache and never throws.

- [ ] **Step 1: Failing test** (appended):

```js
describe('ScanService.cardDetails', () => {
  it('returns type, rarity, aspects and variant from the cached set data', async () => {
    mocks.fetchSetData.mockResolvedValue({ data: [{ Set: 'SOR', Number: '010', Name: 'Luke', Type: 'Leader', Rarity: 'Rare', Aspects: ['Vigilance'], VariantType: 'Normal' }] });
    await expect(ScanService.cardDetails('SOR', '10')).resolves.toEqual({ type: 'Leader', rarity: 'Rare', aspects: ['Vigilance'], variant: 'Normal' });
    await expect(ScanService.cardDetails('SOR', '999')).resolves.toBeNull();
  });

  it('returns null when the set cannot be loaded', async () => {
    mocks.fetchSetData.mockRejectedValue(new Error('offline'));
    await expect(ScanService.cardDetails('SHD', '1')).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Fail. Step 3: Implement** in `ScanService`, after `prefetchSets`:

```js
  /** Type, rarity, aspects and printing of a card, for batch reports. Never throws. */
  async cardDetails(set, number) {
    try {
      const want = normalizeNumber(number);
      const card = (await cardsForSet(set)).find((c) => normalizeNumber(c.Number) === want);
      return card
        ? { type: card.Type ?? null, rarity: card.Rarity ?? null, aspects: card.Aspects ?? [], variant: card.VariantType ?? null }
        : null;
    } catch {
      return null;
    }
  },
```

  Import `normalizeNumber` from `../utils/scanResolve`.

- [ ] **Step 4: Pass. Step 5: Commit** — gated, `feat(batches): card details for batch lines`.

---

### Task 6: `BatchReport` and the print stylesheet

**Files:**
- Create `src/components/BatchReport.jsx` and its test, `src/components/__tests__/BatchReport.test.jsx`.
- Modify `src/index.css`.

**Interfaces:**
- `<BatchReport uid batchId onClose onDeleted />`, a `role="dialog"` named `Batch report`, rendered at `id="batch-report"`.
- Buttons: `Download CSV`, `Save as PDF`, `Rename`, `Delete report`, `Close`.

- [ ] **Step 1: Failing tests:**

```jsx
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const m = vi.hoisted(() => ({ getBatch: vi.fn(), renameBatch: vi.fn(), deleteBatch: vi.fn(), getBulkPrices: vi.fn() }));
vi.mock('../../services/BatchService', () => ({ BatchService: { getBatch: m.getBatch, renameBatch: m.renameBatch, deleteBatch: m.deleteBatch } }));
vi.mock('../../services/PricingService', () => ({ PricingService: { getBulkPrices: m.getBulkPrices } }));

import BatchReport from '../BatchReport';

const BATCH = {
  id: 'b1', name: 'eBay SOR box', createdAt: Date.UTC(2026, 9, 5), closedAt: 2, pricePaid: 100,
  cards: {
    SOR_200_std: { set: 'SOR', number: '200', name: 'Darth Vader', type: 'Unit', rarity: 'Legendary', aspects: ['Aggression'], variant: 'Hyperspace', isFoil: false, qty: 1, isNew: true, priceAtAdd: 80 },
    SOR_050_std: { set: 'SOR', number: '050', name: 'Battle Droid', type: 'Unit', rarity: 'Common', aspects: [], variant: 'Normal', isFoil: false, qty: 10, isNew: false, priceAtAdd: null },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getBatch.mockResolvedValue(BATCH);
  m.getBulkPrices.mockResolvedValue({ SOR_200_std: { market: 90 } });
  m.renameBatch.mockResolvedValue({ ok: true });
  m.deleteBatch.mockResolvedValue({ ok: true });
});

const renderReport = (props = {}) => render(<BatchReport uid="u1" batchId="b1" onClose={vi.fn()} onDeleted={vi.fn()} {...props} />);

describe('BatchReport', () => {
  it('shows the totals, value vs paid, top pulls, new cards and unpriced cards', async () => {
    renderReport();
    expect(await screen.findByRole('heading', { name: 'eBay SOR box' })).toBeInTheDocument();
    expect(screen.getByTestId('value-at-add')).toHaveTextContent('$80.00');
    expect(screen.getByTestId('net')).toHaveTextContent('-$20.00');
    expect(await screen.findByTestId('value-now')).toHaveTextContent('$90.00');
    expect(screen.getByTestId('top-pulls')).toHaveTextContent('Darth Vader');
    expect(screen.getByTestId('new-cards')).toHaveTextContent('Darth Vader');
    expect(screen.getByTestId('unpriced')).toHaveTextContent('Battle Droid');
  });

  it('downloads a CSV', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderReport();
    fireEvent.click(await screen.findByRole('button', { name: 'Download CSV' }));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it('prints for Save as PDF', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderReport();
    fireEvent.click(await screen.findByRole('button', { name: 'Save as PDF' }));
    expect(print).toHaveBeenCalled();
    print.mockRestore();
  });

  it('renames and deletes', async () => {
    const onDeleted = vi.fn();
    renderReport({ onDeleted });
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Batch name'), { target: { value: 'Box #2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(m.renameBatch).toHaveBeenCalledWith('u1', 'b1', 'Box #2'));
    expect(await screen.findByRole('heading', { name: 'Box #2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete report' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete — your collection is not affected' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it('says so when value now cannot be loaded', async () => {
    m.getBulkPrices.mockRejectedValue(new Error('offline'));
    renderReport();
    expect(await screen.findByTestId('value-now')).toHaveTextContent('unavailable');
  });
});
```

- [ ] **Step 2: Fail.**

- [ ] **Step 3: Implement** `src/components/BatchReport.jsx`:
  - A full-screen `div` with `id="batch-report"`, `role="dialog"`, `aria-label="Batch report"`, and the classes `fixed inset-0 z-[80] overflow-y-auto bg-gray-950 text-gray-100 print:static print:bg-white print:text-black`.
  - **On mount:** `BatchService.getBatch(uid, batchId)`. While it loads, show "Loading…"; if it returns null, show "Report not found" with a Close button.
  - **Current prices:** call `PricingService.getBulkPrices(lines.map(l => ({ cardId: l.id, set: l.set, number: l.number, isFoil: l.isFoil })))` and map each result to `price?.market`. On failure, set `nowUnavailable`.
  - **Report:** `buildReport(batch, currentPrices)`.
  - **Header:** `<h2>` with the name; the date, as `new Date(createdAt).toLocaleDateString()`.
  - **Totals grid**, with each value carrying a `data-testid`:
    - Cards; Unique; New unique;
    - Value at add (`value-at-add`);
    - Value now (`value-now`: "…" while loading, or "unavailable");
    - Price paid; Net (`net`, formatted with a sign); Multiple.
  - **Money format:** `const fmt = (v) => v === null ? '—' : \`${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}\``.
  - **Tables:**
    - By rarity, By type, By aspect, By printing (from `byVariant`), as rows of key, count and value;
    - Top pulls (`data-testid="top-pulls"`);
    - New cards (`data-testid="new-cards"`);
    - No price data (`data-testid="unpriced"`), rendered only if any.
  - **Actions bar** (`print:hidden`):
    - **Download CSV** → `downloadText(toBatchCsv(report), batchCsvFilename(report.name, report.createdAt))`, where `downloadText` creates a Blob URL, an anchor with `download`, calls `click()` and revokes the URL. Mark it `@environment:web-file-api`.
    - **Save as PDF** → `window.print()`.
    - **Rename** → an inline `<input aria-label="Batch name">` with a **Save name** button, which calls `BatchService.renameBatch` and updates the local batch name.
    - **Delete report** → an inline confirmation, **Delete — your collection is not affected**, which calls `deleteBatch` and then `onDeleted()`.
    - **Close** → `onClose()`.
  - Add to `src/index.css`:

```css
/* Batch report: printing (Save as PDF) shows only the report. */
@media print {
  body * { visibility: hidden; }
  #batch-report, #batch-report * { visibility: visible; }
  #batch-report { position: absolute; inset: 0; overflow: visible; }
}
```

- [ ] **Step 4: Pass. Step 5: Commit** — gated, `feat(batches): batch report screen with CSV and PDF export`.

---

### Task 7: `BatchesPanel` in the Command Center

**Files:**
- Create `src/components/BatchesPanel.jsx` and its test, `src/components/__tests__/BatchesPanel.test.jsx`.
- Modify `src/components/Dashboard.jsx` (`uid` prop) and `src/App.jsx` (pass `uid={user?.uid}`).

**Interface:** `<BatchesPanel uid />`. It lists batches (name, date, cards, value at add, net vs. paid) and opens `BatchReport` for a tapped row. It shows "No batches yet" when empty, and nothing at all without a `uid`.

- [ ] **Step 1: Failing tests:**

```jsx
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const m = vi.hoisted(() => ({ listBatches: vi.fn() }));
vi.mock('../../services/BatchService', () => ({ BatchService: { listBatches: m.listBatches } }));
vi.mock('../BatchReport', () => ({
  default: ({ batchId, onClose, onDeleted }) => (
    <div role="dialog" aria-label="Batch report">
      report {batchId}
      <button type="button" onClick={onClose}>close-mock</button>
      <button type="button" onClick={onDeleted}>delete-mock</button>
    </div>
  ),
}));

import BatchesPanel from '../BatchesPanel';

const LIST = [
  { id: 'b1', name: 'eBay SOR box', createdAt: Date.UTC(2026, 9, 5), closedAt: 1, pricePaid: 100, summary: { cards: 384, unique: 200, newUnique: 40, valueAtAdd: 120.5 } },
  { id: 'b0', name: 'Pre-release', createdAt: Date.UTC(2026, 9, 1), closedAt: 1, pricePaid: null, summary: { cards: 60, unique: 55, newUnique: 5, valueAtAdd: 30 } },
];

beforeEach(() => { vi.clearAllMocks(); m.listBatches.mockResolvedValue(LIST); });

describe('BatchesPanel', () => {
  it('lists batches with value and net vs paid', async () => {
    render(<BatchesPanel uid="u1" />);
    const row = await screen.findByRole('button', { name: /eBay SOR box/ });
    expect(row).toHaveTextContent('384 cards');
    expect(row).toHaveTextContent('$120.50');
    expect(row).toHaveTextContent('+$20.50');
    expect(screen.getByRole('button', { name: /Pre-release/ })).not.toHaveTextContent('+$');
  });

  it('opens a report and refreshes the list after a delete', async () => {
    render(<BatchesPanel uid="u1" />);
    fireEvent.click(await screen.findByRole('button', { name: /eBay SOR box/ }));
    expect(screen.getByRole('dialog', { name: 'Batch report' })).toHaveTextContent('report b1');
    fireEvent.click(screen.getByText('delete-mock'));
    expect(m.listBatches).toHaveBeenCalledTimes(2);
  });

  it('says when there are no batches, and renders nothing without a user', async () => {
    m.listBatches.mockResolvedValue([]);
    const { rerender } = render(<BatchesPanel uid="u1" />);
    expect(await screen.findByText('No batches yet')).toBeInTheDocument();
    rerender(<BatchesPanel uid={null} />);
    expect(screen.queryByText('No batches yet')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fail.**

- [ ] **Step 3: Implement:**
  - **`BatchesPanel`:**
    - All hooks first; then `if (!uid) return null;`.
    - A `useCallback` `load` → `BatchService.listBatches(uid)`, which sets an array (treat `{ error }` as `[]`).
    - `useEffect(load, [load])`, plus `open` state.
    - Each row is a `<button>` showing:
      - the name;
      - the date;
      - `${summary.cards} cards`;
      - `fmt(summary.valueAtAdd)`;
      - when `pricePaid` is a number, the net `summary.valueAtAdd - pricePaid`, formatted with `+` or `-`.
    - With `open` set, render `<BatchReport uid batchId={open} onClose={() => setOpen(null)} onDeleted={() => { setOpen(null); load(); }} />`.
    - A heading: **Batches**.
  - **`Dashboard`:** accept `uid` and render `<BatchesPanel uid={uid} />` after the stats cards.
  - **`App.jsx`:** pass `uid={user?.uid}` to `<Dashboard>`.

- [ ] **Step 4: Pass**, including `src/test/components/Dashboard.test.jsx` (no `uid` → nothing rendered). **Step 5: Commit** — gated, `feat(batches): batches list in the Command Center`.

---

### Task 8: Batch name and price paid in Review

**Files:** Modify `src/components/ScanReview.jsx`; test in `src/components/__tests__/ScanReview.test.jsx`.

**Interface:**
- New props: `batch`, `onBatchChange({ name?, pricePaid? })`.
- When `batch` is set, the header shows `<input aria-label="Batch name">` and `<input aria-label="Price paid" inputMode="decimal">`.
- The price input reports `pricePaid` as a number, or `null` when blank or invalid.

- [ ] **Step 1: Failing tests:**

```jsx
  it('edits the batch name and price paid', () => {
    const onBatchChange = vi.fn();
    renderReview(build([['a', LUKE]]), { batch: { id: 'b1', name: 'Batch Oct 5', pricePaid: null }, onBatchChange });
    expect(screen.getByLabelText('Batch name')).toHaveValue('Batch Oct 5');
    fireEvent.change(screen.getByLabelText('Batch name'), { target: { value: 'eBay SOR box' } });
    expect(onBatchChange).toHaveBeenLastCalledWith({ name: 'eBay SOR box' });
    fireEvent.change(screen.getByLabelText('Price paid'), { target: { value: '89.99' } });
    expect(onBatchChange).toHaveBeenLastCalledWith({ pricePaid: 89.99 });
    fireEvent.change(screen.getByLabelText('Price paid'), { target: { value: '' } });
    expect(onBatchChange).toHaveBeenLastCalledWith({ pricePaid: null });
  });

  it('shows no batch fields without a batch', () => {
    renderReview(build([['a', LUKE]]));
    expect(screen.queryByLabelText('Batch name')).not.toBeInTheDocument();
  });
```

  Add `fireEvent` to the testing-library import.

- [ ] **Step 2: Fail. Step 3: Implement.** Under the header row in `ScanReview`, when `batch` is set, add:

```jsx
      {batch && (
        <div className="flex gap-2 px-4 py-2 bg-gray-900 border-b border-gray-800">
          <input
            aria-label="Batch name"
            value={batch.name}
            onChange={(e) => onBatchChange({ name: e.target.value })}
            className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm"
          />
          <input
            aria-label="Price paid"
            inputMode="decimal"
            placeholder="Price paid"
            defaultValue={batch.pricePaid ?? ''}
            onChange={(e) => {
              const v = e.target.value.trim() === '' ? null : Number(e.target.value);
              onBatchChange({ pricePaid: Number.isFinite(v) && v >= 0 ? v : null });
            }}
            className="w-28 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm"
          />
        </div>
      )}
```

  Add `batch` and `onBatchChange = () => {}` to the props.

- [ ] **Step 4: Pass. Step 5: Commit** — gated, `feat(batches): name and price a batch in Review`.

---

### Task 9: `CardScanner`: create, append, close, show the report

**Files:** Modify `src/components/CardScanner.jsx`; test in `src/components/__tests__/CardScanner.test.jsx`.

**Interfaces:** Consumes Tasks 3–8. The scanner:
- calls `ensureBatch` on capture;
- passes `batch`/`onBatchChange` to Review;
- on commit, builds lines from `toWrites(draftSnapshot)` with `ScanService.cardDetails`, `PricingService.getBulkPrices` and `getCardQuantities`;
- appends the committed lines;
- closes the batch and shows the `BatchReport` when the draft empties.

- [ ] **Step 1: Failing tests.** Mock `BatchService` (`appendToBatch`, `closeBatch`), `PricingService.getBulkPrices` and `../BatchReport` (a dialog showing its `batchId`, with a `close-report` button calling `onClose`). Add `cardDetails` to the `ScanService` mock (`mocks.cardDetails`, default `{ type: 'Leader', rarity: 'Rare', aspects: ['Vigilance'], variant: 'Normal' }`), and default `getBulkPrices` → `{ SOR_012_std: { market: 4.5 } }`. Then add:

```jsx
  describe('batches', () => {
    it('appends the committed cards to the batch with details, prices and new-card flags', async () => {
      const user = userEvent.setup();
      mocks.commitDraft.mockImplementation(async (draft, ref, { onProgress }) => { onProgress({ rows: [] }); return { rows: [] }; });
      renderScanner({ collectionData: {} });
      pressSpace();
      await user.click(await screen.findByRole('button', { name: 'Review (1)' }));
      fireEvent.change(screen.getByLabelText('Batch name'), { target: { value: 'eBay SOR box' } });
      await user.click(screen.getByRole('button', { name: 'Add 1 card to collection' }));
      await waitFor(() => expect(batchMocks.appendToBatch).toHaveBeenCalled());
      const [uid, batch, lines] = batchMocks.appendToBatch.mock.calls[0];
      expect(uid).toBe('uid-1');
      expect(batch).toMatchObject({ name: 'eBay SOR box' });
      expect(lines).toEqual([{ id: 'SOR_012_std', set: 'SOR', number: '012', name: 'Luke Skywalker', type: 'Leader', rarity: 'Rare', aspects: ['Vigilance'], variant: 'Normal', isFoil: false, qty: 1, isNew: true, priceAtAdd: 4.5 }]);
    });

    it('closes the batch and shows its report when the batch empties', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      mocks.commitDraft.mockImplementation(async (draft, ref, { onProgress }) => { onProgress({ rows: [] }); return { rows: [] }; });
      renderScanner({ onClose });
      pressSpace();
      await user.click(await screen.findByRole('button', { name: 'Review (1)' }));
      await user.click(screen.getByRole('button', { name: 'Add 1 card to collection' }));
      expect(await screen.findByRole('dialog', { name: 'Batch report' })).toBeInTheDocument();
      expect(batchMocks.closeBatch).toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      await user.click(screen.getByText('close-report'));
      expect(onClose).toHaveBeenCalled();
    });

    it('keeps the cards added when the report cannot be updated', async () => {
      const user = userEvent.setup();
      batchMocks.appendToBatch.mockResolvedValue({ error: 'offline' });
      mocks.commitDraft.mockImplementation(async (draft) => ({ rows: draft.rows.filter((r) => r.status !== 'matched') }));
      renderScanner();
      pressSpace(); await flush();
      mocks.scan.mockResolvedValueOnce({ status: 'unidentified', reason: 'unreadable', read: null });
      pressSpace();
      await user.click(await screen.findByRole('button', { name: 'Review (2)' }));
      await user.click(screen.getByRole('button', { name: 'Add 1 card to collection' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/batch report couldn.t be updated/i);
      expect(mocks.commitDraft).toHaveBeenCalledTimes(1);
    });
  });
```

  The existing test `commits from review, saving progress as it goes, and closes when empty` changes: the scanner now shows the report first. Update it to click `close-report` before expecting `onClose`.

- [ ] **Step 2: Fail.**

- [ ] **Step 3: Implement** in `CardScanner.jsx`:
  - **Imports:**
    - `BatchService` from `../services/BatchService`; `PricingService` from `../services/PricingService`; `BatchReport` from `./BatchReport`;
    - `ensureBatch`, `setBatchName`, `setPricePaid` and `toWrites` from `../utils/scanDraft`.
  - **State:** `const [reportBatchId, setReportBatchId] = useState(null);`.
  - **`capture`:** replace `setDraft((d) => addCapture(d, { id, isFoil }))` with `setDraft((d) => addCapture(ensureBatch(d, Date.now(), newId()), { id, isFoil }))`.
  - **`commit`, before `commitDraft`:**

```jsx
    const batch = draft.batch;
    const writes = toWrites(draft);
    // Batch lines are built before the commit: "new" means not owned before it.
    const [details, prices] = await Promise.all([
      Promise.all(writes.map((w) => ScanService.cardDetails(w.set, w.number))),
      PricingService.getBulkPrices(writes.map((w) => ({ cardId: w.collectionId, set: w.set, number: w.number, isFoil: w.isFoil })))
        .catch(() => ({})),
    ]);
    const lines = writes.map((w, i) => ({
      id: w.collectionId, set: w.set, number: w.number, name: w.name,
      type: details[i]?.type ?? null, rarity: details[i]?.rarity ?? null,
      aspects: details[i]?.aspects ?? [], variant: details[i]?.variant ?? null,
      isFoil: w.isFoil, qty: w.qty,
      isNew: getCardQuantities(collectionRefData.current, w.set, w.number).total === 0,
      priceAtAdd: prices?.[w.collectionId]?.market ?? null,
      rowIds: w.rowIds,
    }));
```

  - **After `commitDraft` succeeds** (before the `live.rows.length === 0` check), using the `committed` ids gathered by `dropCommitted` (make it accumulate them into a `Set` declared alongside `snapshotIds`):

```jsx
      const done = lines.filter((l) => l.rowIds.every((rid) => committedIds.has(rid)));
      let reportFailed = false;
      if (batch && done.length) {
        const res = await BatchService.appendToBatch(uid, batch, done.map(({ rowIds, ...l }) => l));
        reportFailed = Boolean(res?.error);
      }
      if (!mountedRef.current) return;
      if (reportFailed) setCommitError("Cards added — the batch report couldn't be updated.");
      if (live.rows.length === 0) {
        clearDraft(getStorage(), uid);
        if (batch && !reportFailed) {
          await BatchService.closeBatch(uid, batch.id);
          if (mountedRef.current) setReportBatchId(batch.id);
          return;
        }
        onClose();
      }
```

    In that branch, replace the old `if (live.rows.length === 0) { clearDraft…; onClose(); }` block.
  - **Review:** pass `batch={draft.batch}` and `onBatchChange={({ name, pricePaid }) => setDraft((d) => (name !== undefined ? setBatchName(d, name) : setPricePaid(d, pricePaid)))}`.
  - **The report screen:** render it with an early return placed **after all hooks**, before the review-mode return:

```jsx
  if (reportBatchId) {
    return (
      <BatchReport
        uid={uid}
        batchId={reportBatchId}
        onClose={() => { setReportBatchId(null); onClose(); }}
        onDeleted={() => { setReportBatchId(null); onClose(); }}
      />
    );
  }
```

  - **`ScanReview`'s error line:** the commit-error paragraph already uses `role="alert"`, so the banner shows there.

- [ ] **Step 4: Run** `npx vitest run src/components/__tests__/CardScanner.test.jsx` until green, then the full gate and a build.

- [ ] **Step 5: Commit** — gated, `feat(batches): every Add feeds the batch report; a finished batch opens it`.

---

### Task 10: Docs

- [ ] Update `CLAUDE.md`. Add to the Card scanner section:
  - **Batches:** draft `batch` metadata (lazy; the default name is `Batch <Mon D>`).
  - **Storage:** the `users/{uid}/batches/{id}` record, appended on every Add, with the first `isNew`/price of each line kept.
  - **Report:** `batchReport.js` (pure), with value at add vs. now.
  - **Export:** `batchCsv.js`, and the print stylesheet for PDF.
  - **Where reports live:** the Command Center Batches list.

  Also add `batches` to the Firestore path listing.
- [ ] Update `TESTING.md` manual checks:
  - name a batch and add it in two goes, then check it's one report;
  - Save as PDF on the phone and desktop;
  - the CSV opens in Excel / Google Sheets.
- [ ] Commit — gated, `docs: scanner batches and reports`.
