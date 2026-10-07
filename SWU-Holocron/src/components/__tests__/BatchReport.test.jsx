/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const m = vi.hoisted(() => ({ getBatch: vi.fn(), renameBatch: vi.fn(), deleteBatch: vi.fn(), setBatchPricePaid: vi.fn(), getBulkPrices: vi.fn() }));
vi.mock('../../services/BatchService', () => ({ BatchService: { getBatch: m.getBatch, renameBatch: m.renameBatch, deleteBatch: m.deleteBatch, setBatchPricePaid: m.setBatchPricePaid } }));
vi.mock('../../services/PricingService', () => ({ PricingService: { getBulkPrices: m.getBulkPrices } }));

import BatchReport from '../BatchReport';

const BATCH = {
  id: 'b1', name: 'eBay SOR box', createdAt: Date.UTC(2026, 9, 5), closedAt: 2, pricePaid: 100,
  cards: {
    SOR_200_std: { set: 'SOR', number: '200', name: 'Darth Vader', type: 'Unit', rarity: 'Legendary', aspects: ['Aggression'], variant: 'Hyperspace', isFoil: false, qty: 1, isNew: true, priceAtAdd: 80 },
    SOR_050_std: { set: 'SOR', number: '050', name: 'Battle Droid', type: 'Unit', rarity: 'Common', aspects: [], variant: 'Normal', isFoil: false, qty: 10, isNew: false, priceAtAdd: null },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getBatch.mockResolvedValue(BATCH);
  m.getBulkPrices.mockResolvedValue({ SOR_200_std: { market: 90 } });
  m.renameBatch.mockResolvedValue({ ok: true });
  m.deleteBatch.mockResolvedValue({ ok: true });
  m.setBatchPricePaid.mockResolvedValue({ ok: true });
});

const renderReport = (props = {}) => render(<BatchReport uid="u1" batchId="b1" onClose={vi.fn()} onDeleted={vi.fn()} {...props} />);

describe('BatchReport', () => {
  it('shows the totals, value vs paid, top pulls, new cards and unpriced cards', async () => {
    renderReport();
    expect(await screen.findByRole('heading', { name: 'eBay SOR box' })).toBeInTheDocument();
    expect(screen.getByTestId('value-at-add')).toHaveTextContent('$80.00');
    expect(screen.getByTestId('net')).toHaveTextContent('-$20.00');
    await waitFor(() => expect(screen.getByTestId('value-now')).toHaveTextContent('$90.00'));
    expect(screen.getByTestId('top-pulls')).toHaveTextContent('Darth Vader');
    expect(screen.getByTestId('new-cards')).toHaveTextContent('Darth Vader');
    expect(screen.getByTestId('unpriced')).toHaveTextContent('Battle Droid');
  });

  it('lists quantities a Replace import lowered', async () => {
    m.getBatch.mockResolvedValue({ ...BATCH, reductions: [{ id: 'SOR_020_std', set: 'SOR', number: '020', name: 'Luke', isFoil: false, from: 4, to: 1 }] });
    renderReport();
    const list = await screen.findByTestId('reductions');
    expect(list).toHaveTextContent('SOR 020');
    expect(list).toHaveTextContent('Luke');
    expect(list).toHaveTextContent('4 → 1');
  });

  it('has no reductions section for an ordinary batch', async () => {
    renderReport();
    await screen.findByRole('heading', { name: 'eBay SOR box' });
    expect(screen.queryByTestId('reductions')).not.toBeInTheDocument();
  });

  it('renders straight under <body>, so printing can hide the rest of the app', async () => {
    renderReport();
    await screen.findByRole('heading', { name: 'eBay SOR box' });
    expect(screen.getByRole('dialog', { name: 'Batch report' }).parentElement).toBe(document.body);
  });

  it('says how many cards have no current price', async () => {
    renderReport();
    await waitFor(() => expect(screen.getByTestId('value-now')).toHaveTextContent('$90.00 (1 unpriced)'));
  });

  it('downloads a CSV', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderReport();
    fireEvent.click(await screen.findByRole('button', { name: 'Download CSV' }));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it('prints for Save as PDF', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderReport();
    fireEvent.click(await screen.findByRole('button', { name: 'Save as PDF' }));
    expect(print).toHaveBeenCalled();
    print.mockRestore();
  });

  it('renames and deletes', async () => {
    const onDeleted = vi.fn();
    renderReport({ onDeleted });
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Batch name'), { target: { value: 'Box #2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(m.renameBatch).toHaveBeenCalledWith('u1', 'b1', 'Box #2'));
    expect(await screen.findByRole('heading', { name: 'Box #2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete report' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete — your collection is not affected' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it('edits the price paid, which updates the net', async () => {
    renderReport();
    expect(await screen.findByTestId('net')).toHaveTextContent('-$20.00');
    fireEvent.click(screen.getByRole('button', { name: 'Edit price paid' }));
    const input = screen.getByLabelText('Price paid');
    expect(input).toHaveValue('100');
    fireEvent.change(input, { target: { value: '$60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    await waitFor(() => expect(m.setBatchPricePaid).toHaveBeenCalledWith('u1', 'b1', 60));
    expect(await screen.findByTestId('net')).toHaveTextContent('+$20.00');
    expect(screen.queryByLabelText('Price paid')).not.toBeInTheDocument();
  });

  it('clears the price paid when left blank, and refuses what it cannot read', async () => {
    renderReport();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit price paid' }));
    fireEvent.change(screen.getByLabelText('Price paid'), { target: { value: 'forty' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/price like 89.99/);
    expect(m.setBatchPricePaid).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Price paid'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    await waitFor(() => expect(m.setBatchPricePaid).toHaveBeenCalledWith('u1', 'b1', null));
    expect(await screen.findByTestId('net')).toHaveTextContent('—');
  });

  it('says so when value now cannot be loaded', async () => {
    m.getBulkPrices.mockRejectedValue(new Error('offline'));
    renderReport();
    await waitFor(() => expect(screen.getByTestId('value-now')).toHaveTextContent('unavailable'));
  });
});
