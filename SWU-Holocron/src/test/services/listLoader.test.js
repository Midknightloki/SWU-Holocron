import { describe, it, expect, vi } from 'vitest';
import { loadListPrices, loadGapItems } from '../../services/listLoader';

const items = { SOR_010_any: { set: 'SOR', number: '010', name: 'V', subtitle: null, type: 'Unit', finish: 'any', qty: 1 } };

describe('loadListPrices', () => {
  it('asks the pricing service for every item', async () => {
    const pricing = { getBulkPrices: vi.fn(async () => ({ SOR_010_any: { market: 2 } })), failedSets: () => [] };
    expect(await loadListPrices(items, { pricing })).toEqual({ prices: { SOR_010_any: { market: 2 } } });
    expect(pricing.getBulkPrices).toHaveBeenCalledWith([{ cardId: 'SOR_010_any', set: 'SOR', number: '010', isFoil: false }]);
  });
  it('reports a failed or partial read as a prices error', async () => {
    expect(await loadListPrices(items, { pricing: { getBulkPrices: async () => { throw new Error('x'); } } })).toEqual({ prices: {}, error: 'prices' });
    const partial = { getBulkPrices: async () => ({}), failedSets: () => ['SOR'] };
    expect((await loadListPrices(items, { pricing: partial })).error).toBe('prices');
  });
  it('asks for nothing when the list is empty', async () => {
    const pricing = { getBulkPrices: vi.fn() };
    expect(await loadListPrices({}, { pricing })).toEqual({ prices: {} });
    expect(pricing.getBulkPrices).not.toHaveBeenCalled();
  });
});

describe('loadGapItems', () => {
  it('builds gap items and names sets that would not load', async () => {
    const loadSetImpl = async (code) => {
      if (code === 'SHD') throw new Error('offline');
      return { cards: [{ Set: 'SOR', Number: '050', Name: 'Droid', Subtitle: '', Type: 'Unit' }] };
    };
    const res = await loadGapItems(['SOR', 'SHD'], {}, { mode: 'missing', loadSetImpl });
    expect(Object.keys(res.items)).toEqual(['SOR_050_any']);
    expect(res.failedSets).toEqual(['SHD']);
  });
});
