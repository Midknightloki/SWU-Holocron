# Market Reports and Saved Reports/Lists — Design (phase 2a)

**Date:** 2026-10-06
**Status:** Draft, awaiting review
**Builds on:** `2026-10-06-collection-value-design.md`, `2026-10-06-surplus-report-design.md`

## Goal

One place to manage what you have and what you want. Two lists get posted
side by side in a Discord trade channel: a **trade list** ("here is what I
can trade") and a **wants list** ("here is what I'm looking for"). Batches
move into the same place. Public links come in phase 2b (its own short spec).

## Decisions

| Question | Decision |
|---|---|
| Value report | Renamed **Market reports**; entry moves from the binder to a Command Center button (binder Value button removed). All cards / Surplus modes unchanged |
| New feature | **Saved reports/lists** — a Command Center button opening a full-screen page with tabs **Batches · Trade lists · Wants lists** |
| Batches | Move from the Command Center into the Batches tab; behaviour unchanged |
| Prebuilt decks | Stay in the Command Center |
| List model | Named lists of specific cards, kind `trade` or `wants`, stored privately per user |
| Trade lists | Created from Market reports → Surplus: **Save as trade list** snapshots the filtered view (new list, or replace an existing one) |
| Wants lists | Filled three ways: **Fill gaps in my collection** (missing titles, or up to a playset — the Command Center's unique-title logic), **from a deck** (deck builder Shop tab), **add by search** |
| Wants finish | Defaults to "any finish"; per line can be set to Standard or Foil |
| Every list | Rename, edit quantity, remove, note per card; Copy as text, CSV, PDF; Show prices (today's market) |
| Sharing | Phase 2b: per-list public links at `/list/<code>` |

## Architecture

### 1. Data: `artifacts/{APP_ID}/users/{uid}/lists/{listId}`

The existing user-subcollection rule already covers this path.

```js
{ kind: 'trade' | 'wants', name, createdAt, updatedAt,
  items: { [key]: { set, number, name, subtitle, finish: 'standard' | 'foil' | 'any', qty, note? } },
  source?: { type: 'surplus' | 'gaps' | 'deck', label } }   // where it came from, for the list's subtitle
```

- `key` is `SET_NNN_${finish}`, with `number` padded to 3.
- **Trade items** always have a concrete finish (they come from collection lines).
- **Wants items** default to `any`.

### 2. Pure model: `src/utils/cardLists.js`

- `itemsFromSurplus(lines)`: surplus lines become trade items, with `qty` set to the surplus and `finish` taken from `isFoil`.
- `itemsFromGaps(cardsBySet, collectionData, { sets, mode: 'missing' | 'playset' })`:
  - for each set, it groups cards by unique title (name and subtitle) and counts owned copies across every printing and finish, exactly as `statsCalculator.calculateStats` does;
  - **`missing`:** one item (qty 1) for each title with nothing owned;
  - **`playset`:** a title whose owned count is below `getPlaysetQuantity(type)` gets the difference;
  - the representative card is the title's base printing (lowest number), with finish `any`.
- `itemsFromDeckGaps(gapCards)`: from the Shop tab's `gapCards` (`{ cardId, needed, owned, gap, card }`), with finish `any`.
- `mergeItems(existing, incoming, { replace })`: replace overwrites; otherwise quantities add up.
- `listLines(list, pricesById)`: lines for display and export, priced at market. A wants line with finish `any` takes the standard price, falling back to foil.
- `toListText(list, lines, { showPrices })`: like `toTradeText`, with a heading: "Trade list: <name>" or "Wants: <name>".
- `toListCsv(...)`.

### 3. Service: `src/services/ListService.js`

- **Methods:** `listLists(uid)`, `getList(uid, id)`, `createList(uid, { kind, name, items, source })`, `updateList(uid, id, patch)`, `deleteList(uid, id)`.
- They never throw; they return `{ error }`.
- `updateList` stamps `updatedAt`.

### 4. UI

**Command Center** (`Dashboard.jsx`):
- two buttons, **Market reports** and **Saved reports/lists**, near the top;
- `BatchesPanel` is removed from here.

**Market reports** (`CollectionValueReport.jsx`):
- the title is "Market reports", with Collection value / Surplus as the subheading;
- in Surplus mode, **Save as trade list** opens a small dialog with a new list name, or picks an existing trade list to replace.

**Saved reports/lists** (`SavedListsPage.jsx`, a full-screen overlay):
- **Tabs:** Batches (the existing `BatchesPanel`), Trade lists, Wants lists.
- **List tabs:**
  - show the user's lists of that kind (name, source, card count, updated date, and value with prices on);
  - **New wants list**, which offers **Fill gaps in my collection** (set picker and missing/playset choice) or **Empty**;
  - tapping a list opens `ListView`.
- **`ListView`:**
  - the name (editable);
  - rows with − / + quantity buttons, a finish selector on wants lines, a note, and remove;
  - **Add card** (wants lists): a search box using `CardPickerModal`;
  - **Show prices**, **Copy as text**, **Download CSV**, **Save as PDF** (`#batch-report` print id), **Delete list**.

**Deck builder Shop tab** (`ShoppingList.jsx`):
- **Save as wants list** creates a list named "Wants: <deck name>" from `gapCards`, or adds to an existing wants list.
- It needs `uid`, threaded in from DeckBuilder.

### 5. Binder

The **Value** button is removed. Market reports now opens from the Command Center.

## Error handling

| Case | Behaviour |
|---|---|
| List save fails | Inline error; the dialog stays open, nothing lost |
| Card data for a picked set won't load (gaps) | That set is skipped and named ("Couldn't load SHD") |
| Gaps produce nothing | "No gaps in the chosen sets — you own every title" |
| Prices unavailable | List shows without values (same rules as Market reports: never $0) |
| Clipboard blocked | Selectable text box, as in Market reports |

## Testing

- **`cardLists.test.js`:**
  - **Surplus to items:** finish taken from `isFoil`, qty set to the surplus.
  - **Gaps in `missing` mode:** titles with no copies of any printing get 1. Owning only a Hyperspace copy means the title isn't missing.
  - **Gaps in `playset` mode:** each title gets its shortfall; leaders and bases cap at 1.
  - **Deck gaps.**
  - **Merging:** add vs replace.
  - **Pricing an `any` finish:** standard first, then foil.
  - **Text:** with and without prices, plus the headings.
- **`ListService.test.js`:** create, list, update (with `updatedAt`), delete; errors returned.
- **`SavedListsPage.test.jsx`:**
  - the tabs, with the Batches tab rendering `BatchesPanel`;
  - creating a wants list from gaps;
  - opening, editing and deleting a list;
  - copying, the CSV, and the price toggle.
- **`CollectionValueReport`:** **Save as trade list** creates a list from the filtered surplus; replace mode.
- **`ShoppingList`:** **Save as wants list**.
- **`Dashboard`:** the two buttons open their pages, and `BatchesPanel` no longer renders there.
- **Binder:** no Value button.
- **Manual:**
  - make a trade list from Surplus and a wants list from gaps in one set;
  - copy both into Discord;
  - save a deck's Shop gaps as a wants list.

## Out of scope (2a)

- Public links (phase 2b).
- Matching your wants against a friend's trade list.
- Price alerts.
- Condition and grading.
- Multiple users editing one list.
