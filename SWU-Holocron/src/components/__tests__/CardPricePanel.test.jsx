/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import CardPricePanel from '../CardPricePanel';

const CARD = { Set: 'SOR', Number: '010', Name: 'Darth Vader' };
const price = (std, foil) => vi.fn(async (set, number, isFoil) => (isFoil ? foil : std));

describe('CardPricePanel', () => {
  // Each price state, one render per test.
  it('shows each price state: loading, then both prices as TCGplayer links', async () => {
    render(<CardPricePanel card={CARD} collectionData={{}} getCardPrice={price({ market: 1.5, url: 'https://t/std' }, { market: 6, url: 'https://t/foil' })} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '$1.50' })).toHaveAttribute('href', 'https://t/std');
    expect(screen.getByRole('link', { name: '$6.00' })).toHaveAttribute('target', '_blank');
  });

  it('shows each price state: a price taken from the other finish', async () => {
    render(<CardPricePanel card={CARD} collectionData={{}} getCardPrice={price({ market: 1.5 }, { market: 1.5, isFallback: true })} />);
    expect(await screen.findByText(/\(from standard\)/)).toBeInTheDocument();
  });

  it('shows each price state: no price data', async () => {
    render(<CardPricePanel card={CARD} collectionData={{}} getCardPrice={price(null, null)} />);
    await screen.findByText('Standard');
    expect(screen.getAllByText('No price data')).toHaveLength(2);
  });

  it('shows each price state: unavailable on error', async () => {
    render(<CardPricePanel card={CARD} collectionData={{}} getCardPrice={vi.fn(async () => { throw new Error('x'); })} />);
    expect(await screen.findByText('Price unavailable')).toBeInTheDocument();
  });

  it('values the copies you own', async () => {
    const owned = { SOR_010_std: { quantity: 3 }, SOR_010_foil: { quantity: 2 } };
    render(<CardPricePanel card={CARD} collectionData={owned} getCardPrice={price({ market: 1.5 }, { market: 6 })} />);
    expect(await screen.findByText('3 + 2F = $16.50')).toBeInTheDocument();
  });

  it('marks the copies total approximate when a finish you own has no price', async () => {
    const owned = { SOR_010_std: { quantity: 3 }, SOR_010_foil: { quantity: 1 } };
    render(<CardPricePanel card={CARD} collectionData={owned} getCardPrice={price({ market: 1.5 }, null)} />);
    expect(await screen.findByText('3 + 1F = ≈$4.50')).toBeInTheDocument();
  });

  it('shows only the foil price for an F-numbered foil printing (SOR/SHD 059F)', async () => {
    render(<CardPricePanel card={{ Set: 'SOR', Number: '059F' }} collectionData={{}} getCardPrice={price({ market: 9 }, { market: 9 })} />);
    expect(await screen.findByText('Foil')).toBeInTheDocument();
    expect(screen.queryByText('Standard')).not.toBeInTheDocument();
  });

  it('says no price data for your copies when none of them is priced', async () => {
    render(<CardPricePanel card={CARD} collectionData={{ SOR_010_std: { quantity: 1 } }} getCardPrice={price(null, null)} />);
    expect(await screen.findByText('1 + 0F · no price data')).toBeInTheDocument();
  });
});
