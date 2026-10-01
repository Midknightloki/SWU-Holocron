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

const TRACK = { kind: 'video', stop: vi.fn() };
const PHOTO = { image: 'IMG', source: 'photo', width: 4080, height: 3072 };

const pressSpace = (target = window, init = {}) =>
  fireEvent.keyDown(target, { key: ' ', code: 'Space', ...init });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.getItem.mockReset();
  localStorage.getItem.mockReturnValue(null);
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
    expect(await screen.findByTestId('scan-flash')).toBeInTheDocument();
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

  it('shows which capture path ran and at what size', async () => {
    renderScanner();
    pressSpace();
    expect(await screen.findByText('photo 4080×3072')).toBeInTheDocument();
  });

  it('marks the collector-number area inside the card guide', () => {
    renderScanner();
    expect(screen.getByTestId('card-guide')).toContainElement(screen.getByTestId('collector-guide'));
  });

  it('switches the guide to landscape for leaders and bases', async () => {
    const user = userEvent.setup();
    renderScanner();
    const toggle = screen.getByRole('button', { name: 'Landscape guide' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('card-guide')).toHaveAttribute('data-orientation', 'portrait');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('card-guide')).toHaveAttribute('data-orientation', 'landscape');
    // The collector number is bottom-right on leaders and bases too.
    expect(screen.getByTestId('card-guide')).toContainElement(screen.getByTestId('collector-guide'));
    expect(mocks.capturePhoto).not.toHaveBeenCalled();
  });

  it('shows a level that turns green when the phone is flat', async () => {
    renderScanner();
    expect(screen.queryByTestId('level')).not.toBeInTheDocument();
    tilt(10, 0);
    expect(await screen.findByTestId('level')).toHaveAttribute('data-level', 'false');
    tilt(1, -1);
    await waitFor(() => expect(screen.getByTestId('level')).toHaveAttribute('data-level', 'true'));
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
    localStorage.getItem.mockImplementation((key) => (key === 'swu-scan-draft-uid-1' ? saved : null));
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
