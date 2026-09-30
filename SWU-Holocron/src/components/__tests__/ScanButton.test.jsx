/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ScanButton from '../ScanButton';

describe('ScanButton', () => {
  it('opens the scanner for a user who can scan', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<ScanButton isAnonymous={false} canScan onOpen={onOpen} />);
    await user.click(screen.getByRole('button', { name: 'Scan cards' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('is locked, and says why, for a signed-in user without Pro', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<ScanButton isAnonymous={false} canScan={false} onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: 'Card scanning is a Pro feature' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('is not shown to a guest', () => {
    render(<ScanButton isAnonymous canScan={false} onOpen={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
