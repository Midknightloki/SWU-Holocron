/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const m = vi.hoisted(() => ({ listPublished: vi.fn(), list: vi.fn(), add: vi.fn() }));
vi.mock('../../services/PrebuiltDeckService', () => ({ PrebuiltDeckService: { listPublished: m.listPublished } }));
vi.mock('../../services/prebuiltAdd', () => ({ PrebuiltAdds: { list: m.list }, addPrebuiltToCollection: m.add }));
vi.mock('../BatchReport', () => ({ default: ({ batchId }) => <div role="dialog" aria-label="Batch report">report {batchId}</div> }));

import PrebuiltDecksPanel from '../PrebuiltDecksPanel';

const PRODUCT = { tcgplayerProductId: 9, name: 'Intro Battle: Hoth - Learn to Play Kit', imageUrl: 'img' };
const DECKS = [
  { id: '149318', sourceId: 149318, name: 'Vader Preset', product: PRODUCT, cards: [{ id: 'IBH_053', qty: 1 }], issues: [] },
  { id: '149317', sourceId: 149317, name: 'Leia Preset', product: PRODUCT, cards: [{ id: 'IBH_001', qty: 1 }], issues: [] },
  { id: '151901', sourceId: 151901, name: 'Emperor Palpatine Spotlight', product: null, cards: [{ id: 'ASH_015', qty: 1 }], issues: [] },
];

beforeEach(() => {
  vi.clearAllMocks();
  m.listPublished.mockResolvedValue(DECKS);
  m.list.mockResolvedValue({});
  m.add.mockResolvedValue({ ok: true, batchId: 'b9', skipped: [] });
});

const renderPanel = (props = {}) => render(<PrebuiltDecksPanel uid="u1" collectionRef={{ id: 'ref' }} collectionData={{}} onAdded={vi.fn()} {...props} />);

describe('PrebuiltDecksPanel', () => {
  it('groups decks by product and searches them', async () => {
    renderPanel();
    expect(await screen.findByText('Intro Battle: Hoth - Learn to Play Kit')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add all (2)' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search prebuilt decks'), { target: { value: 'palpatine' } });
    expect(screen.queryByText('Vader Preset')).not.toBeInTheDocument();
    expect(screen.getByText('Emperor Palpatine Spotlight')).toBeInTheDocument();
  });

  it('adds a deck with the price paid and opens its report', async () => {
    const onAdded = vi.fn();
    renderPanel({ onAdded });
    fireEvent.click(await screen.findByRole('button', { name: 'Add Emperor Palpatine Spotlight' }));
    fireEvent.change(screen.getByLabelText('Price paid'), { target: { value: '24.99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to collection' }));
    expect(await screen.findByRole('dialog', { name: 'Batch report' })).toHaveTextContent('report b9');
    expect(m.add).toHaveBeenCalledWith(expect.objectContaining({ uid: 'u1', collectionRef: { id: 'ref' }, decks: [DECKS[2]], name: 'Emperor Palpatine Spotlight', pricePaid: 24.99 }));
    expect(onAdded).toHaveBeenCalled();
  });

  it('adds every deck of a product as one batch named after the product', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Add all (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to collection' }));
    await waitFor(() => expect(m.add).toHaveBeenCalledWith(expect.objectContaining({ decks: [DECKS[0], DECKS[1]], name: PRODUCT.name })));
  });

  it('asks before adding a deck again, then adds on top', async () => {
    m.list.mockResolvedValue({ 151901: { addedAt: Date.UTC(2026, 9, 1), count: 1 } });
    renderPanel();
    expect(await screen.findByText(/Added/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Emperor Palpatine Spotlight' }));
    expect(screen.getByText(/You added this on .*Add another copy\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add to collection' }));
    await waitFor(() => expect(m.add).toHaveBeenCalled());
  });

  it('says which cards were skipped, and when the report could not be saved', async () => {
    m.add.mockResolvedValueOnce({ ok: true, batchId: 'b9', skipped: ['XYZ_001'] });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Emperor Palpatine Spotlight' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to collection' }));
    expect(await screen.findByText(/1 card wasn.t added.*XYZ_001/)).toBeInTheDocument();
    m.add.mockResolvedValueOnce({ error: 'report', batchId: 'b9', skipped: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Add Emperor Palpatine Spotlight' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to collection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/batch report couldn.t be saved/i);
  });

  it('renders nothing without a user', () => {
    const { container } = render(<PrebuiltDecksPanel uid={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
