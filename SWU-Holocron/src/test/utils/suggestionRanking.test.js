import { describe, it, expect } from 'vitest';
import { rankCandidates, extractConceptTerms, extractConceptPhrases } from '../../utils/suggestionRanking.js';

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

  it('ranks an aspect-neutral card above an off-aspect one', () => {
    const neutral = card({ id: 'LOF_020', aspects: [] });
    const offAspect = card({ id: 'LOF_021', aspects: ['Heroism'] });

    const result = rankCandidates({ ...base, cards: [offAspect, neutral] });

    expect(result[0].id).toBe('LOF_020');
  });

  it('ranks an in-aspect card above an aspect-neutral one', () => {
    // Neutral cards are playable in any deck and pay for it: they are generally
    // costlier or weaker than a card that matches the deck's aspects. Matching
    // aspects should win.
    const inAspect = card({ id: 'LOF_022', aspects: ['Villainy'] });
    const neutral = card({ id: 'LOF_023', aspects: [] });

    const result = rankCandidates({ ...base, cards: [neutral, inAspect] });

    expect(result[0].id).toBe('LOF_022');
  });

  it('ranks a double aspect match above a single one', () => {
    // Aspect requirements are a balancing cost in SWU, so a card demanding two
    // aspects the deck actually has is usually stronger for its cost.
    const double = card({ id: 'LOF_040', aspects: ['Villainy', 'Vigilance'] });
    const single = card({ id: 'LOF_041', aspects: ['Villainy'] });

    const result = rankCandidates({ ...base, cards: [single, double] });

    expect(result[0].id).toBe('LOF_040');
  });

  it('counts a repeated aspect as a double requirement', () => {
    // A card costing the same aspect twice carries two requirements.
    const doubled = card({ id: 'LOF_050', aspects: ['Villainy', 'Villainy'] });
    const single = card({ id: 'LOF_051', aspects: ['Villainy'] });

    const result = rankCandidates({ ...base, cards: [single, doubled] });

    expect(result[0].id).toBe('LOF_050');
  });

  it('orders aspect tiers: double, single, neutral, partial, off', () => {
    const cards = [
      card({ id: 'LOF_1', aspects: ['Heroism'] }),                  // off
      card({ id: 'LOF_2', aspects: ['Villainy', 'Heroism'] }),      // partial
      card({ id: 'LOF_3', aspects: [] }),                           // neutral
      card({ id: 'LOF_4', aspects: ['Villainy'] }),                 // single
      card({ id: 'LOF_5', aspects: ['Villainy', 'Vigilance'] }),    // double
    ];

    const order = rankCandidates({ ...base, cards }).map((c) => c.id);

    expect(order).toEqual(['LOF_5', 'LOF_4', 'LOF_3', 'LOF_2', 'LOF_1']);
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

describe('extractConceptTerms', () => {
  // The ranker cannot understand "swarm aggro"; it can only match words it
  // already knows. The vocabulary is built from the card pool itself, so a
  // stray adjective never becomes a ranking signal.
  const VOCAB = ['imperial', 'trooper', 'vehicle', 'unit', 'event', 'upgrade', 'force', 'spy'];

  it('finds vocabulary terms in free text', () => {
    expect(extractConceptTerms('Imperial trooper swarm', VOCAB).sort())
      .toEqual(['imperial', 'trooper']);
  });

  it('matches a plural against its singular vocabulary entry', () => {
    expect(extractConceptTerms('lots of vehicles', VOCAB)).toContain('vehicle');
  });

  it('ignores words that are not in the vocabulary', () => {
    expect(extractConceptTerms('fast aggressive tempo deck', VOCAB)).toEqual([]);
  });

  it('does not match a term embedded inside another word', () => {
    // "forceful" must not register as the Force trait.
    expect(extractConceptTerms('a forceful plan', VOCAB)).toEqual([]);
  });

  it('is case-insensitive and de-duplicates', () => {
    expect(extractConceptTerms('IMPERIAL imperial Imperial', VOCAB)).toEqual(['imperial']);
  });

  it('returns nothing for empty or missing input', () => {
    expect(extractConceptTerms('', VOCAB)).toEqual([]);
    expect(extractConceptTerms(null, VOCAB)).toEqual([]);
    expect(extractConceptTerms('imperial', null)).toEqual([]);
  });
});

describe('rankCandidates: deck concept', () => {
  it('ranks a concept match above aspect and tribal signals', () => {
    const conceptMatch = card({ id: 'LOF_060', aspects: ['Heroism'], traits: ['Vehicle'] });
    const aspectMatch = card({ id: 'LOF_061', aspects: ['Villainy', 'Vigilance'], traits: [] });

    const result = rankCandidates({
      ...base,
      cards: [aspectMatch, conceptMatch],
      conceptTerms: ['vehicle'],
    });

    expect(result[0].id).toBe('LOF_060');
  });

  it('still puts an owned card above a concept match', () => {
    // Ownership stays the top signal: suggest what can be built today.
    const owned = card({ id: 'SOR_070', aspects: ['Heroism'], traits: [] });
    const conceptMatch = card({ id: 'LOF_071', aspects: ['Villainy'], traits: ['Vehicle'] });

    const result = rankCandidates({
      ...base,
      cards: [conceptMatch, owned],
      ownedIds: new Set(['SOR_070']),
      conceptTerms: ['vehicle'],
    });

    expect(result[0].id).toBe('SOR_070');
  });

  it('matches a concept term against the card type as well as its traits', () => {
    const eventCard = card({ id: 'LOF_080', type: 'Event', aspects: [] });
    const unitCard = card({ id: 'LOF_081', type: 'Unit', aspects: ['Villainy'] });

    const result = rankCandidates({ ...base, cards: [unitCard, eventCard], conceptTerms: ['event'] });

    expect(result[0].id).toBe('LOF_080');
  });

  it('changes nothing when no concept is given', () => {
    const cards = [
      card({ id: 'LOF_090', aspects: ['Villainy', 'Vigilance'] }),
      card({ id: 'LOF_091', aspects: ['Heroism'] }),
    ];

    const withNone = rankCandidates({ ...base, cards }).map((c) => c.id);
    const withEmpty = rankCandidates({ ...base, cards, conceptTerms: [] }).map((c) => c.id);

    expect(withEmpty).toEqual(withNone);
  });
});

describe('extractConceptPhrases', () => {
  // Themes like "indirect damage" are mechanics described in rules text, not
  // traits or keywords. Against the live database "indirect" appears in the
  // rules text of 23 cards and in zero traits and zero keywords, so a
  // vocabulary built from traits/types/keywords could never see it.

  it('keeps the meaningful words and drops the filler', () => {
    // "theme" is filler: it describes the sentence, not the cards.
    expect(extractConceptPhrases('indirect damage theme')).toEqual(['indirect', 'damage']);
  });

  it('drops filler words that would match almost any card', () => {
    const out = extractConceptPhrases('a deck that can with some cards');
    expect(out).not.toContain('deck');
    expect(out).not.toContain('that');
    expect(out).not.toContain('with');
    expect(out).not.toContain('some');
  });

  it('drops very short words', () => {
    expect(extractConceptPhrases('go up to it')).toEqual([]);
  });

  it('de-duplicates and lower-cases', () => {
    expect(extractConceptPhrases('Damage DAMAGE damage')).toEqual(['damage']);
  });

  it('returns nothing for empty input', () => {
    expect(extractConceptPhrases('')).toEqual([]);
    expect(extractConceptPhrases(null)).toEqual([]);
  });
});

describe('rankCandidates: concept phrases in rules text', () => {
  it('ranks a card whose rules text mentions the theme above one that does not', () => {
    const onTheme = card({ id: 'LOF_100', aspects: [], text: 'Deal 2 indirect damage to a player.' });
    const offTheme = card({ id: 'LOF_101', aspects: ['Villainy'], text: 'Draw a card.' });

    const result = rankCandidates({
      ...base,
      cards: [offTheme, onTheme],
      conceptPhrases: ['indirect', 'damage'],
    });

    expect(result[0].id).toBe('LOF_100');
  });

  it('still ranks a trait/type concept match above a rules-text one', () => {
    // Vocabulary terms are a precise signal; text matching is fuzzy.
    const byTrait = card({ id: 'LOF_110', traits: ['Vehicle'], text: '' });
    const byText = card({ id: 'LOF_111', traits: [], text: 'vehicle vehicle vehicle' });

    const result = rankCandidates({
      ...base,
      cards: [byText, byTrait],
      conceptTerms: ['vehicle'],
      conceptPhrases: ['vehicle'],
    });

    expect(result[0].id).toBe('LOF_110');
  });

  it('keeps ownership above any concept signal', () => {
    const owned = card({ id: 'SOR_120', aspects: ['Heroism'], text: '' });
    const onTheme = card({ id: 'LOF_121', aspects: ['Villainy'], text: 'indirect damage' });

    const result = rankCandidates({
      ...base,
      cards: [onTheme, owned],
      ownedIds: new Set(['SOR_120']),
      conceptPhrases: ['indirect', 'damage'],
    });

    expect(result[0].id).toBe('SOR_120');
  });

  it('changes nothing when no phrases are supplied', () => {
    const cards = [card({ id: 'LOF_130', text: 'indirect damage' }), card({ id: 'LOF_131' })];
    const a = rankCandidates({ ...base, cards }).map((c) => c.id);
    const b = rankCandidates({ ...base, cards, conceptPhrases: [] }).map((c) => c.id);
    expect(a).toEqual(b);
  });
});
