import { describe, it, expect } from 'vitest';
import {
  cardIdentity,
  cardNumberValue,
  pickBasePrinting,
  dedupeToBasePrintings,
} from '../../utils/cardIdentity.js';

/**
 * Card identity and base-printing selection.
 *
 * A card is identified by **name + subtitle**. Among printings sharing that
 * identity, the **lowest card number is the base printing**; higher numbers are
 * prestige/showcase variants, and a trailing letter marks a foil.
 *
 * Getting this wrong misleads twice over: searching "Fett's Firespray: Feared
 * Silhouette" returned the prestige variant, and then reported it missing from
 * the collection because the player owns the base printing rather than the
 * prestige one.
 */

const card = (over = {}) => ({
  Name: 'Fett’s Firespray',
  Subtitle: 'Feared Silhouette',
  Set: 'SOR',
  Number: '001',
  ...over,
});

describe('cardIdentity', () => {
  it('combines name and subtitle', () => {
    const a = card({ Number: '001' });
    const b = card({ Number: '450' });
    expect(cardIdentity(a)).toBe(cardIdentity(b));
  });

  it('separates cards that share a name but differ by subtitle', () => {
    // This is the case that name-only de-duplication collapsed incorrectly.
    const a = card({ Name: 'Boba Fett', Subtitle: 'Daimyo' });
    const b = card({ Name: 'Boba Fett', Subtitle: 'Disintegrator' });
    expect(cardIdentity(a)).not.toBe(cardIdentity(b));
  });

  it('treats a missing subtitle as empty rather than undefined', () => {
    expect(cardIdentity({ Name: 'Vanquish' })).toBe(cardIdentity({ Name: 'Vanquish', Subtitle: '' }));
  });

  it('is case-insensitive and ignores surrounding space', () => {
    expect(cardIdentity({ Name: ' Vanquish ', Subtitle: 'X' }))
      .toBe(cardIdentity({ Name: 'VANQUISH', Subtitle: 'x' }));
  });
});

describe('cardNumberValue', () => {
  it('reads the numeric part', () => {
    expect(cardNumberValue('001')).toBe(1);
    expect(cardNumberValue('450')).toBe(450);
    expect(cardNumberValue(37)).toBe(37);
  });

  it('ignores a foil or variant suffix', () => {
    expect(cardNumberValue('059F')).toBe(59);
  });

  it('sorts unparseable numbers last rather than first', () => {
    expect(cardNumberValue('')).toBe(Number.MAX_SAFE_INTEGER);
    expect(cardNumberValue(null)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('pickBasePrinting', () => {
  it('picks the lowest card number', () => {
    const base = card({ Number: '001' });
    const prestige = card({ Number: '450' });
    expect(pickBasePrinting([prestige, base])).toBe(base);
  });

  it('prefers the non-foil when numbers tie', () => {
    const plain = card({ Number: '059' });
    const foil = card({ Number: '059F' });
    expect(pickBasePrinting([foil, plain])).toBe(plain);
  });

  it('compares numerically, not as strings', () => {
    // '9' sorts after '10' as a string; it must not here.
    const nine = card({ Number: '9' });
    const ten = card({ Number: '10' });
    expect(pickBasePrinting([ten, nine])).toBe(nine);
  });

  it('returns null for an empty list', () => {
    expect(pickBasePrinting([])).toBeNull();
    expect(pickBasePrinting(null)).toBeNull();
  });
});

describe('dedupeToBasePrintings', () => {
  it('keeps one entry per identity, the base printing', () => {
    const cards = [
      card({ Number: '450' }),
      card({ Number: '001' }),
      card({ Number: '001F' }),
      card({ Name: 'Vanquish', Subtitle: '', Number: '200' }),
    ];

    const result = dedupeToBasePrintings(cards);

    expect(result).toHaveLength(2);
    expect(result.find((c) => c.Name !== 'Vanquish').Number).toBe('001');
  });

  it('does not merge two cards that differ only by subtitle', () => {
    const cards = [
      card({ Name: 'Boba Fett', Subtitle: 'Daimyo', Number: '010' }),
      card({ Name: 'Boba Fett', Subtitle: 'Disintegrator', Number: '020' }),
    ];
    expect(dedupeToBasePrintings(cards)).toHaveLength(2);
  });

  it('preserves the order the identities first appeared in', () => {
    const cards = [
      card({ Name: 'Zeta', Subtitle: '', Number: '300' }),
      card({ Name: 'Alpha', Subtitle: '', Number: '100' }),
      card({ Name: 'Zeta', Subtitle: '', Number: '010' }),
    ];
    const result = dedupeToBasePrintings(cards);

    expect(result.map((c) => c.Name)).toEqual(['Zeta', 'Alpha']);
    expect(result[0].Number).toBe('010');
  });

  it('handles an empty list', () => {
    expect(dedupeToBasePrintings([])).toEqual([]);
    expect(dedupeToBasePrintings(null)).toEqual([]);
  });

  it('accepts alternate field names so it works on prompt-shaped candidates', () => {
    // The AI suggestion pipeline uses {name, id} rather than {Name, Number}.
    const cards = [
      { id: 'SOR_450', name: 'Fett’s Firespray', subtitle: 'Feared Silhouette' },
      { id: 'SOR_001', name: 'Fett’s Firespray', subtitle: 'Feared Silhouette' },
    ];
    expect(dedupeToBasePrintings(cards)).toHaveLength(1);
    expect(dedupeToBasePrintings(cards)[0].id).toBe('SOR_001');
  });
});

describe('pickBasePrinting: across sets', () => {
  // Card numbers are only comparable WITHIN a set. A promo set numbers its
  // cards from 1, so comparing raw numbers across sets hands the base slot to
  // the promo: "Fett's Firespray — Feared Silhouette" is JTL_240 in its base
  // set and JTLOP_18 as an OP promo, and 18 < 240.
  const BASE_SETS = new Set(['SOR', 'JTL', 'LOF']);

  it('prefers a base-set printing over a promo one with a lower number', () => {
    const promo = card({ Set: 'JTLOP', Number: '18' });
    const baseSet = card({ Set: 'JTL', Number: '240' });

    expect(pickBasePrinting([promo, baseSet], { baseSetCodes: BASE_SETS })).toBe(baseSet);
  });

  it('still takes the lowest number among base-set printings', () => {
    const showcase = card({ Set: 'SOR', Number: '447' });
    const original = card({ Set: 'SOR', Number: '184' });

    expect(pickBasePrinting([showcase, original], { baseSetCodes: BASE_SETS })).toBe(original);
  });

  it('falls back to the lowest number when no base sets are known', () => {
    const a = card({ Set: 'JTLOP', Number: '18' });
    const b = card({ Set: 'JTL', Number: '240' });

    expect(pickBasePrinting([b, a])).toBe(a);
  });

  it('picks the lowest number when every printing is a promo', () => {
    const a = card({ Set: 'P26', Number: '151' });
    const b = card({ Set: 'P25', Number: '55' });

    expect(pickBasePrinting([a, b], { baseSetCodes: BASE_SETS })).toBe(b);
  });

  it('threads the option through dedupeToBasePrintings', () => {
    const cards = [
      card({ Set: 'JTLOP', Number: '18' }),
      card({ Set: 'JTL', Number: '240' }),
    ];
    const result = dedupeToBasePrintings(cards, { baseSetCodes: BASE_SETS });

    expect(result).toHaveLength(1);
    expect(result[0].Set).toBe('JTL');
  });
});
