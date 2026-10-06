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

// The filters start collapsed behind a button.
const showFilters = () => fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));

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
    showFilters();
    const set = screen.getByLabelText('Set');
    fireEvent.change(set, { target: { selectedOptions: [set.querySelector('option[value="SHD"]')] } });
    await waitFor(() => expect(screen.getByTestId('total-cards')).toHaveTextContent('1'));
    // SHD's only card has no price: no money total, not $0.00.
    expect(screen.getByTestId('total-value')).toHaveTextContent('—');
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
    showFilters();
    fireEvent.change(screen.getByLabelText('Search cards'), { target: { value: 'vader' } });
    expect(localStorage.setItem).toHaveBeenLastCalledWith('swu-value-filters', expect.stringContaining('"search":"vader"'));
  });

  it('starts from remembered filters', async () => {
    localStorage.getItem.mockImplementation(() => JSON.stringify({ search: 'vader' }));
    expect(await open()).toHaveTextContent('$10.00');
    showFilters();
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

  it('survives saved filters of the wrong type, field by field', async () => {
    localStorage.getItem.mockImplementation(() => JSON.stringify({ minPrice: '5', search: 5, finish: 'weird', price: 7, sets: [1, 'SOR'], rarities: 'Rare' }));
    await open();
    // Only the readable part survives: sets ['SOR'] (the number is dropped).
    expect(screen.getByTestId('total-cards')).toHaveTextContent('12');
    expect(screen.getByRole('button', { name: 'Remove Set: SOR' })).toBeInTheDocument();
    showFilters();
    expect(screen.getByLabelText('Search cards')).toHaveValue('');
    expect(screen.getByLabelText('Finish')).toHaveValue('all');
  });

  it('prints every matching card, not just the rows on screen', async () => {
    const many = Array.from({ length: 150 }, (_, i) => L(`SOR_${String(i).padStart(3, '0')}_std`, { value: i, unitPrice: i }));
    let printedRows = 0;
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      printedRows = within(screen.getByRole('list', { name: 'Cards' })).getAllByRole('listitem').length;
    });
    render(<CollectionValueReport collectionData={{}} onClose={vi.fn()} load={async () => ({ lines: many, missingSets: [] })} />);
    await screen.findByRole('list', { name: 'Cards' });
    fireEvent.click(screen.getByRole('button', { name: 'Save as PDF' }));
    await waitFor(() => expect(print).toHaveBeenCalled());
    expect(printedRows).toBe(150);
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Cards' })).getAllByRole('listitem')).toHaveLength(100));
    print.mockRestore();
  });

  it('shows no money total when nothing is priced', async () => {
    render(<CollectionValueReport collectionData={{}} onClose={vi.fn()} load={async () => ({ lines: [LINES[2]], missingSets: [] })} />);
    expect(await screen.findByTestId('total-value')).toHaveTextContent('—');
  });

  it('keeps the filters collapsed behind a button, with the active ones still shown as chips', async () => {
    localStorage.getItem.mockImplementation(() => JSON.stringify({ sets: ['SOR'] }));
    await open();
    const toggle = screen.getByRole('button', { name: 'Filters (1)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Search cards')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Set: SOR' })).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Search cards')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByLabelText('Search cards')).not.toBeInTheDocument();
  });
});

describe('Surplus mode', () => {
  const S = (id, o) => L(id, { qty: 1, unitPrice: 2, value: 2, ...o });
  const OWN = [S('SOR_010_std', { name: 'Darth Vader', qty: 6, value: 12 }), S('SOR_005_std', { name: 'Luke', type: 'Leader', qty: 3, value: 6 })];
  const loadWith = (extra) => vi.fn(async () => ({ lines: OWN, missingSets: [], decks: [{ cards: { SOR_010: 2 } }], ...extra }));

  const openSurplus = async (load) => {
    render(<CollectionValueReport uid="u1" collectionData={{}} onClose={vi.fn()} load={load} />);
    await screen.findByTestId('total-value');
    fireEvent.click(screen.getByRole('button', { name: 'Surplus' }));
  };

  it('lists the surplus with how it was worked out, and reads the decks', async () => {
    const load = loadWith();
    await openSurplus(load);
    expect(load).toHaveBeenCalledWith({}, { uid: 'u1', includeDecks: true });
    expect(screen.getByRole('heading', { name: 'Surplus / trade list' })).toBeInTheDocument();
    // Vader 6 - 2 in decks - 3 kept = 1; Luke (leader) 3 - 1 kept = 2.
    expect(screen.getByTestId('total-cards')).toHaveTextContent('3');
    expect(screen.getByText('Surplus 1 · own 6 · decks 2 · keep 3')).toBeInTheDocument();
    expect(screen.getByText('Surplus 2 · own 3 · decks 0 · keep 1')).toBeInTheDocument();
    expect(localStorage.setItem).toHaveBeenCalledWith('swu-value-mode', 'surplus');
  });

  it('shows no surplus when decks cannot be read', async () => {
    await openSurplus(loadWith({ decks: undefined, decksError: true }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Couldn.t read your decks/);
    expect(screen.getByTestId('total-cards')).toHaveTextContent('0');
  });

  it('says when there is no surplus', async () => {
    await openSurplus(vi.fn(async () => ({ lines: [S('SOR_010_std', { qty: 3 })], missingSets: [], decks: [] })));
    expect(screen.getByText(/No surplus — everything you own/)).toBeInTheDocument();
  });

  it('hides every price when Show prices is off', async () => {
    await openSurplus(loadWith());
    fireEvent.click(screen.getByRole('button', { name: 'Show prices' }));
    expect(screen.getByRole('button', { name: 'Show prices' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('total-value')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\$\d/);
    expect(localStorage.setItem).toHaveBeenCalledWith('swu-value-show-prices', '0');
  });

  it('copies the trade list as text', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await openSurplus(loadWith());
    fireEvent.click(screen.getByRole('button', { name: 'Copy as text' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toMatch(/^2× Luke \(SOR 005\)/);
    expect(writeText.mock.calls[0][0]).toMatch(/Total: 3 cards/);
    expect(await screen.findByRole('status')).toHaveTextContent('Copied 3 cards');
  });

  it('falls back to a selectable box when the clipboard is blocked', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } });
    await openSurplus(loadWith());
    fireEvent.click(screen.getByRole('button', { name: 'Copy as text' }));
    expect((await screen.findByLabelText('Trade list')).value).toContain('1× Darth Vader');
  });
});
