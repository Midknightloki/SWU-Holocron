# Precon Decks from Official Decklist Images — Design

**Date:** 2026-10-07
**Status:** Draft, awaiting review
**Builds on:** the prebuilt decks feature (`scripts/prebuiltDecks.js`, `AdminPrebuiltDecks.jsx`)

## Goal

Most precons are missing: Spotlight decks (Qui-Gon, Jabba, Han, Boba, Leia, Maul) and the Two-Player Starters. sw-unlimited-db's precon publisher hasn't posted them, and no source publishes them as data. The official site does publish them, but as images: each article has a decklist image with two decks.

This feature lets an admin paste such an image link and get both decks into **review**. From there the existing publish flow takes over. Each new precon costs one paste.

## What the images look like

Eight images were checked (`cdn.starwarsunlimited.com/large_SWH_0N_…Decklist…`). They share one format:

- **Two decks per image,** each under the heading "<NAME> DECK LIST".
- **Each row:** rarity icon, collector number, optional `*`, card name, `xN`. Examples: `38 Lepi Lookout x3`, `93* C-3PO x2`.
- **The set code is not printed.** A plain number is in the deck's own set. `*` means "card from a previous set", and which earlier set is not stated.
- **The leader and base are ordinary rows** (e.g. `S 10 Leia Organa x1`, `C 20 Daimyo's Palace x1`).
- **The file name carries the set number:** `SWH_02` = SHD, `03` = TWI, `04` = JTL, `07` = A Lawless Time. These match `officialCodeUtils`' official codes.
- **Names repeat with different numbers,** e.g. `9 Boba Fett` (leader) and `189 Boba Fett` (unit), or `184* Fett's Firespray` and `240 Fett's Firespray`. So the number is what identifies the card, and the name is the check.

## Decisions

| Question | Decision |
|---|---|
| How an image is read | A new admin-only Cloud Function, `readDecklist`, sends the image to **Gemini 2.5 Flash on Vertex**, the same setup as `scanCard`. Its `responseSchema` returns decks → lines `{ number, fromPreviousSet, name, qty }`. |
| Image input | Paste the image link, or upload the file. Links are fetched **by the function** and only from `https://cdn.starwarsunlimited.com/`. No arbitrary URLs: the function must not fetch internal addresses on request (SSRF). Images are capped at 8 MB. |
| Which set | Guessed from `SWH_0N` in the file name and shown as a set picker the admin can change. With no guess, the admin picks one. |
| Turning lines into cards | The pure `resolveDecklistLine`, number plus name, like the scanner. A plain line matches the card at that number in the deck's set, with the name agreeing. A `*` line, or a plain line that doesn't match, is looked up in **earlier sets** (by release date, newest first) at the same number with the name agreeing. |
| Name agreement | Case, punctuation, apostrophes and accents are ignored, so "Leia's Disguise" = "LEIA'S DISGUISE". A line that matches by number but not by name is never accepted silently. |
| Lines that don't resolve | Shown in a review list with the reason. The admin fixes each one with the card picker or removes it. **Save is disabled until every line resolves.** |
| Sanity check | Each deck shows its counts: leader, base and main deck. If the main deck isn't 50, a warning shows, but it doesn't block saving. |
| Where it lands | A prebuilt deck in `status: 'review'`, the same document shape as a pasted link. Leaders and base are taken from the resolved cards' types. Its id is `img-<set>-<slug of the deck name>`, and it records `source: { type: 'image', url, setCode }`. If that id already exists, the admin is told and nothing is overwritten. |
| After that | Unchanged: review → **Publish** with the suggested product. The weekly sync only touches decks it lists, so image decks are never changed or removed by it. |
| Cost and limits | Admin-only, so no daily quota. One Gemini call per image. |

## Architecture

### 1. Function: `functions/readDecklist.js` (package-free, injected like `scanCard.js`)

- **`readDecklistHandler(request, { db, HttpsError, readImage, fetchImage })`:**
  - requires a signed-in **admin**, read from the profile like `scanCard`;
  - accepts `{ imageUrl }` or `{ image }` (base64), and refuses both or neither;
  - only fetches `imageUrl` when it starts with `https://cdn.starwarsunlimited.com/`; it must be `image/png`, `image/jpeg` or `image/webp` and at most 8 MB;
  - returns `{ decks: [{ title, lines: [{ number, fromPreviousSet, name, qty }] }] }`, or an `HttpsError`.
- **The Gemini reader in `index.js`:**
  - the prompt describes the format and says the `*` means `fromPreviousSet`; numbers are returned without the star;
  - `thinkingBudget: 0`, a `responseSchema`, and enough `maxOutputTokens` for 2 × ~35 lines.
- **Export:** `exports.readDecklist = onCall({ maxInstances: 2, timeoutSeconds: 120 }, …)`.
- **Deployed by hand:** `firebase deploy --only functions:readDecklist`.

### 2. Pure model: `src/utils/decklistImage.js`

- `setFromImageUrl(url, registry)`: maps the `SWH_0N` in the file name to a registry set code, or returns `null`.
- `normalizeName(s)`: as described under "Name agreement".
- `resolveDecklistLine(line, { setCode, cardsBySet, earlierSets })`, returning one of:
  - `{ card }`
  - `{ error: 'name-mismatch', candidate }`
  - `{ error: 'not-found' }`
- `buildPrebuiltDeck({ title, resolved, setCode, url })` returns `{ sourceId, sourceName, leaders, base, cards: [{ id, qty }] }`. `id` uses `cardKey`, as the sync does.

### 3. Service: `PrebuiltDeckService`

- `readDecklistImage({ imageUrl } | { image })` calls the function.
- `addFromImage(deck)` writes the review document. It refuses an id that already exists.

### 4. UI: the Prebuilt Decks admin tab

**Add from decklist image** sits next to the paste-a-link field.

1. **Input:** a link field, or **Upload image**.
2. **Read:** the set picker is pre-filled from the file name. While the image is read, it says "Reading…".
3. **Review, one panel per deck:**
   - the deck name, which can be edited;
   - its counts;
   - one row per line: the image's number, name and quantity → the resolved card (set, number, name), or a red reason with **Pick card** / **Remove**.
4. **Save as review** puts each deck into the list of decks waiting for review.

## Error handling

| Case | Behaviour |
|---|---|
| Link not on the official CDN | "Only official starwarsunlimited.com images can be read." (checked in the browser and in the function) |
| Image unreadable or not a decklist | "Couldn't find a decklist in this image." Nothing is saved. |
| Gemini or the network fails | An error, with **Try again** |
| A deck with that id already exists | "Already in Prebuilt Decks." That deck isn't saved; the other deck in the image still can be. |
| Set picker changed after reading | The lines are re-resolved against the new set. The image is not read again. |

## Testing

- **`readDecklist.test.js`** (`src/test/functions/`, like `scanCard`):
  - an admin is required;
  - only CDN links are fetched;
  - the type and size limits hold;
  - exactly one input is accepted;
  - the reader's output is passed through;
  - errors map to `HttpsError`.
- **`decklistImage.test.js`**, using real lines from these images as fixtures:
  - a plain line resolves in-set;
  - `93* C-3PO` resolves to an earlier set;
  - a name mismatch is never accepted;
  - `9 Boba Fett` and `189 Boba Fett` resolve to different cards;
  - `setFromImageUrl` gives SWH_04 → JTL and nothing for unknown names;
  - names normalise;
  - the deck is built with its leader and base.
- **Service:** `addFromImage` writes the review document and refuses an existing id.
- **Admin UI:**
  - read → review → fix a line with Pick card → save;
  - Save is disabled while any line is unresolved;
  - the warning shows at a main deck other than 50;
  - non-CDN links are refused.
- **Manual (after deploying the function):** the eight images listed in the conversation. Check the counts and spot-check `*` lines against the official card pages, then publish.

## Out of scope

- **Finding the images automatically** by crawling the official articles.
- **The Luke and Vader Two-Player Starters (SOR):** no image link yet. They can be added the same way once found.
- **Non-English images.**
