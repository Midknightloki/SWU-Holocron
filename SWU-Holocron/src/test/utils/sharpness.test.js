import { describe, it, expect } from 'vitest';
import { laplacianVariance } from '../../utils/sharpness';

const W = 32;
const H = 32;
const checker = (block) => Uint8Array.from({ length: W * H }, (_, i) => {
  const x = i % W;
  const y = Math.floor(i / W);
  return (Math.floor(x / block) + Math.floor(y / block)) % 2 ? 230 : 20;
});
const boxBlur = (img, passes) => {
  let src = Float32Array.from(img);
  for (let p = 0; p < passes; p += 1) {
    const out = new Float32Array(src.length);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && xx < W && yy >= 0 && yy < H) { sum += src[yy * W + xx]; n += 1; }
          }
        }
        out[y * W + x] = sum / n;
      }
    }
    src = out;
  }
  return src;
};

describe('laplacianVariance', () => {
  it('is zero for a flat image', () => {
    expect(laplacianVariance(new Uint8Array(W * H).fill(128), W, H)).toBe(0);
  });

  it('is high for sharp edges and drops as the image blurs', () => {
    const sharp = laplacianVariance(checker(4), W, H);
    const soft = laplacianVariance(boxBlur(checker(4), 1), W, H);
    const softer = laplacianVariance(boxBlur(checker(4), 3), W, H);
    expect(sharp).toBeGreaterThan(1000);
    expect(soft).toBeLessThan(sharp);
    expect(softer).toBeLessThan(soft);
  });

  it('returns 0 for images too small to filter', () => {
    expect(laplacianVariance(new Uint8Array(4), 2, 2)).toBe(0);
    expect(laplacianVariance(null, 0, 0)).toBe(0);
  });
});
