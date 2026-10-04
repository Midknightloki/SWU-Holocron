/**
 * Sharpness of a grayscale image: the variance of its 4-neighbour Laplacian.
 * Sharp edges give large positive and negative responses (high variance);
 * blur flattens them. The scanner uses it to decide whether an instant
 * video frame is good enough or a full photo is needed.
 */
export function laplacianVariance(gray, width, height) {
  if (!gray || width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      sum += lap;
      sumSq += lap * lap;
      n += 1;
    }
  }
  const mean = sum / n;
  return Math.max(0, sumSq / n - mean * mean);
}
