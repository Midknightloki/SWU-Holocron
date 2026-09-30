/**
 * Grab the current frame of a <video> as a base64 JPEG (no data: prefix),
 * scaled so its long edge is at most maxEdge. About 1024px is enough for
 * Gemini to read the collector line and keeps each upload near 100-150 KB.
 *
 * Browser only: happy-dom has no real canvas, so this is verified by hand
 * (see TESTING.md) and mocked in component tests.
 *
 * @environment:web-media
 */
export function captureFrame(video, { maxEdge = 1024, quality = 0.8 } = {}) {
  const width = video?.videoWidth;
  const height = video?.videoHeight;
  if (!width || !height) return null;

  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? null;
}
