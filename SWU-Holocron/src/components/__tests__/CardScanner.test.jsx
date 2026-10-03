/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const mocks = vi.hoisted(() => ({ scan: vi.fn(), commitDraft: vi.fn(), capturePhoto: vi.fn() }));

vi.mock('../../services/ScanService', () => ({
  ScanService: { scan: mocks.scan, commitDraft: mocks.commitDraft },
}));
vi.mock('../../utils/frameCapture', () => ({ capturePhoto: mocks.capturePhoto }));
vi.mock('../CardPickerModal', () => ({ default: () => null }));
vi.mock('../RigCalibration', () => ({
  default: ({ onSave, onClose, onTakePhoto }) => (
    <div role="dialog" aria-label="Calibrate rig">
      <button type="button" onClick={() => onSave({ rect: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 }, source: 'photo', orientation: 'portrait' })}>save-mock</button>
      <button type="button" onClick={onClose}>close-mock</button>
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

import CardScanner from '../CardScanner';

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

const TRACK = { kind: 'video', stop: vi.fn() };
const PHOTO = { image: 'IMG', source: 'photo', width: 4080, height: 3072 };

const pressSpace = (target = window, init = {}) =>
  fireEvent.keyDown(target, { key: ' ', code: 'Space', ...init });

beforeEach(() => {
  vi.clearAllMocks();
  helpSeen = true;
  rigStored = null;
  localStorage.getItem.mockReset();
  localStorage.getItem.mockImplementation((key) => {
    if (key === 'swu-scan-help-seen') return helpSeen ? '1' : null;
    if (key === 'swu-scan-rig') return rigStored;
    return null;
  });
  mocks.capturePhoto.mockResolvedValue(PHOTO);
  mocks.scan.mockResolvedValue(LUKE);
  stubCamera(async () => ({ getTracks: () => [TRACK], getVideoTracks: () => [TRACK] }));
});

describe('CardScanner', () => {
  it('captures on Space and counts the card', async () => {
    renderScanner();
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    pressSpace();
    await waitFor(() => expect(mocks.scan).toHaveBeenCalledWith('IMG', ['SOR']));
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

  it('flashes when a card cannot be identified', async () => {
    mocks.scan.mockResolvedValue({ status: 'unidentified', reason: 'unreadable', read: null });
    renderScanner();
    pressSpace();
    expect(await screen.findByTestId('scan-flash')).toHaveAttribute('data-kind', 'error');
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

  it('flashes green when a card is read', async () => {
    renderScanner();
    pressSpace();
    expect(await screen.findByTestId('scan-flash')).toHaveAttribute('data-kind', 'success');
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
