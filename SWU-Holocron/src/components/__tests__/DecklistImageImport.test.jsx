/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import React from 'react';
vi.mock('../CardPickerModal', () => ({
  default: ({ onSelect }) => <button type="button" onClick={() => onSelect({ Set: 'JTL', Number: '200', Name: 'Shuttle Tydirium', Type: 'Unit' })}>pick-it</button>,
}));
import DecklistImageImport from '../DecklistImageImport';

const URL = 'https://cdn.starwarsunlimited.com//large_SWH_04_Article_Spotlight_Decks_Decklist_v02_1f4852aef7.jpg';
const REGISTRY = [
  { code: 'TWI', isBaseSet: true, releaseDate: '2024-11-08' },
  { code: 'JTL', isBaseSet: true, releaseDate: '2025-03-14' },
];
const card = (Set, Number, Name, Type = 'Unit') => ({ Set, Number, Name, Type });
const SETS = {
  JTL: [card('JTL', '017', 'Han Solo', 'Leader'), card('JTL', '024', 'Echo Base', 'Base'), card('JTL', '249', 'Millennium Falcon')],
  TWI: [card('TWI', '114', 'Clone Commander Cody')],
};
const DECKS = [{ title: 'HAN SOLO', lines: [
  { number: '17', fromPreviousSet: false, name: 'Han Solo', qty: 1 },
  { number: '024', fromPreviousSet: false, name: 'Echo Base', qty: 1 },
  { number: '249', fromPreviousSet: false, name: 'Millennium Falcon', qty: 3 },
  { number: '114', fromPreviousSet: true, name: 'Clone Commander Cody', qty: 1 },
  { number: '200', fromPreviousSet: false, name: 'Shuttle Tydirium', qty: 3 },
] }];
let service; let loadSetImpl; let onSaved;
beforeEach(() => {
  service = {
    readDecklistImage: vi.fn(async () => ({ decks: DECKS })),
    addFromImage: vi.fn(async (deck) => ({ ok: true, id: deck.sourceId })),
  };
  loadSetImpl = vi.fn(async (code) => ({ cards: SETS[code] ?? [] }));
  onSaved = vi.fn();
});
const open = () => render(<DecklistImageImport onSaved={onSaved} service={service} loadSetImpl={loadSetImpl} getRegistry={async () => REGISTRY} />);
const read = async () => {
  fireEvent.change(screen.getByLabelText('Decklist image link'), { target: { value: URL } });
  fireEvent.click(screen.getByRole('button', { name: 'Read image' }));
  return screen.findByRole('region', { name: 'Han Solo' });
};

describe('DecklistImageImport', () => {
  it('reads an official image, guesses the set and resolves the lines', async () => {
    open();
    const deck = await read();
    expect(service.readDecklistImage).toHaveBeenCalledWith({ imageUrl: URL });
    expect(screen.getByLabelText('Deck set')).toHaveValue('JTL');
    await waitFor(() => expect(within(deck).getByText('TWI 114 Clone Commander Cody')).toBeInTheDocument());
    expect(within(deck).getByText('JTL 017 Han Solo')).toBeInTheDocument();
    expect(within(deck).getByText(/not found/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save as review' })).toBeDisabled();
  });

  it('refuses a link that is not on the official CDN without calling the function', async () => {
    open();
    fireEvent.change(screen.getByLabelText('Decklist image link'), { target: { value: 'https://evil.com/x.png' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read image' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only official starwarsunlimited.com images');
    expect(service.readDecklistImage).not.toHaveBeenCalled();
  });

  it('fixes an unresolved line with the card picker, warns on the count, then saves', async () => {
    open();
    const deck = await read();
    await within(deck).findByText(/not found/i);
    fireEvent.click(within(deck).getByRole('button', { name: /Pick card/ }));
    fireEvent.click(screen.getByText('pick-it'));
    expect(within(deck).getByText('JTL 200 Shuttle Tydirium')).toBeInTheDocument();
    expect(within(deck).getByText(/Main deck has 7 cards/)).toBeInTheDocument();
    fireEvent.change(within(deck).getByLabelText('Deck name'), { target: { value: 'HAN SOLO SPOTLIGHT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as review' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [saved, meta] = service.addFromImage.mock.calls[0];
    expect(saved).toMatchObject({ sourceId: 'img-jtl-han-solo-spotlight', leaders: ['JTL_017'], base: 'JTL_024' });
    expect(saved.cards).toContainEqual({ id: 'JTL_200', qty: 3 });
    expect(meta).toEqual({ url: URL, setCode: 'JTL' });
    expect(screen.getByText('Saved Han Solo Spotlight')).toBeInTheDocument();
  });

  it('can remove a line instead', async () => {
    open();
    const deck = await read();
    await within(deck).findByText(/not found/i);
    fireEvent.click(within(deck).getByRole('button', { name: /Remove/ }));
    expect(screen.getByRole('button', { name: 'Save as review' })).not.toBeDisabled();
  });

  it('re-resolves when the set is changed, without reading the image again', async () => {
    open();
    await read();
    await waitFor(() => expect(loadSetImpl).toHaveBeenCalledWith('JTL'));
    fireEvent.change(screen.getByLabelText('Deck set'), { target: { value: 'TWI' } });
    await waitFor(() => expect(screen.getAllByText(/not found|doesn't match/i).length).toBeGreaterThan(1));
    expect(service.readDecklistImage).toHaveBeenCalledTimes(1);
  });

  it('says when a deck is already stored', async () => {
    service.addFromImage.mockResolvedValue({ error: 'exists' });
    open();
    const deck = await read();
    await within(deck).findByText(/not found/i);
    fireEvent.click(within(deck).getByRole('button', { name: /Remove/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save as review' }));
    expect(await screen.findByText('Han Solo is already in Prebuilt Decks')).toBeInTheDocument();
  });
});
