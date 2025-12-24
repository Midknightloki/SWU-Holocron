# SWU Community Deck Sources & Meta Research

## 1. Top Deck List Sources

### A. SWUDB (swudb.com)
**Status:** The most popular and comprehensive community site.
**Data Provided:** Deck lists, card database, collection manager, community ratings, card prices.

**API & Scraping Feasibility:**
- **API:** Has a developer/API section (`swudb.com/developers`). This is the standard for community data integration.
- **Exports:** Decks can be easily exported in text/JSON formats directly from the UI.
- **Recommendation:** This is the primary candidate for scraping or API integration to build a "meta list".

### B. Garbage Rollers (garbagerollers.com)
**Status:** Premier content site for meta analysis and articles.
**Data Provided:** "Meta Snapshots", tier lists, tournament reports, qualitative analysis.

**API & Scraping Feasibility:**
- **API:** No public API known.
- **Scraping:** Content is article-based. Good for parsing "Tier Lists" manually or via text analysis, but less structured than a database like SWUDB.
- **Use Case:** Use this to determine *which* decks are "Meta" (Tier 1/2), then fetch the actual lists from SWUDB.

### C. Star Wars Unlimited DB (sw-unlimited-db.com)
**Status:** Alternative database.
**Notes:** Less stable and less widely used than SWUDB.
**Recommendation:** Secondary source only if SWUDB is unavailable.

---

## 2. Meta List Compilation Strategy

To compile a "Meta List" of decks, the recommended approach is:

1.  **Identify the Meta:**
    - Scrape/Parse **Garbage Rollers** Meta Snapshots to get the names/archetypes of the current top decks (e.g., "Boba Green", "Sabine Aggro").

2.  **Fetch the Lists:**
    - Use **SWUDB** (API or Search) to find high-rated or tournament-winning deck lists matching those archetypes.
    - SWUDB often has a "Hot Decks" or "Tournament Results" section which can be directly queried.

3.  **Data Structure:**
    - Map the qualitative "Tier" from Garbage Rollers to the concrete "Deck List" from SWUDB.
