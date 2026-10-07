/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import CopyTextButton from '../CopyTextButton';

let writeText;
beforeEach(() => {
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
const long = ['Wants: Big', '', ...Array.from({ length: 120 }, (_, i) => `1× A card with quite a long name number ${i} (SOR ${i})`), 'Total: 120 cards'].join('\n');

describe('CopyTextButton', () => {
  it('copies a short list in one tap, escaped for Discord', async () => {
    render(<CopyTextButton text={'Wants: A\n\n1× *Star* (SOR 001)\nTotal: 1 cards'} count={1} fallbackLabel="List text" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy as text' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Copied 1 cards');
    expect(writeText).toHaveBeenCalledWith('Wants: A\n\n1× \\*Star\\* (SOR 001)\nTotal: 1 cards');
  });

  it('copies a long list part by part', async () => {
    render(<CopyTextButton text={long} fallbackLabel="List text" />);
    const first = screen.getByRole('button', { name: /^Copy part 1 of \d$/ });
    const n = Number(first.textContent.match(/of (\d)/)[1]);
    fireEvent.click(first);
    expect(await screen.findByRole('status')).toHaveTextContent(`Copied part 1 of ${n}`);
    expect(writeText.mock.calls[0][0].length).toBeLessThanOrEqual(2000);
    expect(screen.getByRole('button', { name: `Copy part 2 of ${n}` })).toBeInTheDocument();
  });

  it('shows the current part to select by hand when the clipboard is blocked', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    render(<CopyTextButton text={long} fallbackLabel="List text" />);
    fireEvent.click(screen.getByRole('button', { name: /^Copy part 1/ }));
    expect((await screen.findByLabelText('List text')).value.startsWith('Wants: Big (part 1 of')).toBe(true);
  });

  it('resets when the text changes', async () => {
    const { rerender } = render(<CopyTextButton text={long} fallbackLabel="List text" />);
    fireEvent.click(screen.getByRole('button', { name: /^Copy part 1/ }));
    await screen.findByRole('status');
    rerender(<CopyTextButton text={`${long}\n`} fallbackLabel="List text" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Copy part 1/ })).toBeInTheDocument();
  });

  it('reaches every part when the clipboard is blocked', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    render(<CopyTextButton text={long} fallbackLabel="List text" />);
    fireEvent.click(screen.getByRole('button', { name: /^Copy part 1/ }));
    await screen.findByLabelText('List text');
    fireEvent.click(screen.getByRole('button', { name: /^Copy part 2/ }));
    await vi.waitFor(() => expect(screen.getByLabelText('List text').value).toMatch(/^Wants: Big \(part 2 of/));
  });
});
