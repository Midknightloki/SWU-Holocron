/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const mocks = vi.hoisted(() => ({
  scan: vi.fn(), commitDraft: vi.fn(), capturePhoto: vi.fn(), prefetchSets: vi.fn(),
  captureVideoFrame: vi.fn(), sharpness: 200,
}));
// Photos live in the photo store now: an in-memory stand-in.
const photos = vi.hoisted(() => ({ map: new Map(), remove: vi.fn(), clear: vi.fn() }));
vi.mock('../../services/photoStore', () => ({
  PhotoStore: {
    put: vi.fn(async (id, b) => { photos.map.set(id, b); return true; }),
    get: vi.fn(async (id) => photos.map.get(id) ?? null),
    remove: (ids) => { photos.remove(ids); ids.forEach((id) => photos.map.delete(id)); return Promise.resolve(); },
    clear: async () => { photos.clear(); photos.map.clear(); },
  },
}));
vi.mock('../../utils/sharpness', () => ({ laplacianVariance: () => mocks.sharpness }));

vi.mock('../../services/ScanService', () => ({
  ScanService: { scan: mocks.scan, commitDraft: mocks.commitDraft, prefetchSets: mocks.prefetchSets },
}));
vi.mock('../../utils/frameCapture', () => ({ capturePhoto: mocks.capturePhoto, captureVideoFrame: mocks.captureVideoFrame }));
vi.mock('../CardPickerModal', () => ({ default: () => null }));
const sampler = vi.hoisted(() => ({ queue: [], fn: null }));
vi.mock('../../utils/frameSampler', () => ({
  createFrameSampler: () => {
    sampler.fn = vi.fn(() => (sampler.queue.length ? sampler.queue.shift() : null));
    return (...args) => sampler.fn(...args);
  },
}));
vi.mock('../RigCalibration', () => ({
  default: ({ onSave, onClose, onTakePhoto, onClear }) => (
    <div role="dialog" aria-label="Calibrate rig">
      <button type="button" onClick={() => onSave({ rect: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 }, source: 'photo', orientation: 'portrait' })}>save-mock</button>
      <button type="button" onClick={onClose}>close-mock</button>
      <button type="button" onClick={onClear}>clear-mock</button>
      <button
        type="button"
        onClick={async (e) => {
          const target = e.currentTarget;
          const shot = await onTakePhoto();
          target.setAttribute('data-image', String(shot.image));
        }}
      >
        take-mock
      </button>
    </div>
  ),
}));

import CardScanner, { AUTO_TICK_MS } from '../CardScanner';

const LUKE = { status: 'matched', set: 'SOR', number: '012', name: 'Luke Skywalker' };

const stubCamera = (impl) => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(impl) },
  });
};

const renderScanner = (props = {}) => render(
  <CardScanner uid="uid-1" collectionRef={{ id: 'ref' }} setCodes={['SOR']} onClose={vi.fn()} {...props} />,
);

// Capture is asynchronous now (a real photo takes a moment): let it settle.
const tilt = (beta, gamma) => act(() => {
  window.dispatchEvent(Object.assign(new Event('deviceorientation'), { beta, gamma }));
});

// A tap on the preview while the first photo is still pending.
const user_tap = () => act(async () => { fireEvent.click(screen.getByTestId('scan-preview')); });

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

// Most tests start with the how-to already seen; the first-use test flips it.
let helpSeen = true;
let rigStored = null;
let setsStored = null;

const TRACK = { kind: 'video', stop: vi.fn() };
const PHOTO = { image: 'IMG', source: 'photo', width: 4080, height: 3072 };

const pressSpace = (target = window, init = {}) =>
  fireEvent.keyDown(target, { key: ' ', code: 'Space', ...init });

beforeEach(() => {
  vi.clearAllMocks();
  helpSeen = true;
  rigStored = null;
  sampler.queue = [];
  setsStored = null;
  mocks.prefetchSets.mockResolvedValue(undefined);
  localStorage.getItem.mockReset();
  localStorage.getItem.mockImplementation((key) => {
    if (key === 'swu-scan-help-seen') return helpSeen ? '1' : null;
    if (key === 'swu-scan-rig') return rigStored;
    if (key === 'swu-scan-sets') return setsStored;
    return null;
  });
  mocks.capturePhoto.mockResolvedValue(PHOTO);
  mocks.captureVideoFrame.mockReturnValue(null);
  mocks.sharpness = 200;
  photos.map.clear();
  photos.remove.mockClear();
  photos.clear.mockClear();
  mocks.scan.mockResolvedValue(LUKE);
  stubCamera(async () => ({ getTracks: () => [TRACK], getVideoTracks: () => [TRACK] }));
});

describe('CardScanner', () => {
  it('captures on Space and counts the card', async () => {
    renderScanner();
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    pressSpace();
    await waitFor(() => expect(mocks.scan).toHaveBeenCalledWith('IMG', ['SOR'], { hintSets: [], baseSets: [] }));
    expect(await screen.findByRole('button', { name: 'Review (1)' })).toBeInTheDocument();
  });

  it('captures on Enter', async () => {
    renderScanner();
    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(mocks.scan).toHaveBeenCalledTimes(1));
  });

  it('captures on a tap anywhere on the preview', async () => {
    const user = userEvent.setup();
    renderScanner();
    await user.click(screen.getByTestId('scan-preview'));
    await waitFor(() => expect(mocks.scan).toHaveBeenCalledTimes(1));
  });

  it('ignores auto-repeated key presses', async () => {
    renderScanner();
    pressSpace();
    pressSpace(window, { repeat: true });
    pressSpace(window, { repeat: true });
    await flush();
    expect(mocks.scan).toHaveBeenCalledTimes(1);
  });

  it('Space with the foil switch focused captures instead of toggling it', async () => {
    renderScanner();
    const foil = screen.getByRole('button', { name: 'Foil stack' });
    foil.focus();
    const event = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    foil.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(mocks.scan).toHaveBeenCalledTimes(1));
    expect(foil).toHaveAttribute('aria-pressed', 'false');
  });

  it('marks captures foil while the foil stack switch is on', async () => {
    const user = userEvent.setup();
    renderScanner();
    await user.click(screen.getByRole('button', { name: 'Foil stack' }));
    pressSpace();
    await user.click(await screen.findByRole('button', { name: 'Review (1)' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Foil' })).toHaveAttribute('aria-pressed', 'true'));
  });

  it('stays silent when a card cannot be identified, and the badge counts it', async () => {
    // Recognition runs in the background now; only the badge reports it.
    mocks.scan.mockResolvedValue({ status: 'unidentified', reason: 'unreadable', read: null });
    renderScanner();
    pressSpace();
    expect(await screen.findByTestId('review-badge')).toHaveTextContent('1');
    expect(screen.queryByTestId('scan-flash')).not.toBeInTheDocument();
  });

  it('stores each capture as a photo and reads it through the queue', async () => {
    renderScanner();
    pressSpace();
    await waitFor(() => expect(mocks.scan).toHaveBeenCalledWith('IMG', ['SOR'], { hintSets: [], baseSets: [] }));
    expect([...photos.map.values()]).toEqual(['IMG']);
  });

  it('re-queues cards still reading when the scanner reopens', async () => {
    const saved = JSON.stringify({ rows: [{ id: 'old', status: 'reading', isFoil: false, qty: 1, hasPhoto: true }] });
    localStorage.getItem.mockImplementation((key) => {
      if (key === 'swu-scan-help-seen') return '1';
      return key === 'swu-scan-draft-uid-1' ? saved : null;
    });
    photos.map.set('old', 'OLDIMG');
    renderScanner();
    await waitFor(() => expect(mocks.scan).toHaveBeenCalledWith('OLDIMG', ['SOR'], expect.any(Object)));
  });

  it('marks a card still reading at reopen as failed when its photo is gone', async () => {
    const saved = JSON.stringify({ rows: [{ id: 'old', status: 'reading', isFoil: false, qty: 1, hasPhoto: true }] });
    localStorage.getItem.mockImplementation((key) => {
      if (key === 'swu-scan-help-seen') return '1';
      return key === 'swu-scan-draft-uid-1' ? saved : null;
    });
    renderScanner();
    expect(await screen.findByTestId('review-badge')).toHaveTextContent('1');
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it('flashes when the frame cannot be captured, without calling the function', async () => {
    mocks.capturePhoto.mockResolvedValue({ image: null, source: 'video', width: 0, height: 0 });
    renderScanner();
    pressSpace();
    expect(await screen.findByTestId('scan-flash')).toBeInTheDocument();
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it('stops capturing at the daily limit and says when it resets', async () => {
    mocks.scan.mockResolvedValue({ status: 'failed', error: 'quota', limit: 1000, resetsAt: '2026-09-30T00:00:00.000Z' });
    renderScanner();
    pressSpace();
    expect(await screen.findByText(/Daily scan limit of 1000 reached/)).toBeInTheDocument();
    pressSpace();
    await flush();
    expect(mocks.scan).toHaveBeenCalledTimes(1);
  });

  it('explains a denied camera and does not capture', async () => {
    stubCamera(async () => { throw Object.assign(new Error('nope'), { name: 'NotAllowedError' }); });
    renderScanner();
    expect(await screen.findByText(/Camera access was denied/)).toBeInTheDocument();
    pressSpace();
    await flush();
    expect(mocks.capturePhoto).not.toHaveBeenCalled();
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it('takes the photo from the live camera track', async () => {
    renderScanner();
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    await flush();
    pressSpace();
    await waitFor(() => expect(mocks.capturePhoto).toHaveBeenCalledWith(expect.objectContaining({ track: TRACK })));
  });

  it('ignores captures while a photo is still being taken', async () => {
    let finish;
    mocks.capturePhoto.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    renderScanner();
    pressSpace();
    pressSpace();
    await user_tap();
    expect(mocks.capturePhoto).toHaveBeenCalledTimes(1);
    await act(async () => { finish(PHOTO); });
    await waitFor(() => expect(mocks.scan).toHaveBeenCalledTimes(1));
  });

  it('has no status footer: counts live on the Review button', async () => {
    renderScanner();
    pressSpace();
    await screen.findByRole('button', { name: 'Review (1)' });
    expect(screen.queryByText(/scanned/)).not.toBeInTheDocument();
    expect(screen.queryByText(/reading/)).not.toBeInTheDocument();
    expect(screen.queryByText(/photo 4080/)).not.toBeInTheDocument();
  });

  it('puts the controls in a bar below the preview, within thumb reach', () => {
    renderScanner();
    const controls = screen.getByTestId('scanner-controls');
    expect(controls).toContainElement(screen.getByRole('button', { name: 'Close scanner' }));
    expect(controls).toContainElement(screen.getByRole('button', { name: 'Review (0)' }));
    expect(screen.getByTestId('scan-preview').compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('badges the Review button with how many cards need attention', async () => {
    mocks.scan.mockResolvedValue({ status: 'unidentified', reason: 'unreadable', read: null });
    renderScanner();
    expect(screen.queryByTestId('review-badge')).not.toBeInTheDocument();
    pressSpace();
    expect(await screen.findByTestId('review-badge')).toHaveTextContent('1');
  });

  it('turns the calibrate button amber when a calibrated rig capture was not cropped', async () => {
    rigStored = JSON.stringify({ version: 1, rect: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 }, source: 'photo', orientation: 'portrait', savedAt: 1 });
    mocks.capturePhoto.mockResolvedValue({ ...PHOTO, source: 'video', cropped: false });
    renderScanner();
    const button = screen.getByRole('button', { name: 'Calibrate rig' });
    expect(button).not.toHaveAttribute('data-crop', 'missed');
    pressSpace();
    await waitFor(() => expect(button).toHaveAttribute('data-crop', 'missed'));
    expect(button.getAttribute('title')).toMatch(/not cropped/i);
  });

  it('clears the amber warning once the rig is recalibrated', async () => {
    const user = userEvent.setup();
    rigStored = JSON.stringify({ version: 1, rect: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 }, source: 'photo', orientation: 'portrait', savedAt: 1 });
    mocks.capturePhoto.mockResolvedValue({ ...PHOTO, source: 'video', cropped: false });
    renderScanner();
    pressSpace();
    const button = screen.getByRole('button', { name: 'Calibrate rig' });
    await waitFor(() => expect(button).toHaveAttribute('data-crop', 'missed'));
    await user.click(button);
    await user.click(screen.getByText('save-mock'));
    expect(screen.getByRole('button', { name: 'Calibrate rig' })).not.toHaveAttribute('data-crop', 'missed');
  });

  it('keeps the calibrate button normal while captures are cropped', async () => {
    rigStored = JSON.stringify({ version: 1, rect: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 }, source: 'photo', orientation: 'portrait', savedAt: 1 });
    mocks.capturePhoto.mockResolvedValue({ ...PHOTO, cropped: true });
    renderScanner();
    pressSpace();
    await waitFor(() => expect(mocks.scan).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Calibrate rig' })).not.toHaveAttribute('data-crop', 'missed');
  });

  it('no flash on a good read', async () => {
    renderScanner();
    pressSpace();
    await waitFor(() => expect(mocks.scan).toHaveBeenCalled());
    await flush();
    expect(screen.queryByTestId('scan-flash')).not.toBeInTheDocument();
  });

  it('marks the collector-number area inside the card guide', () => {
    renderScanner();
    expect(screen.getByTestId('card-guide')).toContainElement(screen.getByTestId('collector-guide'));
  });

  it('marks both collector positions in one portrait guide, with no orientation toggle', () => {
    renderScanner();
    const guide = screen.getByTestId('card-guide');
    // Most cards: bottom-right. Leaders and bases stood upright: top-right.
    expect(guide).toContainElement(screen.getByTestId('collector-guide'));
    expect(guide).toContainElement(screen.getByTestId('collector-guide-upright'));
    expect(screen.queryByRole('button', { name: 'Landscape guide' })).not.toBeInTheDocument();
  });

  it('opens the how-to on first use, and pauses capture until it is dismissed', async () => {
    const user = userEvent.setup();
    helpSeen = false;
    renderScanner();
    expect(screen.getByRole('dialog', { name: 'How to scan' })).toHaveTextContent(/quarter-turn counter-clockwise/i);

    pressSpace();
    await flush();
    expect(mocks.capturePhoto).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'How to scan' })).not.toBeInTheDocument();
    expect(localStorage.setItem).toHaveBeenCalledWith('swu-scan-help-seen', '1');

    await user.click(screen.getByRole('button', { name: 'How to scan' }));
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    pressSpace();
    await waitFor(() => expect(mocks.capturePhoto).toHaveBeenCalledTimes(1));
  });

  it('does not open the how-to again once seen', () => {
    renderScanner();
    expect(screen.queryByRole('dialog', { name: 'How to scan' })).not.toBeInTheDocument();
  });

  it('shows a level that turns green when the phone is flat', async () => {
    renderScanner();
    expect(screen.queryByTestId('level')).not.toBeInTheDocument();
    tilt(10, 0);
    expect(await screen.findByTestId('level')).toHaveAttribute('data-level', 'false');
    tilt(1, -1);
    await waitFor(() => expect(screen.getByTestId('level')).toHaveAttribute('data-level', 'true'));
  });

  it('crops captures to the saved calibration', async () => {
    rigStored = JSON.stringify({ version: 1, rect: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 }, source: 'photo', orientation: 'portrait', savedAt: 1 });
    mocks.capturePhoto.mockResolvedValue({ ...PHOTO, width: 3024, height: 4032, cropped: true });
    renderScanner();
    expect(screen.getByTestId('card-guide')).toHaveAttribute('data-calibrated', 'true');
    pressSpace();
    await waitFor(() => expect(mocks.capturePhoto).toHaveBeenCalled());
    const { crop } = mocks.capturePhoto.mock.calls[0][0];
    expect(crop('photo', 3024, 4032)).toEqual({ x: 0.176, y: 0.068, w: 0.648, h: 0.864 });
    expect(crop('video', 3024, 4032)).toBeNull();
    expect(crop('photo', 4032, 3024)).toBeNull();
  });

  it('falls back to the centred guide when the preview size is unknown', () => {
    rigStored = JSON.stringify({ version: 1, rect: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 }, source: 'photo', orientation: 'portrait', savedAt: 1 });
    renderScanner();
    // happy-dom has no layout: no video size, so no calibrated position yet.
    expect(screen.getByTestId('card-guide').className).toContain('left-1/2');
  });

  it('opens calibration, pauses capture, and saves the rig', async () => {
    const user = userEvent.setup();
    renderScanner();
    expect(screen.getByTestId('card-guide')).toHaveAttribute('data-calibrated', 'false');
    await user.click(screen.getByRole('button', { name: 'Calibrate rig' }));
    expect(screen.getByRole('dialog', { name: 'Calibrate rig' })).toBeInTheDocument();
    pressSpace();
    await flush();
    expect(mocks.capturePhoto).not.toHaveBeenCalled();
    await user.click(screen.getByText('save-mock'));
    expect(screen.queryByRole('dialog', { name: 'Calibrate rig' })).not.toBeInTheDocument();
    expect(localStorage.setItem).toHaveBeenCalledWith('swu-scan-rig', expect.stringContaining('"source":"photo"'));
    expect(screen.getByTestId('card-guide')).toHaveAttribute('data-calibrated', 'true');
  });

  it('will not take the calibration photo while a scan capture is still running', async () => {
    const user = userEvent.setup();
    let finish;
    mocks.capturePhoto.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    renderScanner();
    pressSpace();
    await flush();
    await user.click(screen.getByRole('button', { name: 'Calibrate rig' }));
    await user.click(screen.getByText('take-mock'));
    await waitFor(() => expect(screen.getByText('take-mock')).toHaveAttribute('data-image', 'null'));
    // A second takePhoto on a busy track is what fell back to a video frame.
    expect(mocks.capturePhoto).toHaveBeenCalledTimes(1);
    await act(async () => { finish(PHOTO); });
  });

  describe('auto mode', () => {
    // Structured scenes: presence ignores overall brightness, so flat frames
    // would all look alike. 100 = empty rig (paper + ruler), 200 = a card,
    // 0 = a black frame (camera warming up).
    const SCENE = {
      100: [...Array(12).fill(180), ...Array(4).fill(40)],
      200: [40, 40, 200, 200, 40, 200, 40, 200, 200, 40, 40, 200, 40, 40, 200, 40],
      0: Array(16).fill(0),
    };
    const F = (v) => Uint8Array.from(SCENE[v]);
    const many = (n, v) => Array.from({ length: n }, () => F(v));
    const handFrames = (n) => Array.from({ length: n }, (_, i) => Uint8Array.from({ length: 16 }, (_, j) => ((i + j) % 2 ? 30 : 110)));
    // Auto ignores the first second after the camera (re)starts.
    const warm = () => tick(10);
    const enableAndLearn = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Auto capture' }));
      await warm();
      sampler.queue.push(...many(8, 100));
      await tick(8);
    };
    const CAL = JSON.stringify({ version: 1, rect: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 }, source: 'photo', orientation: 'portrait', savedAt: 1 });
    const tick = async (n) => {
      for (let i = 0; i < n; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => { vi.advanceTimersByTime(AUTO_TICK_MS); });
      }
    };

    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('needs a calibration: without one, Auto opens calibration', () => {
      renderScanner();
      fireEvent.click(screen.getByRole('button', { name: 'Auto capture' }));
      expect(screen.getByRole('dialog', { name: 'Calibrate rig' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Auto capture' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('learns the empty rig, then captures a settled card exactly once', async () => {
      rigStored = CAL;
      renderScanner();
      fireEvent.click(screen.getByRole('button', { name: 'Auto capture' }));
      expect(screen.getByTestId('auto-status')).toHaveTextContent(/learning/i);
      await warm();
      sampler.queue.push(...many(8, 100));
      await tick(8);
      expect(screen.getByTestId('auto-status')).toHaveTextContent(/ready/i);
      sampler.queue.push(...handFrames(4), ...many(40, 200));
      await tick(44);
      expect(mocks.capturePhoto).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('auto-status')).toHaveTextContent(/remove card/i);
    });

    it('pauses while an overlay is open', async () => {
      rigStored = CAL;
      renderScanner();
      fireEvent.click(screen.getByRole('button', { name: 'Auto capture' }));
      fireEvent.click(screen.getByRole('button', { name: 'How to scan' }));
      sampler.queue.push(...many(8, 100), ...handFrames(4), ...many(20, 200));
      await tick(32);
      expect(sampler.fn).not.toHaveBeenCalled();
      expect(mocks.capturePhoto).not.toHaveBeenCalled();
    });

    it('opens auto settings from the chip, saves changes, and re-learns', async () => {
      rigStored = CAL;
      renderScanner();
      await enableAndLearn();
      fireEvent.click(screen.getByRole('button', { name: /^Auto settings/ }));
      fireEvent.change(screen.getByLabelText('Settle time'), { target: { value: '900' } });
      expect(localStorage.setItem).toHaveBeenCalledWith('swu-scan-auto', expect.stringContaining('"settleMs":900'));
      fireEvent.click(screen.getByRole('button', { name: 'Re-learn empty rig' }));
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(screen.getByTestId('auto-status')).toHaveTextContent(/learning/i);
    });

    it('a habitual tap with Auto on does not scan the card twice', async () => {
      rigStored = CAL;
      renderScanner();
      await enableAndLearn();
      sampler.queue.push(...handFrames(3));
      await tick(3);
      pressSpace();
      await act(async () => {});
      sampler.queue.push(...many(20, 200));
      await tick(20);
      expect(mocks.capturePhoto).toHaveBeenCalledTimes(1);
    });

    it('says "Capturing" until the photo is taken, then "remove card"', async () => {
      rigStored = CAL;
      let finish;
      mocks.capturePhoto.mockImplementation(() => new Promise((r) => { finish = r; }));
      renderScanner();
      await enableAndLearn();
      sampler.queue.push(...handFrames(3), ...many(8, 200));
      await tick(11);
      expect(screen.getByTestId('auto-status')).toHaveTextContent(/capturing/i);
      await act(async () => { finish(PHOTO); });
      expect(screen.getByTestId('auto-status')).toHaveTextContent(/remove card/i);
    });

    it('catches the next card when it settles while a capture is still in flight', async () => {
      rigStored = CAL;
      let finish;
      mocks.capturePhoto
        .mockImplementationOnce(() => new Promise((r) => { finish = r; }))
        .mockResolvedValue(PHOTO);
      renderScanner();
      await enableAndLearn();
      // Card 1 settles and capture starts; the swap happens during the exposure.
      sampler.queue.push(...handFrames(3), ...many(8, 200), ...handFrames(2), ...many(8, 100), ...handFrames(3), ...many(8, 200));
      await tick(32);
      expect(mocks.capturePhoto).toHaveBeenCalledTimes(1);
      await act(async () => { finish(PHOTO); });
      sampler.queue.push(...many(3, 200));
      await tick(3);
      expect(mocks.capturePhoto).toHaveBeenCalledTimes(2);
    });

    it('re-learns the empty rig after a recalibration', async () => {
      rigStored = CAL;
      renderScanner();
      await enableAndLearn();
      expect(screen.getByTestId('auto-status')).toHaveTextContent(/ready/i);
      fireEvent.click(screen.getByRole('button', { name: 'Calibrate rig' }));
      fireEvent.click(screen.getByText('save-mock'));
      expect(screen.getByTestId('auto-status')).toHaveTextContent(/learning/i);
    });

    it('switches Auto off when the calibration is cleared', async () => {
      rigStored = CAL;
      renderScanner();
      await enableAndLearn();
      fireEvent.click(screen.getByRole('button', { name: 'Calibrate rig' }));
      fireEvent.click(screen.getByText('clear-mock'));
      expect(screen.getByRole('button', { name: 'Auto capture' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('pauses with a rotate hint when the phone is turned away from the calibration', async () => {
      rigStored = CAL; // portrait
      const { container } = renderScanner();
      const video = container.querySelector('video');
      Object.defineProperty(video, 'videoWidth', { value: 1920, configurable: true });
      Object.defineProperty(video, 'videoHeight', { value: 1080, configurable: true });
      fireEvent.click(screen.getByRole('button', { name: 'Auto capture' }));
      await warm();
      sampler.queue.push(...many(8, 100));
      await tick(8);
      expect(screen.getByTestId('auto-status')).toHaveTextContent(/rotate/i);
      expect(sampler.fn).not.toHaveBeenCalled();
    });

    it('ignores the camera warming up after returning from Review', async () => {
      rigStored = CAL;
      renderScanner();
      await enableAndLearn();
      fireEvent.click(screen.getByRole('button', { name: 'Review (0)' }));
      fireEvent.click(screen.getByRole('button', { name: 'Back to camera' }));
      await act(async () => {});
      const before = sampler.fn.mock.calls.length;
      sampler.queue.push(...many(9, 0));
      await tick(9);
      expect(sampler.fn.mock.calls.length).toBe(before);
      expect(mocks.capturePhoto).not.toHaveBeenCalled();
    });

    it('hints at re-learning when "remove card" has lasted a long time', async () => {
      rigStored = CAL;
      renderScanner();
      await enableAndLearn();
      sampler.queue.push(...handFrames(3), ...many(120, 200));
      await tick(123);
      expect(screen.getByTestId('auto-status')).toHaveTextContent(/tap here if the rig is empty/i);
    });

    it('uses an instant video frame when it is sharp enough', async () => {
      rigStored = CAL;
      mocks.captureVideoFrame.mockReturnValue({ image: 'FRAME', gray: new Uint8Array(9), grayWidth: 3, grayHeight: 3, source: 'video', width: 2160, height: 3840, cropped: true });
      mocks.sharpness = 200;
      renderScanner();
      await enableAndLearn();
      sampler.queue.push(...handFrames(3), ...many(8, 200));
      await tick(11);
      expect(mocks.capturePhoto).not.toHaveBeenCalled();
      await act(async () => {});
      expect(mocks.scan).toHaveBeenCalledWith('FRAME', expect.any(Array), expect.any(Object));
    });

    it('falls back to a full photo when the frame is blurry', async () => {
      rigStored = CAL;
      mocks.captureVideoFrame.mockReturnValue({ image: 'FRAME', gray: new Uint8Array(9), grayWidth: 3, grayHeight: 3, source: 'video', width: 2160, height: 3840, cropped: true });
      mocks.sharpness = 5;
      renderScanner();
      await enableAndLearn();
      sampler.queue.push(...handFrames(3), ...many(8, 200));
      await tick(11);
      expect(mocks.capturePhoto).toHaveBeenCalledTimes(1);
    });

    it('turning Auto off stops sampling', async () => {
      rigStored = CAL;
      renderScanner();
      const toggle = screen.getByRole('button', { name: 'Auto capture' });
      fireEvent.click(toggle);
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      sampler.queue.push(...many(10, 100));
      await tick(10);
      expect(sampler.fn ?? vi.fn()).not.toHaveBeenCalled();
      expect(screen.queryByTestId('auto-status')).not.toBeInTheDocument();
    });
  });

  describe('set picker', () => {
    const OPTIONS = [
      { code: 'SOR', name: 'Spark of Rebellion', isBaseSet: true },
      { code: 'SHD', name: 'Shadows of the Galaxy', isBaseSet: true },
      { code: 'SHDOP', name: 'Shadows of the Galaxy - OP Promo', isBaseSet: false },
    ];
    const renderWithSets = () => renderScanner({ setCodes: ['SOR', 'SHD', 'SHDOP'], setOptions: OPTIONS });

    it('defaults to any set and sends no hints', async () => {
      renderWithSets();
      expect(screen.getByRole('button', { name: 'Choose sets' })).toHaveTextContent('Any set');
      pressSpace();
      await waitFor(() => expect(mocks.scan).toHaveBeenCalledWith('IMG', ['SOR', 'SHD', 'SHDOP'], { hintSets: [], baseSets: ['SOR', 'SHD'] }));
    });

    it('picks a set as a hint, remembers it, and warms its card data', async () => {
      const user = userEvent.setup();
      renderWithSets();
      await user.click(screen.getByRole('button', { name: 'Choose sets' }));
      const dialog = screen.getByRole('dialog', { name: 'Choose sets' });
      await user.click(within(dialog).getByRole('button', { name: /SHD.*Shadows of the Galaxy$/ }));
      await user.click(within(dialog).getByRole('button', { name: 'Done' }));
      expect(screen.getByRole('button', { name: 'Choose sets' })).toHaveTextContent('SHD');
      expect(localStorage.setItem).toHaveBeenCalledWith('swu-scan-sets', '["SHD"]');
      expect(mocks.prefetchSets).toHaveBeenCalledWith(['SHD']);
      pressSpace();
      await waitFor(() => expect(mocks.scan).toHaveBeenCalledWith('IMG', ['SOR', 'SHD', 'SHDOP'], { hintSets: ['SHD'], baseSets: ['SOR', 'SHD'] }));
    });

    it('restores the picked sets and prefetches them on open', () => {
      setsStored = '["SHD","SOR"]';
      renderWithSets();
      expect(screen.getByRole('button', { name: 'Choose sets' })).toHaveTextContent('SHD +1');
      expect(mocks.prefetchSets).toHaveBeenCalledWith(['SHD', 'SOR']);
    });

    it('ignores stored codes that are no longer registered', () => {
      setsStored = '["NOPE"]';
      renderWithSets();
      expect(screen.getByRole('button', { name: 'Choose sets' })).toHaveTextContent('Any set');
    });

    it('"Any set" clears the picks', async () => {
      const user = userEvent.setup();
      setsStored = '["SHD"]';
      renderWithSets();
      await user.click(screen.getByRole('button', { name: 'Choose sets' }));
      await user.click(screen.getByRole('button', { name: 'Any set' }));
      await user.click(screen.getByRole('button', { name: 'Done' }));
      expect(screen.getByRole('button', { name: 'Choose sets' })).toHaveTextContent('Any set');
      expect(localStorage.setItem).toHaveBeenCalledWith('swu-scan-sets', '[]');
    });

    it('does not capture while the picker is open', async () => {
      const user = userEvent.setup();
      renderWithSets();
      await user.click(screen.getByRole('button', { name: 'Choose sets' }));
      pressSpace();
      await flush();
      expect(mocks.capturePhoto).not.toHaveBeenCalled();
    });
  });

  describe('new cards', () => {
    it('pops up NEW for the first copy of a card not in the collection, only once', async () => {
      renderScanner({ collectionData: {} });
      pressSpace();
      expect(await screen.findByTestId('new-card-toast')).toHaveTextContent('Luke Skywalker');
      await act(async () => { await new Promise((r) => setTimeout(r, 1700)); });
      expect(screen.queryByTestId('new-card-toast')).not.toBeInTheDocument();
      pressSpace();
      await waitFor(() => expect(mocks.scan).toHaveBeenCalledTimes(2));
      await flush();
      expect(screen.queryByTestId('new-card-toast')).not.toBeInTheDocument();
    });

    it('does not pop up for a card already owned, even only as a foil', async () => {
      renderScanner({ collectionData: { SOR_012_foil: { quantity: 1 } } });
      pressSpace();
      await waitFor(() => expect(mocks.scan).toHaveBeenCalled());
      await flush();
      expect(screen.queryByTestId('new-card-toast')).not.toBeInTheDocument();
    });
  });

  it('mentions calibration in the how-to', () => {
    helpSeen = false;
    renderScanner();
    expect(screen.getByRole('dialog', { name: 'How to scan' })).toHaveTextContent(/calibrate/i);
  });
  it('persists the batch under the user\'s own key', async () => {
    renderScanner();
    pressSpace();
    await waitFor(() => {
      const calls = localStorage.setItem.mock.calls.filter(([key]) => key === 'swu-scan-draft-uid-1');
      expect(calls.length).toBeGreaterThan(0);
      expect(JSON.parse(calls.at(-1)[1]).rows).toHaveLength(1);
    });
  });

  it('stops reading when the scanner closes, so nothing is read twice', async () => {
    const gates = [];
    mocks.scan.mockImplementation(() => new Promise((resolve) => { gates.push(() => resolve(LUKE)); }));
    const { unmount } = renderScanner();
    for (let i = 0; i < 4; i += 1) {
      pressSpace();
      await flush(); // eslint-disable-line no-await-in-loop
    }
    await waitFor(() => expect(mocks.scan).toHaveBeenCalledTimes(3));
    unmount();
    await act(async () => { gates.forEach((g) => g()); });
    await flush();
    expect(mocks.scan).toHaveBeenCalledTimes(3);
  });

  it('keeps results that arrive while Add is saving', async () => {
    // Review finding: the save replaced the batch with its snapshot, so a card
    // matched mid-save went back to "reading" for good.
    const user = userEvent.setup();
    const ACKBAR = { status: 'matched', set: 'SOR', number: '045', name: 'Admiral Ackbar', type: 'Unit' };
    let releaseB;
    mocks.scan
      .mockResolvedValueOnce(LUKE)
      .mockImplementationOnce(() => new Promise((resolve) => { releaseB = () => resolve(ACKBAR); }));
    let releaseCommit;
    mocks.commitDraft.mockImplementation(async (draft, ref, { onProgress }) => {
      await new Promise((r) => { releaseCommit = r; });
      const rest = { rows: draft.rows.filter((r) => r.status !== 'matched') };
      onProgress(rest);
      return rest;
    });
    renderScanner();
    pressSpace();
    await flush();
    pressSpace();
    await waitFor(() => expect(mocks.scan).toHaveBeenCalledTimes(2));
    await user.click(await screen.findByRole('button', { name: 'Review (2)' }));
    await user.click(await screen.findByRole('button', { name: 'Add 1 card to collection' }));
    await act(async () => { releaseB(); });
    await act(async () => { releaseCommit(); });
    expect(await screen.findByRole('button', { name: 'Add 1 card to collection' })).toBeEnabled();
    expect(screen.getByText('Admiral Ackbar')).toBeInTheDocument();
  });

  it('resumes cards waiting on the daily limit when the scanner reopens', async () => {
    const saved = JSON.stringify({ rows: [{ id: 'w', status: 'waiting', reason: 'quota', isFoil: false, qty: 1, hasPhoto: true }] });
    localStorage.getItem.mockImplementation((key) => {
      if (key === 'swu-scan-help-seen') return '1';
      return key === 'swu-scan-draft-uid-1' ? saved : null;
    });
    photos.map.set('w', 'WIMG');
    renderScanner();
    await waitFor(() => expect(mocks.scan).toHaveBeenCalledWith('WIMG', ['SOR'], expect.any(Object)));
  });

  it("discarding deletes only this batch's photos, not the whole device's", async () => {
    const user = userEvent.setup();
    photos.map.set('someone-else', 'OTHER');
    renderScanner();
    pressSpace();
    await user.click(await screen.findByRole('button', { name: 'Review (1)' }));
    await user.click(screen.getByRole('button', { name: 'Discard batch' }));
    await user.click(screen.getByRole('button', { name: 'Discard 1 card' }));
    await waitFor(() => expect(photos.remove).toHaveBeenCalled());
    expect(photos.clear).not.toHaveBeenCalled();
    expect(photos.map.get('someone-else')).toBe('OTHER');
  });

  it('deletes photos of rows that leave the batch', async () => {
    const user = userEvent.setup();
    mocks.commitDraft.mockImplementation(async () => ({ rows: [] }));
    renderScanner();
    pressSpace();
    await user.click(await screen.findByRole('button', { name: 'Review (1)' }));
    await user.click(await screen.findByRole('button', { name: 'Add 1 card to collection' }));
    await waitFor(() => expect(photos.remove).toHaveBeenCalled());
  });

  it('commits from review, saving progress as it goes, and closes when empty', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    mocks.commitDraft.mockImplementation(async (draft, ref, { onProgress }) => {
      onProgress({ rows: [] });
      return { rows: [] };
    });
    renderScanner({ onClose });
    pressSpace();
    await user.click(await screen.findByRole('button', { name: 'Review (1)' }));
    await user.click(await screen.findByRole('button', { name: 'Add 1 card to collection' }));
    expect(mocks.commitDraft).toHaveBeenCalledWith(expect.any(Object), { id: 'ref' }, expect.any(Object));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(localStorage.removeItem).toHaveBeenCalledWith('swu-scan-draft-uid-1');
  });

  it('says a previous save is still running when a commit is refused', async () => {
    const user = userEvent.setup();
    mocks.commitDraft.mockRejectedValue(Object.assign(new Error('busy'), { code: 'commit-in-progress' }));
    renderScanner();
    pressSpace();
    await user.click(await screen.findByRole('button', { name: 'Review (1)' }));
    await user.click(await screen.findByRole('button', { name: 'Add 1 card to collection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/previous save is still in progress/i);
  });

  it("drops the previous account's batch when the signed-in user changes", async () => {
    const saved = JSON.stringify({ rows: [{ id: 'x', status: 'matched', set: 'SOR', number: '012', name: 'Luke Skywalker', isFoil: false, qty: 1 }] });
    localStorage.getItem.mockImplementation((key) => {
      if (key === 'swu-scan-help-seen') return '1';
      return key === 'swu-scan-draft-uid-1' ? saved : null;
    });
    const { rerender } = renderScanner();
    expect(screen.getByRole('button', { name: 'Review (1)' })).toBeInTheDocument();
    rerender(<CardScanner uid="uid-2" collectionRef={{ id: 'ref-2' }} setCodes={['SOR']} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Review (0)' })).toBeInTheDocument();
    const leaked = localStorage.setItem.mock.calls.filter(([key, value]) => key === 'swu-scan-draft-uid-2' && JSON.parse(value).rows.length > 0);
    expect(leaked).toEqual([]);
  });

  it('keeps the batch and explains when a commit fails', async () => {
    const user = userEvent.setup();
    mocks.commitDraft.mockRejectedValue(new Error('offline'));
    renderScanner();
    pressSpace();
    await user.click(await screen.findByRole('button', { name: 'Review (1)' }));
    await user.click(await screen.findByRole('button', { name: 'Add 1 card to collection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/won't be added twice/);
  });
});
