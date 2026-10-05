# Prebuilt Decks — Design

**Date:** 2026-10-05
**Status:** Draft, awaiting review

## Goal

Add a prebuilt product (Spotlight deck, starter deck, Twin Suns deck, Intro
Battle preset) to a collection in one tap, without scanning it or typing it
in. New precons should arrive by themselves. The admin's only job is a short
review, plus a one-time backfill of older products.

## What the research found

| Source | Products | Deck contents |
|---|---|---|
| Official site, swu-db, swuapi | — | none structured |
| TCGplayer via tcgcsv (already used for prices) | every precon product, with image and release date | none |
| **sw-unlimited-db.com deck API** | — | **exact printings** |

Details of the sw-unlimited-db deck API:
- **Deck contents:** `GET https://sw-unlimited-db.com/umbraco/api/deckapi/get?id={id}` returns `{ metadata: { name }, leader: { id: 'ASH_015', count }, base: {…}, deck: [{ id: 'SEC_185', count }] }`.
  - `id` is `SET_NNN` for the standard printing.
  - Karabast and other open-source clients import decks through it.
  - It sends `Access-Control-Allow-Origin: *`, so a browser can call it directly.
- **Deck listing:** `POST https://sw-unlimited-db.com/api/proxy/api/decks/query` with `{ userId, take, page, status: 1, cards: [] }` lists a user's published decks (`id`, `name`, `createdDate`, `updatedDate`, `typeId`). It has no CORS header, so only the sync calls it.
- **Who publishes precons:** the site owner (user **3671**) publishes precons as they release: both ASH Spotlights, both Intro Battle: Hoth presets, and all four Twin Suns 2026 decks. They also publish a few personal decks.
- **Gaps:** older products (the SOR, SHD and TWI starters; the JTL, LOF and SEC Spotlights) are not in that account.

Prebuilt decks always contain the **standard printing** of every card (no foil,
Hyperspace or Showcase variants), so a deck maps to `SET_NNN_std` collection
ids directly.

## Decisions

| Question | Decision |
|---|---|
| Deck source | sw-unlimited-db deck API, polled weekly for user 3671's published decks |
| Products | TCGplayer precon products from tcgcsv supply name, image and release date |
| New decks | Arrive as **review**; an admin publishes, links them to a product, or marks them "not a precon" |
| Backfill / fallback | Admin pastes a sw-unlimited-db deck link; the browser fetches it |
| Collector action | One tap adds a deck (or every deck in a product) as a finished batch, with a report |
| Printing | Always standard (`_std`) |

## Architecture

### 1. Data: `artifacts/{APP_ID}/public/data/prebuiltDecks/{sourceId}`

The document id is the sw-unlimited-db deck id. The path has 6 segments, so it
is a document path.

```js
{
  sourceId: 151901, sourceName: 'Emperor Palpatine (ASH)', sourceUpdatedAt: '2026-07-23T08:22:33Z',
  typeId: 1,                                 // 1 standard, 2 Twin Suns (from the source)
  leaders: ['ASH_015'], base: 'ASH_021',
  cards: [{ id: 'ASH_118', qty: 1 }, …],     // leaders, base and deck, merged
  status: 'review' | 'published' | 'ignored' | 'changed',
  issues: [{ id: 'XYZ_001', problem: 'unknown-card' }],
  product: { tcgplayerProductId, name, imageUrl, releasedOn } | null,
  suggestedProduct: { … } | null,
  name: 'Emperor Palpatine Spotlight Deck',  // display name, editable
  fetchedAt, publishedAt, publishedBy,
}
```

Rules:
- `allow read: if isSignedIn()`.
- `allow write: if isAdmin()`.
- The sync writes through the Admin SDK.
- Emulator tests go in `src/test/rules/` (CI deploys rules on push).

### 2. Weekly sync: `scripts/prebuiltDecks.js`, a new step in `cardDbSync.js` after prices

1. Query user 3671's published decks (paged, `take` 100).
2. For each one, act on its state:
   - **Not stored yet:** fetch its contents, check every printing exists in `cardDatabase` (missing ones go in `issues`), suggest a product, and store it as `review`.
   - **Stored, and the source's `updatedDate` is newer:** re-fetch it and set the status to `changed`. Keep the published contents until an admin accepts the new ones.
   - **`ignored`:** skip it.
3. **Product suggestion:**
   - Candidates are TCGplayer products whose name matches a precon pattern (`Spotlight Deck:`, `Starter`, `Twin Suns`, `Intro Battle`), excluding bundles (`Display`, `Pair`, `Case`, `Box`).
   - Score each candidate: the set code in parentheses in the deck name matches the product's group, and the leader's name appears in the product name.
   - Keep the best score above a threshold, or none.
4. **Failure is non-fatal:** the step reports `degraded` and never fails the card sync.
5. **Politeness:** one query per page, plus one fetch per new or changed deck, with a 1 s gap between requests and an identifying User-Agent.

### 3. Admin: a **Prebuilt decks** tab in `AdminPanel.jsx`

- **Order:** a list grouped by status. **Review** and **Changed** come first.
- **Each deck shows:**
  - its leader and base;
  - its card count, which should be 50 (+1 leader, +1 base), or the Twin Suns size for `typeId` 2;
  - its issues;
  - the suggested product, with a product picker (searchable precon products) to change it.
- **Actions:**
  - **Publish** sets the status to `published`, along with the product and the editable display name.
  - **Not a precon** sets the status to `ignored`.
  - **Accept changes**, for a `changed` deck.
  - **Unpublish**.
- **Add from link:** paste `https://sw-unlimited-db.com/decks/{id}` (any user). The browser fetches it through the deck API, checks the printings and stores it as `review`. This covers the backfill and any deck the account misses.
- Admin writes go through a new `PrebuiltDeckService` (never throws; returns `{ error }`).

### 4. Collectors: a **Prebuilt decks** panel in the Command Center

- **The list:** published decks, grouped by product, with the product image and name. Searchable by name or leader.
- **Add to collection:** on a deck, or **Add all** on a product with several decks. It asks for an optional price paid. Then:
  - It increments `SET_NNN_std` for every card, as one additive write batch (as the scanner does, chunked at 400).
  - It records a batch named after the product, through `BatchService` (`appendToBatch`, then `closeBatch`). Lines carry details from `ScanService.cardDetails` and prices from `PricingService.getBulkPrices`, and `isNew` comes from the collection before the write.
  - It opens `BatchReport`.
- **Owned decks:** a deck the user already added shows "Added <date>". Adding it again is allowed, because people buy duplicates; a confirmation asks first.

## Error handling

| Case | Behaviour |
|---|---|
| sw-unlimited-db down or changed | Sync step degraded; published decks unaffected; admin can still add from link once it's back |
| Card missing from our DB | Listed under the deck's issues; Publish asks for confirmation first, and that card is skipped when the deck is added (the report says which) |
| Source deck edited after publishing | Status `changed`; collectors keep the published list until accepted |
| Collection write fails | Same as scanner: nothing recorded in the batch for unwritten chunks; error shown, retry safe |
| Batch report write fails | Cards stay added; banner, as in the scanner |
| Personal deck from the owner | Admin marks "Not a precon" once; sync skips it after that |

## Testing

- **`prebuiltDecks` (sync, pure parts):**
  - parse the deck API response;
  - merge the leader, base and deck;
  - detect new, changed and ignored decks;
  - score product suggestions (ASH Palpatine matches the ASH Spotlight, and a Display product is never suggested);
  - degrade on fetch failure.
- **`PrebuiltDeckService`:** parse a link, add from link (mocked fetch), publish, ignore, accept changes, list published.
- **Rules tests:** signed-in read; admin-only write.
- **`PrebuiltDecksPanel`:**
  - list grouped by product;
  - search;
  - Add writes increments for every card, `_std`;
  - batch recorded and report shown;
  - "Added" badge and the duplicate confirmation.
- **Admin tab:** review list order; publish with a product; not a precon; add from link; issues shown.
- **Manual:**
  - run the sync with `workflow_dispatch` and check the 2026 decks appear for review;
  - backfill one older Spotlight from a link;
  - add a deck on the phone and check the counts and report.

## Out of scope

- Scraping community articles.
- Booster or display contents.
- Foil or variant precons (they don't exist).
- Decks from users other than 3671, except those added by link.
