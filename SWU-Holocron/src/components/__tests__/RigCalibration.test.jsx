/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const mocks = vi.hoisted(() => ({ locateCard: vi.fn() }));
vi.mock('../../services/ScanService', () => ({ ScanService: { locateCard: mocks.locateCard } }));

import RigCalibration from '../RigCalibration';
import { defaultRect } from '../../utils/rigCalibration';

const SHOT = { image: 'IMG', source: 'photo', width: 3000, height: 4000 };

const renderCal = (props = {}) => {
  const handlers = {
    onTakePhoto: vi.fn(async () => SHOT),
    onSave: vi.fn(),
    onClear: vi.fn(),
    onClose: vi.fn(),
  };
  const utils = render(<RigCalibration hasCalibration={false} {...handlers} {...props} />);
  return { ...handlers, ...utils };
};

const rectOf = () => JSON.parse(screen.getByTestId('calib-rect').getAttribute('data-rect'));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locateCard.mockResolvedValue({ found: true, box: [100, 200, 900, 800] });
});

describe('RigCalibration', () => {
  it('shows the card Gemini found on the calibration photo', async () => {
    const user = userEvent.setup();
    renderCal();
    expect(screen.getByRole('dialog', { name: 'Calibrate rig' })).toHaveTextContent(/put a card in the rig/i);
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    expect(await screen.findByTestId('calib-rect')).toBeInTheDocument();
    expect(mocks.locateCard).toHaveBeenCalledWith('IMG');
    expect(rectOf()).toEqual({ x: 0.2, y: 0.1, w: 0.6, h: 0.8 });
    expect(screen.getByRole('img', { name: 'Calibration photo' })).toHaveAttribute('src', 'data:image/jpeg;base64,IMG');
  });

  it('starts from a centred box when no card is found', async () => {
    const user = userEvent.setup();
    mocks.locateCard.mockResolvedValue({ found: false, box: null });
    renderCal();
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await screen.findByTestId('calib-rect');
    expect(rectOf()).toEqual(defaultRect(3000, 4000));
    expect(screen.getByText(/couldn't find the card/i)).toBeInTheDocument();
  });

  it('still allows manual placement when the card finder is unreachable', async () => {
    const user = userEvent.setup();
    mocks.locateCard.mockResolvedValue({ error: 'network' });
    renderCal();
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await screen.findByTestId('calib-rect');
    expect(screen.getByText(/couldn't reach the card finder/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('stays on the first step when no photo could be taken', async () => {
    const user = userEvent.setup();
    const { onTakePhoto } = renderCal();
    onTakePhoto.mockResolvedValue({ image: null, source: 'video', width: 0, height: 0 });
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    expect(await screen.findByText(/couldn't take a photo/i)).toBeInTheDocument();
    expect(mocks.locateCard).not.toHaveBeenCalled();
    expect(screen.queryByTestId('calib-rect')).not.toBeInTheDocument();
  });

  it('nudges a corner with the arrow keys', async () => {
    const user = userEvent.setup();
    renderCal();
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await screen.findByTestId('calib-rect');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Bottom-right corner' }), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Bottom-right corner' }), { key: 'ArrowDown' });
    expect(rectOf()).toEqual({ x: 0.2, y: 0.1, w: 0.605, h: 0.805 });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Top-left corner' }), { key: 'ArrowLeft' });
    expect(rectOf()).toMatchObject({ x: 0.195, w: 0.61 });
  });

  it('saves the rect with the capture source and orientation', async () => {
    const user = userEvent.setup();
    const { onSave } = renderCal();
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await screen.findByTestId('calib-rect');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ rect: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 }, source: 'photo', orientation: 'portrait' });
  });

  it('retakes the photo', async () => {
    const user = userEvent.setup();
    const { onTakePhoto } = renderCal();
    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    await screen.findByTestId('calib-rect');
    await user.click(screen.getByRole('button', { name: 'Retake' }));
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeInTheDocument();
    expect(onTakePhoto).toHaveBeenCalledTimes(1);
  });

  it('cancels without saving', async () => {
    const user = userEvent.setup();
    const { onClose, onSave } = renderCal();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('offers to clear only when a calibration exists', async () => {
    const user = userEvent.setup();
    const { onClear, unmount } = renderCal();
    expect(screen.queryByRole('button', { name: 'Clear calibration' })).not.toBeInTheDocument();
    unmount();
    const second = renderCal({ hasCalibration: true });
    await user.click(screen.getByRole('button', { name: 'Clear calibration' }));
    expect(second.onClear).toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });

  it('ignores a locate result that arrives after closing', async () => {
    let resolveLocate;
    mocks.locateCard.mockImplementation(() => new Promise((r) => { resolveLocate = r; }));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = renderCal();
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    await act(async () => { await Promise.resolve(); });
    unmount();
    await act(async () => { resolveLocate({ found: true, box: [100, 200, 900, 800] }); });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
