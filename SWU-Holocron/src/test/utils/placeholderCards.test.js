import { describe, it, expect } from 'vitest';
import {
  PLACEHOLDER_FLAG,
  isSetReleased,
  expectedCardCount,
  missingCardNumbers,
  buildPlaceholderCard,
  placeholdersForSet,
  classifySetCompleteness,
  isFailingStatus,
  applyPlaceholders,
} from '../../placeholderCards.js';

/**
 * The three real cases, measured against api.swu-db.com on 2026-09-26. These are
 * the whole reason the release-date rule exists, so they are the fixtures.
 */
const SOR = { code: 'SOR', name: 'Spark of Rebellion', releaseDate: '2024-03-08', cardCount: 252, maxElement: '252', parentSetId: null };
const SOROPJ = { code: 'SOROPJ', name: 'SOR - OP Promo - Judge', releaseDate: null, cardCount: 2, maxElement: '002', parentSetId: 'SOR' };
const CST = { code: 'CST', name: 'Costco Exclusive', releaseDate: '2026-09-15', cardCount: 3, maxElement: '3', parentSetId: null };
const IC27 = { code: 'IC27', name: 'Icons 2027', releaseDate: '2026-11-20', cardCount: 194, maxElement: '194', parentSetId: null };

const CATALOG = [SOR, SOROPJ, CST, IC27];
const NOW = Date.parse('2026-09-26T00:00:00Z');

const card = (number) => ({ Number: number, Name: 'Real Card ' + number });

describe('isSetReleased', () => {
  it('treats a past release date as released', () => {
    expect(isSetReleased(SOR, CATALOG, NOW)).toBe(true);
  });

  it('treats a future release date as not released', () => {
    expect(isSetReleased(IC27, CATALOG, NOW)).toBe(false);
  });

  it('counts the release date itself as released', () => {
    expect(isSetReleased({ code: 'X', releaseDate: '2026-09-26' }, CATALOG, NOW)).toBe(true);
  });

  // SOROPJ has no date of its own; it promotes a set from 2024.
  it('inherits the parent set date when it has none', () => {
    expect(isSetReleased(SOROPJ, CATALOG, NOW)).toBe(true);
  });

  it('does not treat a promo of an unreleased set as released', () => {
    const promo = { code: 'IC27P', releaseDate: null, parentSetId: 'IC27' };
    expect(isSetReleased(promo, CATALOG, NOW)).toBe(false);
  });

  it('treats a set with no date and no datable parent as released', () => {
    expect(isSetReleased({ code: 'PROMO', releaseDate: null, parentSetId: null }, CATALOG, NOW)).toBe(true);
  });

  it('survives a missing set', () => {
    expect(isSetReleased(null, CATALOG, NOW)).toBe(false);
  });
});

describe('expectedCardCount', () => {
  it('reads the declared count', () => {
    expect(expectedCardCount(SOR)).toBe(252);
  });

  // maxElement arrives both padded ('002') and bare ('3').
  it('parses maxElement in either format', () => {
    expect(expectedCardCount(SOROPJ)).toBe(2);
    expect(expectedCardCount(CST)).toBe(3);
  });

  it('takes the larger of the two, since a set cannot have fewer cards than its highest number', () => {
    expect(expectedCardCount({ cardCount: 5, maxElement: '12' })).toBe(12);
    expect(expectedCardCount({ cardCount: 20, maxElement: '12' })).toBe(20);
  });

  it('returns 0 when the catalog says nothing usable', () => {
    expect(expectedCardCount({})).toBe(0);
    expect(expectedCardCount(null)).toBe(0);
    expect(expectedCardCount({ cardCount: null, maxElement: '' })).toBe(0);
  });
});

describe('missingCardNumbers', () => {
  it('lists every number when nothing was fetched', () => {
    expect(missingCardNumbers(SOROPJ, [])).toEqual(['001', '002']);
  });

  it('lists only the gap', () => {
    expect(missingCardNumbers(CST, [card('001'), card('002')])).toEqual(['003']);
  });

  it('returns nothing when the set is complete', () => {
    expect(missingCardNumbers(CST, [card('001'), card('002'), card('003')])).toEqual([]);
  });

  it('matches numbers regardless of padding in the source data', () => {
    expect(missingCardNumbers(CST, [card('1'), card(2)])).toEqual(['003']);
  });

  it('does not invent numbers past the expected count', () => {
    // A variant numbered above the count must not shift the range.
    expect(missingCardNumbers(CST, [card('001'), card('002'), card('003'), card('900')])).toEqual([]);
  });

  it('fills an interior hole, not just the tail', () => {
    expect(missingCardNumbers(CST, [card('001'), card('003')])).toEqual(['002']);
  });

  it('returns nothing when the catalog gives no count', () => {
    expect(missingCardNumbers({ code: 'X' }, [])).toEqual([]);
  });
});

describe('buildPlaceholderCard', () => {
  const placeholder = buildPlaceholderCard('soropj', 2);

  it('is flagged as a placeholder', () => {
    expect(placeholder[PLACEHOLDER_FLAG]).toBe(true);
    expect(placeholder.placeholderReason).toBe('catalog-shortfall');
  });

  it('normalizes the set code and pads the number', () => {
    expect(placeholder.Set).toBe('SOROPJ');
    expect(placeholder.Number).toBe('002');
  });

  // Identity is name + subtitle everywhere in this app, so placeholders in the
  // same set must not collapse into one another.
  it('gives each placeholder a distinct identity', () => {
    const a = buildPlaceholderCard('SOROPJ', 1);
    const b = buildPlaceholderCard('SOROPJ', 2);
    expect(`${a.Name}${a.Subtitle}`).not.toBe(`${b.Name}${b.Subtitle}`);
  });

  it('guesses nothing it does not know', () => {
    expect(placeholder.Type).toBeNull();
    expect(placeholder.Cost).toBeNull();
    expect(placeholder.Rarity).toBeNull();
    expect(placeholder.Aspects).toEqual([]);
    expect(placeholder.Traits).toEqual([]);
  });

  it('says what it is, in the field the UI already renders', () => {
    expect(placeholder.FrontText).toMatch(/no data source describes it/i);
  });
});

describe('placeholdersForSet', () => {
  it('fills a released set with no data at all', () => {
    const result = placeholdersForSet({ set: SOROPJ, cards: [], catalog: CATALOG, now: NOW });
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.Number)).toEqual(['001', '002']);
  });

  it('fills the single gap in a just-released set', () => {
    const result = placeholdersForSet({
      set: CST,
      cards: [card('001'), card('002')],
      catalog: CATALOG,
      now: NOW,
    });
    expect(result).toHaveLength(1);
    expect(result[0].Number).toBe('003');
  });

  // The important one. 9 of 194 cards revealed for a set two months out is not
  // missing data, and 185 invented cards would be a disaster.
  it('creates nothing for a set that has not been released', () => {
    const cards = Array.from({ length: 9 }, (_, i) => card(String(i + 1)));
    expect(placeholdersForSet({ set: IC27, cards, catalog: CATALOG, now: NOW })).toEqual([]);
  });

  it('creates nothing for a complete set', () => {
    const cards = Array.from({ length: 252 }, (_, i) => card(String(i + 1)));
    expect(placeholdersForSet({ set: SOR, cards, catalog: CATALOG, now: NOW })).toEqual([]);
  });

  it('creates nothing without a set code', () => {
    expect(placeholdersForSet({ set: {}, cards: [], catalog: CATALOG, now: NOW })).toEqual([]);
  });
});

describe('classifySetCompleteness', () => {
  const classify = (set, cards) => classifySetCompleteness({ set, cards, catalog: CATALOG, now: NOW });

  it('calls a full set complete', () => {
    const cards = Array.from({ length: 3 }, (_, i) => card(String(i + 1)));
    expect(classify(CST, cards)).toMatchObject({ status: 'complete', missing: 0, placeholders: 0, real: 3 });
  });

  it('calls a placeheld set complete-with-placeholders, not a failure', () => {
    const cards = [card('001'), card('002'), buildPlaceholderCard('CST', 3)];
    const result = classify(CST, cards);
    expect(result).toMatchObject({ status: 'complete-with-placeholders', missing: 0, placeholders: 1, real: 2 });
    expect(isFailingStatus(result.status)).toBe(false);
  });

  it('calls an unreleased short set awaiting-release, not a failure', () => {
    const cards = Array.from({ length: 9 }, (_, i) => card(String(i + 1)));
    const result = classify(IC27, cards);
    expect(result).toMatchObject({ status: 'awaiting-release', missing: 185 });
    expect(isFailingStatus(result.status)).toBe(false);
  });

  it('calls a released, short, unplaceheld set incomplete -- and that does fail', () => {
    const result = classify(CST, [card('001')]);
    expect(result).toMatchObject({ status: 'incomplete', missing: 2 });
    expect(isFailingStatus(result.status)).toBe(true);
  });

  it('reports unknown when the catalog gives no count to check against', () => {
    expect(classify({ code: 'X' }, [card('001')])).toMatchObject({ status: 'unknown', expected: 0 });
    expect(isFailingStatus('unknown')).toBe(false);
  });

  it('counts placeholders separately from real cards', () => {
    const cards = [card('001'), buildPlaceholderCard('CST', 2), buildPlaceholderCard('CST', 3)];
    expect(classify(CST, cards)).toMatchObject({ real: 1, placeholders: 2 });
  });
});

describe('applyPlaceholders', () => {
  const apply = (set, cards) =>
    applyPlaceholders({ set, cards, catalog: CATALOG, now: NOW });

  it('adds the placeholders a released, short set needs', () => {
    const result = apply(CST, [card('001'), card('002')]);
    expect(result.added).toEqual(['003']);
    expect(result.removed).toEqual([]);
    expect(result.cards).toHaveLength(3);
    expect(result.real).toBe(2);
  });

  it('is idempotent -- running twice changes nothing the second time', () => {
    const first = apply(CST, [card('001'), card('002')]);
    const second = apply(CST, first.cards);
    expect(second.added).toEqual([]);
    expect(second.removed).toEqual([]);
    expect(second.cards).toHaveLength(3);
  });

  // The whole reason it rebuilds rather than patches: a placeholder has to
  // disappear by itself once the real card turns up.
  it('drops a placeholder once the real card arrives', () => {
    const withPlaceholder = apply(CST, [card('001'), card('002')]).cards;
    // The real card turns up alongside the placeholder that stood in for it --
    // nothing deletes the placeholder first, which is the point.
    const result = apply(CST, [...withPlaceholder, card('003')]);
    expect(result.removed).toEqual(['003']);
    expect(result.added).toEqual([]);
    expect(result.cards.some((c) => c.isPlaceholder)).toBe(false);
    expect(result.real).toBe(3);
  });

  it('drops every placeholder from a set that turns out to be complete', () => {
    const stale = [card('001'), card('002'), card('003'), buildPlaceholderCard('CST', 3)];
    const result = apply(CST, stale);
    expect(result.removed).toEqual(['003']);
    expect(result.cards.filter((c) => c.isPlaceholder)).toEqual([]);
  });

  it('never places holders in an unreleased set, and strips any that exist', () => {
    const cards = [card('001'), buildPlaceholderCard('IC27', 50)];
    const result = apply(IC27, cards);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual(['050']);
    expect(result.cards).toHaveLength(1);
  });

  it('does not count placeholders as real cards', () => {
    const result = apply(SOROPJ, []);
    expect(result.real).toBe(0);
    expect(result.cards).toHaveLength(2);
  });
});
