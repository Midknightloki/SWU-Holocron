/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
vi.mock('../../services/CardService', () => ({ CardService: { getCardImage: (s, n) => `/img/${s}/${n}` } }));
import PublicListView from '../PublicListView';

const DOC = {
  code: 'abcd2345', kind: 'wants', name: 'Gaps', showPrices: true, cards: 3, value: 3, pricesAsOf: Date.UTC(2026, 9, 6),
  lines: [
    { set: 'SOR', number: '005', name: 'Luke', subtitle: null, finish: 'foil', qty: 1, type: 'Unit' },
    { set: 'SOR', number: '010', name: 'Darth Vader', subtitle: 'Dark Lord', finish: 'any', qty: 2, note: 'any art', type: 'Leader', unitPrice: 1.5, priceIsFallback: true },
  ],
};
let service;
beforeEach(() => { service = { getPublicList: vi.fn(async () => ({ list: DOC })) }; });

describe('PublicListView', () => {
  it('shows the list with prices, notes and finishes', async () => {
    render(<PublicListView code="abcd2345" service={service} />);
    expect(await screen.findByRole('heading', { name: 'Wants list: Gaps' })).toBeInTheDocument();
    expect(screen.getAllByTestId('public-row')).toHaveLength(2);
    expect(screen.getByText('any art')).toBeInTheDocument();
    expect(screen.getByText(/SOR 005 · Foil/)).toBeInTheDocument();
    expect(screen.getByText('$1.50 ↺')).toBeInTheDocument();
    expect(screen.getByTestId('public-value')).toHaveTextContent('$3.00');
    expect(screen.getByText(/Prices as of/)).toBeInTheDocument();
    expect(service.getPublicList).toHaveBeenCalledWith('abcd2345');
  });

  it('shows no dollar amounts on a list without prices', async () => {
    service.getPublicList.mockResolvedValue({ list: { ...DOC, kind: 'trade', showPrices: false, value: undefined, pricesAsOf: undefined, lines: DOC.lines.map(({ unitPrice, ...l }) => l) } });
    render(<PublicListView code="abcd2345" service={service} />);
    await screen.findByRole('heading', { name: 'Trade list: Gaps' });
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('copies the list as text', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<PublicListView code="abcd2345" service={service} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy as text' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toMatch(/^Wants: Gaps/);
  });

  it('says when a list is no longer shared', async () => {
    service.getPublicList.mockResolvedValue({ error: 'not-found' });
    render(<PublicListView code="gone2345" service={service} />);
    expect(await screen.findByText("This list isn't shared any more.")).toBeInTheDocument();
  });

  it('says when it cannot load', async () => {
    service.getPublicList.mockResolvedValue({ error: 'offline' });
    render(<PublicListView code="abcd2345" service={service} />);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this list");
  });

  it('fits a phone: wrapping notes and names, wide quantities, landscape leaders, fallback marker', async () => {
    render(<PublicListView code="abcd2345" service={service} />);
    await screen.findAllByTestId('public-row');
    expect(screen.getByText('any art')).toHaveClass('break-words');
    expect(screen.getByText('Darth Vader, Dark Lord')).toHaveClass('break-words');
    const [luke, vader] = screen.getAllByTestId('public-row');
    expect(luke.querySelector('img')).toHaveClass('w-10', 'h-14');
    expect(vader.querySelector('img')).toHaveClass('w-14', 'h-10');
    expect(screen.getByText('$1.50 ↺')).toBeInTheDocument();
    expect(screen.getByText('×2')).toHaveClass('whitespace-nowrap');
  });
});
