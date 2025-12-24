# Implementation Plan: Deck Data Collection & Meta Analysis Service

**Goal:** Create an automated service to periodically collect decklists from community sources (primarily SWUDB), store them in Firestore, and analyze them to identify popular Leader/Base combinations and common "meta shells".

**Context:** This service runs on Firebase Cloud Functions. It is designed to be autonomous, respecting API rate limits and ensuring data consistency with the internal "Holocron" card database.

---

## 1. Architecture & Data Flow

1.  **Ingestion (Daily):**
    *   **Trigger:** Scheduled Cloud Function (`every 24 hours`).
    *   **Source:** SWUDB API (or other configured sources).
    *   **Process:** Fetch recent decks -> Normalize Data -> Store in Firestore (`imported_decks`).
2.  **Analysis (Weekly/On-Demand):**
    *   **Trigger:** Scheduled Cloud Function (`every Monday`) or HTTP Trigger.
    *   **Source:** Firestore (`imported_decks`).
    *   **Process:** Group by Archetype -> Calculate Card Frequency -> Generate "Shells" -> Store in Firestore (`meta_snapshots`).

---

## 2. Firestore Schema Design

### Collection: `imported_decks`
Stores raw, normalized deck data.
*   **Document ID:** `{source}_{externalId}` (e.g., `swudb_HkLmnOpQ`) - Ensures idempotency.
*   **Fields:**
    *   `source`: `string` (e.g., "swudb")
    *   `externalId`: `string` (original ID from source)
    *   `name`: `string` (Deck Name)
    *   `author`: `string`
    *   `dateImported`: `Timestamp`
    *   `dateCreated`: `Timestamp` (Original creation date)
    *   `leader`: `{ set: string, number: string, id: string }` (Normalized)
    *   `base`: `{ set: string, number: string, id: string }` (Normalized)
    *   `mainDeck`: `Array<{ set: string, number: string, count: number }>`
    *   `sideboard`: `Array<{ set: string, number: string, count: number }>`
    *   `tags`: `Array<string>` (e.g., "tournament", "casual")

### Collection: `meta_snapshots`
Stores aggregated analysis results.
*   **Document ID:** `snapshot_{startDate}_{endDate}`
*   **Fields:**
    *   `periodStart`: `Timestamp`
    *   `periodEnd`: `Timestamp`
    *   `totalDecksAnalyzed`: `number`
    *   `archetypes`: `Array<ArchetypeStats>`

**Type `ArchetypeStats`:**
```typescript
{
  leader: { set: string, number: string },
  base: { set: string, number: string },
  deckCount: number,
  sharePercentage: number, // (deckCount / totalDecksAnalyzed) * 100
  coreShell: Array<{ set: string, number: string, inclusionRate: number }>, // Cards in >80% of decks
  flexSlots: Array<{ set: string, number: string, inclusionRate: number }>  // Cards in 40-80% of decks
}
```

---

## 3. Implementation Steps

### Phase 1: Environment & Clients

1.  **Setup Cloud Functions:**
    *   Location: `functions/src/`
    *   Dependencies: `axios` (HTTP requests), `dayjs` (Date handling).
    *   Ensure `firebase-admin` is initialized.

2.  **Implement `SWUDBClient`:**
    *   **File:** `functions/src/clients/SWUDBClient.js`
    *   **Responsibility:** Interface with SWUDB.
    *   **Endpoints:** Research `swudb.com/developers` or inspect network traffic. Likely endpoints for "Recent Decks" or "Tournament Decks".
    *   **Rate Limiting:** Implement a simple delay (e.g., 1s) between requests if paging is needed.

3.  **Implement `CardNormalizer`:**
    *   **File:** `functions/src/utils/CardNormalizer.js`
    *   **Responsibility:** Convert external card representations to Holocron format.
    *   **Logic:** Map `Set Code` + `Card Number` (e.g., "SOR" + "010") to internal IDs.
    *   **Fallback:** If a card cannot be mapped, log a warning but persist the raw Set/Number.

### Phase 2: Ingestion Service

4.  **Create `ingestDecks` Function:**
    *   **File:** `functions/src/scheduled/ingestDecks.js`
    *   **Trigger:** `pubsub.schedule('every 24 hours')`
    *   **Logic:**
        1.  Fetch last 50-100 decks from `SWUDBClient`.
        2.  Filter out decks older than 24h (or since last run).
        3.  Loop through decks:
            *   Normalize Leader, Base, and Cards.
            *   Write to `imported_decks` using `set({ ... }, { merge: true })`.
        4.  Log success/failure counts.

### Phase 3: Analysis Service

5.  **Implement `DeckAnalyzer`:**
    *   **File:** `functions/src/analysis/DeckAnalyzer.js`
    *   **Logic:**
        *   Input: Array of deck objects.
        *   Step 1: Group by `Leader` + `Base`.
        *   Step 2: For each group:
            *   Count total decks in group.
            *   Iterate all cards in all decks of this group.
            *   Count frequency of each card.
            *   Calculate `inclusionRate` (Frequency / GroupTotal).
            *   Categorize:
                *   **Core:** Rate >= 0.80
                *   **Flex:** 0.40 <= Rate < 0.80
        *   Output: `ArchetypeStats` object.

6.  **Create `generateMetaSnapshot` Function:**
    *   **File:** `functions/src/scheduled/generateMetaSnapshot.js`
    *   **Trigger:** `pubsub.schedule('every monday 09:00')`
    *   **Logic:**
        1.  Query `imported_decks` where `dateImported` > (Now - 7 days).
        2.  Run `DeckAnalyzer`.
        3.  Save result to `meta_snapshots`.

---

## 4. Technical Considerations

*   **Data Mapping is Critical:** SWUDB might use "SOR" for Spark of Rebellion, while we might use "SWU01". Verify the set codes in `src/constants.js` or the database seed files.
*   **Error Handling:** If the external API is down, the function should fail gracefully and retry on the next scheduled run.
*   **Cost Management:**
    *   Firestore Reads: The Analysis step reads *all* decks from the week. If volume grows (e.g., >10k decks/week), switch to an incremental aggregation approach (updating a running counter daily).
    *   For now (MVP), reading ~1000 docs once a week is negligible.

## 5. Future Expansion
*   **Win Rates:** If sources provide match results, add `winRate` to `ArchetypeStats`.
*   **Price Tracking:** Integrate with a pricing API to calculate "Average Deck Cost".
