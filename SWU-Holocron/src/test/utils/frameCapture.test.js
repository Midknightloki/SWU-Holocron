import { describe, it, expect, vi } from 'vitest';
import { fitWithin, capturePhoto, captureVideoFrame, CAPTURE_MAX_EDGE } from '../../utils/frameCapture';

const video = { videoWidth: 1280, videoHeight: 720 };
const track = { kind: 'video' };

const fakeImageCapture = (takePhoto) => vi.fn(function ImageCapture(t) {
  this.track = t;
  this.takePhoto = takePhoto;
});

describe('fitWithin', () => {
  it('scales the long edge down to the limit, keeping aspect', () => {
    expect(fitWithin(4080, 3072, 2048)).toEqual({ width: 2048, height: 1542 });
    expect(fitWithin(3072, 4080, 2048)).toEqual({ width: 1542, height: 2048 });
  });
  it('never scales up', () => {
    expect(fitWithin(1280, 720, 2048)).toEqual({ width: 1280, height: 720 });
  });
});

describe('capturePhoto', () => {
  it('sends 2048px, four times the detail of the old 1024px frames', () => {
    expect(CAPTURE_MAX_EDGE).toBe(2048);
  });

  it('takes a real still photo when the browser supports ImageCapture', async () => {
    const blob = { type: 'image/jpeg' };
    const ImageCaptureCtor = fakeImageCapture(vi.fn(async () => blob));
    const bitmap = { width: 4080, height: 3072 };
    const decodeBlob = vi.fn(async () => bitmap);
    const encode = vi.fn(() => 'PHOTO');

    const result = await capturePhoto({ track, video, ImageCaptureCtor, decodeBlob, encode });

    expect(ImageCaptureCtor).toHaveBeenCalledWith(track);
    expect(decodeBlob).toHaveBeenCalledWith(blob);
    expect(encode).toHaveBeenCalledWith(bitmap, { width: 2048, height: 1542 });
    expect(result).toEqual({ image: 'PHOTO', source: 'photo', width: 4080, height: 3072, cropped: false });
  });

  it('reports the photo size even though the bitmap is released after encoding', async () => {
    // Production showed 'photo 0x0': a closed ImageBitmap reports width/height 0.
    const bitmap = { width: 4080, height: 3072, close() { this.width = 0; this.height = 0; } };
    const ImageCaptureCtor = fakeImageCapture(vi.fn(async () => ({})));
    const result = await capturePhoto({ track, video, ImageCaptureCtor, decodeBlob: async () => bitmap, encode: () => 'PHOTO' });
    expect(result).toMatchObject({ source: 'photo', width: 4080, height: 3072 });
  });

  it('falls back to a video frame when ImageCapture is unavailable', async () => {
    const encode = vi.fn(() => 'FRAME');
    const result = await capturePhoto({ track, video, ImageCaptureCtor: undefined, encode });
    expect(encode).toHaveBeenCalledWith(video, { width: 1280, height: 720 });
    expect(result).toEqual({ image: 'FRAME', source: 'video', width: 1280, height: 720, cropped: false });
  });

  it('falls back to a video frame when takePhoto fails', async () => {
    const ImageCaptureCtor = fakeImageCapture(vi.fn(async () => { throw new Error('busy'); }));
    const encode = vi.fn(() => 'FRAME');
    const result = await capturePhoto({ track, video, ImageCaptureCtor, encode });
    expect(result).toMatchObject({ image: 'FRAME', source: 'video' });
  });

  it('returns no image when the video has no frame yet', async () => {
    const encode = vi.fn();
    const result = await capturePhoto({ track: null, video: { videoWidth: 0, videoHeight: 0 }, encode });
    expect(result).toEqual({ image: null, source: 'video', width: 0, height: 0, cropped: false });
    expect(encode).not.toHaveBeenCalled();
  });
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
});

describe('captureVideoFrame', () => {
  it('grabs the cropped region of the stream and a small grayscale copy', () => {
    const encode = vi.fn(() => 'FRAME');
    const toGray = vi.fn(() => new Uint8Array(4));
    const video4k = { videoWidth: 2160, videoHeight: 3840 };
    const out = captureVideoFrame({ video: video4k, crop: () => ({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }), encode, toGray });
    expect(encode).toHaveBeenCalledWith(video4k, { width: 1080, height: 1920 }, { sx: 540, sy: 960, sw: 1080, sh: 1920 });
    expect(toGray).toHaveBeenCalledWith(video4k, { width: 288, height: 512 }, { sx: 540, sy: 960, sw: 1080, sh: 1920 });
    expect(out).toMatchObject({ image: 'FRAME', grayWidth: 288, grayHeight: 512, source: 'video', width: 2160, height: 3840, cropped: true });
  });

  it('returns null when the video has no frame', () => {
    expect(captureVideoFrame({ video: { videoWidth: 0, videoHeight: 0 }, encode: vi.fn(), toGray: vi.fn() })).toBeNull();
  });

  it('returns null if drawing fails', () => {
    const encode = () => { throw new Error('InvalidStateError'); };
    expect(captureVideoFrame({ video: { videoWidth: 10, videoHeight: 10 }, encode, toGray: vi.fn() })).toBeNull();
  });
});
