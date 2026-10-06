# Surplus Report (phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Surplus mode in the Value report that lists cards beyond deck use and a playset, with a Show prices toggle and Copy as text, CSV and PDF sharing.

**Architecture:**
- **Pure model:** `src/utils/surplus.js` (deck usage, keep rules, surplus lines, trade text) turns value-report lines into surplus lines whose `qty` is the surplus, so the existing filters, summary and sort apply unchanged.
- **CSV:** `toCollectionCsv` gains `{ showPrices, mode }`.
- **Loader:** the loader optionally reads decks.
- **Report:** gains the mode switch, the price toggle and Copy as text. App passes `uid`.

**Tech Stack:** React 18, Vitest + Testing Library.

**Spec:** `SWU-Holocron/docs/superpowers/specs/2026-10-06-surplus-report-design.md`

## Global Constraints

- **Where to run things:** npm/npx from `SWU-Holocron/`; lint in Bash.
- **Gated commits:** run `npm run test:unit`, lint (stop on any output) and `npm run build`, then commit.
- **Commit trailer:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Unicode:** never put a literal U+FEFF in source; use the `\uFEFF` escape.
- **Keep rules:** a line counts as Normal standard when `!isFoil && (variant === 'Normal' || variant === 'Unknown')`. That printing keeps 3, or 1 for a `Leader` or `Base`. Every other line keeps 1.
- **Deck usage:** summed across decks (`cards`, `sideboard`, `leaderId`, `baseId`), with ids normalised to `SET_NNN` (numbers padded to 3).
- **Allocation:** standard copies first, then foil, within one `SET_NNN`.
- **Decks unreadable:** show no surplus at all.
- **localStorage keys:** `swu-value-mode` and `swu-value-show-prices`, with every access in try/catch.

## Review Focus

1. **A surplus computed without decks** would list deck cards for trade. (Task 4: `shows no surplus when decks cannot be read`.)
2. **Deck usage larger than what you own** must never give a negative surplus, and must not take copies from a different printing. (Task 1: `never goes negative, and deck use stays within its printing`.)
3. **Show prices off must remove every dollar amount**, on screen and in Copy as text and CSV. (Task 4: `hides every price when Show prices is off`; Task 2: `drops price columns when prices are hidden`.)
4. **Unpadded deck ids** (`TS26_1`) must match padded collection numbers. (Task 1: `matches unpadded deck ids`.)
5. **A blocked clipboard** must still let the user copy the list. (Task 4: `falls back to a selectable box when the clipboard is blocked`.)

---

### Task 1: `src/utils/surplus.js`

**Files:** Create `src/utils/surplus.js`; test in `src/test/utils/surplus.test.js`.

**Interfaces:**
- `deckUsage(decks) → { [SET_NNN]: number }`
- `keepFor(line) → number`
- `buildSurplusLines(lines, usage) → Line[]`. Each line is `{ ...line, owned, inDecks, kept, qty: surplus, value }` and only lines with a surplus above 0 are returned.
- `toTradeText(lines, { showPrices }) → string`

- [ ] **Step 1: Failing tests:**

```js
import { describe, it, expect } from 'vitest';
import { deckUsage, keepFor, buildSurplusLines, toTradeText } from '../../utils/surplus';

const L = (id, o = {}) => {
  const [set, number, finish] = id.split('_');
  return { id, set, number, name: 'Darth Vader', subtitle: 'Dark Lord', type: 'Unit', rarity: 'Rare', aspects: [], variant: 'Normal', isFoil: finish === 'foil', qty: 1, unitPrice: 2, priceIsFallback: false, value: 2, url: null, ...o };
};
const ids = (lines) => lines.map((l) => [l.id, l.qty]);

describe('deckUsage', () => {
  it('sums main deck, sideboard, leader and base across decks', () => {
    expect(deckUsage([
      { cards: { SOR_010: 2, SOR_050: 3 }, sideboard: { SOR_010: 1 }, leaderId: 'SOR_005', baseId: 'SOR_020' },
      { cards: { SOR_010: 3 }, leaderId: 'SOR_005' },
    ])).toEqual({ SOR_010: 6, SOR_050: 3, SOR_005: 2, SOR_020: 1 });
  });

  it('matches unpadded deck ids', () => {
    expect(deckUsage([{ cards: { TS26_1: 2 }, leaderId: 'TS26_10' }])).toEqual({ TS26_001: 2, TS26_010: 1 });
  });
});

describe('keepFor', () => {
  it('keeps a playset of the Normal standard printing and one of everything else', () => {
    expect(keepFor(L('SOR_010_std'))).toBe(3);
    expect(keepFor(L('SOR_010_std', { type: 'Leader' }))).toBe(1);
    expect(keepFor(L('SOR_020_std', { type: 'Base' }))).toBe(1);
    expect(keepFor(L('SOR_010_foil'))).toBe(1);
    expect(keepFor(L('SOR_300_std', { variant: 'Hyperspace' }))).toBe(1);
    expect(keepFor(L('SOR_059F_foil', { variant: 'Foil' }))).toBe(1);
    expect(keepFor(L('SHD_001_std', { variant: 'Unknown', type: 'Unknown' }))).toBe(3);
  });
});

describe('buildSurplusLines', () => {
  it('works the design examples', () => {
    // Own Normal x5, Normal foil x2, Hyperspace x1; no decks.
    const own = [L('SOR_010_std', { qty: 5 }), L('SOR_010_foil', { qty: 2 }), L('SOR_300_std', { qty: 1, variant: 'Hyperspace' })];
    expect(ids(buildSurplusLines(own, {}))).toEqual([['SOR_010_std', 2], ['SOR_010_foil', 1]]);
    // x5 with 2 in decks: none. x6: one.
    expect(buildSurplusLines([L('SOR_010_std', { qty: 5 })], { SOR_010: 2 })).toEqual([]);
    expect(ids(buildSurplusLines([L('SOR_010_std', { qty: 6 })], { SOR_010: 2 }))).toEqual([['SOR_010_std', 1]]);
  });

  it('takes deck copies from standard first, then foil', () => {
    const own = [L('SOR_010_std', { qty: 1 }), L('SOR_010_foil', { qty: 3 })];
    // 2 in decks: std 1 used, foil 1 used -> foil 2 left, keep 1 -> 1 surplus.
    expect(buildSurplusLines(own, { SOR_010: 2 })).toEqual([
      expect.objectContaining({ id: 'SOR_010_foil', owned: 3, inDecks: 1, kept: 1, qty: 1, value: 2 }),
    ]);
  });

  it('never goes negative, and deck use stays within its printing', () => {
    const own = [L('SOR_010_std', { qty: 2 }), L('SOR_300_std', { qty: 4, variant: 'Hyperspace' })];
    // 9 of SOR_010 in decks: more than owned; the Hyperspace printing is untouched.
    expect(ids(buildSurplusLines(own, { SOR_010: 9 }))).toEqual([['SOR_300_std', 3]]);
  });

  it('keeps one leader and leaves unpriced surplus unpriced', () => {
    const out = buildSurplusLines([L('SOR_005_std', { qty: 3, type: 'Leader', unitPrice: null, value: null })], {});
    expect(out).toEqual([expect.objectContaining({ qty: 2, kept: 1, value: null })]);
  });

  it('ignores deck cards nobody owns', () => {
    expect(buildSurplusLines([], { SOR_010: 3 })).toEqual([]);
  });
});

describe('toTradeText', () => {
  const lines = [
    L('SOR_010_foil', { qty: 1, unitPrice: 6 }),
    L('SOR_005_std', { qty: 2, name: 'Luke Skywalker', subtitle: 'Faithful Friend', unitPrice: null }),
  ];

  it('lists the cards by set and number, with a total', () => {
    expect(toTradeText(lines, { showPrices: false })).toBe([
      '2× Luke Skywalker, Faithful Friend (SOR 005)',
      '1× Darth Vader, Dark Lord (SOR 010) — Foil',
      'Total: 3 cards',
    ].join('\n'));
  });

  it('adds prices when shown', () => {
    expect(toTradeText(lines, { showPrices: true })).toBe([
      '2× Luke Skywalker, Faithful Friend (SOR 005)',
      '1× Darth Vader, Dark Lord (SOR 010) — Foil — $6.00 ea',
      'Total: 3 cards · ~$6.00',
    ].join('\n'));
  });
});
```

  Arithmetic check:
  - **Design example:** std 5 keeps 3, surplus 2. Foil 2 keeps 1, surplus 1. Hyperspace 1 keeps 1, surplus 0.
  - **Standard-first allocation:** std 1 has 1 used and 0 left. Foil 3 has 1 used, 2 left, keeps 1, surplus 1, value 1 × 2 = 2.
  - **More in decks than owned:** SOR_010 std 2 with 9 in decks is all used, surplus 0. Hyperspace 4 keeps 1, surplus 3.
  - **Leader:** 3 owned keeps 1, surplus 2.
  - **Trade text total:** 2 + 1 = 3 cards. The value only counts priced cards: 6 × 1 = 6.

- [ ] **Step 2: Fail. Step 3: Implement:**

```js
/**
 * Surplus: copies owned beyond what decks use and a playset kept back.
 * A playset is 3 of a card's Normal printing in standard (1 for a leader or
 * base) and 1 of every other printing or finish. Deck usage is summed across
 * all decks; a deck card takes its printing's standard copies, then foil.
 * Pure. Lines are value-report lines; a surplus line's qty is the surplus.
 */
const cents = (v) => Math.round(v * 100) / 100;
const padNumber = (n) => (/^\d+$/.test(String(n)) ? String(n).padStart(3, '0') : String(n));
const printingId = (id) => {
  const i = String(id ?? '').lastIndexOf('_');
  return i > 0 ? `${id.slice(0, i)}_${padNumber(id.slice(i + 1))}` : null;
};

export function deckUsage(decks) {
  const usage = {};
  const add = (id, n) => {
    const key = printingId(id);
    if (key && n > 0) usage[key] = (usage[key] ?? 0) + n;
  };
  for (const deck of decks ?? []) {
    for (const [id, n] of Object.entries(deck.cards ?? {})) add(id, Number(n) || 0);
    for (const [id, n] of Object.entries(deck.sideboard ?? {})) add(id, Number(n) || 0);
    if (deck.leaderId) add(deck.leaderId, 1);
    if (deck.baseId) add(deck.baseId, 1);
  }
  return usage;
}

const isPlaysetPrinting = (l) => !l.isFoil && (l.variant === 'Normal' || l.variant === 'Unknown');

export function keepFor(line) {
  if (!isPlaysetPrinting(line)) return 1;
  return line.type === 'Leader' || line.type === 'Base' ? 1 : 3;
}

export function buildSurplusLines(lines, usage) {
  const remaining = { ...usage };
  // Standard before foil within a printing.
  const ordered = [...lines].sort((a, b) => Number(a.isFoil) - Number(b.isFoil));
  const out = [];
  for (const l of ordered) {
    const key = `${l.set}_${l.number}`;
    const inDecks = Math.min(l.qty, remaining[key] ?? 0);
    if (inDecks) remaining[key] -= inDecks;
    const kept = Math.min(keepFor(l), l.qty - inDecks);
    const surplus = l.qty - inDecks - kept;
    if (surplus <= 0) continue;
    out.push({
      ...l, owned: l.qty, inDecks, kept, qty: surplus,
      value: l.unitPrice === null ? null : cents(l.unitPrice * surplus),
    });
  }
  // Back to the order they came in.
  return lines.map((l) => out.find((s) => s.id === l.id)).filter(Boolean);
}

export function toTradeText(lines, { showPrices }) {
  const sorted = [...lines].sort((a, b) => a.set.localeCompare(b.set) || a.number.localeCompare(b.number, undefined, { numeric: true }) || Number(a.isFoil) - Number(b.isFoil));
  const out = sorted.map((l) => {
    const price = showPrices && l.unitPrice !== null ? ` — $${l.unitPrice.toFixed(2)} ea` : '';
    return `${l.qty}× ${l.name}${l.subtitle ? `, ${l.subtitle}` : ''} (${l.set} ${l.number})${l.isFoil ? ' — Foil' : ''}${price}`;
  });
  const cards = lines.reduce((s, l) => s + l.qty, 0);
  const priced = lines.filter((l) => l.unitPrice !== null);
  const value = cents(priced.reduce((s, l) => s + l.unitPrice * l.qty, 0));
  out.push(`Total: ${cards} cards${showPrices && priced.length ? ` · ~$${value.toFixed(2)}` : ''}`);
  return out.join('\n');
}
```

  The design example expects `[['SOR_010_std', 2], ['SOR_010_foil', 1]]` in input order, which the final re-map preserves.

- [ ] **Step 4: Pass. Step 5: Commit** — `feat(surplus): surplus model`.

---

### Task 2: CSV options

**Files:** Modify `src/utils/collectionValue.js` (`toCollectionCsv`) and its test.

**Interface:** `toCollectionCsv(lines, summary, filters, { showPrices = true, mode = 'all' } = {})`:
- **`showPrices` false:** omit the Unit price, Value and Price note columns, and the `Total value` and `Priced share` rows.
- **`mode` surplus:** insert Owned, In decks and Kept before Qty, and name the Qty column `Surplus`. Add a `Mode,Surplus` summary row.

- [ ] **Step 1: Failing tests** (append):

```js
describe('toCollectionCsv options', () => {
  it('drops price columns when prices are hidden', () => {
    const rows = toCollectionCsv(lines, summarize(lines), DEFAULT_FILTERS, { showPrices: false }).split('\r\n');
    expect(rows[0]).toBe('\uFEFFSet,Number,Name,Subtitle,Type,Rarity,Aspects,Variant,Finish,Qty');
    expect(rows.some((r) => r.startsWith('Total value'))).toBe(false);
    expect(rows.some((r) => r.startsWith('Priced share'))).toBe(false);
    expect(rows.join('\n')).not.toMatch(/\$|40\.00/);
  });

  it('adds the surplus columns in surplus mode', () => {
    const surplus = [{ ...lines.find((l) => l.id === 'SOR_050_std'), owned: 10, inDecks: 2, kept: 3, qty: 5 }];
    const rows = toCollectionCsv(surplus, summarize(surplus), DEFAULT_FILTERS, { mode: 'surplus' }).split('\r\n');
    expect(rows[0]).toBe('\uFEFFSet,Number,Name,Subtitle,Type,Rarity,Aspects,Variant,Finish,Owned,In decks,Kept,Surplus,Unit price,Value,Price note');
    expect(rows[1]).toBe('SOR,050,Battle Droid,,Unit,Common,,Normal,Standard,10,2,3,5,0.05,0.25,');
    expect(rows).toContain('Mode,Surplus');
  });
});
```

  The test summarises `surplus`, so its line value must be recomputed. Build the fixture as `{ ..., qty: 5, value: 0.25 }`, because `buildCollectionLines` would otherwise carry the 10-copy value (0.5). Add `value: 0.25` to the fixture above.

- [ ] **Step 2: Fail. Step 3: Implement.** Build the header and each row from a column list:

```js
export function toCollectionCsv(lines, summary, filters, { showPrices = true, mode = 'all' } = {}) {
  const surplusMode = mode === 'surplus';
  const cols = [
    ['Set', (l) => l.set], ['Number', (l) => l.number], ['Name', (l) => l.name], ['Subtitle', (l) => l.subtitle],
    ['Type', (l) => l.type], ['Rarity', (l) => l.rarity], ['Aspects', (l) => l.aspects.join('/')], ['Variant', (l) => l.variant],
    ['Finish', (l) => (l.isFoil ? 'Foil' : 'Standard')],
    ...(surplusMode ? [['Owned', (l) => l.owned], ['In decks', (l) => l.inDecks], ['Kept', (l) => l.kept]] : []),
    [surplusMode ? 'Surplus' : 'Qty', (l) => l.qty],
    ...(showPrices ? [
      ['Unit price', (l) => money(l.unitPrice)], ['Value', (l) => money(l.value)],
      ['Price note', (l) => (l.unitPrice === null ? 'no price data' : l.priceIsFallback ? 'from other finish' : '')],
    ] : []),
  ];
  const out = [row(cols.map(([h]) => h))];
  for (const l of sortLines(lines, 'set', 'asc')) out.push(row(cols.map(([, get]) => get(l))));
  out.push('');
  if (surplusMode) out.push(row(['Mode', 'Surplus']));
  if (showPrices) out.push(row(['Total value', money(summary.value)]));
  out.push(row(['Cards', summary.cards]));
  out.push(row(['Unique cards', summary.unique]));
  if (showPrices) out.push(row(['Priced share', `${Math.round(summary.pricedShare * 100)}%`]));
  out.push(row(['Filters', describeFilters(filters)]));
  return `\uFEFF${out.join('\r\n')}`;
}
```

  Write `\uFEFF` as the six-character escape, never the raw character.

- [ ] **Step 4: Pass** (the old CSV test must still pass unchanged). **Step 5: Commit** — `feat(surplus): CSV options for prices and surplus mode`.

---

### Task 3: Loader reads decks

**Files:** Modify `src/services/collectionValueLoader.js` and its test.

**Interface:** `loadCollectionValue(collectionData, { …, uid, includeDecks = false, decksService = DeckService })` adds `decks: Deck[]`, or `decksError: true` if listing throws.

- [ ] **Step 1: Failing tests:**

```js
  it('reads decks when asked', async () => {
    const decksService = { listDecks: vi.fn(async () => [{ cards: { SOR_010: 2 } }]) };
    const res = await loadCollectionValue(COLLECTION, { uid: 'u1', includeDecks: true, decksService, loadSetImpl: async () => ({ cards: [] }), pricing: { getBulkPrices: async () => ({}) } });
    expect(decksService.listDecks).toHaveBeenCalledWith('u1');
    expect(res.decks).toEqual([{ cards: { SOR_010: 2 } }]);
  });

  it('flags decks it could not read', async () => {
    const res = await loadCollectionValue(COLLECTION, { uid: 'u1', includeDecks: true, decksService: { listDecks: async () => { throw new Error('denied'); } }, loadSetImpl: async () => ({ cards: [] }), pricing: { getBulkPrices: async () => ({}) } });
    expect(res.decksError).toBe(true);
    expect(res.decks).toBeUndefined();
  });
```

- [ ] **Step 2: Fail. Step 3: Implement.** `import { DeckService } from './DeckService'`. After the prices step:

```js
  let decks;
  let decksError;
  if (includeDecks) {
    try {
      decks = await decksService.listDecks(uid);
    } catch {
      decksError = true;
    }
  }
```

  Add `...(decks ? { decks } : {}), ...(decksError ? { decksError } : {})` to the return.

- [ ] **Step 4: Pass. Step 5: Commit** — `feat(surplus): load decks for the surplus report`.

---

### Task 4: Report: mode, Show prices, Copy as text

**Files:**
- Modify `src/components/CollectionValueReport.jsx` and its test.
- Modify `src/App.jsx`: pass `uid={user?.uid}` to `<CollectionValueReport>`.

**Behaviour:**
- **Props:** `uid` is added. Loading calls `load(collectionData, { uid, includeDecks: true })` once on mount. The decks are always loaded; they're small, and switching modes is then instant.
- **Mode:** state `mode` (`'all' | 'surplus'`), read from and written to `swu-value-mode`.
  - **Buttons:** two, **All cards** and **Surplus**, with `aria-pressed`.
  - **Title:** "Collection value" or "Surplus / trade list".
  - **Base lines:** `all` uses `allLines`. `surplus` uses `data.decksError ? [] : buildSurplusLines(allLines, deckUsage(data.decks ?? []))`.
  - **Filters:** filter options come from the mode's base lines.
- **Show prices:** a toggle button, **Show prices**, with `aria-pressed`. It's read from and written to `swu-value-show-prices` and defaults to `true`. When it's false, the report hides:
  - the totals' Value tile (and the priced share);
  - breakdown values;
  - unit price and value in list rows;
  - the Min price filter and the Price select (they're meaningless without prices);
  - the otherFinish and unpriced notes.

  Exports pass `{ showPrices, mode }`.
- **Surplus rows:** under the name, `Surplus {qty} · own {owned} · decks {inDecks} · keep {kept}`.
- **Surplus totals:** labelled "Surplus cards", "Unique" and, with prices on, "Surplus value".
- **Messages:**
  - `decksError` in surplus mode: "Couldn't read your decks, so surplus can't be worked out." (`role="alert"`).
  - No lines in surplus mode: "No surplus — everything you own is in a deck or part of a playset."
- **Copy as text:** `navigator.clipboard.writeText(toTradeText(filteredLines, { showPrices }))`.
  - On success: "Copied N cards" (`role="status"`).
  - If the clipboard is missing or the write rejects: a `<textarea readOnly aria-label="Trade list">` with the text, plus "Select and copy".
- **CSV filename:** `surplus-yyyy-mm-dd.csv` in surplus mode.

- [ ] **Step 1: Failing tests** (append; `load` now receives the options, and the mocks return `decks`):

```jsx
describe('Surplus mode', () => {
  const S = (id, o) => L(id, { qty: 1, unitPrice: 2, value: 2, ...o });
  const OWN = [S('SOR_010_std', { name: 'Darth Vader', qty: 6, value: 12 }), S('SOR_005_std', { name: 'Luke', type: 'Leader', qty: 3, value: 6 })];
  const loadWith = (extra) => vi.fn(async () => ({ lines: OWN, missingSets: [], decks: [{ cards: { SOR_010: 2 } }], ...extra }));

  const openSurplus = async (load) => {
    render(<CollectionValueReport uid="u1" collectionData={{}} onClose={vi.fn()} load={load} />);
    await screen.findByTestId('total-value');
    fireEvent.click(screen.getByRole('button', { name: 'Surplus' }));
  };

  it('lists the surplus with how it was worked out, and reads the decks', async () => {
    const load = loadWith();
    await openSurplus(load);
    expect(load).toHaveBeenCalledWith({}, { uid: 'u1', includeDecks: true });
    expect(screen.getByRole('heading', { name: 'Surplus / trade list' })).toBeInTheDocument();
    // Vader 6 - 2 in decks - 3 kept = 1; Luke (leader) 3 - 1 kept = 2.
    expect(screen.getByTestId('total-cards')).toHaveTextContent('3');
    expect(screen.getByText('Surplus 1 · own 6 · decks 2 · keep 3')).toBeInTheDocument();
    expect(screen.getByText('Surplus 2 · own 3 · decks 0 · keep 1')).toBeInTheDocument();
    expect(localStorage.setItem).toHaveBeenCalledWith('swu-value-mode', 'surplus');
  });

  it('shows no surplus when decks cannot be read', async () => {
    await openSurplus(loadWith({ decks: undefined, decksError: true }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Couldn.t read your decks/);
    expect(screen.getByTestId('total-cards')).toHaveTextContent('0');
  });

  it('says when there is no surplus', async () => {
    await openSurplus(vi.fn(async () => ({ lines: [S('SOR_010_std', { qty: 3 })], missingSets: [], decks: [] })));
    expect(screen.getByText(/No surplus — everything you own/)).toBeInTheDocument();
  });

  it('hides every price when Show prices is off', async () => {
    await openSurplus(loadWith());
    fireEvent.click(screen.getByRole('button', { name: 'Show prices' }));
    expect(screen.getByRole('button', { name: 'Show prices' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('total-value')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\$\d/);
    expect(localStorage.setItem).toHaveBeenCalledWith('swu-value-show-prices', '0');
  });

  it('copies the trade list as text', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await openSurplus(loadWith());
    fireEvent.click(screen.getByRole('button', { name: 'Copy as text' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toMatch(/^2× Luke \(SOR 005\)/);
    expect(writeText.mock.calls[0][0]).toMatch(/Total: 3 cards/);
    expect(await screen.findByRole('status')).toHaveTextContent('Copied 3 cards');
  });

  it('falls back to a selectable box when the clipboard is blocked', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } });
    await openSurplus(loadWith());
    fireEvent.click(screen.getByRole('button', { name: 'Copy as text' }));
    expect(await screen.findByLabelText('Trade list')).toHaveValue(expect.stringContaining('1× Darth Vader'));
  });
});
```

  The `L()` helper in the existing test file sets `subtitle: null`, so the trade text reads `2× Luke (SOR 005)`. `SOR_005_std` sorts before `SOR_010`. The total is 3 cards.

  Also update the existing tests' `render(<CollectionValueReport … />)` calls: `uid` is optional, so those keep working unchanged.

- [ ] **Step 2: Fail. Step 3: Implement.** Keep hooks before any conditional return. Derive `baseLines` with `useMemo` from mode and data, then `options`, `lines`, `summary` and `sorted` from `baseLines`. **Step 4: Pass**, plus the `BinderValue.test.jsx` app test. **Step 5: Commit** — `feat(surplus): surplus mode, Show prices and Copy as text in the value report`.

---

### Task 5: Docs, full gate and build

- [ ] **`CLAUDE.md`:** extend the Collection value note with Surplus mode:
  - the keep rules and deck-usage sum (`src/utils/surplus.js`);
  - no surplus when decks can't be read;
  - Show prices;
  - Copy as text.

  Add `swu-value-mode` and `swu-value-show-prices` to the localStorage keys.
- [ ] **`TESTING.md`:**
  - check a known card's surplus by hand;
  - copy the list into a chat;
  - export a PDF and a CSV with prices off and confirm no dollar amounts.
- [ ] **Gate and commit** — `docs: surplus report`.
