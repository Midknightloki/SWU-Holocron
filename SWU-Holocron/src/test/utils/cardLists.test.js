import { describe, it, expect } from 'vitest';
import {
  itemKey, cardItem, itemsFromSurplus, itemsFromGaps, itemsFromDeckGaps, mergeItems, changeFinish,
  priceRequests, listLines, listSummary, toListText, toListCsv,
} from '../../utils/cardLists';

const card = (o) => ({ Set: 'SOR', Number: '010', Name: 'Darth Vader', Subtitle: 'Dark Lord of the Sith', Type: 'Leader', ...o });
const own = (id, quantity) => ({ [id]: { quantity } });

describe('itemKey / cardItem', () => {
  it('pads numbers and names the finish', () => {
    expect(itemKey('TS26', 1, 'any')).toBe('TS26_001_any');
    expect(itemKey('SOR', '059F', 'foil')).toBe('SOR_059F_foil');
  });
  it('makes an item from a card with nulls, never undefined', () => {
    expect(cardItem({ Set: 'SOR', Number: 5, Name: 'X' })).toEqual({ set: 'SOR', number: '005', name: 'X', subtitle: null, type: null, finish: 'any', qty: 1 });
  });
});

describe('itemsFromSurplus', () => {
  it('takes the finish from isFoil and qty from the surplus', () => {
    const items = itemsFromSurplus([
      { set: 'SOR', number: '010', name: 'Vader', subtitle: 'Dark Lord', type: 'Leader', isFoil: false, qty: 2 },
      { set: 'SOR', number: '010', name: 'Vader', subtitle: 'Dark Lord', type: 'Leader', isFoil: true, qty: 1 },
    ]);
    expect(items.SOR_010_standard.qty).toBe(2);
    expect(items.SOR_010_foil).toMatchObject({ finish: 'foil', qty: 1 });
  });
});

describe('itemsFromGaps', () => {
  const sor = [
    card({ Number: '280' }), // Hyperspace printing of the same title, listed first
    card({ Number: '010' }),
    card({ Number: '050', Name: 'Battle Droid', Subtitle: '', Type: 'Unit' }),
    card({ Number: '060', Name: 'Han Solo', Subtitle: '', Type: 'Unit' }),
  ];
  it('missing: one of each title with no copy of any printing', () => {
    const items = itemsFromGaps({ SOR: sor }, { ...own('SOR_280_std', 1), ...own('SOR_060_foil', 1) }, { mode: 'missing' });
    expect(Object.keys(items)).toEqual(['SOR_050_any']);
    expect(items.SOR_050_any).toMatchObject({ name: 'Battle Droid', subtitle: null, finish: 'any', qty: 1 });
  });
  it('playset: the shortfall per title, leaders capped at 1, printings summed', () => {
    const items = itemsFromGaps({ SOR: sor }, { ...own('SOR_050_std', 1), ...own('SOR_050_foil', 1) }, { mode: 'playset' });
    expect(items.SOR_050_any.qty).toBe(1);
    expect(items.SOR_010_any.qty).toBe(1); // the representative is the lowest number
    expect(items.SOR_280_any).toBeUndefined();
    expect(items.SOR_060_any.qty).toBe(3);
  });
  it('reads padded collection docs for unpadded set numbers', () => {
    const items = itemsFromGaps({ TS26: [card({ Set: 'TS26', Number: 1, Name: 'A', Subtitle: '', Type: 'Unit' })] }, own('TS26_001_std', 3), { mode: 'playset' });
    expect(items).toEqual({});
  });
});

describe('itemsFromDeckGaps', () => {
  it('turns shop gap rows into any-finish items', () => {
    const items = itemsFromDeckGaps([{ gap: 2, card: card({ Number: 7, Name: 'Krennic', Subtitle: '', Type: 'Unit' }) }, { gap: 0, card: card() }]);
    expect(items).toEqual({ SOR_007_any: { set: 'SOR', number: '007', name: 'Krennic', subtitle: null, type: 'Unit', finish: 'any', qty: 2 } });
  });
});

describe('mergeItems / changeFinish', () => {
  const a = { SOR_010_any: cardItem(card(), 'any', 2) };
  it('adds quantities, or replaces', () => {
    expect(mergeItems(a, { SOR_010_any: cardItem(card(), 'any', 1) }).SOR_010_any.qty).toBe(3);
    expect(mergeItems(a, {}, { replace: true })).toEqual({});
  });
  it('re-keys on a finish change and merges into an existing line', () => {
    const items = { ...a, SOR_010_standard: cardItem(card(), 'standard', 1) };
    const next = changeFinish(items, 'SOR_010_any', 'standard');
    expect(Object.keys(next)).toEqual(['SOR_010_standard']);
    expect(next.SOR_010_standard).toMatchObject({ finish: 'standard', qty: 3 });
  });
});

describe('prices and lines', () => {
  const items = {
    SOR_010_any: cardItem(card(), 'any', 2),
    SOR_005_foil: cardItem(card({ Number: 5, Name: 'Luke', Subtitle: '' }), 'foil', 1),
  };
  it('asks for standard prices for any finish (the pricing service falls back to foil)', () => {
    expect(priceRequests(items)).toEqual([
      { cardId: 'SOR_010_any', set: 'SOR', number: '010', isFoil: false },
      { cardId: 'SOR_005_foil', set: 'SOR', number: '005', isFoil: true },
    ]);
  });
  it('prices lines, never as $0 when unpriced, sorted by number', () => {
    const lines = listLines(items, { SOR_010_any: { market: 1.5, isFallback: true } });
    expect(lines.map((l) => l.key)).toEqual(['SOR_005_foil', 'SOR_010_any']);
    expect(lines[0]).toMatchObject({ unitPrice: null, value: null });
    expect(lines[1]).toMatchObject({ unitPrice: 1.5, value: 3, priceIsFallback: true });
    expect(listSummary(lines)).toEqual({ cards: 3, unique: 2, value: 3, priced: 1 });
  });
});

describe('text and CSV', () => {
  const items = {
    SOR_010_any: { ...cardItem(card(), 'any', 2), note: 'any art' },
    SOR_005_standard: cardItem(card({ Number: 5, Name: 'Luke', Subtitle: '' }), 'standard', 1),
  };
  const lines = listLines(items, { SOR_010_any: { market: 1.5 } });
  it('wants text with heading, finish and note', () => {
    const text = toListText({ kind: 'wants', name: 'Gaps' }, lines, { showPrices: true });
    expect(text.split('\n')).toEqual([
      'Wants: Gaps',
      '',
      '1× Luke (SOR 005) — Standard',
      '2× Darth Vader, Dark Lord of the Sith (SOR 010) — $1.50 ea (any art)',
      'Total: 3 cards · ~$3.00',
    ]);
  });
  it('no dollar amounts with prices hidden; trade heading', () => {
    const text = toListText({ kind: 'trade', name: 'Binder' }, lines, { showPrices: false });
    expect(text.startsWith('Trade list: Binder')).toBe(true);
    expect(text).not.toContain('$');
  });
  it('CSV with and without prices, starting with a BOM', () => {
    const csv = toListCsv({ kind: 'wants', name: 'Gaps' }, lines, { showPrices: true });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Set,Number,Name,Subtitle,Finish,Qty,Unit price,Value,Note');
    expect(csv).toContain('SOR,010,Darth Vader,Dark Lord of the Sith,Any finish,2,1.50,3.00,any art');
    const bare = toListCsv({ kind: 'wants', name: 'Gaps' }, lines, { showPrices: false });
    expect(bare).not.toContain('Unit price');
    expect(bare).not.toContain('Total value');
  });
});
