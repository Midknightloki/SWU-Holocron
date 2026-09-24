import { describe, it, expect } from 'vitest';
import {
  normalizeSetCatalog,
  parseReleaseDate,
  LEGACY_SET_CODES,
} from '../../setCatalog.js';
import apiSets from '../fixtures/swu-db-sets.json';

/**
 * Fixture is a recorded subset of https://api.swu-db.com/sets, unmodified.
 * It deliberately includes the shapes that broke the hardcoded list:
 * base sets, OP promos with a parentSetId, and promo sets with no releaseDate.
 */

describe('parseReleaseDate', () => {
  it('parses the API M/D/YY format to an ISO date', () => {
    expect(parseReleaseDate('7/11/25')).toBe('2025-07-11');
  });

  it('zero-pads single-digit months and days', () => {
    expect(parseReleaseDate('3/8/24')).toBe('2024-03-08');
  });

  it('returns null for missing or unparseable values', () => {
    expect(parseReleaseDate(null)).toBeNull();
    expect(parseReleaseDate(undefined)).toBeNull();
    expect(parseReleaseDate('')).toBeNull();
    expect(parseReleaseDate('not-a-date')).toBeNull();
  });
});

describe('normalizeSetCatalog', () => {
  it('maps the API shape onto the registry shape', () => {
    const sor = normalizeSetCatalog(apiSets).find((s) => s.code === 'SOR');
    expect(sor).toEqual({
      code: 'SOR',
      name: 'Spark of Rebellion',
      releaseDate: '2024-03-08',
      isBaseSet: true,
      cardCount: 252,
      parentSetId: null,
    });
  });

  it('defaults isBaseSet to false when the API omits it', () => {
    const promo = normalizeSetCatalog(apiSets).find((s) => s.code === 'SOROP');
    expect(promo.isBaseSet).toBe(false);
  });

  it('keeps parentSetId so promos can be grouped under their base set', () => {
    const hmwp = normalizeSetCatalog(apiSets).find((s) => s.code === 'HMWP');
    expect(hmwp.parentSetId).toBe('HMW');
  });

  it('discovers sets that the hardcoded SETS list never had', () => {
    const codes = normalizeSetCatalog(apiSets).map((s) => s.code);
    expect(codes).toEqual(expect.arrayContaining(['TS26', 'ASH', 'HMW', 'IC27', 'IBH']));
  });

  it('includes unreleased sets so a new set is known before launch', () => {
    const hmw = normalizeSetCatalog(apiSets).find((s) => s.code === 'HMW');
    expect(hmw.releaseDate).toBe('2026-10-09');
  });

  it('orders by release date, with undated promo sets last', () => {
    const result = normalizeSetCatalog(apiSets);
    const dated = result.filter((s) => s.releaseDate);
    const undated = result.filter((s) => !s.releaseDate);

    const dates = dated.map((s) => s.releaseDate);
    expect(dates).toEqual([...dates].sort());

    const firstUndatedIndex = result.findIndex((s) => !s.releaseDate);
    if (undated.length > 0) {
      expect(firstUndatedIndex).toBe(dated.length);
    }
  });

  it('skips entries with no usable set code', () => {
    const result = normalizeSetCatalog([
      { fullName: 'Nameless', numberCards: 3 },
      { setId: '', fullName: 'Empty code' },
      { setId: 'OK', fullName: 'Fine', numberCards: 1 },
    ]);
    expect(result.map((s) => s.code)).toEqual(['OK']);
  });

  it('de-duplicates repeated set codes, keeping the first', () => {
    const result = normalizeSetCatalog([
      { setId: 'DUP', fullName: 'First', numberCards: 10 },
      { setId: 'DUP', fullName: 'Second', numberCards: 20 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('First');
  });

  it('returns an empty array for a non-array payload rather than throwing', () => {
    expect(normalizeSetCatalog(null)).toEqual([]);
    expect(normalizeSetCatalog({ data: [] })).toEqual([]);
    expect(normalizeSetCatalog(undefined)).toEqual([]);
  });

  it('never invents the legacy pseudo-codes, which the API does not have', () => {
    const codes = normalizeSetCatalog(apiSets).map((s) => s.code);
    expect(codes).not.toContain('PROMO');
    expect(codes).not.toContain('OTHER');
  });
});

describe('LEGACY_SET_CODES', () => {
  it('records PROMO and OTHER as legacy buckets', () => {
    // These are not real API sets, but existing collection documents are keyed
    // with them (e.g. PROMO_001_std). They must keep resolving or those cards
    // are orphaned.
    expect(LEGACY_SET_CODES).toContain('PROMO');
    expect(LEGACY_SET_CODES).toContain('OTHER');
  });
});
