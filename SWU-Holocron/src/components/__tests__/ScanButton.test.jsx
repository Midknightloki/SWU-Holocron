/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ScanButton from '../ScanButton';

// Entitlement is decided by the parent: a view only receives an onScan
// handler when the user is Pro or an admin, and renders no button otherwise.

describe('ScanButton', () => {
  it('opens the scanner from the inline button', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<ScanButton onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: 'Scan cards' });
    expect(button).toHaveTextContent('Scan');
    await user.click(button);
    expect(onOpen).toHaveBeenCalled();
  });

  it('opens the scanner from the floating button', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<ScanButton variant="fab" onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: 'Scan cards' });
    expect(button).toHaveAttribute('data-variant', 'fab');
    await user.click(button);
    expect(onOpen).toHaveBeenCalled();
  });
});
