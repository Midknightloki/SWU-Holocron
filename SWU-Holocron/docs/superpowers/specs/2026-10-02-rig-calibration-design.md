# Scanner Rig Calibration — Design

**Date:** 2026-10-02
**Status:** Draft, awaiting review
**Builds on:** `2026-09-29-card-scanner-design.md`

## Goal

Users scan with fixed rigs: the phone is mounted and every card lands in the
same place, in the same orientation, every time. The rig cannot be adjusted to
suit the app, so the app adapts to the rig — once — and from then on sends
Gemini only the card, at the best resolution the photo allows.

Today every capture sends the **whole** photo (e.g. 3024×4032, scaled to 2048).
On the reference rig the card fills ~70% of the width and ~55% of the height,
so background, paper and ruler take most of the pixels. Cropping to the card
before scaling gives the collector digits roughly 1.4× more pixels on each axis.

Success: after one calibration, a stand-mounted user's captures are cropped to
the card, the on-screen guide sits over the card, and the unidentified rate on a
real stack drops versus uncalibrated scanning on the same rig.

## Decisions

| Question | Decision |
|---|---|
| How the card is found | Automatic (Gemini bounding box) on one calibration photo, then the user adjusts corners and saves |
| How often | Once per rig; recalibrate or clear on demand. Never per scan |
| Coordinate space | Fractions of the **photo** (0..1), never screen pixels |
| Storage | Per device, `localStorage['swu-scan-rig']` |
| Crop margin | 4% of the card's size on each side, clamped to the photo |
| Capture source mismatch | Calibration records `photo` or `video`; a capture from the other source is not cropped |
| Not calibrated | Behaviour unchanged from today |
| Cost | `locateCard` counts as one scan against the daily limit; admins exempt (same rule as `scanCard`) |

## Architecture

### 1. `locateCard` Cloud Function

- `functions/scanCard.js` gains a generic factory used by both functions, so
  auth, anonymous rejection, image validation, entitlement (`isAdmin || isPro`)
  and quota charging exist once. `createScanCardHandler` keeps its signature and
  behaviour (it becomes a thin wrapper), so its 17 tests stand unchanged.
- `createLocateCardHandler({ db, appId, locate, HttpsError, logger, now })`:
  same pipeline, calls `locate(image)` and returns
  `{ found: boolean, box: [ymin, xmin, ymax, xmax] | null }`.
- Sanitising: `box` must be four finite numbers in 0..1000 with
  `ymin < ymax` and `xmin < xmax`, else the result is `{ found: false, box: null }`.
  Values are rounded to integers.
- `functions/index.js` supplies `locateCardWithGemini`: the image inline,
  `thinkingBudget: 0`, temperature 0, `responseSchema`
  `{ found: boolean, box_2d: integer[4] }`, and a prompt asking for the box of
  the single trading card in the photo as `[ymin, xmin, ymax, xmax]` normalised
  to 0–1000 (Gemini's native bounding-box format). Exported as `locateCard`.
- Deployed by hand, like `scanCard`.

### 2. Calibration model (`src/utils/rigCalibration.js`, pure)

- `boxToRect([ymin, xmin, ymax, xmax])` → `{ x, y, w, h }` as fractions.
- `withMargin(rect, 0.04)` → grown by 4% of its own width/height per side,
  clamped to 0..1.
- `DEFAULT_RECT`: centred, 63:88, 80% of the photo height — the starting box
  when Gemini finds nothing.
- `cropPixels(rect, width, height)` → integer `{ sx, sy, sw, sh }` inside the image.
- `cropFor(calibration, source)` → the margin-applied rect if
  `calibration.source === source`, else `null`.
- `saveCalibration(storage, { rect, source })`, `loadCalibration(storage)`,
  `clearCalibration(storage)`: never throw; `loadCalibration` validates shape
  and range and returns `null` for anything else. Stored value:
  `{ version: 1, rect, source, savedAt }`.

### 3. Capture (`src/utils/frameCapture.js`)

- `capturePhoto({ track, video, crop, ... })`: `crop` is a function
  `(source) => rect | null` (the scanner passes `(s) => cropFor(calibration, s)`),
  so the source decision stays with the code that knows which path ran.
- With a rect, `encode` draws only `cropPixels(rect, w, h)` of the source,
  scaled so that region's long edge is at most 2048. Without, unchanged.
- The result gains `cropped: boolean` for the footer.
- The calibration photo itself is taken with no crop.

### 4. Calibration screen (`src/components/RigCalibration.jsx`)

Opened from a **Calibrate** button in the scanner toolbar.

1. "Put a card in the rig, then tap Take photo." → uncropped `capturePhoto`.
2. Calls `ScanService.locateCard(image)` (spinner while waiting).
3. Shows the photo with the rectangle drawn over it — the detected box, or
   `DEFAULT_RECT` with "Couldn't find the card — drag the corners onto it."
4. Four corner handles, dragged with pointer events, in photo fractions; a
   corner cannot cross its opposite or leave the photo (minimum 10% size).
5. **Save** → `saveCalibration`; **Retake**; **Cancel** (nothing saved).
   **Clear calibration** shown when one exists.
6. Errors (quota, network, forbidden) show a message and still allow manual
   placement from `DEFAULT_RECT` — calibration must not depend on Gemini.

### 5. Scanner changes (`src/components/CardScanner.jsx`)

- Loads the calibration on mount; passes the crop function to `capturePhoto`.
- Guide: when calibrated, the yellow outline and both cyan collector boxes are
  positioned from the calibrated rect, mapped onto the displayed video area
  (`object-contain` letterboxing computed from `videoWidth/videoHeight` and the
  element size). Labelled as approximate: the live stream and the still photo
  can differ in field of view on some phones; the crop is exact regardless,
  because it is computed on the photo.
- Uncalibrated: today's centred guide.
- Footer: `photo 3024×4032 · cropped` / `· full frame`.
- How-to gains a first step: "Calibrate once for your rig (Calibrate button)."

### 6. `ScanService.locateCard(image)`

Calls the function; returns `{ found, box }`, or `{ error }` mapped through the
existing `mapScanError`. Never throws.

## Error handling

| Case | Behaviour |
|---|---|
| Gemini finds no card / bad box | `DEFAULT_RECT` + drag message |
| Quota, network, forbidden during calibration | Message; manual placement still possible |
| Corrupt or old stored calibration | Treated as uncalibrated |
| Capture source differs from calibration | Full frame sent, footer says `full frame` |
| Storage unavailable | Calibration works for the session only |

## Testing

- `src/test/utils/rigCalibration.test.js`: box conversion, margin + clamping,
  `cropPixels` rounding/bounds, `cropFor` source match, storage round-trip,
  invalid stored values → `null`, throwing storage.
- `src/test/functions/scanCard.test.js` (extended): `locateCard` rejects
  anonymous / non-Pro, admin uncounted, Pro counted, cap enforced; sanitising
  rejects out-of-range, inverted and non-numeric boxes. Existing tests unchanged.
- `src/test/utils/frameCapture.test.js` (extended): crop passes the right source
  region and output size; no crop when the crop function returns null; `cropped` flag.
- `src/test/services/ScanService.test.js` (extended): `locateCard` success and error mapping.
- `src/components/__tests__/RigCalibration.test.jsx`: detected box shown;
  not-found → default + message; error → manual still possible; dragging a
  corner moves it and respects bounds; Save stores; Cancel stores nothing; Clear.
- `src/components/__tests__/CardScanner.test.jsx` (extended): crop function
  passed when calibrated; guide positioned from calibration; footer label.
- **Manual, on the rig:** box quality from Gemini; how closely the live guide
  sits on the card; unidentified rate on the same stack calibrated vs not.

## Out of scope

- Per-scan detection (rejected: doubles Gemini cost for a rig that never moves).
- Perspective / keystone correction (the level handles that physically).
- Syncing calibration across devices.
- Camera hardware zoom (`track.applyConstraints({ zoom })`): cropping the full-res
  photo achieves the same effect without changing focus distance.
