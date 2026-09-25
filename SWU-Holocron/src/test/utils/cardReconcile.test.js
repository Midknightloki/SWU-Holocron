import { describe, it, expect } from 'vitest';
import {
  normalizeCardNumber,
  cardMatchKey,
  valuesEqual,
  reconcileSet,
} from '../../cardReconcile.js';

/**
 * Regression tests for reconciliation between swu-db and the official site.
 *
 * Two defects motivated this module, both found on the first full pipeline run:
 *
 * 1. MATCH KEY. swu-db zero-pads card numbers to three digits and stores them
 *    as strings ("005", "059F"); the official site returns unpadded integers
 *    (5, 59). The key was built from raw values, so "005" never matched 5 and
 *    cards 1-99 in every set silently skipped reconciliation. 956 cards looked
 *    like "official-only" when they were the same cards. Adding them as holes
 *    would have inserted 956 duplicate leaders and bases.
 *
 * 2. COMPARISON. Fields were compared with ===, so "7" vs 7 and
 *    ["IMPERIAL"] vs ["Imperial"] counted as corrections. About 75% of 13,995
 *    overrides were type or case noise that rewrote the database every run and
 *    never converged.
 */

describe('normalizeCardNumber', () => {
  it('zero-pads to three digits, matching getCollectionId', () => {
    expect(normalizeCardNumber('5')).toBe('005');
    expect(normalizeCardNumber(5)).toBe('005');
    expect(normalizeCardNumber('05')).toBe('005');
    expect(normalizeCardNumber('005')).toBe('005');
  });

  it('leaves numbers of four or more digits alone', () => {
    expect(normalizeCardNumber('1122')).toBe('1122');
    expect(normalizeCardNumber(1122)).toBe('1122');
  });

  it('preserves a variant suffix while padding the numeric part', () => {
    expect(normalizeCardNumber('59F')).toBe('059F');
    expect(normalizeCardNumber('059F')).toBe('059F');
  });

  it('upper-cases the suffix so casing cannot fork a key', () => {
    expect(normalizeCardNumber('59f')).toBe('059F');
  });

  it('returns an empty string for unusable input rather than throwing', () => {
    expect(normalizeCardNumber(null)).toBe('');
    expect(normalizeCardNumber(undefined)).toBe('');
    expect(normalizeCardNumber('')).toBe('');
  });
});

describe('cardMatchKey', () => {
  it('matches a padded swu-db number against an unpadded official number', () => {
    expect(cardMatchKey('SOR', '005')).toBe(cardMatchKey('SOR', 5));
  });

  it('matches a foil printing to its base card, so foils inherit corrections', () => {
    // swu-db carries 436 foil entries for SOR alone; the official site has none.
    // A foil is the same card, so it should receive the same field corrections.
    expect(cardMatchKey('SOR', '059F')).toBe(cardMatchKey('SOR', 59));
  });

  it('keeps different sets apart', () => {
    expect(cardMatchKey('SOR', 5)).not.toBe(cardMatchKey('SHD', 5));
  });

  it('is case-insensitive on the set code', () => {
    expect(cardMatchKey('sor', 5)).toBe(cardMatchKey('SOR', 5));
  });
});

describe('valuesEqual', () => {
  it('treats a numeric string and a number as equal', () => {
    expect(valuesEqual('7', 7)).toBe(true);
    expect(valuesEqual('0', 0)).toBe(true);
  });

  it('treats string lists differing only by case as equal', () => {
    expect(valuesEqual(['IMPERIAL', 'TROOPER'], ['Imperial', 'Trooper'])).toBe(true);
  });

  it('treats strings differing only by case or surrounding space as equal', () => {
    expect(valuesEqual('Vigilance', 'vigilance')).toBe(true);
    expect(valuesEqual(' Leader ', 'Leader')).toBe(true);
  });

  it('treats null, undefined and empty string as equivalently absent', () => {
    expect(valuesEqual(null, undefined)).toBe(true);
    expect(valuesEqual(null, '')).toBe(true);
  });

  // The normalizer must not be so eager that it hides a real discrepancy.
  it('still reports genuinely different values as different', () => {
    expect(valuesEqual('Vader', 'Darth Vader')).toBe(false);
    expect(valuesEqual(7, 8)).toBe(false);
    expect(valuesEqual(['Imperial'], ['Imperial', 'Trooper'])).toBe(false);
    expect(valuesEqual('7', 70)).toBe(false);
    expect(valuesEqual(0, null)).toBe(false);
    expect(valuesEqual(false, 0)).toBe(false);
  });

  it('does not treat list order as irrelevant', () => {
    expect(valuesEqual(['A', 'B'], ['B', 'A'])).toBe(false);
  });
});

describe('reconcileSet', () => {
  const FIELDS = ['Name', 'Cost', 'Traits'];

  it('applies official values to a card matched across the padding mismatch', () => {
    const result = reconcileSet({
      setCode: 'SOR',
      apiCards: [{ Set: 'SOR', Number: '005', Name: 'Luke', Cost: '7' }],
      officialCards: [{ Set: 'SOR', Number: 5, Name: 'Luke Skywalker', Cost: 7 }],
      fields: FIELDS,
    });

    expect(result.cards[0].Name).toBe('Luke Skywalker');
    expect(result.overrides).toHaveLength(1);
    expect(result.overrides[0].field).toBe('Name');
  });

  it('does not record an override for a type-only difference', () => {
    const result = reconcileSet({
      setCode: 'SOR',
      apiCards: [{ Set: 'SOR', Number: '005', Cost: '7' }],
      officialCards: [{ Set: 'SOR', Number: 5, Cost: 7 }],
      fields: FIELDS,
    });

    expect(result.overrides).toHaveLength(0);
  });

  it('does not record an override for a case-only list difference', () => {
    const result = reconcileSet({
      setCode: 'SOR',
      apiCards: [{ Set: 'SOR', Number: '005', Traits: ['IMPERIAL'] }],
      officialCards: [{ Set: 'SOR', Number: 5, Traits: ['Imperial'] }],
      fields: FIELDS,
    });

    expect(result.overrides).toHaveLength(0);
  });

  it('adds a card the official site has and swu-db does not', () => {
    const result = reconcileSet({
      setCode: 'SOR',
      apiCards: [{ Set: 'SOR', Number: '005', Name: 'Luke' }],
      officialCards: [
        { Set: 'SOR', Number: 5, Name: 'Luke' },
        { Set: 'SOR', Number: 250, Name: 'Newly Printed' },
      ],
      fields: FIELDS,
    });

    expect(result.added).toHaveLength(1);
    expect(result.added[0].Name).toBe('Newly Printed');
    expect(result.cards).toHaveLength(2);
  });

  it('does NOT add a card that only appeared missing due to padding', () => {
    // This is the failure that would have inserted 956 duplicates.
    const result = reconcileSet({
      setCode: 'SOR',
      apiCards: [{ Set: 'SOR', Number: '005', Name: 'Luke' }],
      officialCards: [{ Set: 'SOR', Number: 5, Name: 'Luke' }],
      fields: FIELDS,
    });

    expect(result.added).toHaveLength(0);
    expect(result.cards).toHaveLength(1);
  });

  it('applies corrections to foil printings as well as the base card', () => {
    const result = reconcileSet({
      setCode: 'SOR',
      apiCards: [
        { Set: 'SOR', Number: '005', Name: 'Luke' },
        { Set: 'SOR', Number: '005F', Name: 'Luke' },
      ],
      officialCards: [{ Set: 'SOR', Number: 5, Name: 'Luke Skywalker' }],
      fields: FIELDS,
    });

    expect(result.cards.map((c) => c.Name)).toEqual(['Luke Skywalker', 'Luke Skywalker']);
    expect(result.added).toHaveLength(0);
  });

  it('leaves the set untouched when the official data is empty', () => {
    const apiCards = [{ Set: 'SOR', Number: '005', Name: 'Luke' }];
    const result = reconcileSet({ setCode: 'SOR', apiCards, officialCards: [], fields: FIELDS });

    expect(result.overrides).toHaveLength(0);
    expect(result.added).toHaveLength(0);
    expect(result.cards).toEqual(apiCards);
  });

  it('does not mutate the caller’s input arrays', () => {
    const apiCards = [{ Set: 'SOR', Number: '005', Name: 'Luke' }];
    reconcileSet({
      setCode: 'SOR',
      apiCards,
      officialCards: [{ Set: 'SOR', Number: 5, Name: 'Luke Skywalker' }],
      fields: FIELDS,
    });

    expect(apiCards[0].Name).toBe('Luke');
  });
});

describe('reconcileSet: never destroys data', () => {
  const FIELDS = ['Name', 'Power', 'HP', 'Subtitle', 'Keywords'];

  // The first two production runs replaced 667 real values with empty ones,
  // because the scraper coerced missing official data into false/null/''
  // and "official wins" was applied absolutely. Official is authoritative for
  // fields it actually HAS; absent must mean absent.

  it('does not replace a real value with null', () => {
    const result = reconcileSet({
      setCode: 'SOR',
      apiCards: [{ Set: 'SOR', Number: '005', Power: 6, HP: 9 }],
      officialCards: [{ Set: 'SOR', Number: 5, Power: null, HP: null }],
      fields: FIELDS,
    });

    expect(result.cards[0].Power).toBe(6);
    expect(result.cards[0].HP).toBe(9);
    expect(result.overrides).toHaveLength(0);
  });

  it('does not replace a real value with an empty string', () => {
    const result = reconcileSet({
      setCode: 'SOR',
      apiCards: [{ Set: 'SOR', Number: '005', Subtitle: 'Walking Carpet' }],
      officialCards: [{ Set: 'SOR', Number: 5, Subtitle: '' }],
      fields: FIELDS,
    });

    expect(result.cards[0].Subtitle).toBe('Walking Carpet');
  });

  it('reports a refused overwrite so a mapping regression is visible', () => {
    const result = reconcileSet({
      setCode: 'SOR',
      apiCards: [{ Set: 'SOR', Number: '005', Power: 6 }],
      officialCards: [{ Set: 'SOR', Number: 5, Power: null }],
      fields: FIELDS,
    });

    expect(result.refused).toHaveLength(1);
    expect(result.refused[0]).toMatchObject({ field: 'Power', number: '005' });
  });

  it('still fills a field swu-db lacks -- that is the whole point of the scrape', () => {
    const result = reconcileSet({
      setCode: 'SOR',
      apiCards: [{ Set: 'SOR', Number: '005', Name: 'Luke' }],
      officialCards: [{ Set: 'SOR', Number: 5, Name: 'Luke', Keywords: ['Sentinel'] }],
      fields: FIELDS,
    });

    expect(result.cards[0].Keywords).toEqual(['Sentinel']);
    expect(result.overrides).toHaveLength(1);
  });

  it('still applies a genuine official correction between two real values', () => {
    const result = reconcileSet({
      setCode: 'SOR',
      apiCards: [{ Set: 'SOR', Number: '005', Power: 6 }],
      officialCards: [{ Set: 'SOR', Number: 5, Power: 8 }],
      fields: FIELDS,
    });

    expect(result.cards[0].Power).toBe(8);
  });

  it('allows a legitimate zero, which is a value and not an absence', () => {
    const result = reconcileSet({
      setCode: 'SOR',
      apiCards: [{ Set: 'SOR', Number: '005', Power: 6 }],
      officialCards: [{ Set: 'SOR', Number: 5, Power: 0 }],
      fields: FIELDS,
    });

    expect(result.cards[0].Power).toBe(0);
  });
});

describe('reconcileSet: token cards must not hijack real cards', () => {
  const FIELDS = ['Name', 'Type', 'Unique', 'Subtitle'];

  // The official site numbers its token cards (Experience, Shield) 1 and 2
  // within each set, colliding with the real cards 1 and 2 -- usually leaders.
  // Index building was last-write-wins, so in production SOR/001 became:
  //   {Name: "Experience", Type: "Token Upgrade", Unique: false}
  // i.e. Director Krennic was overwritten by a token, across ~50 sets.

  it('does not let a token overwrite a real card sharing its number', () => {
    const result = reconcileSet({
      setCode: 'SOR',
      apiCards: [{ Set: 'SOR', Number: '001', Name: 'Director Krennic', Type: 'Leader', Unique: true }],
      officialCards: [
        { Set: 'SOR', Number: 1, Name: 'Director Krennic', Type: 'Leader', Unique: true },
        { Set: 'SOR', Number: 1, Name: 'Experience', Type: 'Token Upgrade', Unique: false },
      ],
      fields: FIELDS,
    });

    expect(result.cards[0].Name).toBe('Director Krennic');
    expect(result.cards[0].Type).toBe('Leader');
    expect(result.cards[0].Unique).toBe(true);
  });

  it('does not add a token as a new card', () => {
    const result = reconcileSet({
      setCode: 'SOR',
      apiCards: [{ Set: 'SOR', Number: '001', Name: 'Director Krennic' }],
      officialCards: [
        { Set: 'SOR', Number: 1, Name: 'Director Krennic' },
        { Set: 'SOR', Number: 2, Name: 'Shield', Type: 'Token Unit' },
      ],
      fields: FIELDS,
    });

    expect(result.added).toHaveLength(0);
    expect(result.cards).toHaveLength(1);
  });

  it('still reconciles a normal card whose type merely contains the word token', () => {
    const result = reconcileSet({
      setCode: 'SOR',
      apiCards: [{ Set: 'SOR', Number: '050', Name: 'Old', Type: 'Unit' }],
      officialCards: [{ Set: 'SOR', Number: 50, Name: 'New', Type: 'Unit' }],
      fields: FIELDS,
    });

    expect(result.cards[0].Name).toBe('New');
  });
});
