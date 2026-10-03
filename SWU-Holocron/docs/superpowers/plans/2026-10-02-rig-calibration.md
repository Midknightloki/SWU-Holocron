# Scanner Rig Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a stand-mounted user calibrate the scanner to their rig once (Gemini finds the card, user adjusts), after which every capture is cropped to the card before it is sent.

**Architecture:** A `locateCard` callable shares `scanCard`'s auth/entitlement/quota pipeline and returns Gemini's `box_2d`. A pure `rigCalibration` module turns that into a photo-fraction rectangle, stores it per device, and decides when a crop applies. `capturePhoto` crops the full-resolution photo to that rectangle (+4%) before scaling to 2048. A `RigCalibration` overlay inside the scanner takes the calibration photo and lets the user drag or nudge the corners.

**Tech Stack:** React 18, Vite, Tailwind, Firebase JS SDK v10, Cloud Functions v2 (Node 24), `@google/genai` (Vertex, `enterprise: true`), Vitest + Testing Library + happy-dom.

**Spec:** `SWU-Holocron/docs/superpowers/specs/2026-10-02-rig-calibration-design.md`

**Deliberate deviations from the spec:**
- `DEFAULT_RECT` becomes `defaultRect(photoWidth, photoHeight)`: "63:88, 80% of the height" depends on the photo's aspect, so it must be computed.
- The crop function is `(source, width, height) => rect | null`, and calibrations record `orientation` (`portrait`/`landscape`). A photo taken after the phone is rotated would otherwise be cropped with a rectangle from the other orientation. See Review Focus #1.

## Global Constraints

- All `npm`/`npx` commands run from `SWU-Holocron/` (git root is one level up).
- CI does not install `functions/node_modules`: `functions/scanCard.js` must `require` no package.
- Services are object literals exported by name; JSX test files use `.jsx`.
- Every hook before any conditional return.
- `no-console` allows only `console.warn`/`console.error`.
- ESLint **errors** stay at zero: `npx eslint src --ext js,jsx --quiet`.
- `localStorage` keys `swu-`-prefixed; storage helpers never throw.
- Coordinates are fractions (0..1) of the captured image, never screen pixels.
- Crop margin `CROP_MARGIN = 0.04`; minimum calibration size `MIN_SIZE = 0.1`; capture long edge stays 2048.
- `locateCard` uses the same entitlement (`isAdmin || isPro`) and daily-quota rule as `scanCard`; admins exempt.
- Gemini config: `thinkingBudget: 0`, `responseSchema`, `@google/genai` with `enterprise: true`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Gate commits on green: `npm run test:unit && npx eslint src --ext js,jsx --quiet` before `git commit` (use `&&`, never `;`).

## Review Focus

1. **Phone rotated after calibrating.** The calibration was saved from a portrait photo; a later capture comes back landscape. The crop must be skipped (full frame), not applied to the wrong region. (Task 1: `cropFor skips a capture whose orientation differs`; Task 2: `does not crop when the crop function declines`.)
2. **Capture path changes.** Calibrated on `photo`; `takePhoto` fails and the capture falls back to a video frame. Expected: full frame, footer says `full frame`. (Task 1: `cropFor skips a different capture source`; Task 7: footer test.)
3. **Scanner closed while Gemini is still locating.** Expected: no error, nothing saved, no state update after unmount. (Task 6: `ignores a locate result that arrives after closing`.)
4. **Storage unavailable or holding garbage** (private mode, an old or hand-edited value). Expected: treated as uncalibrated, never a crash. (Task 1: `loadCalibration rejects malformed values`, `never throws`.)
5. **Calibrated, but the preview size is not known yet** (video metadata not loaded, or a test environment with no layout). Expected: the default centred guide, not a guide at 0×0. (Task 1: `guideStyle returns null without sizes`; Task 7: `falls back to the centred guide`.)

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/utils/rigCalibration.js` | create | Pure geometry, crop decision, per-device storage |
| `src/test/utils/rigCalibration.test.js` | create | |
| `src/utils/frameCapture.js` | modify | Optional crop of the source before scaling |
| `src/test/utils/frameCapture.test.js` | modify | |
| `functions/scanCard.js` | modify | Shared Gemini-call pipeline; `createLocateCardHandler`, `sanitizeBox` |
| `src/test/functions/scanCard.test.js` | modify | `locateCard` tests (existing ones unchanged) |
| `functions/index.js` | modify | `askGemini` helper, `locateCardWithGemini`, `exports.locateCard` |
| `src/services/ScanService.js` | modify | `locateCard(image)` |
| `src/test/services/ScanService.test.js` | modify | |
| `src/components/RigCalibration.jsx` | create | Calibration overlay: photo, locate, corner adjust, save |
| `src/components/__tests__/RigCalibration.test.jsx` | create | |
| `src/components/CardScanner.jsx` | modify | Load calibration, crop captures, Calibrate button, calibrated guide, footer, how-to |
| `src/components/__tests__/CardScanner.test.jsx` | modify | |
| `CLAUDE.md`, `TESTING.md`, `docs/DEPLOYMENT_RUNBOOK.md` | modify | Docs |

---

### Task 1: `rigCalibration` — geometry, crop decision, storage

**Files:**
- Create: `SWU-Holocron/src/utils/rigCalibration.js`
- Test: `SWU-Holocron/src/test/utils/rigCalibration.test.js`

**Interfaces:**
- Produces:
  - `RIG_KEY = 'swu-scan-rig'`, `CROP_MARGIN = 0.04`, `MIN_SIZE = 0.1`
  - `Rect = { x, y, w, h }` (fractions, rounded to 4 dp)
  - `boxToRect([ymin, xmin, ymax, xmax])` (0–1000) → `Rect`
  - `defaultRect(photoWidth, photoHeight)` → `Rect`
  - `withMargin(rect, margin = CROP_MARGIN)` → `Rect` (clamped to 0..1)
  - `cropPixels(rect, width, height)` → `{ sx, sy, sw, sh }` (integers, inside the image)
  - `orientationOf(width, height)` → `'portrait' | 'landscape'`
  - `cropFor(calibration, source, width, height)` → `Rect | null`
  - `cornerPoint(rect, corner)`, `moveCorner(rect, corner, px, py)`; `corner ∈ 'tl'|'tr'|'bl'|'br'`
  - `guideStyle(rect, videoWidth, videoHeight, boxWidth, boxHeight)` → `{ left, top, width, height }` px, or `null`
  - `Calibration = { version: 1, rect, source: 'photo'|'video', orientation, savedAt }`
  - `saveCalibration(storage, { rect, source, orientation }) → Calibration | null`, `loadCalibration(storage) → Calibration | null`, `clearCalibration(storage)`

- [ ] **Step 1: Write the failing tests.** Create `src/test/utils/rigCalibration.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  RIG_KEY, CROP_MARGIN, MIN_SIZE, boxToRect, defaultRect, withMargin, cropPixels,
  orientationOf, cropFor, cornerPoint, moveCorner, guideStyle,
  saveCalibration, loadCalibration, clearCalibration,
} from '../../utils/rigCalibration';

const memoryStorage = () => {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
};
const throwingStorage = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('denied'); },
  removeItem: () => { throw new Error('denied'); },
};

const RECT = { x: 0.2, y: 0.1, w: 0.6, h: 0.8 };
const CAL = { version: 1, rect: RECT, source: 'photo', orientation: 'portrait', savedAt: 1 };

describe('geometry', () => {
  it('converts a Gemini box_2d to fractions, rounded to 4 places', () => {
    expect(boxToRect([100, 200, 900, 800])).toEqual(RECT);
  });

  it('builds a centred card-shaped default for the photo aspect', () => {
    const r = defaultRect(3000, 4000);
    expect(r.h).toBe(0.8);
    expect(r.y).toBe(0.1);
    expect(r.w).toBeCloseTo(0.8 * (63 / 88) * (4000 / 3000), 3);
    expect(r.x).toBeCloseTo((1 - r.w) / 2, 3);
  });

  it('caps the default width for very tall photos', () => {
    expect(defaultRect(1000, 4000).w).toBe(0.9);
  });

  it('adds a 4% margin and clamps it to the image', () => {
    expect(CROP_MARGIN).toBe(0.04);
    expect(withMargin(RECT)).toEqual({ x: 0.176, y: 0.068, w: 0.648, h: 0.864 });
    expect(withMargin({ x: 0, y: 0, w: 1, h: 1 })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('turns a rect into whole pixels inside the image', () => {
    expect(cropPixels(RECT, 3024, 4032)).toEqual({ sx: 604, sy: 403, sw: 1816, sh: 3226 });
    expect(cropPixels({ x: 0.9, y: 0.9, w: 0.2, h: 0.2 }, 100, 100)).toEqual({ sx: 90, sy: 90, sw: 10, sh: 10 });
  });

  it('names the orientation of an image', () => {
    expect(orientationOf(3024, 4032)).toBe('portrait');
    expect(orientationOf(4032, 3024)).toBe('landscape');
  });

  it('finds and moves a corner, keeping the minimum size and the image bounds', () => {
    expect(cornerPoint(RECT, 'br')).toEqual({ x: 0.8, y: 0.9 });
    expect(moveCorner(RECT, 'br', 0.85, 0.95)).toEqual({ x: 0.2, y: 0.1, w: 0.65, h: 0.85 });
    expect(moveCorner(RECT, 'tl', -1, -1)).toEqual({ x: 0, y: 0, w: 0.8, h: 0.9 });
    // Dragging top-left past bottom-right stops at the minimum size.
    expect(moveCorner(RECT, 'tl', 1, 1)).toEqual({ x: 0.7, y: 0.8, w: MIN_SIZE, h: MIN_SIZE });
  });

  it('maps a rect onto a letterboxed (object-contain) video', () => {
    // 3:4 video in a 400x800 box: shown 400x533.3, 133.3px bars top and bottom.
    const s = guideStyle(RECT, 3024, 4032, 400, 800);
    expect(s.left).toBeCloseTo(80, 1);
    expect(s.width).toBeCloseTo(240, 1);
    expect(s.top).toBeCloseTo(133.33 + 53.33, 1);
    expect(s.height).toBeCloseTo(426.67, 1);
  });

  it('guideStyle returns null without sizes', () => {
    expect(guideStyle(RECT, 0, 0, 400, 800)).toBeNull();
    expect(guideStyle(RECT, 3024, 4032, 0, 0)).toBeNull();
  });
});

describe('cropFor', () => {
  it('returns the margin-applied rect for a matching capture', () => {
    expect(cropFor(CAL, 'photo', 3024, 4032)).toEqual(withMargin(RECT));
  });

  it('skips a different capture source', () => {
    expect(cropFor(CAL, 'video', 3024, 4032)).toBeNull();
  });

  it('skips a capture whose orientation differs', () => {
    expect(cropFor(CAL, 'photo', 4032, 3024)).toBeNull();
  });

  it('skips when uncalibrated', () => {
    expect(cropFor(null, 'photo', 3024, 4032)).toBeNull();
  });
});

describe('storage', () => {
  it('round-trips a calibration under the swu-scan-rig key', () => {
    const storage = memoryStorage();
    const saved = saveCalibration(storage, { rect: RECT, source: 'photo', orientation: 'portrait' });
    expect(saved).toMatchObject({ version: 1, rect: RECT, source: 'photo', orientation: 'portrait' });
    expect(RIG_KEY).toBe('swu-scan-rig');
    expect(loadCalibration(storage)).toEqual(saved);
  });

  it('loadCalibration rejects malformed values', () => {
    const storage = memoryStorage();
    expect(loadCalibration(storage)).toBeNull();
    for (const bad of [
      '{nope',
      JSON.stringify({ version: 2, rect: RECT, source: 'photo', orientation: 'portrait' }),
      JSON.stringify({ version: 1, rect: { x: 0.5, y: 0, w: 0.9, h: 0.5 }, source: 'photo', orientation: 'portrait' }),
      JSON.stringify({ version: 1, rect: { x: 0, y: 0, w: 0.01, h: 0.5 }, source: 'photo', orientation: 'portrait' }),
      JSON.stringify({ version: 1, rect: RECT, source: 'camera', orientation: 'portrait' }),
      JSON.stringify({ version: 1, rect: RECT, source: 'photo', orientation: 'sideways' }),
      JSON.stringify({ version: 1, rect: { x: '0.2', y: 0.1, w: 0.6, h: 0.8 }, source: 'photo', orientation: 'portrait' }),
    ]) {
      storage.setItem(RIG_KEY, bad);
      expect(loadCalibration(storage)).toBeNull();
    }
  });

  it('never throws', () => {
    expect(saveCalibration(throwingStorage, { rect: RECT, source: 'photo', orientation: 'portrait' })).toBeNull();
    expect(loadCalibration(throwingStorage)).toBeNull();
    expect(() => clearCalibration(throwingStorage)).not.toThrow();
    expect(loadCalibration(null)).toBeNull();
  });

  it('clears a calibration', () => {
    const storage = memoryStorage();
    saveCalibration(storage, { rect: RECT, source: 'photo', orientation: 'portrait' });
    clearCalibration(storage);
    expect(loadCalibration(storage)).toBeNull();
  });
});
```

- [ ] **Step 2: Run and confirm failure.**

Run: `npx vitest run src/test/utils/rigCalibration.test.js`
Expected: FAIL, "Failed to resolve import ../../utils/rigCalibration".

- [ ] **Step 3: Implement.** Create `src/utils/rigCalibration.js`:

```js
/**
 * Scanner rig calibration: where the card sits in the photo on a fixed rig.
 *
 * Everything is in fractions (0..1) of the captured image, never screen
 * pixels: the live preview and the still photo can differ in field of view,
 * but the crop is applied to the photo, so it is exact on the photo.
 *
 * A calibration only applies to captures from the same source (photo vs video
 * frame) and the same orientation it was taken in; anything else is sent full
 * frame rather than cropped to the wrong place.
 *
 * Pure apart from the storage helpers, which take storage as a parameter and
 * never throw. @environment:web-localstorage (save/load/clear)
 */
export const RIG_KEY = 'swu-scan-rig';
export const CROP_MARGIN = 0.04;
export const MIN_SIZE = 0.1;

const SOURCES = ['photo', 'video'];
const ORIENTATIONS = ['portrait', 'landscape'];

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const r4 = (v) => Math.round(v * 10000) / 10000;
const rect4 = ({ x, y, w, h }) => ({ x: r4(x), y: r4(y), w: r4(w), h: r4(h) });

export function boxToRect([ymin, xmin, ymax, xmax]) {
  return rect4({ x: xmin / 1000, y: ymin / 1000, w: (xmax - xmin) / 1000, h: (ymax - ymin) / 1000 });
}

export function defaultRect(photoWidth, photoHeight) {
  const h = 0.8;
  const w = Math.min(0.9, h * (63 / 88) * (photoHeight / photoWidth));
  return rect4({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
}

export function withMargin(rect, margin = CROP_MARGIN) {
  const dx = rect.w * margin;
  const dy = rect.h * margin;
  const left = clamp01(rect.x - dx);
  const top = clamp01(rect.y - dy);
  const right = clamp01(rect.x + rect.w + dx);
  const bottom = clamp01(rect.y + rect.h + dy);
  return rect4({ x: left, y: top, w: right - left, h: bottom - top });
}

export function cropPixels(rect, width, height) {
  const sx = Math.max(0, Math.floor(rect.x * width));
  const sy = Math.max(0, Math.floor(rect.y * height));
  const ex = Math.min(width, Math.ceil((rect.x + rect.w) * width));
  const ey = Math.min(height, Math.ceil((rect.y + rect.h) * height));
  return { sx, sy, sw: ex - sx, sh: ey - sy };
}

export const orientationOf = (width, height) => (width > height ? 'landscape' : 'portrait');

export function cropFor(calibration, source, width, height) {
  if (!calibration) return null;
  if (calibration.source !== source) return null;
  if (calibration.orientation !== orientationOf(width, height)) return null;
  return withMargin(calibration.rect);
}

export function cornerPoint(rect, corner) {
  return {
    x: r4(corner.includes('l') ? rect.x : rect.x + rect.w),
    y: r4(corner.includes('t') ? rect.y : rect.y + rect.h),
  };
}

export function moveCorner(rect, corner, px, py) {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.w;
  let bottom = rect.y + rect.h;
  const x = clamp01(px);
  const y = clamp01(py);
  if (corner.includes('l')) left = Math.min(x, right - MIN_SIZE);
  if (corner.includes('r')) right = Math.max(x, left + MIN_SIZE);
  if (corner.includes('t')) top = Math.min(y, bottom - MIN_SIZE);
  if (corner.includes('b')) bottom = Math.max(y, top + MIN_SIZE);
  return rect4({ x: left, y: top, w: right - left, h: bottom - top });
}

export function guideStyle(rect, videoWidth, videoHeight, boxWidth, boxHeight) {
  if (!(videoWidth > 0 && videoHeight > 0 && boxWidth > 0 && boxHeight > 0)) return null;
  const scale = Math.min(boxWidth / videoWidth, boxHeight / videoHeight);
  const shownW = videoWidth * scale;
  const shownH = videoHeight * scale;
  const offsetX = (boxWidth - shownW) / 2;
  const offsetY = (boxHeight - shownH) / 2;
  return {
    left: offsetX + rect.x * shownW,
    top: offsetY + rect.y * shownH,
    width: rect.w * shownW,
    height: rect.h * shownH,
  };
}

const isFraction = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

function isValidRect(rect) {
  if (!rect) return false;
  const { x, y, w, h } = rect;
  if (![x, y, w, h].every(isFraction)) return false;
  return w >= MIN_SIZE - 1e-9 && h >= MIN_SIZE - 1e-9 && x + w <= 1 + 1e-9 && y + h <= 1 + 1e-9;
}

export function saveCalibration(storage, { rect, source, orientation }) {
  const calibration = { version: 1, rect: rect4(rect), source, orientation, savedAt: Date.now() };
  try {
    storage.setItem(RIG_KEY, JSON.stringify(calibration));
    return calibration;
  } catch {
    return null;
  }
}

export function loadCalibration(storage) {
  try {
    const raw = storage.getItem(RIG_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (c?.version !== 1) return null;
    if (!SOURCES.includes(c.source) || !ORIENTATIONS.includes(c.orientation)) return null;
    if (!isValidRect(c.rect)) return null;
    return c;
  } catch {
    return null;
  }
}

export function clearCalibration(storage) {
  try {
    storage.removeItem(RIG_KEY);
  } catch {
    // Storage unavailable: nothing was persisted.
  }
}
```

- [ ] **Step 4: Run and confirm pass.**

Run: `npx vitest run src/test/utils/rigCalibration.test.js`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
npm run test:unit && npx eslint src --ext js,jsx --quiet && git add src/utils/rigCalibration.js src/test/utils/rigCalibration.test.js && git commit -m "feat(scanner): rig calibration geometry, crop decision and storage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `capturePhoto` crops to the calibration

**Files:**
- Modify: `SWU-Holocron/src/utils/frameCapture.js`
- Test: `SWU-Holocron/src/test/utils/frameCapture.test.js`

**Interfaces:**
- Consumes: `cropPixels` (Task 1).
- Produces:
  - `capturePhoto({ track, video, crop, ImageCaptureCtor, decodeBlob, encode })`. `crop(source, width, height) → Rect | null` defaults to `() => null`.
  - Result: `{ image, source, width, height, cropped: boolean }`; width/height stay the camera's **native** size.
  - `encode(source, outSize, region?)`. `region = { sx, sy, sw, sh }` is passed only when cropping.
  - `encodeJpeg(source, { width, height }, region?)`.

- [ ] **Step 1: Update existing expectations and add the failing tests.** In `src/test/utils/frameCapture.test.js`:
  - In `takes a real still photo…`, change the final assertion to
    `expect(result).toEqual({ image: 'PHOTO', source: 'photo', width: 4080, height: 3072, cropped: false });`
  - In `falls back to a video frame when ImageCapture is unavailable`, change it to
    `expect(result).toEqual({ image: 'FRAME', source: 'video', width: 1280, height: 720, cropped: false });`
  - In `returns no image when the video has no frame yet`, change it to
    `expect(result).toEqual({ image: null, source: 'video', width: 0, height: 0, cropped: false });`
  - Append inside `describe('capturePhoto')`:

```js
  it('crops a photo to the calibrated region before scaling', async () => {
    const bitmap = { width: 3024, height: 4032 };
    const ImageCaptureCtor = fakeImageCapture(vi.fn(async () => ({})));
    const encode = vi.fn(() => 'CROPPED');
    const crop = vi.fn(() => ({ x: 0.2, y: 0.1, w: 0.6, h: 0.8 }));

    const result = await capturePhoto({ track, video, ImageCaptureCtor, decodeBlob: async () => bitmap, encode, crop });

    expect(crop).toHaveBeenCalledWith('photo', 3024, 4032);
    // Region 1816x3226 scaled so its long edge is 2048.
    expect(encode).toHaveBeenCalledWith(bitmap, { width: 1153, height: 2048 }, { sx: 604, sy: 403, sw: 1816, sh: 3226 });
    expect(result).toEqual({ image: 'CROPPED', source: 'photo', width: 3024, height: 4032, cropped: true });
  });

  it('crops a video-frame fallback with the source it reports', async () => {
    const encode = vi.fn(() => 'FRAME');
    const crop = vi.fn((source) => (source === 'video' ? { x: 0, y: 0, w: 0.5, h: 0.5 } : null));
    const result = await capturePhoto({ track, video, ImageCaptureCtor: undefined, encode, crop });
    expect(crop).toHaveBeenCalledWith('video', 1280, 720);
    expect(encode).toHaveBeenCalledWith(video, { width: 640, height: 360 }, { sx: 0, sy: 0, sw: 640, sh: 360 });
    expect(result).toMatchObject({ cropped: true });
  });

  it('does not crop when the crop function declines', async () => {
    const encode = vi.fn(() => 'FRAME');
    const result = await capturePhoto({ track, video, ImageCaptureCtor: undefined, encode, crop: () => null });
    expect(encode).toHaveBeenCalledWith(video, { width: 1280, height: 720 });
    expect(result).toMatchObject({ cropped: false });
  });
```

- [ ] **Step 2: Run and confirm failure.**

Run: `npx vitest run src/test/utils/frameCapture.test.js`
Expected: FAIL. The three changed assertions lack `cropped`, and the crop tests fail because `crop` is never called.

- [ ] **Step 3: Implement.** In `src/utils/frameCapture.js`:
  - Add `import { cropPixels } from './rigCalibration';` at the top.
  - Replace `encodeJpeg` with:

```js
/**
 * Draw a bitmap or video onto a canvas at the given size; base64 JPEG, no prefix.
 * With a region, only that part of the source is drawn (the calibrated crop).
 */
export function encodeJpeg(source, { width, height }, region) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (region) {
    ctx.drawImage(source, region.sx, region.sy, region.sw, region.sh, 0, 0, width, height);
  } else {
    ctx.drawImage(source, 0, 0, width, height);
  }
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1] ?? null;
}

// Encode the whole source, or only the calibrated region of it, scaled to the
// long-edge limit. Returns the image and whether it was cropped.
function encodeWithCrop(source, width, height, crop, sourceKind, encode) {
  const rect = crop(sourceKind, width, height);
  if (!rect) return { image: encode(source, fitWithin(width, height, CAPTURE_MAX_EDGE)), cropped: false };
  const region = cropPixels(rect, width, height);
  return { image: encode(source, fitWithin(region.sw, region.sh, CAPTURE_MAX_EDGE), region), cropped: true };
}
```

  - Replace `capturePhoto` with:

```js
/**
 * @returns {Promise<{ image: string|null, source: 'photo'|'video', width: number, height: number, cropped: boolean }>}
 *   width/height are the camera's native size, for the scanner footer.
 */
export async function capturePhoto({
  track,
  video,
  crop = () => null,
  ImageCaptureCtor = globalThis.ImageCapture,
  decodeBlob = (blob) => createImageBitmap(blob),
  encode = encodeJpeg,
}) {
  if (ImageCaptureCtor && track) {
    try {
      const blob = await new ImageCaptureCtor(track).takePhoto();
      const bitmap = await decodeBlob(blob);
      // Read the size before close(): a released ImageBitmap reports 0x0.
      const { width, height } = bitmap;
      const { image, cropped } = encodeWithCrop(bitmap, width, height, crop, 'photo', encode);
      bitmap.close?.();
      if (image) return { image, source: 'photo', width, height, cropped };
    } catch {
      // takePhoto can reject (camera busy, unsupported settings): use a frame.
    }
  }

  const width = video?.videoWidth ?? 0;
  const height = video?.videoHeight ?? 0;
  if (!width || !height) return { image: null, source: 'video', width: 0, height: 0, cropped: false };
  const { image, cropped } = encodeWithCrop(video, width, height, crop, 'video', encode);
  return { image, source: 'video', width, height, cropped };
}
```

- [ ] **Step 4: Run and confirm pass.**

Run: `npx vitest run src/test/utils/frameCapture.test.js`
Expected: PASS. The `1153` in the first crop test is `round(1816 × 2048 / 3226)`; the 1816 comes from rounding the right edge up (2419.2 → 2420).

- [ ] **Step 5: Commit.**

```bash
npm run test:unit && npx eslint src --ext js,jsx --quiet && git add src/utils/frameCapture.js src/test/utils/frameCapture.test.js && git commit -m "feat(scanner): crop captures to the calibrated card region

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `locateCard` handler sharing `scanCard`'s pipeline

**Files:**
- Modify: `SWU-Holocron/functions/scanCard.js`
- Test: `SWU-Holocron/src/test/functions/scanCard.test.js` (append; existing tests unchanged)

**Interfaces:**
- Produces (CommonJS): `createLocateCardHandler({ db, appId, locate, HttpsError, logger?, now? }) → async (request) => { found: boolean, box: [ymin, xmin, ymax, xmax] | null }`, and `sanitizeBox(output)`. `createScanCardHandler` keeps its exact signature and behaviour.
- `locate(image)` resolves to Gemini's `{ found, box_2d }`.

- [ ] **Step 1: Write the failing tests.** Append to `src/test/functions/scanCard.test.js`. The helpers `FakeHttpsError`, `fakeDb`, `profilePath`, `usagePath`, `CONFIG_PATH`, `request`, `NOW`, `APP` and `expectCode` already exist in that file. Also extend the existing `require` line to
`const { createScanCardHandler, createLocateCardHandler, sanitizeBox, DEFAULT_SCAN_DAILY_LIMIT } = require('../../../functions/scanCard.js');`

```js
describe('locateCard handler', () => {
  const BOX = { found: true, box_2d: [100, 200, 900, 800] };
  const setupLocate = (docs, locate = vi.fn(async () => BOX)) => {
    const db = fakeDb(docs);
    const handler = createLocateCardHandler({ db, appId: APP, locate, HttpsError: FakeHttpsError, now: () => NOW });
    return { db, handler, locate };
  };

  it('returns the card box for a Pro user and counts it as a scan', async () => {
    const { handler, db } = setupLocate({ [profilePath('p')]: { isPro: true } });
    await expect(handler(request('p'))).resolves.toEqual({ found: true, box: [100, 200, 900, 800] });
    expect(db.store.get(usagePath('p'))).toEqual({ date: '2026-09-29', count: 1 });
  });

  it('lets an admin locate without counting it', async () => {
    const { handler, db } = setupLocate({ [profilePath('a')]: { isAdmin: true } });
    await expect(handler(request('a'))).resolves.toMatchObject({ found: true });
    expect(db.store.has(usagePath('a'))).toBe(false);
  });

  it('applies the same guards as scanCard', async () => {
    const { handler, locate } = setupLocate({
      [profilePath('u')]: {},
      [profilePath('p')]: { isPro: true },
      [CONFIG_PATH]: { dailyLimit: 1 },
      [usagePath('p')]: { date: '2026-09-29', count: 1 },
    });
    await expectCode(handler(request(null)), 'unauthenticated');
    await expectCode(handler(request('g', { anonymous: true })), 'permission-denied');
    await expectCode(handler(request('u')), 'permission-denied');
    await expectCode(handler(request('p')), 'resource-exhausted');
    expect(locate).not.toHaveBeenCalled();
  });

  it('maps a Gemini failure to internal', async () => {
    const { handler } = setupLocate({ [profilePath('p')]: { isPro: true } }, vi.fn(async () => { throw new Error('down'); }));
    await expectCode(handler(request('p')), 'internal');
  });
});

describe('sanitizeBox', () => {
  const NOT_FOUND = { found: false, box: null };

  it('keeps a valid box, rounded to integers', () => {
    expect(sanitizeBox({ found: true, box_2d: [100.4, 200.6, 900, 800] })).toEqual({ found: true, box: [100, 201, 900, 800] });
  });

  it.each([
    ['found false', { found: false, box_2d: [1, 2, 3, 4] }],
    ['missing box', { found: true }],
    ['wrong length', { found: true, box_2d: [1, 2, 3] }],
    ['out of range', { found: true, box_2d: [0, 0, 1001, 500] }],
    ['negative', { found: true, box_2d: [-1, 0, 500, 500] }],
    ['inverted', { found: true, box_2d: [600, 0, 500, 500] }],
    ['zero width', { found: true, box_2d: [0, 300, 500, 300] }],
    ['non-numeric', { found: true, box_2d: ['1', 0, 500, 500] }],
    ['null output', null],
  ])('rejects %s', (_label, output) => {
    expect(sanitizeBox(output)).toEqual(NOT_FOUND);
  });
});
```

- [ ] **Step 2: Run and confirm failure.**

Run: `npx vitest run src/test/functions/scanCard.test.js`
Expected: FAIL, `createLocateCardHandler is not a function`. The existing 17 tests still pass.

- [ ] **Step 3: Implement.** In `functions/scanCard.js`:
  - Rename `createScanCardHandler` to `createGeminiHandler`, change its parameters to `{ db, appId, run, sanitize, label, failureMessage, HttpsError, logger = console, now = () => new Date() }`, and replace its last block with:

```js
    let output;
    try {
      output = await run(image);
    } catch (err) {
      logger.error(`${label} failed`, { uid, error: err.message });
      throw new HttpsError("internal", failureMessage);
    }

    return sanitize(output);
```

  - Add after it:

```js
const NOT_FOUND = { found: false, box: null };

/** Gemini box_2d is [ymin, xmin, ymax, xmax] on a 0-1000 scale. */
function sanitizeBox(output) {
  const box = output?.box_2d;
  if (output?.found !== true || !Array.isArray(box) || box.length !== 4) return NOT_FOUND;
  if (!box.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1000)) return NOT_FOUND;
  const [ymin, xmin, ymax, xmax] = box.map(Math.round);
  if (ymin >= ymax || xmin >= xmax) return NOT_FOUND;
  return { found: true, box: [ymin, xmin, ymax, xmax] };
}

/** Reads set, number and name off one card photo. */
function createScanCardHandler({ readCard, ...deps }) {
  return createGeminiHandler({
    ...deps,
    run: readCard,
    sanitize: sanitizeRead,
    label: "scanCard recognition",
    failureMessage: "Card recognition failed.",
  });
}

/**
 * Finds the card in a calibration photo. Same entitlement and quota as a scan:
 * it is one Gemini call, made once per rig.
 */
function createLocateCardHandler({ locate, ...deps }) {
  return createGeminiHandler({
    ...deps,
    run: locate,
    sanitize: sanitizeBox,
    label: "locateCard",
    failureMessage: "Card location failed.",
  });
}
```

  - Change the export to `module.exports = { createScanCardHandler, createLocateCardHandler, sanitizeBox, DEFAULT_SCAN_DAILY_LIMIT };`
  - Update the file's header comment: "scanCard and locateCard handlers — shared entitlement, daily quota and input validation…".

- [ ] **Step 4: Run and confirm pass.**

Run: `npx vitest run src/test/functions/scanCard.test.js`
Expected: PASS, all 17 old tests plus the new ones.

- [ ] **Step 5: Commit.**

```bash
npm run test:unit && npx eslint src --ext js,jsx --quiet && git add functions/scanCard.js src/test/functions/scanCard.test.js && git commit -m "feat(functions): locateCard handler sharing scanCard's guards and quota

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Expose `locateCard` with the Gemini locator

**Files:**
- Modify: `SWU-Holocron/functions/index.js`

**Interfaces:**
- Consumes: `createLocateCardHandler` (Task 3).
- Produces: the callable `locateCard`, with request `{ image }` and response `{ found, box }`.

- [ ] **Step 1: Implement.**
  - Change the require to `const { createScanCardHandler, createLocateCardHandler } = require("./scanCard");`.
  - Replace the body of `readCardWithGemini` with a shared helper, and add the locator:

```js
// One image, one prompt, schema-constrained JSON out. Shared by scanCard and
// locateCard so the Vertex setup and the thinking-budget fix exist once.
async function askGemini(imageBase64, prompt, schema) {
  const { GoogleGenAI } = require("@google/genai");
  const ai = new GoogleGenAI({ enterprise: true, project: GCP_PROJECT, location: VERTEX_LOCATION });
  const result = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
        { text: prompt },
      ],
    }],
    config: {
      maxOutputTokens: 256,
      temperature: 0,
      // Required: see getCardSuggestions. Thinking tokens count against the cap.
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  });
  return JSON.parse(result.text);
}

async function readCardWithGemini(imageBase64) {
  return askGemini(imageBase64, SCAN_PROMPT, SCAN_SCHEMA);
}

/**
 * locateCard — finds the card in a scanner-rig calibration photo, using
 * Gemini's native bounding-box format. Called once per rig, not per scan.
 */
const LOCATE_PROMPT = `This photo is taken from above a scanning rig and shows one Star Wars: Unlimited trading card, possibly with paper, a ruler or other objects around it.
Return the bounding box of the card itself -- its outer edge, including the black border -- as box_2d [ymin, xmin, ymax, xmax], normalised to 0-1000.
If there is no card in the photo, set found to false.`;

const LOCATE_SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean" },
    box_2d: { type: "array", items: { type: "integer" } },
  },
  required: ["found", "box_2d"],
};

async function locateCardWithGemini(imageBase64) {
  return askGemini(imageBase64, LOCATE_PROMPT, LOCATE_SCHEMA);
}

const locateCardHandler = createLocateCardHandler({
  db: admin.firestore(),
  appId: APP_ID,
  locate: locateCardWithGemini,
  HttpsError,
  logger,
});

exports.locateCard = onCall({ maxInstances: 5 }, locateCardHandler);
```

- [ ] **Step 2: Verify that it loads and exports.**

Run: `node -e "const f=require('./functions/index.js'); console.log(Object.keys(f).sort().join(','))"`
Expected: `getCardSuggestions,locateCard,redeemInviteCode,scanCard`

- [ ] **Step 3: Re-run the handler tests.**

Run: `npx vitest run src/test/functions/scanCard.test.js`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
npm run test:unit && npx eslint src --ext js,jsx --quiet && git add functions/index.js && git commit -m "feat(functions): expose locateCard with Gemini bounding boxes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `ScanService.locateCard`

**Files:**
- Modify: `SWU-Holocron/src/services/ScanService.js`
- Test: `SWU-Holocron/src/test/services/ScanService.test.js`

**Interfaces:**
- Produces: `ScanService.locateCard(imageBase64) → Promise<{ found, box } | { error, ... }>`. Never throws. Errors go through the existing `mapScanError`.

- [ ] **Step 1: Write the failing tests.** In `src/test/services/ScanService.test.js`, add `import { httpsCallable } from 'firebase/functions';` after the other imports, then append:

```js
describe('ScanService.locateCard', () => {
  it('calls the locateCard function and returns the box', async () => {
    mocks.callable.mockResolvedValue({ data: { found: true, box: [100, 200, 900, 800] } });
    await expect(ScanService.locateCard('IMG')).resolves.toEqual({ found: true, box: [100, 200, 900, 800] });
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'locateCard');
    expect(mocks.callable).toHaveBeenCalledWith({ image: 'IMG' });
  });

  it('normalises a not-found answer', async () => {
    mocks.callable.mockResolvedValue({ data: { found: false } });
    await expect(ScanService.locateCard('IMG')).resolves.toEqual({ found: false, box: null });
  });

  it('maps errors without throwing', async () => {
    mocks.callable.mockRejectedValue(httpsError('resource-exhausted', { limit: 5, resetsAt: 'x' }));
    await expect(ScanService.locateCard('IMG')).resolves.toEqual({ error: 'quota', limit: 5, resetsAt: 'x' });
  });
});
```

- [ ] **Step 2: Run and confirm failure.**

Run: `npx vitest run src/test/services/ScanService.test.js`
Expected: FAIL, `ScanService.locateCard is not a function`.

- [ ] **Step 3: Implement.** Add this to the `ScanService` object, after `scan`:

```js
  /** Finds the card in a rig-calibration photo. Never throws. */
  async locateCard(imageBase64) {
    if (!isConfigured) return { error: 'unknown' };
    try {
      const call = httpsCallable(getFunctions(), 'locateCard');
      const data = (await call({ image: imageBase64 })).data;
      return { found: data?.found === true, box: data?.found === true ? data.box ?? null : null };
    } catch (err) {
      return mapScanError(err);
    }
  },
```

- [ ] **Step 4: Run and confirm pass.**

Run: `npx vitest run src/test/services/ScanService.test.js`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
npm run test:unit && npx eslint src --ext js,jsx --quiet && git add src/services/ScanService.js src/test/services/ScanService.test.js && git commit -m "feat(scanner): ScanService.locateCard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `RigCalibration` overlay

**Files:**
- Create: `SWU-Holocron/src/components/RigCalibration.jsx`
- Test: `SWU-Holocron/src/components/__tests__/RigCalibration.test.jsx`

**Interfaces:**
- Consumes: `boxToRect`, `defaultRect`, `moveCorner`, `cornerPoint`, `orientationOf` (Task 1); `ScanService.locateCard` (Task 5).
- Produces: `<RigCalibration hasCalibration onTakePhoto onSave onClear onClose />`
  - `onTakePhoto: () => Promise<{ image, source, width, height }>`, an uncropped capture supplied by the scanner.
  - `onSave({ rect, source, orientation })`, `onClear()`, `onClose()`.
  - Role `dialog`, name `Calibrate rig`. The rectangle is `data-testid="calib-rect"` with `data-rect` holding the JSON. The handles are buttons named `Top-left corner`, `Top-right corner`, `Bottom-left corner`, `Bottom-right corner`.

- [ ] **Step 1: Write the failing tests.** Create `src/components/__tests__/RigCalibration.test.jsx`:

```jsx
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const mocks = vi.hoisted(() => ({ locateCard: vi.fn() }));
vi.mock('../../services/ScanService', () => ({ ScanService: { locateCard: mocks.locateCard } }));

import RigCalibration from '../RigCalibration';
import { defaultRect } from '../../utils/rigCalibration';

const SHOT = { image: 'IMG', source: 'photo', width: 3000, height: 4000 };

const renderCal = (props = {}) => {
  const handlers = {
    onTakePhoto: vi.fn(async () => SHOT),
    onSave: vi.fn(),
    onClear: vi.fn(),
    onClose: vi.fn(),
  };
  const utils = render(<RigCalibration hasCalibration={false} {...handlers} {...props} />);
  return { ...handlers, ...utils };
};

const rectOf = () => JSON.parse(screen.getByTestId('calib-rect').getAttribute('data-rect'));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locateCard.mockResolvedValue({ found: true, box: [100, 200, 900, 800] });
});

describe('RigCalibration', () => {
  it('shows the card Gemini found on the calibration photo', async () => {
    const user = userEvent.setup();
    renderCal();
    expect(screen.getByRole('dialog', { name: 'Calibrate rig' })).toHaveTextContent(/put a card in the rig/i);
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    expect(await screen.findByTestId('calib-rect')).toBeInTheDocument();
    expect(mocks.locateCard).toHaveBeenCalledWith('IMG');
    expect(rectOf()).toEqual({ x: 0.2, y: 0.1, w: 0.6, h: 0.8 });
    expect(screen.getByRole('img', { name: 'Calibration photo' })).toHaveAttribute('src', 'data:image/jpeg;base64,IMG');
  });

  it('starts from a centred box when no card is found', async () => {
    const user = userEvent.setup();
    mocks.locateCard.mockResolvedValue({ found: false, box: null });
    renderCal();
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await screen.findByTestId('calib-rect');
    expect(rectOf()).toEqual(defaultRect(3000, 4000));
    expect(screen.getByText(/couldn't find the card/i)).toBeInTheDocument();
  });

  it('still allows manual placement when the card finder is unreachable', async () => {
    const user = userEvent.setup();
    mocks.locateCard.mockResolvedValue({ error: 'network' });
    renderCal();
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await screen.findByTestId('calib-rect');
    expect(screen.getByText(/couldn't reach the card finder/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('stays on the first step when no photo could be taken', async () => {
    const user = userEvent.setup();
    const { onTakePhoto } = renderCal();
    onTakePhoto.mockResolvedValue({ image: null, source: 'video', width: 0, height: 0 });
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    expect(await screen.findByText(/couldn't take a photo/i)).toBeInTheDocument();
    expect(mocks.locateCard).not.toHaveBeenCalled();
    expect(screen.queryByTestId('calib-rect')).not.toBeInTheDocument();
  });

  it('nudges a corner with the arrow keys', async () => {
    const user = userEvent.setup();
    renderCal();
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await screen.findByTestId('calib-rect');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Bottom-right corner' }), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Bottom-right corner' }), { key: 'ArrowDown' });
    expect(rectOf()).toEqual({ x: 0.2, y: 0.1, w: 0.605, h: 0.805 });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Top-left corner' }), { key: 'ArrowLeft' });
    expect(rectOf()).toMatchObject({ x: 0.195, w: 0.61 });
  });

  it('saves the rect with the capture source and orientation', async () => {
    const user = userEvent.setup();
    const { onSave } = renderCal();
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await screen.findByTestId('calib-rect');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ rect: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 }, source: 'photo', orientation: 'portrait' });
  });

  it('retakes the photo', async () => {
    const user = userEvent.setup();
    const { onTakePhoto } = renderCal();
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await screen.findByTestId('calib-rect');
    await user.click(screen.getByRole('button', { name: 'Retake' }));
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeInTheDocument();
    expect(onTakePhoto).toHaveBeenCalledTimes(1);
  });

  it('cancels without saving', async () => {
    const user = userEvent.setup();
    const { onClose, onSave } = renderCal();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('offers to clear only when a calibration exists', async () => {
    const user = userEvent.setup();
    const { onClear, unmount } = renderCal();
    expect(screen.queryByRole('button', { name: 'Clear calibration' })).not.toBeInTheDocument();
    unmount();
    const second = renderCal({ hasCalibration: true });
    await user.click(screen.getByRole('button', { name: 'Clear calibration' }));
    expect(second.onClear).toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });

  it('ignores a locate result that arrives after closing', async () => {
    let resolveLocate;
    mocks.locateCard.mockImplementation(() => new Promise((r) => { resolveLocate = r; }));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = renderCal();
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    await act(async () => { await Promise.resolve(); });
    unmount();
    await act(async () => { resolveLocate({ found: true, box: [100, 200, 900, 800] }); });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
```

- [ ] **Step 2: Run and confirm failure.**

Run: `npx vitest run src/components/__tests__/RigCalibration.test.jsx`
Expected: FAIL, import not resolved.

- [ ] **Step 3: Implement.** Create `src/components/RigCalibration.jsx`:

```jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ScanService } from '../services/ScanService';
import { boxToRect, cornerPoint, defaultRect, moveCorner, orientationOf } from '../utils/rigCalibration';

/**
 * Rig calibration: one photo of a card sitting in the user's rig, Gemini finds
 * the card, the user drags (or arrow-key nudges) the corners onto its edges,
 * and the rectangle is saved as fractions of the photo.
 *
 * Calibration never depends on Gemini: if the finder fails or finds nothing,
 * the user places the box by hand from a centred default.
 *
 * @environment:react
 */

const CORNERS = [
  { id: 'tl', label: 'Top-left corner' },
  { id: 'tr', label: 'Top-right corner' },
  { id: 'bl', label: 'Bottom-left corner' },
  { id: 'br', label: 'Bottom-right corner' },
];

const NUDGE = 0.005;
const ARROWS = { ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0], ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE] };

export default function RigCalibration({ hasCalibration, onTakePhoto, onSave, onClear, onClose }) {
  const [step, setStep] = useState('ready'); // ready | working | adjust
  const [shot, setShot] = useState(null);
  const [rect, setRect] = useState(null);
  const [message, setMessage] = useState(null);
  const [dragging, setDragging] = useState(null);
  const areaRef = useRef(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const takePhoto = useCallback(async () => {
    setMessage(null);
    setStep('working');
    const photo = await onTakePhoto();
    if (!mountedRef.current) return;
    if (!photo?.image) {
      setStep('ready');
      setMessage("Couldn't take a photo. Check the camera, then try again.");
      return;
    }
    const located = await ScanService.locateCard(photo.image);
    if (!mountedRef.current) return;
    setShot(photo);
    if (located.found && located.box) {
      setRect(boxToRect(located.box));
      setMessage('Drag the corners onto the card’s edges if needed, then Save.');
    } else {
      setRect(defaultRect(photo.width, photo.height));
      setMessage(located.error
        ? "Couldn't reach the card finder — drag the corners onto the card."
        : "Couldn't find the card — drag the corners onto it.");
    }
    setStep('adjust');
  }, [onTakePhoto]);

  const pointToFraction = (e) => {
    const box = areaRef.current?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return null;
    return { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height };
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const p = pointToFraction(e);
    if (p) setRect((r) => moveCorner(r, dragging, p.x, p.y));
  };

  const onHandleKey = (corner) => (e) => {
    const delta = ARROWS[e.key];
    if (!delta) return;
    e.preventDefault();
    setRect((r) => {
      const p = cornerPoint(r, corner);
      return moveCorner(r, corner, p.x + delta[0], p.y + delta[1]);
    });
  };

  const save = () => onSave({ rect, source: shot.source, orientation: orientationOf(shot.width, shot.height) });

  const retake = () => {
    setShot(null);
    setRect(null);
    setMessage(null);
    setStep('ready');
  };

  return (
    <div
      role="dialog"
      aria-label="Calibrate rig"
      className="absolute inset-0 z-20 flex flex-col bg-gray-950 text-gray-100"
    >
      <div className="flex items-center gap-2 px-4 py-3 bg-gray-900 border-b border-gray-800">
        <h2 className="text-lg font-bold text-white">Calibrate rig</h2>
        {hasCalibration && (
          <button
            type="button"
            onClick={onClear}
            className="ml-auto px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm"
          >
            Clear calibration
          </button>
        )}
      </div>

      {step !== 'adjust' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-gray-300">
            Put a card in the rig exactly as you will scan it, then tap Take photo.
          </p>
          {message && <p role="alert" className="text-sm text-red-300">{message}</p>}
          <button
            type="button"
            onClick={takePhoto}
            disabled={step === 'working'}
            className="px-4 py-2 rounded-lg bg-yellow-500 hover:bg-yellow-400 text-black font-bold disabled:opacity-50 flex items-center gap-2"
          >
            {step === 'working' && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            {step === 'working' ? 'Finding the card…' : 'Take photo'}
          </button>
        </div>
      )}

      {step === 'adjust' && shot && rect && (
        <div className="flex-1 flex items-center justify-center p-3 overflow-hidden">
          <div
            ref={areaRef}
            className="relative max-h-full max-w-full touch-none select-none"
            style={{ aspectRatio: `${shot.width} / ${shot.height}`, height: '100%' }}
            onPointerMove={onPointerMove}
            onPointerUp={() => setDragging(null)}
            onPointerCancel={() => setDragging(null)}
          >
            <img
              src={`data:image/jpeg;base64,${shot.image}`}
              alt="Calibration photo"
              className="absolute inset-0 w-full h-full object-fill"
              draggable={false}
            />
            <div
              data-testid="calib-rect"
              data-rect={JSON.stringify(rect)}
              className="absolute border-2 border-yellow-400 bg-yellow-400/10"
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.w * 100}%`,
                height: `${rect.h * 100}%`,
              }}
            />
            {CORNERS.map(({ id, label }) => {
              const p = cornerPoint(rect, id);
              return (
                <button
                  key={id}
                  type="button"
                  aria-label={label}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.currentTarget.setPointerCapture?.(e.pointerId);
                    setDragging(id);
                  }}
                  onKeyDown={onHandleKey(id)}
                  className="absolute w-8 h-8 -ml-4 -mt-4 rounded-full bg-yellow-400 border-2 border-black shadow-lg touch-none"
                  style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                />
              );
            })}
          </div>
        </div>
      )}

      <div className="px-4 py-3 bg-gray-900 border-t border-gray-800 space-y-2">
        {step === 'adjust' && message && <p className="text-sm text-gray-300">{message}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm"
          >
            Cancel
          </button>
          {step === 'adjust' && (
            <>
              <button
                type="button"
                onClick={retake}
                className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm"
              >
                Retake
              </button>
              <button
                type="button"
                onClick={save}
                className="flex-1 py-2 rounded-lg bg-yellow-500 hover:bg-yellow-400 text-black font-bold"
              >
                Save
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run and confirm pass.**

Run: `npx vitest run src/components/__tests__/RigCalibration.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
npm run test:unit && npx eslint src --ext js,jsx --quiet && git add src/components/RigCalibration.jsx src/components/__tests__/RigCalibration.test.jsx && git commit -m "feat(scanner): rig calibration overlay with auto-located, adjustable card box

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Wire calibration into `CardScanner`

**Files:**
- Modify: `SWU-Holocron/src/components/CardScanner.jsx`
- Test: `SWU-Holocron/src/components/__tests__/CardScanner.test.jsx`

**Interfaces:**
- Consumes: `loadCalibration`, `saveCalibration`, `clearCalibration`, `cropFor`, `guideStyle` (Task 1); `capturePhoto` with `crop` (Task 2); `RigCalibration` (Task 6).
- Produces:
  - A toolbar button named `Calibrate rig`.
  - `card-guide` gains `data-calibrated="true|false"`.
  - Footer text `photo W×H · cropped` or `photo W×H · full frame`.

- [ ] **Step 1: Update the test harness and add the failing tests.** In `src/components/__tests__/CardScanner.test.jsx`:
  - Mock the overlay, next to the other `vi.mock` calls:

```jsx
vi.mock('../RigCalibration', () => ({
  default: ({ onSave, onClose }) => (
    <div role="dialog" aria-label="Calibrate rig">
      <button type="button" onClick={() => onSave({ rect: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 }, source: 'photo', orientation: 'portrait' })}>save-mock</button>
      <button type="button" onClick={onClose}>close-mock</button>
    </div>
  ),
}));
```

  - Next to `let helpSeen = true;`, add `let rigStored = null;`. In `beforeEach`, set `rigStored = null;` and change the `getItem` implementation to:

```js
  localStorage.getItem.mockImplementation((key) => {
    if (key === 'swu-scan-help-seen') return helpSeen ? '1' : null;
    if (key === 'swu-scan-rig') return rigStored;
    return null;
  });
```

  - Change `shows which capture path ran and at what size` to expect `'photo 4080×3072 · full frame'`.
  - Add these tests before `persists the batch under the user's own key`:

```jsx
  it('crops captures to the saved calibration', async () => {
    rigStored = JSON.stringify({ version: 1, rect: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 }, source: 'photo', orientation: 'portrait', savedAt: 1 });
    mocks.capturePhoto.mockResolvedValue({ ...PHOTO, width: 3024, height: 4032, cropped: true });
    renderScanner();
    expect(screen.getByTestId('card-guide')).toHaveAttribute('data-calibrated', 'true');
    pressSpace();
    await waitFor(() => expect(mocks.capturePhoto).toHaveBeenCalled());
    const { crop } = mocks.capturePhoto.mock.calls[0][0];
    expect(crop('photo', 3024, 4032)).toEqual({ x: 0.176, y: 0.068, w: 0.648, h: 0.864 });
    expect(crop('video', 3024, 4032)).toBeNull();
    expect(crop('photo', 4032, 3024)).toBeNull();
    expect(await screen.findByText('photo 3024×4032 · cropped')).toBeInTheDocument();
  });

  it('falls back to the centred guide when the preview size is unknown', () => {
    rigStored = JSON.stringify({ version: 1, rect: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 }, source: 'photo', orientation: 'portrait', savedAt: 1 });
    renderScanner();
    // happy-dom has no layout: no video size, so no calibrated position yet.
    expect(screen.getByTestId('card-guide').className).toContain('left-1/2');
  });

  it('opens calibration, pauses capture, and saves the rig', async () => {
    const user = userEvent.setup();
    renderScanner();
    expect(screen.getByTestId('card-guide')).toHaveAttribute('data-calibrated', 'false');
    await user.click(screen.getByRole('button', { name: 'Calibrate rig' }));
    expect(screen.getByRole('dialog', { name: 'Calibrate rig' })).toBeInTheDocument();
    pressSpace();
    await flush();
    expect(mocks.capturePhoto).not.toHaveBeenCalled();
    await user.click(screen.getByText('save-mock'));
    expect(screen.queryByRole('dialog', { name: 'Calibrate rig' })).not.toBeInTheDocument();
    expect(localStorage.setItem).toHaveBeenCalledWith('swu-scan-rig', expect.stringContaining('"source":"photo"'));
    expect(screen.getByTestId('card-guide')).toHaveAttribute('data-calibrated', 'true');
  });

  it('mentions calibration in the how-to', () => {
    helpSeen = false;
    renderScanner();
    expect(screen.getByRole('dialog', { name: 'How to scan' })).toHaveTextContent(/calibrate/i);
  });
```

- [ ] **Step 2: Run and confirm failure.**

Run: `npx vitest run src/components/__tests__/CardScanner.test.jsx`
Expected: FAIL. There's no `Calibrate rig` button, no `data-calibrated`, no crop function passed, and the footer text is the old one.

- [ ] **Step 3: Implement** in `src/components/CardScanner.jsx`:
  - Imports:

```jsx
import { X, Sparkles, HelpCircle, Crosshair } from 'lucide-react';
import { clearCalibration, cropFor, guideStyle, loadCalibration, saveCalibration } from '../utils/rigCalibration';
import RigCalibration from './RigCalibration';
```

  - State and refs, next to the others and above the account-switch block:

```jsx
  const [calibration, setCalibration] = useState(() => loadCalibration(getStorage()));
  const [calibrating, setCalibrating] = useState(false);
  const [view, setView] = useState({ vw: 0, vh: 0, bw: 0, bh: 0 });
  const calibratingRef = useRef(false);
  calibratingRef.current = calibrating;
  const previewRef = useRef(null);
```

  - In `capture`, add `calibratingRef.current ||` to the opening guard, pass the crop, record `cropped`, and add `calibration` to the deps:

```jsx
    if (calibratingRef.current || helpOpenRef.current || quotaRef.current || cameraError || capturingRef.current) return;
    ...
      shot = await capturePhoto({
        track: trackRef.current,
        video: videoRef.current,
        crop: (source, width, height) => cropFor(calibration, source, width, height),
      });
    ...
    setLastCapture({ source: shot.source, width: shot.width, height: shot.height, cropped: Boolean(shot.cropped) });
  }, [calibration, cameraError, foilStack, runScan, signalProblem]);
```

  - In the key listener, before anything else, add `if (calibratingRef.current) return;`, so keys reach the calibration buttons untouched.
  - Track the preview and video size for the calibrated guide:

```jsx
  useEffect(() => {
    if (mode !== 'camera') return undefined;
    const video = videoRef.current;
    const box = previewRef.current;
    if (!video || !box) return undefined;
    const measure = () => {
      const r = box.getBoundingClientRect();
      setView({ vw: video.videoWidth, vh: video.videoHeight, bw: r.width, bh: r.height });
    };
    video.addEventListener('loadedmetadata', measure);
    video.addEventListener('resize', measure);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(box);
    measure();
    return () => {
      video.removeEventListener('loadedmetadata', measure);
      video.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [mode]);
```

  - Calibration handlers:

```jsx
  const takeCalibrationPhoto = useCallback(
    () => capturePhoto({ track: trackRef.current, video: videoRef.current }),
    [],
  );

  const saveRig = useCallback((cal) => {
    const saved = saveCalibration(getStorage(), cal);
    // Storage unavailable: keep it for this session anyway.
    setCalibration(saved ?? { version: 1, ...cal, savedAt: Date.now() });
    setCalibrating(false);
  }, []);

  const clearRig = useCallback(() => {
    clearCalibration(getStorage());
    setCalibration(null);
    setCalibrating(false);
  }, []);
```

  - Toolbar: after the How-to button, add:

```jsx
        <button
          type="button"
          aria-label="Calibrate rig"
          title="Calibrate for your rig"
          onClick={() => setCalibrating(true)}
          className={`p-2 rounded-lg border ${
            calibration
              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
          }`}
        >
          <Crosshair size={18} aria-hidden="true" />
        </button>
```

    And add `flex-wrap` to the toolbar's `className`, so five controls wrap on narrow phones instead of overflowing.
  - Preview container: add `ref={previewRef}`.
  - Guide: compute `const calibratedStyle = calibration ? guideStyle(calibration.rect, view.vw, view.vh, view.bw, view.bh) : null;` just before `return` (after the review-mode early return is fine; it isn't a hook). Then change the `card-guide` element:

```jsx
        <div
          data-testid="card-guide"
          data-calibrated={String(Boolean(calibration))}
          aria-hidden="true"
          className={`pointer-events-none absolute border-2 border-yellow-500/70 rounded-xl ${
            calibratedStyle ? '' : 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'
          }`}
          style={calibratedStyle
            ? { left: calibratedStyle.left, top: calibratedStyle.top, width: calibratedStyle.width, height: calibratedStyle.height }
            : { width: 'min(96cqw, calc(92cqh * 63 / 88))', aspectRatio: '63 / 88' }}
        >
```

    Then update the comment above it: when calibrated, the guide sits where the calibration says the card is. It's approximate, because the live stream and the still photo can frame slightly differently, but the crop is exact.
  - How-to list: insert a first item:
    `<li>Using a fixed rig? Tap the crosshair once with a card in place to calibrate — every scan is then cropped to the card.</li>`
  - Footer:

```jsx
        {lastCapture && (
          <span className="text-gray-500">
            {lastCapture.source} {lastCapture.width}×{lastCapture.height} · {lastCapture.cropped ? 'cropped' : 'full frame'}
          </span>
        )}
```

  - Overlay: render inside the camera-mode root, after the help panel:

```jsx
      {calibrating && (
        <RigCalibration
          hasCalibration={Boolean(calibration)}
          onTakePhoto={takeCalibrationPhoto}
          onSave={saveRig}
          onClear={clearRig}
          onClose={() => setCalibrating(false)}
        />
      )}
```

- [ ] **Step 4: Run and confirm pass.**

Run: `npx vitest run src/components/__tests__/CardScanner.test.jsx`
Expected: PASS.

- [ ] **Step 5: Run the full suite, lint and build, then commit.**

```bash
npm run test:unit && npx eslint src --ext js,jsx --quiet && npm run build && git add src/components/CardScanner.jsx src/components/__tests__/CardScanner.test.jsx && git commit -m "feat(scanner): calibrate to a rig and crop every capture to the card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs and hand-off

**Files:**
- Modify: `CLAUDE.md` (git root), `SWU-Holocron/TESTING.md`, `SWU-Holocron/docs/DEPLOYMENT_RUNBOOK.md`

- [ ] **Step 1: Update `CLAUDE.md`.**
  - In the "Card scanner" section, add a bullet on rig calibration:
    - `locateCard` finds the card's box once per rig.
    - The calibration is stored per device in `swu-scan-rig` as photo fractions plus source and orientation (`src/utils/rigCalibration.js`).
    - Captures are cropped to it with a 4% margin.
    - A capture from a different source or orientation is sent full frame.
    - `scanCard` and `locateCard` share one pipeline in `functions/scanCard.js`.
  - Add `swu-scan-rig` and `swu-scan-help-seen` to the `localStorage` key list.
- [ ] **Step 2: Update `TESTING.md`.** Under "Card scanner — manual checks", add:
  - Calibrate on the rig, and check the detected box fits the card.
  - Check the live outline sits over the card. Note any offset; it is approximate by design.
  - Check the footer shows `· cropped`.
  - Compare the unidentified count on the same stack, calibrated vs. cleared.
- [ ] **Step 3: Update `DEPLOYMENT_RUNBOOK.md`.** In the "Card scanner" section, make the deploy command `firebase deploy --only functions:scanCard,functions:locateCard`, and note that `locateCard` must be deployed before the web app ships, or Calibrate falls back to manual placement.
- [ ] **Step 4: Commit.**

```bash
git add ../CLAUDE.md TESTING.md docs/DEPLOYMENT_RUNBOOK.md && git commit -m "docs: scanner rig calibration

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Hand-off.** The user deploys the function (`firebase deploy --only functions:locateCard`), then replies "merge". After the merge, they test calibration on their rig. Do not claim the crop works until they have seen `· cropped` and a good read on the rig.
