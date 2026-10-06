# Collection Value Report and Card Prices — Design

**Date:** 2026-10-06
**Status:** Draft, awaiting review

## Goal

See what the collection is worth, sliced however the user wants, from today's
market prices, so it covers every card however it was added (scanned,
imported, typed or from a prebuilt deck). Also see the market price of any
single card in its detail view.

## Decisions

| Question | Decision |
|---|---|
| Price source | Today's TCGplayer market price from the weekly price sync (`PricingService`, per-set `priceMetadata` docs) |
| Entry point | **Value** button in the binder's top row, beside My Collection |
| Default scope | Whole collection |
| Filters | Set, Rarity, Type, Aspect, Printing, Finish, price status / minimum unit price, name search; multi-select; chips with Clear all |
| Drill-down | Tapping a breakdown row adds it as a filter |
| Card list | Every matching card line, sortable by value, quantity, name or set |
| Unpriced | Listed, never counted as $0; the report shows the priced share |
| Other-finish prices | Used and flagged, as in batch reports |
| Exports | CSV and Save as PDF of the filtered view |
| Persistence | Last filters remembered per device (`swu-value-filters`) |
| Card detail | Standard and foil market price with TCGplayer links, plus the value of the user's copies |

## Architecture

### 1. Pure model: `src/utils/collectionValue.js`

`buildCollectionLines(collectionData, cardsBySet, pricesById)` returns one line per owned collection doc, skipping zero quantities:

```js
{ id: 'SOR_010_foil', set, number, name, subtitle, type, rarity, aspects, variant,
  isFoil, qty, unitPrice: number|null, priceIsFallback, value: number|null, url }
```

- `cardsBySet` is `{ [set]: card[] }`. Card details come from it; a card missing from it keeps the name stored on the collection doc, and `Unknown` for the rest.
- `pricesById` is the `getBulkPrices` result, so `unitPrice = market`.

`applyFilters(lines, filters)`:

```js
filters = { sets: [], rarities: [], types: [], aspects: [], variants: [],
            finish: 'all' | 'standard' | 'foil',
            price: 'all' | 'priced' | 'unpriced', minPrice: number|null, search: '' }
```

- Each empty list means no filter on that field.
- **Aspects:** a card matches if any of its aspects is selected. "Neutral" matches a card with no aspects.
- **`minPrice`:** compares against `unitPrice`. Unpriced lines are excluded when `minPrice` is set.
- **`search`:** matches the name and subtitle, ignoring case.

`summarize(lines)` returns:

```js
{ cards, unique, value, pricedShare,   // share of copies with a price, 0..1
  bySet, byRarity, byType, byAspect, byVariant, byFinish,   // [{ key, count, value }], value desc
  unpriced: lines[], otherFinish: lines[] }
```

- It reuses the breakdown logic from `batchReport.js`, extracted there into a shared `breakdown()` helper.
- **Dual-aspect cards** count in each of their aspects.
- **"Unique"** counts distinct `set_number`.

`sortLines(lines, by: 'value' | 'qty' | 'name' | 'set', dir)`: unpriced lines sort last when sorting by value.

`toCollectionCsv(lines, summary, filters)` covers:
- **Header:** Set, Number, Name, Subtitle, Type, Rarity, Aspects, Variant, Finish, Qty, Unit price, Value, Price note.
- **Summary rows:** after the card rows, including the active filters.
- **Format:** a UTF-8 byte-order mark, quoted the same way as `batchCsv.js`.

### 2. Loading: `src/services/collectionValueLoader.js`

`loadCollectionValue(collectionData) → { lines, missingSets: string[] }`:
- **Card data:** set codes come from the collection's keys. Each set loads through `loadSet` (the IndexedDB cache, then the server). A set that fails to load lands in `missingSets` and its lines keep their stored names.
- **Prices:** `PricingService.getBulkPrices` for every owned id, read once per set (the service already caches set price docs).
- **Errors:** it never throws. Total failure returns empty lines with an error.

### 3. Report: `src/components/CollectionValueReport.jsx`

A full-screen overlay, portalled to `<body>` with the `#batch-report` print id reused, so Save as PDF prints only the report. From top to bottom:
1. **Title, close button and exports:** CSV, Save as PDF.
2. **Filter bar:**
   - multi-select pickers for Set, Rarity, Type, Aspect and Printing (each a dropdown of checkboxes; options come from the loaded lines, with counts);
   - Finish and Price segmented controls;
   - a minimum-price input and a name search.
3. **Active filter chips** (removable) and **Clear all**.
4. **Totals:**
   - **Value**, with "x% of copies priced" under it;
   - Cards and Unique;
   - Standard vs Foil value.
5. **Breakdowns:**
   - **Tables:** By set, rarity, type, aspect and printing (count and value).
   - **Drill-down:** each row is a button that adds its key to the matching filter.
6. **Card list:** sort control (value, quantity, name, set). It shows 100 rows, then **Show more**; exports always include every row.
7. **Notes:** "Priced from the other finish" and "No price data" lists, collapsed.

**Filters persist** in `localStorage['swu-value-filters']`, wrapped in try/catch; a bad stored value falls back to the defaults.

**Loading:** "Loading prices for N sets…" while data loads. `missingSets` shows as a note: "Couldn't load card details for X; their cards show without rarity or type."

### 4. Binder entry

- A **Value** button (a dollar icon) in the binder's first row, beside **★ My Collection**.
- It opens the report for the signed-in user's `collectionData`.
- It is hidden when the collection is empty.

### 5. Card detail prices: `CardModal.jsx`

A **Market price** row under the card details:
- **Standard: $x.xx** and **Foil: $y.yy**, each linking to its TCGplayer page (`url`) in a new tab.
- **A missing finish** shows the other finish's price with "(from foil)" or "(from standard)" when that is all there is, or **No price data**.
- **Your copies** (when owned): `3 + 2F = $37.50`, using each finish's price. The total is marked approximate when any copy is unpriced.

The data comes from `PricingService.getCardPrice(set, number, false/true)`, loaded when the card changes, never blocking the modal. "Loading…" shows while it waits, and "Price unavailable" on error.

## Error handling

| Case | Behaviour |
|---|---|
| Set has no price doc (27 of 51 today) | Its cards are unpriced; listed; the priced share drops |
| Card data for a set won't load | Lines keep stored names; breakdown keys "Unknown"; note shown |
| Prices fail entirely | Report shows cards with no values and says prices are unavailable |
| Huge collection | Model is linear; list renders 100 rows at a time |
| Stored filters reference a set no longer owned | Ignored silently |

## Testing

- **`collectionValue.test.js`:**
  - line building (details, the stored-name fallback, zero quantities skipped);
  - each filter, alone and combined;
  - aspect matching, including Neutral;
  - `minPrice` excluding unpriced lines;
  - totals and the priced share;
  - each breakdown;
  - sort order, with unpriced lines last;
  - CSV quoting, the byte-order mark and the filter summary.
- **`collectionValueLoader.test.js`:** sets loaded once each, a failed set lands in `missingSets`, prices are requested for every owned id, and it never throws.
- **`CollectionValueReport.test.jsx`:**
  - filters change the totals and the list;
  - chips are removed one at a time, and Clear all resets them;
  - a breakdown tap adds a filter;
  - sort, and Show more;
  - CSV and print are called;
  - filters persist across mounts;
  - the loading, error and missing-sets notes.
- **`CardModal.test.jsx`:** both prices with links, an other-finish fallback, No price data, the value of owned copies, and an error state.
- **Binder:** the Value button opens the report; it is hidden for an empty collection.
- **Manual:**
  - open Value on the phone;
  - slice by set and rarity;
  - drill down from a breakdown;
  - export a CSV and a PDF;
  - check a card's market price against TCGplayer.

## Out of scope

- Price history or trends, and alerts.
- Grading or condition.
- Prices for sets the weekly price sync doesn't cover.
- Editing prices by hand.
