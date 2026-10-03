import { describe, it, expect, vi } from 'vitest';
import { createFrameSampler } from '../../utils/frameSampler';

const fakeCanvas = (rgba) => {
  const ctx = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: rgba })),
  };
  return { canvas: { getContext: vi.fn(() => ctx) }, ctx };
};

describe('createFrameSampler', () => {
  it('draws the calibrated region of the video and returns grayscale', () => {
    // 2x1 sample: one pure red pixel, one white pixel.
    const { canvas, ctx } = fakeCanvas(new Uint8ClampedArray([255, 0, 0, 255, 255, 255, 255, 255]));
    const sample = createFrameSampler({ width: 2, height: 1, createCanvas: () => canvas });
    const video = { videoWidth: 1000, videoHeight: 2000 };
    const out = sample(video, { x: 0.1, y: 0.2, w: 0.5, h: 0.25 });
    expect(ctx.drawImage).toHaveBeenCalledWith(video, 100, 400, 500, 500, 0, 0, 2, 1);
    expect(Array.from(out)).toEqual([76, 255]);
  });

  it('reuses one canvas across samples', () => {
    const { canvas } = fakeCanvas(new Uint8ClampedArray(8));
    const createCanvas = vi.fn(() => canvas);
    const sample = createFrameSampler({ width: 2, height: 1, createCanvas });
    const video = { videoWidth: 10, videoHeight: 10 };
    sample(video, { x: 0, y: 0, w: 1, h: 1 });
    sample(video, { x: 0, y: 0, w: 1, h: 1 });
    expect(createCanvas).toHaveBeenCalledTimes(1);
  });

  it('returns null without video dimensions', () => {
    const sample = createFrameSampler({ createCanvas: () => fakeCanvas(new Uint8ClampedArray(0)).canvas });
    expect(sample({ videoWidth: 0, videoHeight: 0 }, { x: 0, y: 0, w: 1, h: 1 })).toBeNull();
    expect(sample(null, { x: 0, y: 0, w: 1, h: 1 })).toBeNull();
  });

  it('returns null when drawing throws (video not ready)', () => {
    const canvas = { getContext: () => ({ drawImage: () => { throw new Error('InvalidStateError'); }, getImageData: vi.fn() }) };
    const sample = createFrameSampler({ width: 2, height: 1, createCanvas: () => canvas });
    expect(sample({ videoWidth: 10, videoHeight: 10 }, { x: 0, y: 0, w: 1, h: 1 })).toBeNull();
  });
});
