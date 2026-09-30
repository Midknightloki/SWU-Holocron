/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const mocks = vi.hoisted(() => ({ getSetRegistry: vi.fn(), fetchSetData: vi.fn() }));

vi.mock('../../services/CardService', () => ({
  CardService: {
    getSetRegistry: mocks.getSetRegistry,
    fetchSetData: mocks.fetchSetData,
    getCardImage: (set, number) => `img/${set}/${number}`,
  },
}));

import CardPickerModal from '../CardPickerModal';

const CARDS = {
  SOR: [
    { Set: 'SOR', Number: '001', Name: 'Director Krennic', Type: 'Leader' },
    { Set: 'SOR', Number: '050', Name: 'Death Trooper', Type: 'Unit' },
  ],
  // SOROP is not in the hardcoded SETS fallback; it only exists via the registry.
  SOROP: [{ Set: 'SOROP', Number: '010', Name: 'Death Star Plans', Type: 'Upgrade' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSetRegistry.mockResolvedValue([{ code: 'SOR' }, { code: 'SOROP' }]);
  mocks.fetchSetData.mockImplementation(async (code) => ({ data: CARDS[code] ?? [] }));
});

describe('CardPickerModal', () => {
  it('still lists only the requested type', async () => {
    render(<CardPickerModal type="Leader" collectionData={{}} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText('Director Krennic')).toBeInTheDocument();
    expect(screen.queryByText('Death Trooper')).not.toBeInTheDocument();
  });

  it('loads sets from the registry, not the hardcoded fallback', async () => {
    render(<CardPickerModal type="Upgrade" collectionData={{}} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText('Death Star Plans')).toBeInTheDocument();
    expect(mocks.fetchSetData).toHaveBeenCalledWith('SOROP');
  });

  it('requests every set at once rather than one after another', async () => {
    // 51 registered sets fetched sequentially made the DeckBuilder leader
    // picker several times slower than the old 14-set fallback.
    const pending = [];
    mocks.fetchSetData.mockImplementation(() => new Promise((resolve) => { pending.push(resolve); }));
    render(<CardPickerModal type="Leader" collectionData={{}} onSelect={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(mocks.fetchSetData).toHaveBeenCalledTimes(2));
    pending.forEach((resolve) => resolve({ data: [] }));
  });

  it('still lists the sets that loaded when one fails', async () => {
    mocks.fetchSetData.mockImplementation(async (code) => {
      if (code === 'SOR') throw new Error('offline');
      return { data: CARDS[code] ?? [] };
    });
    render(<CardPickerModal type="Upgrade" collectionData={{}} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText('Death Star Plans')).toBeInTheDocument();
  });

  it('without a type, asks for a search before listing anything', async () => {
    render(<CardPickerModal collectionData={{}} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(/type at least 2 letters/i)).toBeInTheDocument();
    expect(screen.queryByText('Director Krennic')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Select a card' })).toBeInTheDocument();
  });

  it('without a type, searches every type', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<CardPickerModal collectionData={{}} onSelect={onSelect} onClose={vi.fn()} />);
    await waitFor(() => expect(mocks.fetchSetData).toHaveBeenCalledTimes(2));
    await user.type(screen.getByPlaceholderText(/search/i), 'death');
    expect(await screen.findByText('Death Trooper')).toBeInTheDocument();
    expect(screen.getByText('Death Star Plans')).toBeInTheDocument();
    await user.click(screen.getByText('Death Trooper'));
    expect(onSelect).toHaveBeenCalledWith(CARDS.SOR[1]);
  });
});
