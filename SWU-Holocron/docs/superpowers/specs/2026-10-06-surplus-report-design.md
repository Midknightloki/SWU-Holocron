# Surplus Report — Design (phase 1)

**Date:** 2026-10-06
**Status:** Draft, awaiting review
**Builds on:** `2026-10-06-collection-value-design.md`

## Goal

Show the cards you own beyond what your decks use and a playset, with their
rough value, as a trade list to share with friends or a manifest to bring to a
local game store. Phase 2 (later, its own spec) adds a public shareable link.

## Decisions

| Question | Decision |
|---|---|
| Deck usage | **Sum across all decks** — main deck, sideboard, leader and base (answer A) |
| What a playset keeps | Per printing and finish (answer A): Normal printing **standard** keeps 3 (Leader/Base 1); every other printing or finish — Normal foil, Hyperspace, Hyperspace Foil, Showcase, F-numbered foils — keeps 1 |
| Which copies decks use | A deck card (`SET_NNN`) takes that printing's standard copies first, then its foil copies |
| Surplus | owned − in decks − kept, never below 0 |
| Where | An **All cards / Surplus** mode in the Value report (no new binder button) |
| Prices | **Show prices** toggle (remembered per device); off hides every dollar amount on screen and in exports |
| Sharing (phase 1) | Copy as text, Download CSV, Save as PDF — all follow filters, mode and price toggle |
| Decks unreadable | No surplus shown — a surplus that ignores decks would list deck cards for trade |

## Architecture

### 1. Pure model: `src/utils/surplus.js`

`deckUsage(decks) → { [SET_NNN]: count }`:
- It sums `cards` and `sideboard` maps plus `leaderId` and `baseId` (1 each) over every deck.
- Ids are normalised to `SET` plus the number padded to 3, so `TS26_1` and `TS26_001` agree.

`isPlaysetPrinting(line)`: true when `!line.isFoil` and the variant is `Normal`. An `Unknown` variant counts as Normal, so a card whose details didn't load keeps 3. F-numbered foils (`059F`, variant `Foil`) are never Normal.

`keepFor(line)`:
- a playset printing keeps 3, or 1 when its type is `Leader` or `Base`;
- anything else keeps 1.

`buildSurplusLines(lines, usage)` works on value-report lines (`buildCollectionLines`). For each printing (`SET_NNN`) it allocates `usage[id]` to the standard line first, then the foil line. Each line then gets:

```js
{ ...line, owned: line.qty, inDecks, kept, qty: surplus,
  value: unitPrice === null ? null : cents(unitPrice * surplus) }
```

- Lines with `surplus > 0` are kept; `qty` becomes the surplus, so every existing filter, summary, breakdown and sort applies unchanged.
- **Deck cards nobody owns** are ignored; the report is about surplus, not shortages.

`toTradeText(lines, { showPrices }) → string`:
- one line per card, sorted by set, then number;
- format: `${qty}× ${name}${subtitle ? ', ' + subtitle : ''} (${set} ${number})${isFoil ? ' — Foil' : ''}${showPrices && unitPrice !== null ? ' — $x.xx ea' : ''}`;
- a last line `Total: N cards`, followed by ` · ~$X` when prices are shown and any are priced.

`toCollectionCsv` (from the value report) gains an options argument `{ showPrices, mode }`:
- **Prices hidden:** the Unit price, Value and Price note columns, and the value summary rows, are omitted.
- **Surplus mode:** adds Owned, In decks and Kept columns before Qty, which reads "Surplus".

### 2. Loading

`loadCollectionValue` gains `{ uid, includeDecks }`. With `includeDecks`, it also returns `decks` from `DeckService.listDecks(uid)`, or `decksError: true` if that throws. The decks are read once, when Surplus mode is first chosen.

### 3. Report changes: `CollectionValueReport.jsx`

- **Mode switch:** an **All cards / Surplus** segmented control under the title (`aria-pressed`), remembered in `swu-value-mode`.
- **Surplus mode:**
  - lines = `buildSurplusLines(allLines, deckUsage(decks))`;
  - totals are Surplus cards, Unique, and Surplus value;
  - list rows show `Surplus N · own X · decks Y · keep Z`.
  - If `decksError`, it shows "Couldn't read your decks, so surplus can't be worked out." and no lines.
  - With no surplus: "No surplus — everything you own is in a deck or part of a playset."
- **Show prices:** a toggle (`aria-pressed`), remembered in `swu-value-show-prices`, default on. When off:
  - no value, unit price or breakdown values on screen;
  - no priced-share line;
  - exports without prices.
- **Copy as text:** a new button that copies to the clipboard with `navigator.clipboard.writeText`, then shows "Copied N cards". If the clipboard is unavailable, it shows the text in a selectable box instead.
- **Title:** "Collection value" or "Surplus / trade list", following the mode.
- **Props:** the report takes `uid`, and App passes `uid={user?.uid}`.

## Error handling

| Case | Behaviour |
|---|---|
| Decks can't be read | Surplus mode shows the message, no lines (never a surplus that ignores decks) |
| A deck uses more copies than owned | That printing contributes no surplus; nothing negative |
| Card details missing | Treated as Normal standard (keep 3); listed with stored name |
| Clipboard blocked | Text shown in a selectable box with "Select and copy" |
| Prices hidden | No dollar amount anywhere on screen or in exports |

## Testing

- **`surplus.test.js`:**
  - deck usage summed across decks, including sideboard, leader and base, and with unpadded ids;
  - keep rules: Normal std 3, leader/base 1, foil 1, Hyperspace 1, F-numbered 1, Unknown counts as Normal;
  - allocation: standard first, then foil;
  - surplus is never negative;
  - unowned deck cards are ignored;
  - the worked examples from the design: Vader 5/2 → 2 + 1; 5 owned with 2 in decks → 0; 6 owned → 1;
  - trade text, with and without prices.
- **CSV:** prices hidden drops the price columns and rows; Surplus mode adds Owned, In decks and Kept.
- **Loader:** decks loaded with `includeDecks`; `decksError` when listing throws.
- **Report:**
  - mode switch and its persistence;
  - Surplus totals and row details;
  - the decks-error and no-surplus messages;
  - Show prices hides values on screen;
  - Copy as text writes the clipboard, and falls back to a box;
  - exports follow mode and prices.
- **Manual:**
  - check the surplus against a known card;
  - copy the list into a chat;
  - print a PDF with prices off.

## Out of scope (phase 1)

- The public trade link (phase 2).
- Wishlists or "wants".
- Matching against a friend's list.
- Condition and grading.
- Per-deck exclusions, such as ignoring an unbuilt deck.
