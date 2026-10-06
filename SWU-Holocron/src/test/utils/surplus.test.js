import { describe, it, expect } from 'vitest';
import { deckUsage, keepFor, buildSurplusLines, toTradeText } from '../../utils/surplus';

const L = (id, o = {}) => {
  const [set, number, finish] = id.split('_');
  return { id, set, number, name: 'Darth Vader', subtitle: 'Dark Lord', type: 'Unit', rarity: 'Rare', aspects: [], variant: 'Normal', isFoil: finish === 'foil', qty: 1, unitPrice: 2, priceIsFallback: false, value: 2, url: null, ...o };
};
const ids = (lines) => lines.map((l) => [l.id, l.qty]);

describe('deckUsage', () => {
  it('sums main deck, sideboard, leader and base across decks', () => {
    expect(deckUsage([
      { cards: { SOR_010: 2, SOR_050: 3 }, sideboard: { SOR_010: 1 }, leaderId: 'SOR_005', baseId: 'SOR_020' },
      { cards: { SOR_010: 3 }, leaderId: 'SOR_005' },
    ])).toEqual({ SOR_010: 6, SOR_050: 3, SOR_005: 2, SOR_020: 1 });
  });

  it('matches unpadded deck ids', () => {
    expect(deckUsage([{ cards: { TS26_1: 2 }, leaderId: 'TS26_10' }])).toEqual({ TS26_001: 2, TS26_010: 1 });
  });
});

describe('keepFor', () => {
  it('keeps a playset of the Normal standard printing and one of everything else', () => {
    expect(keepFor(L('SOR_010_std'))).toBe(3);
    expect(keepFor(L('SOR_010_std', { type: 'Leader' }))).toBe(1);
    expect(keepFor(L('SOR_020_std', { type: 'Base' }))).toBe(1);
    expect(keepFor(L('SOR_010_foil'))).toBe(1);
    expect(keepFor(L('SOR_300_std', { variant: 'Hyperspace' }))).toBe(1);
    expect(keepFor(L('SOR_059F_foil', { variant: 'Foil' }))).toBe(1);
    expect(keepFor(L('SHD_001_std', { variant: 'Unknown', type: 'Unknown' }))).toBe(3);
  });
});

describe('buildSurplusLines', () => {
  it('works the design examples', () => {
    // Own Normal x5, Normal foil x2, Hyperspace x1; no decks.
    const own = [L('SOR_010_std', { qty: 5 }), L('SOR_010_foil', { qty: 2 }), L('SOR_300_std', { qty: 1, variant: 'Hyperspace' })];
    expect(ids(buildSurplusLines(own, {}))).toEqual([['SOR_010_std', 2], ['SOR_010_foil', 1]]);
    // x5 with 2 in decks: none. x6: one.
    expect(buildSurplusLines([L('SOR_010_std', { qty: 5 })], { SOR_010: 2 })).toEqual([]);
    expect(ids(buildSurplusLines([L('SOR_010_std', { qty: 6 })], { SOR_010: 2 }))).toEqual([['SOR_010_std', 1]]);
  });

  it('takes deck copies from standard first, then foil', () => {
    const own = [L('SOR_010_std', { qty: 1 }), L('SOR_010_foil', { qty: 3 })];
    // 2 in decks: std 1 used, foil 1 used -> foil 2 left, keep 1 -> 1 surplus.
    expect(buildSurplusLines(own, { SOR_010: 2 })).toEqual([
      expect.objectContaining({ id: 'SOR_010_foil', owned: 3, inDecks: 1, kept: 1, qty: 1, value: 2 }),
    ]);
  });

  it('never goes negative, and deck use stays within its printing', () => {
    const own = [L('SOR_010_std', { qty: 2 }), L('SOR_300_std', { qty: 4, variant: 'Hyperspace' })];
    // 9 of SOR_010 in decks: more than owned; the Hyperspace printing is untouched.
    expect(ids(buildSurplusLines(own, { SOR_010: 9 }))).toEqual([['SOR_300_std', 3]]);
  });

  it('keeps one leader and leaves unpriced surplus unpriced', () => {
    const out = buildSurplusLines([L('SOR_005_std', { qty: 3, type: 'Leader', unitPrice: null, value: null })], {});
    expect(out).toEqual([expect.objectContaining({ qty: 2, kept: 1, value: null })]);
  });

  it('ignores deck cards nobody owns', () => {
    expect(buildSurplusLines([], { SOR_010: 3 })).toEqual([]);
  });
});

describe('toTradeText', () => {
  const lines = [
    L('SOR_010_foil', { qty: 1, unitPrice: 6 }),
    L('SOR_005_std', { qty: 2, name: 'Luke Skywalker', subtitle: 'Faithful Friend', unitPrice: null }),
  ];

  it('lists the cards by set and number, with a total', () => {
    expect(toTradeText(lines, { showPrices: false })).toBe([
      '2× Luke Skywalker, Faithful Friend (SOR 005)',
      '1× Darth Vader, Dark Lord (SOR 010) — Foil',
      'Total: 3 cards',
    ].join('\n'));
  });

  it('adds prices when shown', () => {
    expect(toTradeText(lines, { showPrices: true })).toBe([
      '2× Luke Skywalker, Faithful Friend (SOR 005)',
      '1× Darth Vader, Dark Lord (SOR 010) — Foil — $6.00 ea',
      'Total: 3 cards · ~$6.00',
    ].join('\n'));
  });
});
