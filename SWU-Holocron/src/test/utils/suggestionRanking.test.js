import { describe, it, expect } from 'vitest';
import { rankCandidates } from '../../utils/suggestionRanking.js';

/**
 * Candidate selection for AI deck suggestions.
 *
 * The previous implementation took `.slice(0, 300)` off a list loaded in set
 * release order, so the model only ever saw SOR — the oldest set — and 3.2% of
 * a 9,241-card pool. A JTL deck could not be offered a JTL card because no JTL
 * card was ever sent.
 *
 * Priority order, highest first:
 *   1. cards already in the user's collection  (build it today, not in theory)
 *   2. aspect fit                              (off-aspect costs +2 in SWU)
 *   3. type / tribal overlap with the deck
 *   4. set proximity to the leader's set        (the set before and after)
 */

// Distinct names by default: real cards have distinct names, and de-duplication
// is by name, so a shared default would collapse every fixture into one card.
const card = (over = {}) => {
  const id = over.id ?? 'SOR_100';
  return {
    id,
    name: `Card ${id}`,
    type: 'Unit',
    cost: 3,
    aspects: [],
    traits: [],
    ...over,
  };
};

const SET_ORDER = ['SOR', 'SHD', 'TWI', 'JTL', 'LOF', 'SEC', 'LAW'];

const base = {
  deckAspects: ['Villainy', 'Vigilance'],
  deckTraits: [],
  ownedIds: new Set(),
  leaderSetCode: 'JTL',
  setOrder: SET_ORDER,
  limit: 10,
};

describe('rankCandidates: priority order', () => {
  it('puts an owned card above an unowned one that wins on every other axis', () => {
    const owned = card({ id: 'SOR_001', aspects: ['Heroism'], traits: [], });
    const unowned = card({ id: 'JTL_001', aspects: ['Villainy'], traits: ['Imperial'] });

    const result = rankCandidates({
      ...base,
      cards: [unowned, owned],
      deckTraits: ['Imperial'],
      ownedIds: new Set(['SOR_001']),
    });

    expect(result[0].id).toBe('SOR_001');
  });

  it('prefers aspect fit among cards of equal ownership', () => {
    const onAspect = card({ id: 'LOF_010', aspects: ['Villainy'] });
    const offAspect = card({ id: 'LOF_011', aspects: ['Heroism'] });

    const result = rankCandidates({ ...base, cards: [offAspect, onAspect] });

    expect(result[0].id).toBe('LOF_010');
  });

  it('treats an aspect-neutral card as fitting any deck', () => {
    const neutral = card({ id: 'LOF_020', aspects: [] });
    const offAspect = card({ id: 'LOF_021', aspects: ['Heroism'] });

    const result = rankCandidates({ ...base, cards: [offAspect, neutral] });

    expect(result[0].id).toBe('LOF_020');
  });

  it('prefers trait overlap once ownership and aspect are equal', () => {
    const tribal = card({ id: 'LOF_030', aspects: ['Villainy'], traits: ['Imperial', 'Trooper'] });
    const plain = card({ id: 'LOF_031', aspects: ['Villainy'], traits: ['Underworld'] });

    const result = rankCandidates({
      ...base,
      cards: [plain, tribal],
      deckTraits: ['Imperial', 'Trooper'],
    });

    expect(result[0].id).toBe('LOF_030');
  });

  it('prefers the leader’s own set and its neighbours once all else is equal', () => {
    // Leader is JTL, so TWI (before) and LOF (after) beat distant sets.
    const cards = [
      card({ id: 'SOR_040', aspects: ['Villainy'] }),
      card({ id: 'LAW_040', aspects: ['Villainy'] }),
      card({ id: 'LOF_040', aspects: ['Villainy'] }),
      card({ id: 'JTL_040', aspects: ['Villainy'] }),
      card({ id: 'TWI_040', aspects: ['Villainy'] }),
    ];

    const top3 = rankCandidates({ ...base, cards }).slice(0, 3).map((c) => c.id.split('_')[0]);

    expect(top3).toContain('JTL');
    expect(top3).toContain('TWI');
    expect(top3).toContain('LOF');
    expect(top3).not.toContain('SOR');
  });

  it('does not let one set monopolise the result the way slice() did', () => {
    // 400 SOR cards first, then a handful from the leader's set.
    const cards = [
      ...Array.from({ length: 400 }, (_, i) =>
        card({ id: `SOR_${i}`, aspects: ['Villainy'] })),
      ...Array.from({ length: 5 }, (_, i) =>
        card({ id: `JTL_${i}`, aspects: ['Villainy'] })),
    ];

    const sets = new Set(rankCandidates({ ...base, cards, limit: 20 }).map((c) => c.id.split('_')[0]));

    expect(sets.has('JTL')).toBe(true);
  });
});

describe('rankCandidates: mechanics', () => {
  it('respects the limit', () => {
    const cards = Array.from({ length: 50 }, (_, i) => card({ id: `LOF_${i}` }));
    expect(rankCandidates({ ...base, cards, limit: 12 })).toHaveLength(12);
  });

  it('returns every card when there are fewer than the limit', () => {
    const cards = [card({ id: 'LOF_1' }), card({ id: 'LOF_2' })];
    expect(rankCandidates({ ...base, cards, limit: 300 })).toHaveLength(2);
  });

  it('is deterministic for the same input', () => {
    const cards = Array.from({ length: 30 }, (_, i) =>
      card({ id: `LOF_${i}`, aspects: i % 2 ? ['Villainy'] : ['Heroism'] }));

    const a = rankCandidates({ ...base, cards }).map((c) => c.id);
    const b = rankCandidates({ ...base, cards }).map((c) => c.id);

    expect(a).toEqual(b);
  });

  it('survives missing or malformed fields without throwing', () => {
    const cards = [{ id: 'LOF_1' }, { id: 'LOF_2', aspects: null, traits: undefined }];
    expect(() => rankCandidates({ ...base, cards })).not.toThrow();
    expect(rankCandidates({ ...base, cards })).toHaveLength(2);
  });

  it('handles an unknown leader set without crashing', () => {
    const cards = [card({ id: 'LOF_1' })];
    expect(rankCandidates({ ...base, cards, leaderSetCode: 'NOPE' })).toHaveLength(1);
  });

  it('returns an empty array for no candidates', () => {
    expect(rankCandidates({ ...base, cards: [] })).toEqual([]);
    expect(rankCandidates({ ...base, cards: null })).toEqual([]);
  });
});

describe('rankCandidates: one slot per distinct card', () => {
  // swu-db carries foil printings (a trailing F on the number) and reprints of
  // the same card in several sets. Against the live database the top of the
  // ranking was SOR_229 / SOR_229F / SOR_490 / SOR_490F -- one card, four
  // slots. Prompt space is the scarce resource here.

  it('keeps only the best-scoring printing of a card', () => {
    const cards = [
      card({ id: 'SOR_229', name: 'Cell Block Guard', aspects: ['Villainy'] }),
      card({ id: 'SOR_229F', name: 'Cell Block Guard', aspects: ['Villainy'] }),
      card({ id: 'SOR_490', name: 'Cell Block Guard', aspects: ['Villainy'] }),
      card({ id: 'JTL_050', name: 'Something Else', aspects: ['Villainy'] }),
    ];

    const result = rankCandidates({ ...base, cards });

    expect(result).toHaveLength(2);
    expect(result.map((c) => c.name).sort()).toEqual(['Cell Block Guard', 'Something Else']);
  });

  it('prefers an owned printing over an unowned one of the same card', () => {
    const cards = [
      card({ id: 'SOR_229', name: 'Cell Block Guard', aspects: ['Villainy'] }),
      card({ id: 'SOR_229F', name: 'Cell Block Guard', aspects: ['Villainy'] }),
    ];

    const result = rankCandidates({ ...base, cards, ownedIds: new Set(['SOR_229F']) });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('SOR_229F');
  });

  it('treats names case-insensitively when de-duplicating', () => {
    const cards = [
      card({ id: 'SOR_1', name: 'Vanquish' }),
      card({ id: 'LOF_1', name: 'vanquish' }),
    ];

    expect(rankCandidates({ ...base, cards })).toHaveLength(1);
  });

  it('keeps cards that merely lack a name rather than collapsing them together', () => {
    const cards = [{ id: 'SOR_1' }, { id: 'SOR_2' }];
    expect(rankCandidates({ ...base, cards })).toHaveLength(2);
  });
});
