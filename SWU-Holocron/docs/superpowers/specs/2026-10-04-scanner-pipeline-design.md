# Scanner Pipeline for a Whole Box — Design

**Date:** 2026-10-04
**Status:** Draft, awaiting review
**Builds on:** `2026-10-03-scanner-auto-mode-design.md`

## Goal

Scan a whole booster box (~384 cards) in one sitting, on stream, without
pausing. Live, the scanner only has to make sure it got a good picture.
Recognition happens in the background, and the user reviews the batch at the
end.

From the first full-box run, three problems:

- Auto is slow: 0.6 s to settle, then up to 1.5 s for the full-resolution
  photo. The user caught themselves pulling cards mid-capture.
- A quick swap was sometimes missed. Re-arming needed 0.6 s of stillness on
  the empty rig.
- Photos live in memory, so the batch had to be committed every pack or two.

Success: a 384-card box in one batch, with no mid-stream saves, no missed
swaps, and no hold-still wait on most cards. Recognition is no worse than full
photos.

## Decisions

| Question | Decision |
|---|---|
| Live feedback | **No green flash.** Red flash + vibration **only for a bad photo** (nothing usable captured). An unrecognised card is silent: the Review badge increments. NEW pop-up kept. |
| Capture (Auto) | Live-video frame, cropped to the calibrated card at full stream resolution, accepted if it passes an on-phone sharpness check; otherwise a full photo |
| Capture (manual tap/Space) | Full photo, as today |
| Override | Auto setting **Always use full photos**; slider **Sharpness** |
| Recognition | Background queue, 3 in flight, retry with backoff, pause at the daily limit or offline |
| Photo storage | IndexedDB; draft rows keep only a reference; deleted on commit or remove |
| Re-arm | After ~0.2 s of the empty rig, moving or not |
| Default settle | 0.35 s (was 0.6) |
| Commit while reading | Allowed: Add commits matched rows; rows still reading stay in the batch |

## Architecture

### 1. Auto timing (`autoCapture.js`)
- `captured → empty` when the rig has looked empty (`shapeDiff ≤ presence`) for
  `rearmMs` (default 200 ms) on consecutive ticks, moving or not. It no longer
  waits for `settleMs` of stillness.
- `DEFAULT_AUTO_SETTINGS.settleMs` becomes 350.
- New settings, stored with the others in `swu-scan-auto`:
  - `sharpness` (default 60, range 10–300);
  - `fullPhotos` (boolean, default false).
- Existing stored settings without them load with the defaults.

### 2. Sharpness and frame capture
- `src/utils/sharpness.js` (pure): `laplacianVariance(gray, width, height)`.
  The variance of the 4-neighbour Laplacian over a grayscale image.
- `src/utils/frameCapture.js`:
  - `captureVideoFrame({ video, crop })` → `{ image, gray, grayWidth, grayHeight, source: 'video', width, height, cropped }`.
  - It draws the calibrated region of the video at full stream resolution,
    scaled to the 2048 long edge for the image. It also produces a ≤512 px
    grayscale copy for the sharpness check.
- `CardScanner`, on an Auto capture:
  - if not `fullPhotos`, try `captureVideoFrame`;
  - if `laplacianVariance ≥ sharpness`, use it;
  - otherwise fall back to `capturePhoto` (today's path).
  - Nothing usable → red flash + vibration.

### 3. Photo store (`src/services/photoStore.js`)
- IndexedDB `swu-holocron`, store `scanPhotos`, keyed by draft row id.
  Bump the DB version and create the store in `onupgradeneeded`. The card
  cache shares the DB and the version bump.
- `put(id, base64)`, `get(id)`, `remove(ids)`, `clear()`.
- Never throws. Without IndexedDB, it falls back to an in-memory map for the
  session.
- Draft rows store `hasPhoto: true` instead of `photo`. `saveDraft` /
  `loadDraft` no longer deal in photos at all.

### 4. Recognition queue (`src/services/scanQueue.js`)
- `createScanQueue({ scan, getImage, onResult, concurrency = 3, now, wait })`:
  - `enqueue(id)`, `resume()`, `pause(reason)`, `size()`.
- Takes ids in order, loads each image from the photo store, and calls
  `scan` (today's `ScanService.scan` with hints and base sets).
- Outcomes:
  - **Success or unidentified:** `onResult(id, result)`.
  - **`network` / `unknown`:** retry after 1 s, 2 s, 4 s, 8 s, 16 s. After
    the 5th failure, `onResult(id, { status: 'failed', error })`. The row
    then gets a Retry button in Review.
  - **`quota`:** pause the whole queue and mark its pending rows `waiting`
    (reason `quota`). Resume only on a manual Retry or a new session.
  - **Offline** (`navigator.onLine === false`): pause until the `online`
    event, then resume.
- **On scanner open:** rows still `reading` with a stored photo are
  re-enqueued. Without a stored photo they become `failed` (`interrupted`).

### 5. Scanner and Review changes
- Auto and manual captures:
  - store the photo;
  - add a `reading` row;
  - enqueue it;
  - **no flash on success**.
- The result handler applies the result to the draft. It shows the NEW pop-up
  for a first-in-batch new card. Unrecognised: no flash.
- Review button:
  - count;
  - red attention badge (unidentified + failed);
  - a small "reading N" counter while the queue works.
- Review:
  - photos load from the photo store (thumbnail and full-size viewer);
  - **Add** is enabled when there is ≥1 matched card, even while some are
    still reading; the note says how many stay behind;
  - Retry re-enqueues.
- Commit and remove delete those rows' photos. Discard clears the store
  for this batch.

## Error handling

| Case | Behaviour |
|---|---|
| Frame blurry | Falls back to full photo; no user-visible difference except time |
| Frame and photo both fail | Red flash + vibration; no row added |
| Read fails (network) | Retried with backoff; after 5, failed row with Retry |
| Daily limit | Queue pauses; pending rows `waiting`; existing quota banner |
| Offline | Queue pauses; resumes when back online |
| App closed mid-batch | Rows and photos persist; unread captures resume on reopen |
| IndexedDB unavailable | Photos kept in memory for the session (today's behaviour) |
| Photo missing for a row | Thumbnail shows "No photo"; Retry hidden |

## Testing

- `autoCapture.test.js`:
  - re-arm after a brief empty glimpse while moving;
  - a quick swap with no still empty period is captured;
  - the new 350 ms default;
  - settings load with old stored values.
- `sharpness.test.js`:
  - a high-contrast checkerboard vs. a flat or blurred image;
  - monotonic under blur.
- `photoStore.test.js` (fake-indexeddb):
  - put/get/remove/clear;
  - the in-memory fallback;
  - never throws.
- `scanQueue.test.js`:
  - concurrency cap;
  - order;
  - retry/backoff timing (injected `wait`);
  - fails after 5;
  - quota pause;
  - offline pause and resume;
  - re-enqueue on open.
- `CardScanner.test.jsx`:
  - no flash on success or on unidentified;
  - red flash only when no image;
  - frame accepted when sharp, photo fallback when blurry or `fullPhotos`;
  - the badge increments silently;
  - Add enabled while reading.
- `ScanReview.test.jsx`:
  - photos from the store;
  - Add while reading;
  - photo deleted on remove.
- **Manual, on the rig:**
  - the share of frames passing the sharpness check;
  - recognition rate vs. full photos on the same stack;
  - a full box with no mid-stream saves;
  - kill the app mid-batch and reopen.

## Out of scope

- Phase 3 (named batches, reports, exports).
- Auto-committing matched cards without review.
