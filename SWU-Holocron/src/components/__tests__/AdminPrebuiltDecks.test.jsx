/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

const m = vi.hoisted(() => ({ listDecks: vi.fn(), listProducts: vi.fn(), publish: vi.fn(), ignore: vi.fn(), unpublish: vi.fn(), acceptChanges: vi.fn(), addFromLink: vi.fn() }));
vi.mock('../../services/PrebuiltDeckService', () => ({ PrebuiltDeckService: m }));

import AdminPrebuiltDecks from '../AdminPrebuiltDecks';

const PRODUCTS = [
  { tcgplayerProductId: 2, name: 'Ashes of the Empire - Spotlight Deck: Emperor Palpatine', setCode: 'ASH' },
  { tcgplayerProductId: 1, name: 'Ashes of the Empire - Spotlight Deck: Luke Skywalker', setCode: 'ASH' },
];
const DECKS = [
  { id: '151901', sourceName: 'Emperor Palpatine (ASH)', name: 'Emperor Palpatine (ASH)', status: 'review', cards: [{ id: 'ASH_015', qty: 1 }, { id: 'ASH_118', qty: 50 }], issues: [{ id: 'XYZ_001', problem: 'unknown-card' }], suggestedProduct: PRODUCTS[0], product: null },
  { id: '2963', sourceName: 'Aggression', name: 'Aggression', status: 'review', cards: [], issues: [], suggestedProduct: null, product: null },
  { id: '149318', sourceName: 'Vader Preset', name: 'Vader Preset', status: 'changed', cards: [{ id: 'A_1', qty: 1 }], pending: { cards: [{ id: 'A_1', qty: 2 }] }, issues: [], product: null },
  { id: '147115', sourceName: 'TS deck', name: 'TS deck', status: 'published', cards: [], issues: [], product: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  m.listDecks.mockResolvedValue(DECKS);
  m.listProducts.mockResolvedValue(PRODUCTS);
  for (const k of ['publish', 'ignore', 'unpublish', 'acceptChanges']) m[k].mockResolvedValue({ ok: true });
  m.addFromLink.mockResolvedValue({ ok: true, id: 5 });
});

const renderTab = () => render(<AdminPrebuiltDecks uid="admin" loadKnownIds={async () => new Set(['ASH_015'])} />);

describe('AdminPrebuiltDecks', () => {
  it('lists decks needing review first, with issues, card count and the suggested product', async () => {
    renderTab();
    const review = await screen.findByRole('region', { name: 'Needs review' });
    expect(within(review).getByText('Emperor Palpatine (ASH)')).toBeInTheDocument();
    expect(within(review).getByText(/51 cards/)).toBeInTheDocument();
    expect(within(review).getByText(/Not in our database: XYZ_001/)).toBeInTheDocument();
    expect(within(review).getByLabelText('Product for Emperor Palpatine (ASH)')).toHaveValue('2');
    expect(within(review).getByText('Changed at source')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Published' })).getByText('TS deck')).toBeInTheDocument();
  });

  it('publishes with the chosen product and display name', async () => {
    renderTab();
    fireEvent.change(await screen.findByLabelText('Display name for Emperor Palpatine (ASH)'), { target: { value: 'Emperor Palpatine Spotlight' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish Emperor Palpatine (ASH)' }));
    await waitFor(() => expect(m.publish).toHaveBeenCalledWith('151901', { product: PRODUCTS[0], name: 'Emperor Palpatine Spotlight' }, 'admin'));
    expect(m.listDecks).toHaveBeenCalledTimes(2);
  });

  it('marks a personal deck as not a precon, and accepts a changed deck', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Not a precon: Aggression' }));
    await waitFor(() => expect(m.ignore).toHaveBeenCalledWith('2963'));
    fireEvent.click(screen.getByRole('button', { name: 'Accept changes to Vader Preset' }));
    await waitFor(() => expect(m.acceptChanges).toHaveBeenCalledWith('149318'));
  });

  it('adds a deck from a link and explains a bad one', async () => {
    renderTab();
    const input = await screen.findByLabelText('sw-unlimited-db deck link');
    fireEvent.change(input, { target: { value: 'https://sw-unlimited-db.com/decks/5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fetch deck' }));
    await waitFor(() => expect(m.addFromLink).toHaveBeenCalledWith('https://sw-unlimited-db.com/decks/5', { knownIds: new Set(['ASH_015']) }));
    m.addFromLink.mockResolvedValueOnce({ error: 'bad-link' });
    fireEvent.click(screen.getByRole('button', { name: 'Fetch deck' }));
    expect(await screen.findByText("That isn't a sw-unlimited-db deck link.")).toBeInTheDocument();
  });
});
