/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const m = vi.hoisted(() => ({ listBatches: vi.fn() }));
vi.mock('../../services/BatchService', () => ({ BatchService: { listBatches: m.listBatches } }));
vi.mock('../BatchReport', () => ({
  default: ({ batchId, onClose, onDeleted }) => (
    <div role="dialog" aria-label="Batch report">
      report {batchId}
      <button type="button" onClick={onClose}>close-mock</button>
      <button type="button" onClick={onDeleted}>delete-mock</button>
    </div>
  ),
}));

import BatchesPanel from '../BatchesPanel';

const LIST = [
  { id: 'b1', name: 'eBay SOR box', createdAt: Date.UTC(2026, 9, 5), closedAt: 1, pricePaid: 100, summary: { cards: 384, unique: 200, newUnique: 40, valueAtAdd: 120.5 } },
  { id: 'b0', name: 'Pre-release', createdAt: Date.UTC(2026, 9, 1), closedAt: 1, pricePaid: null, summary: { cards: 60, unique: 55, newUnique: 5, valueAtAdd: 30 } },
];

beforeEach(() => { vi.clearAllMocks(); m.listBatches.mockResolvedValue(LIST); });

describe('BatchesPanel', () => {
  it('lists batches with value and net vs paid', async () => {
    render(<BatchesPanel uid="u1" />);
    const row = await screen.findByRole('button', { name: /eBay SOR box/ });
    expect(row).toHaveTextContent('384 cards');
    expect(row).toHaveTextContent('$120.50');
    expect(row).toHaveTextContent('+$20.50');
    expect(screen.getByRole('button', { name: /Pre-release/ })).not.toHaveTextContent('+$');
  });

  it('opens a report and refreshes the list after a delete', async () => {
    render(<BatchesPanel uid="u1" />);
    fireEvent.click(await screen.findByRole('button', { name: /eBay SOR box/ }));
    expect(screen.getByRole('dialog', { name: 'Batch report' })).toHaveTextContent('report b1');
    fireEvent.click(screen.getByText('delete-mock'));
    expect(m.listBatches).toHaveBeenCalledTimes(2);
  });

  it('reloads after a report closes, so an edited name or price shows', async () => {
    render(<BatchesPanel uid="u1" />);
    fireEvent.click(await screen.findByRole('button', { name: /eBay SOR box/ }));
    fireEvent.click(screen.getByText('close-mock'));
    await waitFor(() => expect(m.listBatches).toHaveBeenCalledTimes(2));
  });

  it('reloads when asked to, so a batch just finished appears', async () => {
    const { rerender } = render(<BatchesPanel uid="u1" refreshKey={0} />);
    await screen.findByRole('button', { name: /eBay SOR box/ });
    rerender(<BatchesPanel uid="u1" refreshKey={1} />);
    await waitFor(() => expect(m.listBatches).toHaveBeenCalledTimes(2));
  });

  it('says when the list could not be loaded', async () => {
    m.listBatches.mockResolvedValue({ error: 'offline' });
    render(<BatchesPanel uid="u1" />);
    expect(await screen.findByText(/couldn.t load your batches/i)).toBeInTheDocument();
  });

  it('says when there are no batches, and renders nothing without a user', async () => {
    m.listBatches.mockResolvedValue([]);
    const { rerender } = render(<BatchesPanel uid="u1" />);
    expect(await screen.findByText('No batches yet')).toBeInTheDocument();
    rerender(<BatchesPanel uid={null} />);
    expect(screen.queryByText('No batches yet')).not.toBeInTheDocument();
  });
});
