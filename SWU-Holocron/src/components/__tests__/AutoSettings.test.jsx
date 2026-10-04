/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import AutoSettings from '../AutoSettings';
import { DEFAULT_AUTO_SETTINGS } from '../../utils/autoCapture';

const renderSettings = (settings = DEFAULT_AUTO_SETTINGS) => {
  const h = { onChange: vi.fn(), onRelearn: vi.fn(), onClose: vi.fn() };
  render(<AutoSettings settings={settings} {...h} />);
  return h;
};

describe('AutoSettings', () => {
  it('shows the timing settings with their current values', () => {
    renderSettings();
    expect(screen.getByRole('dialog', { name: 'Auto settings' })).toBeInTheDocument();
    expect(screen.getByLabelText('Card detection')).toHaveValue('0.08');
    expect(screen.getByLabelText('Stillness')).toHaveValue('0.02');
    expect(screen.getByLabelText('Settle time')).toHaveValue('350');
    expect(screen.getByText('0.4 s')).toBeInTheDocument();
  });

  it('reports a changed setting', () => {
    const { onChange } = renderSettings();
    fireEvent.change(screen.getByLabelText('Settle time'), { target: { value: '900' } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_AUTO_SETTINGS, settleMs: 900 });
  });

  it('tunes sharpness and can force full photos', () => {
    const { onChange } = renderSettings();
    expect(screen.getByLabelText('Sharpness')).toHaveValue('60');
    fireEvent.change(screen.getByLabelText('Sharpness'), { target: { value: '120' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_AUTO_SETTINGS, sharpness: 120 });
    fireEvent.click(screen.getByLabelText('Always use full photos'));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_AUTO_SETTINGS, fullPhotos: true });
  });

  it('re-learns, resets and closes', () => {
    const { onRelearn, onChange, onClose } = renderSettings({ presence: 0.2, stillness: 0.05, settleMs: 1500, sharpness: 100, fullPhotos: true });
    fireEvent.click(screen.getByRole('button', { name: 'Re-learn empty rig' }));
    expect(onRelearn).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_AUTO_SETTINGS);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});
