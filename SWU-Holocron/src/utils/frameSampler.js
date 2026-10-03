/**
 * Tiny grayscale samples of the calibrated card area of the live video, for
 * auto-capture change detection (~10 per second). One reused canvas; any
 * failure (no frame yet, video not ready) returns null and the tick is skipped.
 *
 * @environment:web-media
 */
const defaultCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

export function createFrameSampler({ width = 48, height = 64, createCanvas = defaultCanvas } = {}) {
  let ctx = null;
  return (video, rect) => {
    const vw = video?.videoWidth;
    const vh = video?.videoHeight;
    if (!vw || !vh) return null;
    try {
      if (!ctx) ctx = createCanvas(width, height).getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      const sx = Math.max(0, Math.floor(rect.x * vw));
      const sy = Math.max(0, Math.floor(rect.y * vh));
      const sw = Math.max(1, Math.min(vw - sx, Math.round(rect.w * vw)));
      const sh = Math.max(1, Math.min(vh - sy, Math.round(rect.h * vh)));
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
      const { data } = ctx.getImageData(0, 0, width, height);
      const out = new Uint8Array(width * height);
      for (let i = 0; i < out.length; i += 1) {
        out[i] = Math.round(data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114);
      }
      return out;
    } catch {
      return null;
    }
  };
}
