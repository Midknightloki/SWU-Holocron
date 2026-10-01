import { describe, it, expect, vi } from 'vitest';
import { fitWithin, capturePhoto, CAPTURE_MAX_EDGE } from '../../utils/frameCapture';

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
    expect(result).toEqual({ image: 'PHOTO', source: 'photo', width: 4080, height: 3072 });
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
    expect(result).toEqual({ image: 'FRAME', source: 'video', width: 1280, height: 720 });
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
    expect(result).toEqual({ image: null, source: 'video', width: 0, height: 0 });
    expect(encode).not.toHaveBeenCalled();
  });
});
