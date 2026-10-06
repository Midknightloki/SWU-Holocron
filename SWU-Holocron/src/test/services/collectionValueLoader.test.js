import { describe, it, expect, vi } from 'vitest';
import { loadCollectionValue } from '../../services/collectionValueLoader';

const COLLECTION = {
  SOR_010_std: { quantity: 1, set: 'SOR', number: '010', name: 'Darth Vader', isFoil: false },
  SOR_010_foil: { quantity: 1, set: 'SOR', number: '010', name: 'Darth Vader', isFoil: true },
  SHD_001_std: { quantity: 2, set: 'SHD', number: '001', name: 'Stored Name', isFoil: false },
};

describe('loadCollectionValue', () => {
  it('loads each owned set once and prices every owned id', async () => {
    const loadSetImpl = vi.fn(async (code) => ({ cards: code === 'SOR' ? [{ Set: 'SOR', Number: '010', Name: 'Darth Vader', Rarity: 'Common' }] : [{ Set: 'SHD', Number: '001', Name: 'Real Name' }] }));
    const pricing = { getBulkPrices: vi.fn(async () => ({ SOR_010_std: { market: 2 } })) };
    const res = await loadCollectionValue(COLLECTION, { loadSetImpl, pricing });
    expect(loadSetImpl.mock.calls.map(([c]) => c).sort()).toEqual(['SHD', 'SOR']);
    expect(pricing.getBulkPrices.mock.calls[0][0]).toEqual(expect.arrayContaining([
      { cardId: 'SOR_010_std', set: 'SOR', number: '010', isFoil: false },
      { cardId: 'SOR_010_foil', set: 'SOR', number: '010', isFoil: true },
      { cardId: 'SHD_001_std', set: 'SHD', number: '001', isFoil: false },
    ]));
    expect(res.missingSets).toEqual([]);
    expect(res.lines.find((l) => l.id === 'SOR_010_std')).toMatchObject({ rarity: 'Common', value: 2 });
  });

  it('keeps cards from a set that failed to load, by their stored name', async () => {
    const loadSetImpl = vi.fn(async (code) => { if (code === 'SHD') throw new Error('offline'); return { cards: [] }; });
    const res = await loadCollectionValue(COLLECTION, { loadSetImpl, pricing: { getBulkPrices: async () => ({}) } });
    expect(res.missingSets).toEqual(['SHD']);
    expect(res.lines.find((l) => l.id === 'SHD_001_std')).toMatchObject({ name: 'Stored Name', rarity: 'Unknown', qty: 2 });
  });

  it('shows cards without values when prices fail, and never throws', async () => {
    const res = await loadCollectionValue(COLLECTION, {
      loadSetImpl: async () => ({ cards: [] }),
      pricing: { getBulkPrices: async () => { throw new Error('denied'); } },
    });
    expect(res.lines).toHaveLength(3);
    expect(res.lines.every((l) => l.value === null)).toBe(true);
    expect(res.error).toBe('prices');
  });
});
