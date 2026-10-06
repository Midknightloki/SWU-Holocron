# Public List Links — Design (phase 2b)

**Date:** 2026-10-06
**Status:** Draft, awaiting review
**Builds on:** `2026-10-06-saved-lists-design.md`

## Goal

Post a link to a trade list and a link to a wants list in a Discord channel.
Anyone can open them — no app, no account — and the links stay current as
the owner edits the lists.

## Decisions

| Question | Decision |
|---|---|
| Link | `swu.holocronlabs.net/list/<code>`, an 8-character random code (no look-alike characters) |
| Updates | **Automatic**: while a list is shared, every save also updates its public copy. Buttons: **Share link**, **Copy link**, **Stop sharing** |
| Who can read | Anyone with the link, signed in or not |
| What a viewer sees | List type and name, each card (small image, name, set and number, finish, quantity, note), total cards; prices only when the list has Show prices on, labelled "prices as of <date>"; a **Copy as text** button |
| Owner's name | Not shown (the Discord post already says who shared it) |
| Prices | Frozen into the public copy at each update — viewers can't read the card or price database without signing in |
| Stop sharing | Deletes the public copy; the link then says the list isn't shared any more |
| Deleting a list | Also deletes its public copy |
| Discord preview card | Generic site preview (per-list previews need a server; out of scope) |

## Architecture

### 1. Public copy: `artifacts/{APP_ID}/publicLists/{code}`

Four segments, a valid document path — the same shape as `publicDecks/{slug}`.
Self-contained: the public page reads nothing else from Firestore.

```js
{ uid, kind: 'trade' | 'wants', name, showPrices,
  lines: [{ set, number, name, subtitle, finish, qty, note?, unitPrice? }],  // sorted as the list shows them
  cards,            // total copies
  value,            // only when showPrices and any line is priced
  pricesAsOf,       // ms, only when showPrices
  updatedAt }
```

- `unitPrice` appears only on priced lines and only when `showPrices`.
- The owner's list doc gains `publicCode` (absent when not shared).

### 2. Rules (`firestore.rules`)

```
match /artifacts/{appId}/publicLists/{code} {
  allow read: if true;
  allow create: if isSignedIn() && request.resource.data.uid == request.auth.uid;
  allow update: if isSignedIn() && resource.data.uid == request.auth.uid
                && request.resource.data.uid == request.auth.uid;
  allow delete: if isSignedIn() && resource.data.uid == request.auth.uid;
}
```

**Fixed in passing:** the `publicDecks` update rule checks only the new
data's uid. Anyone signed in can therefore overwrite another user's shared
deck by writing their own uid into it. It gets the same
`resource.data.uid == request.auth.uid` condition on update. Rules tests cover
both collections, including that takeover attempt.

### 3. Pure model (`src/utils/cardLists.js`)

`toPublicList(list, lines, { showPrices, now })` builds the public document
body without `uid`, `updatedAt`, `undefined` fields, or prices when they are
hidden.

### 4. Service (`ListService`)

- `shareList(uid, list, publicBody)`:
  - generates a code and checks it is free (up to 5 attempts);
  - writes the public copy and sets `publicCode` on the list in one batch;
  - returns `{ code }` or `{ error }`.
- `updatePublic(uid, code, publicBody)`: overwrites the public copy.
- `unshareList(uid, listId, code)`: deletes the public copy and removes `publicCode`, in one batch.
- `deleteList(uid, id, code?)`: also deletes the public copy when shared.
- `getPublicList(code)`: no auth needed; returns `{ list }`, `{ error: 'not-found' }` or `{ error }`.
- Every write uses the existing 8 s offline timeout.

### 5. UI

**`ListView`:**
- **Share link** (when not shared) shares the list, then shows the link with **Copy link** and **Stop sharing** (tap twice).
- While shared, every save is followed by `updatePublic` with the current lines and prices. A failure shows a quiet "Shared link not updated yet — check your connection". The next successful save brings the link up to date.
- Turning **Show prices** off removes prices from the public copy on that same save.

**Saved lists rows** show a "Shared" badge when the list has a `publicCode`.

**Public page** (`PublicListView.jsx`, the route `/list/<code>` in `main.jsx` next to `/deck/<slug>`):
- read-only, phone-first;
- a heading of "Trade list" or "Wants list" with the name;
- a row per card;
- totals and, when shown, "prices as of";
- **Copy as text**, reusing `toListText`;
- a footer link to the app.
- **Not found:** "This list isn't shared any more."
- **Load failure:** "Couldn't load this list. Check your connection and try again."

## Error handling

| Case | Behaviour |
|---|---|
| Share fails | Inline error, list stays unshared |
| Public update fails | Quiet notice; list edit itself unaffected; next save retries |
| Code collision | Retry with a new code (5 attempts), then error |
| Viewer opens a stopped link | "This list isn't shared any more." |
| Unpriced card with prices on | Row shows no price; never $0 |

## Testing

- **`cardLists.test.js`** (`toPublicList`): prices omitted when hidden; unpriced lines carry no `unitPrice`; no `undefined` fields; `pricesAsOf` is set only with prices.
- **`ListService.test.js`**: share writes both docs and returns the code; collision retry; unshare removes both; deleting a shared list removes the public copy; `getPublicList` not-found.
- **`ListView.test.jsx`**:
  - share shows the link;
  - an edit while shared calls `updatePublic`;
  - Show prices off removes prices from the public body;
  - stop sharing takes two taps;
  - a failed public update shows the notice.
- **`PublicListView.test.jsx`**: renders rows, prices only when present, the not-found message, and Copy as text.
- **Rules tests** (`src/test/rules`):
  - anyone can read `publicLists`;
  - the owner can create, update and delete;
  - another user cannot create under someone else's uid, overwrite, or delete;
  - the same takeover attempt on `publicDecks` fails.
- **Manual:**
  - share a trade list and a wants list, and open both links in a private window and on the Pixel;
  - edit a list and refresh the link;
  - stop sharing.

## Out of scope

- Per-list Discord preview cards.
- View counts.
- Comments or offers from viewers.
- Matching your wants against someone else's trade list.
