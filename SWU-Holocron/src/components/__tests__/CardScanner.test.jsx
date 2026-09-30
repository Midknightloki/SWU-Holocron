/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const mocks = vi.hoisted(() => ({ scan: vi.fn(), commitDraft: vi.fn(), captureFrame: vi.fn() }));

vi.mock('../../services/ScanService', () => ({
  ScanService: { scan: mocks.scan, commitDraft: mocks.commitDraft },
}));
vi.mock('../../utils/frameCapture', () => ({ captureFrame: mocks.captureFrame }));
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

const pressSpace = (target = window, init = {}) =>
  fireEvent.keyDown(target, { key: ' ', code: 'Space', ...init });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.getItem.mockReturnValue(null);
  mocks.captureFrame.mockReturnValue('IMG');
  mocks.scan.mockResolvedValue(LUKE);
  stubCamera(async () => ({ getTracks: () => [{ stop: vi.fn() }] }));
});

describe('CardScanner', () => {
  it('captures on Space and counts the card', async () => {
    renderScanner();
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    pressSpace();
    expect(mocks.scan).toHaveBeenCalledWith('IMG', ['SOR']);
    expect(await screen.findByRole('button', { name: 'Review (1)' })).toBeInTheDocument();
  });

  it('captures on Enter', async () => {
    renderScanner();
    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' });
    expect(mocks.scan).toHaveBeenCalledTimes(1);
  });

  it('captures on a tap anywhere on the preview', async () => {
    const user = userEvent.setup();
    renderScanner();
    await user.click(screen.getByTestId('scan-preview'));
    expect(mocks.scan).toHaveBeenCalledTimes(1);
  });

  it('ignores auto-repeated key presses', async () => {
    renderScanner();
    pressSpace();
    pressSpace(window, { repeat: true });
    pressSpace(window, { repeat: true });
    expect(mocks.scan).toHaveBeenCalledTimes(1);
  });

  it('Space with the foil switch focused captures instead of toggling it', async () => {
    renderScanner();
    const foil = screen.getByRole('button', { name: 'Foil stack' });
    foil.focus();
    const event = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    foil.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(mocks.scan).toHaveBeenCalledTimes(1);
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
    mocks.captureFrame.mockReturnValue(null);
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
    expect(mocks.scan).toHaveBeenCalledTimes(1);
  });

  it('explains a denied camera and does not capture', async () => {
    stubCamera(async () => { throw Object.assign(new Error('nope'), { name: 'NotAllowedError' }); });
    renderScanner();
    expect(await screen.findByText(/Camera access was denied/)).toBeInTheDocument();
    pressSpace();
    expect(mocks.scan).not.toHaveBeenCalled();
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
