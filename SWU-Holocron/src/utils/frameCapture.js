/**
 * Card-scanner image capture.
 *
 * Prefers a real still photo (ImageCapture.takePhoto, Chrome on Android): the
 * camera's full-resolution photo pipeline, the same one the camera app uses.
 * A frame grabbed from the video stream is far softer -- on a Pixel the preview
 * stream was too smeared for Gemini to read the collector number -- so it is
 * only the fallback (iOS Safari, most desktops, or a takePhoto failure).
 *
 * Either way the image is scaled so its long edge is at most 2048px, which keeps
 * the collector digits around four times the detail of the old 1024px frames
 * while the upload stays well under the function's 2 MB limit.
 *
 * @environment:web-media
 */
export const CAPTURE_MAX_EDGE = 2048;
const JPEG_QUALITY = 0.85;

export function fitWithin(width, height, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Draw a bitmap or video onto a canvas at the given size; base64 JPEG, no prefix. */
export function encodeJpeg(source, { width, height }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(source, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1] ?? null;
}

/**
 * @returns {Promise<{ image: string|null, source: 'photo'|'video', width: number, height: number }>}
 *   width/height are the camera's native size, for the scanner footer.
 */
export async function capturePhoto({
  track,
  video,
  ImageCaptureCtor = globalThis.ImageCapture,
  decodeBlob = (blob) => createImageBitmap(blob),
  encode = encodeJpeg,
}) {
  if (ImageCaptureCtor && track) {
    try {
      const blob = await new ImageCaptureCtor(track).takePhoto();
      const bitmap = await decodeBlob(blob);
      const image = encode(bitmap, fitWithin(bitmap.width, bitmap.height, CAPTURE_MAX_EDGE));
      bitmap.close?.();
      if (image) return { image, source: 'photo', width: bitmap.width, height: bitmap.height };
    } catch {
      // takePhoto can reject (camera busy, unsupported settings): use a frame.
    }
  }

  const width = video?.videoWidth ?? 0;
  const height = video?.videoHeight ?? 0;
  if (!width || !height) return { image: null, source: 'video', width: 0, height: 0 };
  return { image: encode(video, fitWithin(width, height, CAPTURE_MAX_EDGE)), source: 'video', width, height };
}
