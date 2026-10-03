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
  it('shows the three settings with their current values', () => {
    renderSettings();
    expect(screen.getByRole('dialog', { name: 'Auto settings' })).toBeInTheDocument();
    expect(screen.getByLabelText('Card detection')).toHaveValue('0.08');
    expect(screen.getByLabelText('Stillness')).toHaveValue('0.02');
    expect(screen.getByLabelText('Settle time')).toHaveValue('600');
    expect(screen.getByText('0.6 s')).toBeInTheDocument();
  });

  it('reports a changed setting', () => {
    const { onChange } = renderSettings();
    fireEvent.change(screen.getByLabelText('Settle time'), { target: { value: '900' } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_AUTO_SETTINGS, settleMs: 900 });
  });

  it('re-learns, resets and closes', () => {
    const { onRelearn, onChange, onClose } = renderSettings({ presence: 0.2, stillness: 0.05, settleMs: 1500 });
    fireEvent.click(screen.getByRole('button', { name: 'Re-learn empty rig' }));
    expect(onRelearn).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_AUTO_SETTINGS);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});
