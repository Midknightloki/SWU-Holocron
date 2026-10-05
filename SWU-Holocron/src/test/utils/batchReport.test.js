import { describe, it, expect } from 'vitest';
import { buildReport } from '../../utils/batchReport';

const line = (o) => ({ set: 'SOR', number: '001', name: 'X', type: 'Unit', rarity: 'Common', aspects: ['Vigilance'], variant: 'Normal', isFoil: false, qty: 1, isNew: false, priceAtAdd: 0.1, ...o });

const BATCH = {
  name: 'eBay SOR box', createdAt: 1, closedAt: 2, pricePaid: 100,
  cards: {
    SOR_010_std: line({ number: '010', name: 'Luke Skywalker', type: 'Leader', rarity: 'Rare', aspects: ['Vigilance', 'Heroism'], qty: 2, isNew: true, priceAtAdd: 5 }),
    SOR_010_foil: line({ number: '010', name: 'Luke Skywalker', type: 'Leader', rarity: 'Rare', aspects: ['Vigilance', 'Heroism'], isFoil: true, variant: 'Foil', priceAtAdd: 20 }),
    SOR_200_std: line({ number: '200', name: 'Darth Vader', rarity: 'Legendary', aspects: ['Aggression', 'Villainy'], variant: 'Hyperspace', priceAtAdd: 80 }),
    SOR_050_std: line({ number: '050', name: 'Battle Droid', qty: 10, priceAtAdd: 0.05 }),
    SOR_051_std: line({ number: '051', name: 'Mystery', priceAtAdd: null, qty: 3 }),
  },
};

describe('buildReport', () => {
  const r = buildReport(BATCH);

  it('totals cards, unique cards and new unique cards', () => {
    expect(r.cards).toBe(17);
    expect(r.unique).toBe(4); // SOR 010 in two finishes counts once
    expect(r.newUnique).toBe(1);
    expect(r.newCards.map((l) => l.id)).toEqual(['SOR_010_std']);
  });

  it('leaves unpriced lines out of values and lists them', () => {
    expect(r.valueAtAdd).toBe(110.5); // 5*2 + 20 + 80 + 0.05*10
    expect(r.unpriced.map((l) => l.id)).toEqual(['SOR_051_std']);
  });

  it('compares value with the price paid', () => {
    expect(r.net).toBe(10.5);
    expect(r.multiple).toBe(1.11);
    const unpaid = buildReport({ ...BATCH, pricePaid: null });
    expect(unpaid.net).toBeNull();
    expect(unpaid.multiple).toBeNull();
  });

  it('computes value now only when current prices are loaded', () => {
    expect(r.valueNow).toBeNull();
    const now = buildReport(BATCH, { SOR_010_std: 6, SOR_200_std: 90 });
    expect(now.valueNow).toBe(102); // only lines with a current price
    expect(now.lines.find((l) => l.id === 'SOR_010_std').priceNow).toBe(6);
  });

  it('breaks down by rarity, type, aspect (dual aspects in both) and variant', () => {
    expect(r.byRarity).toEqual([
      { key: 'Legendary', count: 1, value: 80 },
      { key: 'Rare', count: 3, value: 30 },
      { key: 'Common', count: 13, value: 0.5 },
    ]);
    expect(r.byType.map((g) => g.key)).toEqual(['Unit', 'Leader']);
    const vigilance = r.byAspect.find((g) => g.key === 'Vigilance');
    const heroism = r.byAspect.find((g) => g.key === 'Heroism');
    expect(vigilance.count).toBe(16);
    expect(heroism).toEqual({ key: 'Heroism', count: 3, value: 30 });
    expect(r.byVariant.find((g) => g.key === 'Hyperspace')).toEqual({ key: 'Hyperspace', count: 1, value: 80 });
  });

  it('lists the top pulls by price', () => {
    expect(r.topPulls.map((l) => l.id)).toEqual(['SOR_200_std', 'SOR_010_foil', 'SOR_010_std', 'SOR_050_std']);
  });

  it('flags prices taken from the other finish, still counting them', () => {
    const b = { ...BATCH, cards: { ...BATCH.cards, SOR_010_foil: { ...BATCH.cards.SOR_010_foil, priceIsFallback: true } } };
    const flagged = buildReport(b);
    expect(flagged.otherFinish.map((l) => l.id)).toEqual(['SOR_010_foil']);
    expect(flagged.valueAtAdd).toBe(110.5);
    expect(r.otherFinish).toEqual([]);
  });

  it('sorts lines by set then number', () => {
    expect(r.lines.map((l) => l.id)).toEqual(['SOR_010_foil', 'SOR_010_std', 'SOR_050_std', 'SOR_051_std', 'SOR_200_std']);
  });

  it('handles an empty batch', () => {
    const empty = buildReport({ name: 'x', createdAt: 1, cards: {} });
    expect(empty).toMatchObject({ cards: 0, unique: 0, valueAtAdd: 0, topPulls: [], net: null });
  });
});

describe('buildReport current prices and new cards', () => {
  it('counts lines with no current price instead of valuing them at $0', () => {
    const now = buildReport(BATCH, { SOR_010_std: 6, SOR_200_std: 90 });
    expect(now.unpricedNow).toBe(3); // foil Luke, Battle Droid, Mystery
    expect(buildReport(BATCH).unpricedNow).toBeNull();
  });

  it('lists a card new in both finishes once', () => {
    const both = buildReport({ ...BATCH, cards: { ...BATCH.cards, SOR_010_foil: { ...BATCH.cards.SOR_010_foil, isNew: true } } });
    expect(both.newCards.map((l) => `${l.set} ${l.number}`)).toEqual(['SOR 010']);
    expect(both.newUnique).toBe(1);
  });
});
