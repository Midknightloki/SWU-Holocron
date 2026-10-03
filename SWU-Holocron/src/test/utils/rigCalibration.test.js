import { describe, it, expect } from 'vitest';
import {
  RIG_KEY, CROP_MARGIN, MIN_SIZE, boxToRect, defaultRect, withMargin, cropPixels,
  orientationOf, cropFor, cornerPoint, moveCorner, guideStyle, calibratedGuide, toStreamRect, clampRect,
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

  it('maps a 4:3 photo rect onto the narrower 16:9 stream the preview shows', () => {
    // Portrait 9:16 stream is a centre crop of the 3:4 photo: it shows the
    // middle 75% of the photo's width. A card at photo x 0.15-0.85 fills
    // stream x 0.033-0.967; drawing it at 0.15-0.85 was ~25% too narrow.
    const card = { x: 0.15, y: 0.1, w: 0.7, h: 0.8 };
    const s = guideStyle(card, 1080, 1920, 450, 800, 3 / 4);
    expect(s.left).toBeCloseTo(15, 1);
    expect(s.width).toBeCloseTo(420, 1);
    expect(s.top).toBeCloseTo(80, 1);
    expect(s.height).toBeCloseTo(640, 1);
  });

  it('maps onto a stream that is taller than the photo by cropping height', () => {
    // Landscape: 4:3 photo, 16:9 stream shows the middle 75% of the height.
    const card = { x: 0.1, y: 0.15, w: 0.8, h: 0.7 };
    const s = guideStyle(card, 1920, 1080, 800, 450, 4 / 3);
    expect(s.top).toBeCloseTo(15, 1);
    expect(s.height).toBeCloseTo(420, 1);
    expect(s.left).toBeCloseTo(80, 1);
  });

  it('converts photo fractions to stream fractions for a narrower stream', () => {
    // 9:16 stream shows the middle 75% of a 3:4 photo's width.
    const r = toStreamRect({ x: 0.15, y: 0.1, w: 0.7, h: 0.8 }, 9 / 16, 3 / 4);
    expect(r.x).toBeCloseTo(0.0333, 3);
    expect(r.w).toBeCloseTo(0.9333, 3);
    expect(r).toMatchObject({ y: 0.1, h: 0.8 });
  });

  it('leaves the rect alone when the aspects match or the photo aspect is unknown', () => {
    expect(toStreamRect(RECT, 0.75, 0.75)).toEqual(RECT);
    expect(toStreamRect(RECT, 0.5625, undefined)).toEqual(RECT);
  });

  it('clamps a rect to the frame', () => {
    expect(clampRect({ x: -0.1, y: 0.5, w: 0.5, h: 0.7 })).toEqual({ x: 0, y: 0.5, w: 0.4, h: 0.5 });
  });

  it('guideStyle returns null without sizes', () => {
    expect(guideStyle(RECT, 0, 0, 400, 800)).toBeNull();
    expect(guideStyle(RECT, 3024, 4032, 0, 0)).toBeNull();
  });
});

describe('calibratedGuide', () => {
  const view = { vw: 1080, vh: 1920, bw: 450, bh: 800 };

  it('places the guide when the stream matches the calibration orientation', () => {
    expect(calibratedGuide({ ...CAL, aspect: 0.75 }, view)).toMatchObject({ width: expect.any(Number) });
  });

  it('falls back (null) when the phone has been rotated since calibrating', () => {
    expect(calibratedGuide(CAL, { vw: 1920, vh: 1080, bw: 800, bh: 450 })).toBeNull();
  });

  it('falls back (null) when uncalibrated or sizes are unknown', () => {
    expect(calibratedGuide(null, view)).toBeNull();
    expect(calibratedGuide(CAL, { vw: 0, vh: 0, bw: 0, bh: 0 })).toBeNull();
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
    const saved = saveCalibration(storage, { rect: RECT, source: 'photo', orientation: 'portrait', aspect: 0.75 });
    expect(saved).toMatchObject({ version: 1, rect: RECT, source: 'photo', orientation: 'portrait', aspect: 0.75 });
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
      JSON.stringify({ version: 1, rect: RECT, source: 'photo', orientation: 'portrait', aspect: -1 }),
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
