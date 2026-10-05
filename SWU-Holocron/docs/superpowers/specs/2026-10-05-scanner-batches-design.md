# Scanner Batches and Reports — Design

**Date:** 2026-10-05
**Status:** Draft, awaiting review
**Builds on:** `2026-10-04-scanner-pipeline-design.md`

## Goal

After scanning a box, see whether it was worth the money: what came out of it,
what it is worth, which cards were new to the collection, and how that
compares with what was paid. Name each batch (e.g. "eBay SOR booster box",
"Homeworlds Pre-release"), keep the reports, and export them (CSV for
spreadsheets, PDF for keeping).

## Decisions

| Question | Decision |
|---|---|
| Batch lifecycle | Named any time. Each Add appends to the batch's saved record; the batch closes when nothing is left in it (option A) |
| Default name | `Batch <Mon D>` (e.g. "Batch Oct 5"), editable in Review |
| Price paid | Optional, entered in Review; enables value-vs-paid |
| Value | Market price **at the time each card was added** (stored), plus **current** value computed when a report is opened |
| Unpriced cards | Listed as "no price data", never counted as $0 |
| Storage | Firestore `artifacts/{APP_ID}/users/{uid}/batches/{batchId}` (already allowed by the user-subcollection rule) |
| Where reports live | Opens automatically when a batch closes; Command Center gets a **Batches** list |
| Exports | CSV download; PDF via a print-friendly layout and the browser's Print → Save as PDF (no new library) |

## Architecture

### 1. Batch metadata on the draft (`scanDraft.js`)

The draft gains `batch: { id, name, pricePaid, createdAt }`. It is created
lazily on the first capture and persisted with the rows. `loadDraft` keeps it,
and a new batch starts once the draft empties after its batch closed.

- `ensureBatch(draft, now)`
- `setBatchName(draft, name)`
- `setPricePaid(draft, amount | null)`

### 2. Batch record (`src/services/BatchService.js`)

The Firestore document:

```js
{
  name, createdAt, updatedAt, closedAt: null | ms, pricePaid: null | number,
  cards: {
    [collectionId]: { set, number, name, type, rarity, aspects: [], variant,
                      isFoil, qty, isNew, priceAtAdd: number | null },
  },
  summary: { cards, unique, newUnique, valueAtAdd },   // for the list view
}
```

About 200 B per card line, so a full box is about 80 KB, well inside
Firestore's 1 MB document limit.

- `appendToBatch(uid, batch, lines)`: a transaction that creates the doc if it
  is missing.
  - It adds each line's `qty` to an existing line, keeping that line's first
    `isNew`/`priceAtAdd`.
  - It updates `name`/`pricePaid` from the draft, recomputes `summary`, and
    sets `updatedAt`.
- `closeBatch(uid, id)`, `listBatches(uid)` (newest first, summaries only),
  `getBatch(uid, id)`, `renameBatch(uid, id, name)`,
  `setBatchPricePaid(uid, id, amount)`, `deleteBatch(uid, id)`.
- Never throws: it returns `{ error }`. Deleting a report never touches the
  collection.

### 3. Lines for a commit

- **Card details:** `ScanService.cardDetails(set, number)` returns
  `{ type, rarity, aspects, variant }` from the per-session set cache already
  used for recognition. Unknown details stay null.
- **Prices:** `PricingService.getBulkPrices` gives the market price per
  collection id and finish, read before the commit. The `market` field is
  used; `isFallback` prices (the other finish) are kept but flagged.
- **`isNew`:** the card is not owned in any finish *before* this commit, from
  `getCardQuantities(collectionData)`.

### 4. Report (`src/utils/batchReport.js`, pure)

`buildReport(batch, currentPrices = {})` returns:

```js
{ name, createdAt, closedAt, pricePaid,
  cards, unique, newUnique, newCards: [...],
  valueAtAdd, valueNow, unpriced: [...],
  net: valueAtAdd - pricePaid | null, multiple: valueAtAdd / pricePaid | null,
  byRarity: [{ key, count, value }], byType: [...], byAspect: [...], byVariant: [...],
  topPulls: [10 lines by priceAtAdd × 1, ties by name] }
```

- Aspects count a dual-aspect card in both.
- Every value is rounded to cents.

### 5. CSV (`src/utils/batchCsv.js`, pure)

`toBatchCsv(report)` produces:
- a header row, then one row per card line: Set, Number, Name, Type, Rarity,
  Aspects, Variant, Foil, Qty, New, Price at add, Value at add, Price now;
- a blank row, then summary rows.

Fields containing commas or quotes are quoted, with doubled `""`, to the same
round-trip standard as `csvParser.js`. Downloaded as
`<name>-<yyyy-mm-dd>.csv` through a Blob link.

### 6. UI

- **Review header:** an editable batch name, and a "Price paid" field
  (currency input, blank allowed).
- **Commit:**
  - After a successful Add, append the committed lines to the batch.
  - If the append fails, show "Cards added — the batch report couldn't be
    updated". The collection is unaffected.
  - When the draft empties, close the batch and show its report before the
    scanner closes.
- **`BatchReport.jsx`:**
  - A full-screen report with the totals, a value-vs-paid strip,
    breakdown tables, top pulls, new cards and unpriced cards.
  - Buttons: **Download CSV**, **Save as PDF** (`window.print()`),
    **Rename**, **Delete**, **Close**.
  - Current prices are fetched on open, with "Value now" shown once loaded.
- **Print:** `#batch-report` is the only visible element in `@media print`,
  in a white, ink-friendly layout.
- **`BatchesPanel.jsx`** in the Command Center (Dashboard):
  - the list of batches (name, date, cards, value at add, net vs paid);
  - tap → `BatchReport`;
  - shows "No batches yet" when empty.

## Error handling

| Case | Behaviour |
|---|---|
| Append fails (offline, rules) | Collection commit stands; banner says the report wasn't updated |
| Price data missing for a set | Lines priced null → "no price data" |
| Report opened offline | Value now shows "unavailable"; at-add values still shown |
| Batch doc missing when listing | Skipped |
| Very large batch | ~80 KB per box; a warning if `cards` exceeds 3,000 lines (still well under 1 MB) |

## Testing

- `batchReport.test.js`:
  - totals;
  - new uniques;
  - value at add and now;
  - unpriced cards excluded from values and listed;
  - net/multiple with and without a price paid;
  - each breakdown (a dual aspect counted in both);
  - top pulls order;
  - variants.
- `batchCsv.test.js`: header, quoting of commas and quotes, summary rows,
  blanks for null prices.
- `BatchService.test.js` (mocked Firestore):
  - create on first append;
  - qty merging keeps the first `isNew`/price;
  - summary recomputed;
  - close, list, rename, delete;
  - errors returned, never thrown.
- `scanDraft.test.js`: batch metadata created lazily, persisted, renamed,
  priced, and reset after close.
- `CardScanner.test.jsx`:
  - a commit appends lines with details, prices and `isNew`;
  - an append failure shows the banner;
  - an emptied batch closes and shows the report.
- `BatchReport.test.jsx` and `BatchesPanel.test.jsx`: rendering, CSV
  download triggered, print called, rename/delete.
- **Manual:** the print layout and Save as PDF on the phone and desktop; CSV
  opens in Excel / Google Sheets.

## Out of scope

- Charts, editing card lines inside a report, sharing reports publicly,
  multi-currency.
