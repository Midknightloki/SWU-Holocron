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

/**
 * Crop for a frame of the live video stream. The calibration's fractions are
 * of the still photo; the stream is usually a centre crop of it (16:9 of a
 * 4:3 sensor), so the margined rect is converted to stream fractions.
 */
export function videoCropFor(calibration, width, height) {
  if (!calibration || calibration.orientation !== orientationOf(width, height)) return null;
  return clampRect(toStreamRect(withMargin(calibration.rect), width / height, calibration.aspect));
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

/**
 * Photo fractions -> stream fractions. A 16:9 stream is a centre crop of the
 * 4:3 sensor the still photo uses, so the same card sits at different
 * fractions in each. Without the photo's aspect, the two are assumed to match.
 */
export function toStreamRect(rect, streamAspect, photoAspect) {
  if (!(photoAspect > 0) || !(streamAspect > 0) || streamAspect === photoAspect) return rect;
  if (streamAspect < photoAspect) {
    const f = streamAspect / photoAspect;
    return { ...rect, x: (rect.x - (1 - f) / 2) / f, w: rect.w / f };
  }
  const f = photoAspect / streamAspect;
  return { ...rect, y: (rect.y - (1 - f) / 2) / f, h: rect.h / f };
}

export function clampRect(rect) {
  const left = clamp01(rect.x);
  const top = clamp01(rect.y);
  const right = clamp01(rect.x + rect.w);
  const bottom = clamp01(rect.y + rect.h);
  return rect4({ x: left, y: top, w: right - left, h: bottom - top });
}

/**
 * Where to draw a photo-fraction rect over the live preview (object-contain).
 *
 * The stream and the still photo usually differ in shape: a 16:9 stream is a
 * centre crop of the 4:3 sensor the photo uses. With the photo's aspect known,
 * the rect is first converted from photo fractions to stream fractions;
 * without it (older calibrations) the two are assumed to match.
 */
export function guideStyle(rect, videoWidth, videoHeight, boxWidth, boxHeight, photoAspect) {
  if (!(videoWidth > 0 && videoHeight > 0 && boxWidth > 0 && boxHeight > 0)) return null;
  rect = toStreamRect(rect, videoWidth / videoHeight, photoAspect);
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

/**
 * The calibrated guide for the current preview, or null to fall back to the
 * centred guide: when uncalibrated, when the preview size is unknown, or when
 * the phone is now in the other orientation (the crop is skipped then too).
 */
export function calibratedGuide(calibration, { vw, vh, bw, bh }) {
  if (!calibration || !(vw > 0 && vh > 0)) return null;
  if (calibration.orientation !== orientationOf(vw, vh)) return null;
  return guideStyle(calibration.rect, vw, vh, bw, bh, calibration.aspect);
}

const isFraction = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

function isValidRect(rect) {
  if (!rect) return false;
  const { x, y, w, h } = rect;
  if (![x, y, w, h].every(isFraction)) return false;
  return w >= MIN_SIZE - 1e-9 && h >= MIN_SIZE - 1e-9 && x + w <= 1 + 1e-9 && y + h <= 1 + 1e-9;
}

export function saveCalibration(storage, { rect, source, orientation, aspect }) {
  const calibration = { version: 1, rect: rect4(rect), source, orientation, savedAt: Date.now() };
  if (Number.isFinite(aspect) && aspect > 0) calibration.aspect = aspect;
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
    if (c.aspect !== undefined && !(Number.isFinite(c.aspect) && c.aspect > 0)) return null;
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
