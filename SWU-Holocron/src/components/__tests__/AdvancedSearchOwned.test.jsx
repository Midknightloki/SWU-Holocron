/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

vi.mock('../../services/CardService', () => ({
  CardService: {
    getSetRegistry: vi.fn(async () => [{ code: 'SOR', name: 'Spark of Rebellion', isBaseSet: true }]),
    fetchSetData: vi.fn(async () => ({
      data: [
        { Set: 'SOR', Number: '001', Name: 'Luke Skywalker', Subtitle: 'Faithful Friend', Type: 'Unit', Traits: ['REBEL'], VariantType: 'Normal' },
        { Set: 'SOR', Number: '300', Name: 'Luke Skywalker', Subtitle: 'Faithful Friend', Type: 'Unit', Traits: ['REBEL'], VariantType: 'Hyperspace' },
        { Set: 'SOR', Number: '002', Name: 'Han Solo', Subtitle: 'Reluctant Hero', Type: 'Unit', Traits: ['REBEL'], VariantType: 'Normal' },
      ],
    })),
    getCardImage: (set, number) => `img/${set}/${number}`,
    getCollectionId: (set, number) => `${set}_${number}`,
  },
}));

import AdvancedSearch from '../AdvancedSearch';

// Owned only as the Hyperspace printing of Luke.
const COLLECTION = { SOR_300_std: { quantity: 1 } };

beforeEach(() => {
  localStorage.getItem.mockReset();
  localStorage.setItem.mockReset();
});

const search = async (props = {}) => {
  const user = userEvent.setup();
  render(<AdvancedSearch onCardClick={vi.fn()} collectionData={COLLECTION} embedded {...props} />);
  await user.type(await screen.findByPlaceholderText(/name, text, traits/i), 'rebel');
  await screen.findByText('Han Solo');
  return user;
};

describe('AdvancedSearch "Owned only" (deck builder)', () => {
  it('shows only cards owned in any printing, and updates the count', async () => {
    await search();
    expect(screen.getByText(/2 Results/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Owned only' }));
    await waitFor(() => expect(screen.queryByText('Han Solo')).not.toBeInTheDocument());
    expect(screen.getByText('Luke Skywalker')).toBeInTheDocument();
    expect(screen.getByText(/1 Result\b/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Owned only' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('remembers the choice on this device', async () => {
    await search();
    fireEvent.click(screen.getByRole('button', { name: 'Owned only' }));
    expect(localStorage.setItem).toHaveBeenCalledWith('swu-deck-owned-only', '1');
  });

  it('starts on when it was left on', async () => {
    localStorage.getItem.mockImplementation((k) => (k === 'swu-deck-owned-only' ? '1' : null));
    const user = userEvent.setup();
    render(<AdvancedSearch onCardClick={vi.fn()} collectionData={COLLECTION} embedded />);
    await user.type(await screen.findByPlaceholderText(/name, text, traits/i), 'rebel');
    await screen.findByText('Luke Skywalker');
    expect(screen.queryByText('Han Solo')).not.toBeInTheDocument();
  });

  it('is not offered outside the deck builder', async () => {
    render(<AdvancedSearch onCardClick={vi.fn()} collectionData={COLLECTION} />);
    await screen.findByPlaceholderText(/name, text, traits/i);
    expect(screen.queryByRole('button', { name: 'Owned only' })).not.toBeInTheDocument();
  });
});
