import { describe, it, expect } from 'vitest';
import {
  buildCollectionLines, applyFilters, summarize, sortLines, filterOptions, toCollectionCsv, DEFAULT_FILTERS,
} from '../../utils/collectionValue';

const CARDS = {
  SOR: [
    { Set: 'SOR', Number: '010', Name: 'Darth Vader', Subtitle: 'Dark Lord', Type: 'Leader', Rarity: 'Common', Aspects: ['Aggression', 'Villainy'], VariantType: 'Normal' },
    { Set: 'SOR', Number: '050', Name: 'Battle Droid', Type: 'Unit', Rarity: 'Common', Aspects: [], VariantType: 'Normal' },
    { Set: 'SOR', Number: '300', Name: 'Luke Skywalker', Subtitle: 'Faithful Friend', Type: 'Unit', Rarity: 'Legendary', Aspects: ['Vigilance', 'Heroism'], VariantType: 'Hyperspace' },
  ],
};
const COLLECTION = {
  SOR_010_std: { quantity: 2, set: 'SOR', number: '010', name: 'Darth Vader', isFoil: false },
  SOR_010_foil: { quantity: 1, set: 'SOR', number: '010', name: 'Darth Vader', isFoil: true },
  SOR_050_std: { quantity: 10, set: 'SOR', number: '050', name: 'Battle Droid', isFoil: false },
  SOR_300_std: { quantity: 1, set: 'SOR', number: '300', name: 'Luke Skywalker', isFoil: false },
  SHD_001_std: { quantity: 1, set: 'SHD', number: '001', name: 'Mystery Card', isFoil: false },
  SOR_099_std: { quantity: 0, set: 'SOR', number: '099', name: 'Gone', isFoil: false },
};
const PRICES = {
  SOR_010_std: { market: 1.5, url: 'u1' },
  SOR_010_foil: { market: 6, url: 'u2', isFallback: false },
  SOR_050_std: { market: 0.05 },
  SOR_300_std: { market: 40, isFallback: true },
  SHD_001_std: null,
};
const lines = buildCollectionLines(COLLECTION, CARDS, PRICES);
const byId = (id) => lines.find((l) => l.id === id);

describe('buildCollectionLines', () => {
  it('builds one priced line per owned doc, with card details', () => {
    expect(lines.map((l) => l.id).sort()).toEqual(['SHD_001_std', 'SOR_010_foil', 'SOR_010_std', 'SOR_050_std', 'SOR_300_std']);
    expect(byId('SOR_010_std')).toEqual({
      id: 'SOR_010_std', set: 'SOR', number: '010', name: 'Darth Vader', subtitle: 'Dark Lord', type: 'Leader',
      rarity: 'Common', aspects: ['Aggression', 'Villainy'], variant: 'Normal', isFoil: false, qty: 2,
      unitPrice: 1.5, priceIsFallback: false, value: 3, url: 'u1',
    });
    expect(byId('SOR_300_std')).toMatchObject({ priceIsFallback: true, value: 40 });
  });

  it('keeps a card whose set details are missing, by its stored name', () => {
    expect(byId('SHD_001_std')).toMatchObject({ name: 'Mystery Card', type: 'Unknown', rarity: 'Unknown', aspects: ['Unknown'], variant: 'Unknown', unitPrice: null, value: null });
  });
});

describe('summarize', () => {
  it('values skip unpriced lines and report the priced share', () => {
    const s = summarize(lines);
    expect(s).toMatchObject({ cards: 15, unique: 4, value: 49.5, standardValue: 43.5, foilValue: 6 });
    expect(s.pricedShare).toBeCloseTo(14 / 15);
    expect(s.unpriced.map((l) => l.id)).toEqual(['SHD_001_std']);
    expect(s.otherFinish.map((l) => l.id)).toEqual(['SOR_300_std']);
    expect(s.bySet).toEqual([{ key: 'SOR', count: 14, value: 49.5 }, { key: 'SHD', count: 1, value: 0 }]);
    expect(s.byAspect.find((g) => g.key === 'Villainy')).toEqual({ key: 'Villainy', count: 3, value: 9 });
    expect(s.byAspect.find((g) => g.key === 'Neutral')).toEqual({ key: 'Neutral', count: 10, value: 0.5 });
  });

  it('is all zeros for no lines', () => {
    expect(summarize([])).toMatchObject({ cards: 0, unique: 0, value: 0, pricedShare: 0 });
  });
});

describe('applyFilters', () => {
  const ids = (f) => applyFilters(lines, { ...DEFAULT_FILTERS, ...f }).map((l) => l.id).sort();

  it('passes everything with the defaults', () => {
    expect(ids({})).toHaveLength(5);
  });

  it('filters by set, rarity, type, variant and finish', () => {
    expect(ids({ sets: ['SHD'] })).toEqual(['SHD_001_std']);
    expect(ids({ rarities: ['Legendary'] })).toEqual(['SOR_300_std']);
    expect(ids({ types: ['Leader'] })).toEqual(['SOR_010_foil', 'SOR_010_std']);
    expect(ids({ variants: ['Hyperspace'] })).toEqual(['SOR_300_std']);
    expect(ids({ finish: 'foil' })).toEqual(['SOR_010_foil']);
    expect(ids({ finish: 'standard' })).toHaveLength(4);
  });

  it('aspect filter matches any aspect; Neutral matches none', () => {
    expect(ids({ aspects: ['Heroism'] })).toEqual(['SOR_300_std']);
    expect(ids({ aspects: ['Neutral'] })).toEqual(['SOR_050_std']);
    expect(ids({ aspects: ['Villainy', 'Heroism'] })).toEqual(['SOR_010_foil', 'SOR_010_std', 'SOR_300_std']);
  });

  it('filters by price status, and minimum price excludes unpriced lines', () => {
    expect(ids({ price: 'unpriced' })).toEqual(['SHD_001_std']);
    expect(ids({ price: 'priced' })).toHaveLength(4);
    expect(ids({ minPrice: 1 })).toEqual(['SOR_010_foil', 'SOR_010_std', 'SOR_300_std']);
  });

  it('searches name and subtitle, ignoring case, and combines filters', () => {
    expect(ids({ search: 'faithful' })).toEqual(['SOR_300_std']);
    expect(ids({ search: 'vader', finish: 'standard' })).toEqual(['SOR_010_std']);
  });
});

describe('filterOptions and sortLines', () => {
  it('lists each field with counts', () => {
    const o = filterOptions(lines);
    expect(o.sets).toEqual([{ key: 'SHD', count: 1 }, { key: 'SOR', count: 14 }]);
    expect(o.aspects.find((a) => a.key === 'Neutral')).toEqual({ key: 'Neutral', count: 10 });
  });

  it('sorts by value with unpriced last, and by name, quantity and set', () => {
    expect(sortLines(lines, 'value').map((l) => l.id)).toEqual(['SOR_300_std', 'SOR_010_foil', 'SOR_010_std', 'SOR_050_std', 'SHD_001_std']);
    expect(sortLines(lines, 'value', 'asc').at(-1).id).toBe('SHD_001_std');
    expect(sortLines(lines, 'qty')[0].id).toBe('SOR_050_std');
    expect(sortLines(lines, 'name', 'asc')[0].name).toBe('Battle Droid');
    expect(sortLines(lines, 'set', 'asc')[0].set).toBe('SHD');
  });
});

describe('toCollectionCsv', () => {
  it('writes a BOM, a header, quoted rows, and a summary with the filters', () => {
    const csv = toCollectionCsv(lines, summarize(lines), { ...DEFAULT_FILTERS, sets: ['SOR'] });
    const rows = csv.split('\r\n');
    expect(rows[0]).toBe('\uFEFFSet,Number,Name,Subtitle,Type,Rarity,Aspects,Variant,Finish,Qty,Unit price,Value,Price note');
    expect(rows).toContain('SOR,300,Luke Skywalker,Faithful Friend,Unit,Legendary,Vigilance/Heroism,Hyperspace,Standard,1,40.00,40.00,from other finish');
    expect(rows).toContain('SHD,001,Mystery Card,,Unknown,Unknown,Unknown,Unknown,Standard,1,,,no price data');
    expect(rows).toContain('Total value,49.50');
    expect(rows).toContain('Filters,Set: SOR');
  });
});

describe('review fixes', () => {
  it('counts a card that repeats an aspect once per aspect', () => {
    const ls = buildCollectionLines(
      { SOR_155_std: { quantity: 2, set: 'SOR', number: '155', isFoil: false } },
      { SOR: [{ Set: 'SOR', Number: '155', Name: 'Twin', Aspects: ['Aggression', 'Aggression'] }] },
      { SOR_155_std: { market: 1 } },
    );
    expect(summarize(ls).byAspect).toEqual([{ key: 'Aggression', count: 2, value: 2 }]);
    expect(filterOptions(ls).aspects).toEqual([{ key: 'Aggression', count: 2 }]);
  });

  it('files cards without details under Unknown, not Neutral', () => {
    const ls = buildCollectionLines({ SHD_001_std: { quantity: 1, set: 'SHD', number: '001' } }, {}, {});
    expect(summarize(ls).byAspect.map((g) => g.key)).toEqual(['Unknown']);
    expect(applyFilters(ls, { ...DEFAULT_FILTERS, aspects: ['Neutral'] })).toEqual([]);
  });

  it('reads set and number from the id when an old doc lacks them', () => {
    const ls = buildCollectionLines({ JTL_017_foil: { quantity: 1 } }, {}, { JTL_017_foil: { market: 3 } });
    expect(ls[0]).toMatchObject({ set: 'JTL', number: '017', isFoil: true, value: 3 });
  });
});
