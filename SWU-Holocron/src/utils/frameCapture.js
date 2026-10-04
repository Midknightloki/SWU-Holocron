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
import { cropPixels } from './rigCalibration';

export const CAPTURE_MAX_EDGE = 2048;
const JPEG_QUALITY = 0.85;

export function fitWithin(width, height, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

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

/** Draw the region of a source at the given size and return grayscale pixels. */
export function grayscaleOf(source, { width, height }, region) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, region.sx, region.sy, region.sw, region.sh, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Math.round(data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114);
  }
  return out;
}

// Near native resolution for a 4K stream's card crop: a heavier downscale
// averages away the 2-3 px smear that makes collector digits unreadable.
const SHARPNESS_EDGE = 1600;

/**
 * An instant capture: the current frame of the live stream, cropped to the
 * card at full stream resolution, plus a small grayscale copy for the
 * sharpness check. No shutter wait -- the card can be pulled immediately.
 */
export function captureVideoFrame({ video, crop = () => null, encode = encodeJpeg, toGray = grayscaleOf }) {
  const width = video?.videoWidth ?? 0;
  const height = video?.videoHeight ?? 0;
  if (!width || !height) return null;
  try {
    const rect = crop('video', width, height);
    const region = rect ? cropPixels(rect, width, height) : { sx: 0, sy: 0, sw: width, sh: height };
    const image = encode(video, fitWithin(region.sw, region.sh, CAPTURE_MAX_EDGE), region);
    const graySize = fitWithin(region.sw, region.sh, SHARPNESS_EDGE);
    const gray = toGray(video, graySize, region);
    if (!image || !gray) return null;
    return { image, gray, grayWidth: graySize.width, grayHeight: graySize.height, source: 'video', width, height, cropped: Boolean(rect) };
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<{ image: string|null, source: 'photo'|'video', width: number, height: number, cropped: boolean }>}
 *   width/height are the camera's native size; `cropped` drives the scanner's
 *   "not cropped" warning on the calibrate button.
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
