# Polish Round — Design

**Date:** 2026-10-07
**Status:** Draft, awaiting review
**Builds on:** `2026-10-06-saved-lists-design.md`, `2026-10-06-public-lists-design.md`

## Goal

Six improvements queued after phase 2:

1. **Imports become batches.** A CSV import is recorded as a batch with a report, just like a scanned box.
2. **Discord-friendly copied text.**
3. **The public list page reads well on a phone.**
4. **Fewer writes while editing a list, and an honest "prices as of" date.**
5. **Shared decks get the same field and size checks as shared lists.**
6. **A guest can upgrade to Google without losing their collection.**

## Decisions

| Question | Decision |
|---|---|
| Import mode | **Ask each time**: **Add these cards** (adds, like scanning) or **Replace quantities** (today's behaviour, for restoring a full export) |
| What an import batch holds | **Add:** every imported card. **Replace:** the cards whose quantity went **up**, by how much; quantities that went down are listed separately in the report |
| Guest → Google | Upgrade in place (same uid, everything kept). If that Google account already has a collection, the guest's cards are **added into it** and recorded as a batch named "Guest collection" |
| Discord limit | Copy as text splits lists over Discord's 2000-character message limit into parts: **Copy part 1 of 3**, … |
| Markdown | Characters Discord treats as formatting (`* _ ~ \|` and backquote) are escaped in copied text |

## 1. Imports as batches

**Flow.** Choosing a CSV no longer imports straight away. An **Import cards** dialog opens and shows:
- the file name, the number of cards found and any skipped rows;
- **How to import:**
  - *Add these cards* — "adds to what you own, like scanning; for a purchase or a trade";
  - *Replace quantities* — "sets each card to the number in the file; for restoring a full export";
- **Batch name**, defaulting to "Import <file name>", and an optional **Price paid**;
- an **Import** button.

When the import finishes, its batch report opens, exactly as **Finish batch** opens a scan report. The browser `alert()` pop-ups in the import path are replaced by messages inside the dialog.

**Model.** `src/services/importBatch.js` provides `importToCollection({ uid, collectionRef, collectionData, items, mode, name, pricePaid })`.
- **Add:** commits through `ScanService.commitDraft`, which adds quantities in chunks of 400. Batch lines are the imported quantities.
- **Replace:** writes each card's quantity, chunked at 400, as the import does today.
  - Batch lines are the positive differences from the collection as it was before the import.
  - Quantities that went down are stored on the batch as `reductions: [{ id, name, set, number, isFoil, from, to }]`.
- **Batch lines** carry type, rarity, aspects and printing (via `ScanService.cardDetails`), today's price and `isNew`, exactly as prebuilt decks do. The batch is closed as soon as it is written, and records `source: { type: 'import', mode, file }`.
- **No change at all** (a replace where every quantity already matches): no batch is created, and the dialog says "Nothing changed — your collection already matches this file."
- **Signed-in users only.** The legacy sync-code path has no uid to file a batch under, so it imports as before with no report.
- **The report** (`BatchReport`) gains a "Quantities lowered" section when `reductions` is present. It is listed, never valued.

## 2. Discord-friendly copied text

In `src/utils/discordText.js`:
- `escapeDiscord(text)` puts a backslash before each of `* _ ~ |` and the backquote.
- `splitForDiscord(text, limit = 2000)` splits on line boundaries, so each part stays under the limit.
  - The heading line is repeated on each part with " (part 2 of 3)" added.
  - The total line goes on the last part.

The three Copy as text buttons (list view, public page, Market reports) use these. A list that fits copies in one tap, as now. A longer one shows **Copy part 1 of N**, which advances to the next part after each successful copy, with a "Copied part 1 of 3" status. CSV and PDF are unchanged.

## 3. Public page on a phone

- **Notes and names** wrap: long notes and URLs use `break-words`, and the full card name shows on two lines rather than being cut off.
- **Quantity** column width fits up to `×999`.
- **Leaders and bases** use a landscape thumbnail, matching the binder's horizontal cards.
- **"Price from the other finish"** marker: lines priced from the other finish carry `priceIsFallback` into the public copy and show "↺".
- **Copy as text** follows section 2.

## 4. Fewer writes, honest dates

- **Debounced saves.** `ListView` waits 800 ms after the last edit before saving the list. A burst of + taps becomes one save, and the public copy is updated once per save, not once per tap. A pending save is sent when the user leaves the list (Back, closing the page) and before unload.
- **No double write on share.** The share write already carries the current body, so the effect skips its first run right after sharing.
- **"Prices as of"** is the time the prices were last loaded, not the time of the edit.
- **Stale notice.** "Shared link not updated yet" clears when a later update succeeds or the queued write lands.

## 5. Shared deck checks

The `publicDecks` create and update rules gain:
- a fixed key set: `deckId, uid, name, description, leaderId, baseId, cards, aspects, format, tags, totalCards, publishedAt`;
- `name` as a string of at most 200 characters, `description` at most 2000;
- `cards` as a map of at most 200 entries;
- `tags` as a list of at most 20.

There is no code-format check, so existing links keep working. Rules tests prove a normal publish still passes.

## 6. Guest upgrade

`loginWithGoogle` (in `AuthContext`), when the current user is a guest:

1. **Link the Google account to the guest** (`linkWithPopup`): the guest becomes a Google account with the **same uid**. The collection, decks, lists and batches are all kept, and nothing else happens.
2. **If Google says the account already exists** (`auth/credential-already-in-use`):
   - read the guest's collection, which is still allowed while signed in as the guest;
   - sign in to the existing account with the credential from the error;
   - add the guest's cards into that collection through `ScanService.commitDraft`;
   - record a finished batch, "Guest collection", so the user can see what came across.
3. **Afterwards**, show a one-line status: "Signed in — your guest collection is now in this account (N cards)".

Guest decks, lists and batches are **not** moved in the merge case. The status says so ("Guest decks and lists weren't moved"). The upgrade-in-place case keeps everything.

Signed-in non-guests keep `signInWithPopup` exactly as today.

## Error handling

| Case | Behaviour |
|---|---|
| Import commit fails part-way | Message in the dialog naming how many cards were written; no batch recorded (a retry is safe in Replace mode; in Add mode the dialog warns that retrying may double-count the written part) |
| Report write fails after a successful import | Cards stay imported; dialog says the report couldn't be saved |
| Guest merge: sign-in works, card copy fails | Signed in to Google; status says the guest cards couldn't be copied and that the guest account is gone — offered as a downloadable CSV of the guest cards so nothing is lost |
| Popup closed / blocked | Same as today: no change |
| Copy part blocked by clipboard | Selectable box with the current part |

## Testing

- **`importBatch.test.js`:**
  - add mode: lines and quantities;
  - replace mode: positive differences, reductions, and the no-change case;
  - isNew flags, prices, and the `source` field;
  - chunking at 400 writes.
- **Import dialog test:**
  - mode choice, default name, price paid;
  - opens the report afterwards;
  - no-change message;
  - errors shown in the dialog, not in alerts.
- **`discordText.test.js`:**
  - escaping;
  - splitting at line boundaries under the limit;
  - the heading repeated with "part N of M", and the total on the last part.
- **Copy-in-parts UI test** (list view): the parts advance, and a list that fits copies in one part.
- **Public page:** long note class, landscape thumbnail for leaders and bases, fallback marker.
- **`ListView`:**
  - debounce (fake timers): several taps lead to one save;
  - the pending save is flushed on Back;
  - no republish right after sharing;
  - "prices as of" uses the price load time.
- **Rules:**
  - a normal deck publish passes;
  - an extra field, an oversized name, or more than 200 cards is refused.
- **Guest upgrade (`AuthContext` / `guestUpgrade.js` with mocked auth):**
  - link success keeps the uid;
  - credential-in-use copies the cards and records the batch;
  - a failed copy offers the CSV;
  - non-guests use popup sign-in.
- **Manual:**
  - import a small CSV with Add, then the same CSV with Replace, and check both reports;
  - copy a long list into Discord;
  - check the public page on the Pixel;
  - upgrade a fresh guest account.

## Out of scope

- Moving guest decks, lists and batches in the merge case.
- Per-list Discord preview cards.
- Import from formats other than CSV (deck-list text keeps its own importer).
