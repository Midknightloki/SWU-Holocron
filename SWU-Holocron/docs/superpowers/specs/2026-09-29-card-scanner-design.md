# Card Scanner — Design

**Date:** 2026-09-29
**Status:** Draft, awaiting review
**Phase:** B (manual-trigger stack scanning). Phase C (hands-free capture) and
Patreon-driven Pro are out of scope; see Future work.

## Goal

Keying cards in one at a time is the most tedious part of the app. The scanner
lets a user put a phone in a stand, pass a stack of cards across a flat surface in
front of it, capture each one, then review and approve the whole batch before it
touches their collection.

Success means a user can enter a stack of 50+ cards faster than by hand, with no
wrong card reaching the collection without the user having seen it.

## Decisions

| Question | Decision |
|---|---|
| Recognition | Gemini 2.5 Flash on Vertex, via a new `scanCard` callable function |
| What is read | The printed set code, collector number **and card name** |
| Accuracy guard | The (set, number) lookup must match the read name, or the row is unidentified |
| Session shape | Stack: scan many into a tally, review, commit once |
| Capture trigger | Tap anywhere on the preview, or Space/Enter (keyboard, laptop webcam, keyboard-mode Bluetooth shutter) |
| Foil | Stack-level "foil stack" switch sets the default; per-row foil toggle in review |
| Failed read | Warning flash (retry now) **and** an unidentified row with its photo |
| Who can scan | `isAdmin || isPro`, enforced server-side and mirrored in the UI; guests never |
| Pro grant | Manual, by setting `isPro: true` on the profile doc in the Firebase console |
| Daily cap | Per user, tunable without redeploy, default 1000; admins exempt |
| Commit semantics | Additive (`increment()`), unlike CSV import which overwrites |

## Architecture

```
CardScanner.jsx ──capture──▶ ScanService.scan(image)
      │                          │  httpsCallable('scanCard')
      │                          ▼
      │                    functions: scanCard ──▶ Gemini (Vertex)
      │                          │  {readable, set, number, name}
      │                          ▼
      │                    resolveScan(read, lookup)   ← pure
      ▼
 scan draft (tally, localStorage)
      │
ScanReview.jsx ──approve──▶ ScanService.commitDraft()  ── increment, batches of 400
```

### 1. `scanCard` Cloud Function (`functions/index.js`, logic in `functions/scanCard.js`)

- Rejects unauthenticated and anonymous callers (`unauthenticated` / `permission-denied`).
- Reads `artifacts/{APP_ID}/users/{uid}`; requires `isAdmin === true || isPro === true`,
  else `permission-denied`.
- Non-admins: in a transaction on `artifacts/{APP_ID}/scanUsage/{uid}` = `{ date, count }`
  (UTC date string), reset when the date changes, reject with `resource-exhausted`
  when `count >= dailyLimit`, otherwise increment. The `resource-exhausted` error
  carries the limit and the reset time (next UTC midnight) in its details.
- `dailyLimit` is read on each call from `artifacts/{APP_ID}/config/scanner`
  (`{ dailyLimit: number }`), falling back to the code constant
  `DEFAULT_SCAN_DAILY_LIMIT = 1000` when the doc or field is missing or not a
  positive integer. Admins are not counted and not limited.
- Validates input: `image` is a base64 JPEG string under 2 MB decoded; else `invalid-argument`.
- Calls Gemini with the image inline, `thinkingBudget: 0`, and a `responseSchema` of
  `{ readable: boolean, set: string, number: string, name: string }`. The prompt
  directs it to the collector line at the card's bottom edge and to the title.
- Returns the read unchanged. **Never writes to the collection.**
- Same runtime service account and `@google/genai` / `enterprise: true` setup as
  `getCardSuggestions`. No new secrets.

The quota is charged before the Gemini call, so a failed Gemini call still counts.
That's acceptable at this limit and avoids a refund path.

### 2. `ScanService` (`src/services/ScanService.js`)

`export const ScanService = { scan, commitDraft }`, plus the pure resolver in
`src/utils/scanResolve.js`.

- `scan(imageBase64)` calls the function and returns the raw read, mapping
  `HttpsError` codes to `{ error: 'quota' | 'forbidden' | 'network' | 'unknown', ... }`.
- `resolveScan(read, lookup)` (pure) → `{ status: 'matched', set, number, name }` or
  `{ status: 'unidentified', reason, read }`. Steps:
  1. `readable === false` → unidentified (`unreadable`).
  2. Normalise the set: uppercase, trim. Accept it if it is a code in the **set
     registry**; otherwise try `SET_CODE_MAP` (printed/official → internal).
     Unknown → unidentified (`unknown-set`). No new hardcoded set list.
  3. Normalise the number: strip a `/total` suffix and leading zeros, then pad to 3,
     as `getCollectionId` does.
  4. Look up the card in that set's data. Missing → unidentified (`no-such-card`).
  5. Compare names after normalising case, punctuation and whitespace; match on
     the title, ignoring a subtitle if only one side has it. Mismatch →
     unidentified (`name-mismatch`).
- Card data for the lookup comes through the existing `CardService.fetchSetData`
  path and the `swu-cards-{SET}` cache, loaded lazily per set the first time a
  scan references it.
- `commitDraft(draft, collectionRef)` writes `increment(qty)` plus a merge of
  `set, number, name, isFoil, timestamp` for each matched row, in chunks of 400.
  **After each chunk commits, its rows are removed from the persisted draft**,
  so a retry after a mid-commit failure never double-counts.

### 3. Draft (`src/utils/scanDraft.js`, pure)

Draft rows: `{ id, status: 'reading' | 'matched' | 'unidentified' | 'failed', set?, number?, name?, isFoil, photo?, read?, reason? }`.
Grouped for display by `(set, number, isFoil)` as ×N. Pure functions: add,
resolve, set foil, set quantity, remove, group, and `toWrites` (to collection
increments). Persisted to `localStorage['swu-scan-draft']` on every change,
without photos: rows survive a reload, photos do not. Unidentified rows keep
what Gemini read and show "photo lost". A row still `reading` at reload becomes
`failed`.

### 4. `CardScanner.jsx`

- Camera: `getUserMedia({ video: { facingMode: 'environment' } })`, with a
  framing guide overlay. Handles permission denial and no camera with a clear
  message.
- Capture on a tap anywhere on the preview, or on Space/Enter. Draw the frame to a
  canvas, scale it to about 1024px on the long edge, and encode it as a JPEG at
  quality 0.8.
- Requests are **not serialised**: each capture adds a `reading` row immediately
  and resolves asynchronously; order is preserved.
- Unidentified or failed → a brief red flash plus haptic (`navigator.vibrate`
  where available).
- A "Foil stack" switch sets `isFoil` on new captures.
- A running tally strip, and a "Review (N)" button.
- On `quota`: capture is disabled and a message shows the limit and reset time;
  the draft is kept.
- Wrapped in an `ErrorBoundary`, like the other overlays.

### 5. `ScanReview.jsx`

- Grouped rows with inline quantity and foil controls (house rule: collection
  controls stay inline).
- Unidentified rows show the photo (if present) and what Gemini read, with a
  "Pick card" button that opens `CardPickerModal`.
- Failed rows have a "Retry" button, which re-sends the stored photo.
- "Add N cards to collection" commits; disabled while any row is `reading`.
  Unidentified and failed rows are **not** committed; they stay in the draft,
  and the UI says so.
- Discard-batch action, with confirmation rendered in the UI (not `window.confirm`).

### 6. Gating and entry point

- `firestore.rules`: add `'isPro'` to both protected-field lists (lines 48 and 52),
  so a user cannot grant it to themselves. `config/scanner` and `scanUsage/{uid}`
  get no client access at all (the function uses the Admin SDK).
- `AuthContext`: expose `isPro` alongside `isAdmin`/`isContributor`, and a
  derived `canScan = isAdmin || isPro`. Not read for anonymous users, same as
  the existing roles.
- `App.jsx`: a "Scan" button in the binder header. Enabled when `canScan`. For
  signed-in non-Pro users it shows locked, with a short "Pro feature" note.
  Hidden for guests.

### 7. Supporting change: `CardPickerModal`

`type` becomes optional; when omitted it lists every card type. The existing
Leader/Base callers are unchanged. The picker currently iterates the hardcoded
`SETS` fallback; it switches to the set registry in the same change, per
CLAUDE.md.

## Error handling summary

| Case | Row status | User sees |
|---|---|---|
| Name matches | matched | Row resolves, groups ×N |
| Unreadable | unidentified | Flash; row with photo |
| Name mismatch, unknown set, no such card | unidentified | Flash; row with photo and "read as …" |
| Network or function error | failed | Flash; row with photo and Retry |
| Daily cap | — | Capture disabled; limit and reset time; draft kept |
| Not permitted | — | Should not occur (button locked); generic message if it does |
| Commit fails mid-way | Committed chunks gone from draft | Error; "Add" retries only the remainder |

## Testing (tests first, per house rules)

- `src/test/utils/scanResolve.test.js`: set normalisation (registry, `SET_CODE_MAP`,
  unknown), number normalisation (`12`, `012`, `12/252`), name matching (case,
  punctuation, subtitle present on one side only), each unidentified reason.
- `src/test/utils/scanDraft.test.js`: add/resolve/group, foil default and flip,
  quantity edits, persistence without photos, `reading` → `failed` on reload,
  `toWrites` excluding unidentified and failed rows.
- `src/test/services/ScanService.test.js`: error-code mapping; `commitDraft`
  chunking at 400; committed rows removed after each chunk; a mid-commit
  failure leaves exactly the uncommitted rows.
- `src/test/functions/scanCard.test.js`: rejects unauthenticated and anonymous
  callers and non-Pro non-admins; admin allowed and not counted; Pro counted; cap
  enforced; date rollover resets; config fallback to 1000 (missing, zero,
  non-number). Firestore and Gemini mocked.
- `src/test/rules/firestore.rules.test.js`: a user cannot set `isPro` on
  create or update; no client read or write on `config/scanner` or `scanUsage/*`.
- `src/components/__tests__/ScanReview.test.jsx`: grouping, inline edits,
  pick-card resolution, Add disabled while reading, discard.
- **Manual, in a browser** (happy-dom cannot): camera on an Android and an iOS
  phone in the installed PWA; tap and keyboard capture; accuracy on a real mixed
  stack (standard, hyperspace, showcase, promo, foil), with the misread rate
  recorded in the PR.

## Out of scope / future work

- **Phase C: hands-free capture.** Steadiness detection that captures once per
  card. It reuses everything above except the trigger.
- **Patreon.** OAuth link plus a pledge webhook that sets `isPro`, with a weekly
  re-check. Needs Secret Manager for the client and webhook secrets. A separate
  spec, and it pairs naturally with fixing guest → Google account linking
  (`linkWithPopup`).
- **Admin UI for `dailyLimit`**: the Firebase console is enough for now.
- **On-device OCR** to cut Gemini cost, if cost ever justifies it.
