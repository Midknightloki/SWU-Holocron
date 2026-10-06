/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import React from 'react';
import CollectionValueReport from '../CollectionValueReport';

const L = (id, o) => ({ id, set: 'SOR', number: id.split('_')[1], name: id, subtitle: null, type: 'Unit', rarity: 'Common', aspects: [], variant: 'Normal', isFoil: id.endsWith('foil'), qty: 1, unitPrice: 1, priceIsFallback: false, value: 1, url: null, ...o });
const LINES = [
  L('SOR_010_std', { name: 'Darth Vader', rarity: 'Rare', aspects: ['Villainy'], unitPrice: 5, value: 10, qty: 2 }),
  L('SOR_050_std', { name: 'Battle Droid', qty: 10, unitPrice: 0.05, value: 0.5 }),
  L('SHD_001_std', { set: 'SHD', name: 'Mystery', unitPrice: null, value: null }),
];
const load = vi.fn(async () => ({ lines: LINES, missingSets: [] }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.getItem.mockReset();
  localStorage.setItem.mockReset();
});

const open = async () => {
  render(<CollectionValueReport collectionData={{}} onClose={vi.fn()} load={load} />);
  return screen.findByTestId('total-value');
};

describe('CollectionValueReport', () => {
  it('shows totals and the priced share', async () => {
    expect(await open()).toHaveTextContent('$10.50');
    expect(screen.getByTestId('priced-share')).toHaveTextContent('92% of copies priced');
    expect(screen.getByTestId('total-cards')).toHaveTextContent('13');
  });

  it('filters, and every number follows', async () => {
    await open();
    const set = screen.getByLabelText('Set');
    fireEvent.change(set, { target: { selectedOptions: [set.querySelector('option[value="SHD"]')] } });
    await waitFor(() => expect(screen.getByTestId('total-cards')).toHaveTextContent('1'));
    expect(screen.getByTestId('total-value')).toHaveTextContent('$0.00');
    expect(screen.getByRole('button', { name: 'Remove Set: SHD' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Set: SHD' }));
    await waitFor(() => expect(screen.getByTestId('total-cards')).toHaveTextContent('13'));
  });

  it('drills down from a breakdown row, and clears all', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Filter by rarity Rare' }));
    await waitFor(() => expect(screen.getByTestId('total-value')).toHaveTextContent('$10.00'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(screen.getByTestId('total-value')).toHaveTextContent('$10.50'));
  });

  it('sorts the card list and pages it', async () => {
    const many = Array.from({ length: 150 }, (_, i) => L(`SOR_${String(i).padStart(3, '0')}_std`, { value: i, unitPrice: i }));
    render(<CollectionValueReport collectionData={{}} onClose={vi.fn()} load={async () => ({ lines: many, missingSets: [] })} />);
    const list = await screen.findByRole('list', { name: 'Cards' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(100);
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('SOR_149_std');
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(150);
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'name' } });
    fireEvent.click(screen.getByRole('button', { name: /Ascending|Descending/ }));
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('SOR_000_std');
  });

  it('remembers filters', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Search cards'), { target: { value: 'vader' } });
    expect(localStorage.setItem).toHaveBeenLastCalledWith('swu-value-filters', expect.stringContaining('"search":"vader"'));
  });

  it('starts from remembered filters', async () => {
    localStorage.getItem.mockImplementation(() => JSON.stringify({ search: 'vader' }));
    expect(await open()).toHaveTextContent('$10.00');
    expect(screen.getByLabelText('Search cards')).toHaveValue('vader');
  });

  it('ignores stored filters it cannot read', async () => {
    localStorage.getItem.mockImplementation(() => '{"sets":"oops"');
    await open();
    expect(screen.getByTestId('total-cards')).toHaveTextContent('13');
    localStorage.getItem.mockImplementation(() => JSON.stringify({ sets: 'SHD' }));
    cleanup();
    await open();
    expect(screen.getByTestId('total-cards')).toHaveTextContent('13');
  });

  it('exports CSV and prints', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(click).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save as PDF' }));
    expect(print).toHaveBeenCalled();
    click.mockRestore(); print.mockRestore();
  });

  it('notes sets it could not load and missing prices', async () => {
    render(<CollectionValueReport collectionData={{}} onClose={vi.fn()} load={async () => ({ lines: LINES, missingSets: ['SHD'], error: 'prices' })} />);
    expect(await screen.findByText(/Couldn.t load card details for SHD/)).toBeInTheDocument();
    expect(screen.getByText('Prices are unavailable right now.')).toBeInTheDocument();
  });
});
