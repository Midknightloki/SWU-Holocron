/**
 * Candidate selection for AI deck suggestions.
 *
 * The model can only recommend cards it is shown, and the prompt has room for a
 * few hundred. Which few hundred is therefore the whole game.
 *
 * The previous implementation took `.slice(0, 300)` off a list loaded in set
 * release order. Measured against the live database: that sent 300 SOR cards
 * and nothing else — 3.2% of a 9,241-card pool, all from the oldest set. A JTL
 * deck could not be offered a JTL card, because no JTL card was ever sent.
 *
 * Priority order, highest first:
 *   1. cards already in the user's collection — suggest what they can build
 *      today, not what they would have to buy
 *   2. aspect fit — an off-aspect card costs +2 to play in SWU
 *   3. type / tribal overlap with what is already in the deck
 *   4. set proximity to the leader's set, including the set either side
 *
 * Weights are decades apart so a lower criterion can never outrank a higher
 * one; within a tier the finer signals order the result.
 *
 * @environment:none — pure functions, safe everywhere
 */

const W_OWNED = 10000;
// Deck concept sits below ownership and above every card-intrinsic signal:
// a card that fits the stated plan beats a merely on-aspect one, but a card
// already in the binder still comes first.
const W_CONCEPT_EACH = 1500;
const W_CONCEPT_CAP = 2;
// Rules-text matching is fuzzier than a trait or type name, so it scores lower
// than a vocabulary hit -- but still above every card-intrinsic signal, because
// a theme the player named is a stronger wish than an aspect coincidence.
const W_CONCEPT_TEXT_EACH = 1300;
const W_CONCEPT_TEXT_CAP = 2;
// Aspect tiers, best first. Aspect requirements are a balancing cost in SWU: a
// card demanding two aspects the deck has is usually stronger for its cost,
// while an aspect-neutral card is playable anywhere and pays for that in cost
// or power. A partial match still incurs +2 for each aspect the deck lacks.
const W_ASPECT_DOUBLE = 1200;
const W_ASPECT_FIT = 1000;
const W_ASPECT_NEUTRAL = 700;
const W_ASPECT_PARTIAL = 400;
const W_TRAIT_EACH = 60;
const W_TRAIT_CAP = 3;
const W_SET_LEADER = 30;
const W_SET_ADJACENT = 20;
const W_TYPE_MATCH = 10;

import { cardIdentity } from './cardIdentity.js';

const WORD_CHARS = new Set('abcdefghijklmnopqrstuvwxyz0123456789'.split(''));
const asArray = (v) => (Array.isArray(v) ? v : []);
const lower = (v) => String(v ?? '').trim().toLowerCase();

/**
 * Pull the terms a deck concept has in common with the card pool's vocabulary.
 *
 * The ranker cannot understand "swarm aggro" -- that judgement belongs to the
 * model, which receives the concept text verbatim. What this does is far more
 * modest and entirely deterministic: find the trait, type and keyword names the
 * user actually named, so the 300-card shortlist is concept-aware rather than
 * concept-blind. Matching against the pool's own vocabulary means a stray
 * adjective can never become a ranking signal.
 *
 * @param {string} conceptText free text from the user
 * @param {string[]} vocabulary known traits, types and keywords
 * @returns {string[]} matched terms, lower-cased and de-duplicated
 */
export function extractConceptTerms(conceptText, vocabulary) {
  const text = lower(conceptText);
  if (!text || !Array.isArray(vocabulary)) return [];

  const isWordChar = (ch) => ch !== undefined && WORD_CHARS.has(ch);

  // Whole-word match, tolerating a trailing plural, so 'vehicles' finds
  // 'vehicle' while 'forceful' never registers the Force trait. Done by index
  // rather than a built regex: vocabulary terms are data, and building a
  // pattern from data needs escaping that is easy to get wrong.
  const containsTerm = (haystack, term) => {
    let i = haystack.indexOf(term);
    while (i !== -1) {
      const before = i === 0 ? undefined : haystack[i - 1];
      let afterIdx = i + term.length;
      if (haystack[afterIdx] === 's') afterIdx += 1;
      const after = haystack[afterIdx];
      if (!isWordChar(before) && !isWordChar(after)) return true;
      i = haystack.indexOf(term, i + 1);
    }
    return false;
  };

  const found = new Set();
  for (const raw of vocabulary) {
    const term = lower(raw);
    if (term && containsTerm(text, term)) found.add(term);
  }
  return [...found];
}

// Words too common to be a useful signal: they appear in the rules text of
// almost every card, or carry no theme at all.
const CONCEPT_STOPWORDS = new Set([
  'deck', 'deckbuilding', 'build', 'building', 'cards', 'card', 'play', 'playing',
  'that', 'this', 'with', 'from', 'into', 'your', 'you', 'them', 'they', 'when',
  'some', 'more', 'most', 'lots', 'want', 'like', 'good', 'best', 'really',
  'theme', 'themed', 'strategy', 'around', 'focus', 'focused', 'using', 'use',
]);

/**
 * Significant words from a deck concept, for matching against card rules text.
 *
 * Mechanics such as "indirect damage" live in rules text, not in traits or
 * keywords: against the live database "indirect" appears in the rules text of
 * 23 cards and in zero traits and zero keywords. A vocabulary built from
 * traits, types and keywords is blind to that whole class of theme, so the
 * words themselves are matched against the text as well.
 *
 * @param {string} conceptText
 * @returns {string[]} lower-cased significant words, de-duplicated
 */
export function extractConceptPhrases(conceptText) {
  const text = lower(conceptText);
  if (!text) return [];

  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  const out = new Set();
  for (const word of words) {
    if (word.length < 4) continue;
    if (CONCEPT_STOPWORDS.has(word)) continue;
    out.add(word);
  }
  return [...out];
}

/**
 * Score a single candidate. Higher is better.
 */
function scoreCard(card, ctx) {
  const { deckAspectSet, deckTraitSet, ownedIds, setIndexOf, leaderIndex, deckTypeSet, conceptTermSet, conceptPhraseList } = ctx;
  let score = 0;

  if (ownedIds.has(card.id)) score += W_OWNED;

  // Concept fit: how many of the terms the user named this card carries, across
  // its traits and its type.
  if (conceptTermSet.size > 0) {
    const searchable = [...asArray(card.traits).map(lower), lower(card.type)].filter(Boolean);
    let hits = 0;
    for (const term of conceptTermSet) {
      if (searchable.includes(term)) hits += 1;
    }
    score += Math.min(hits, W_CONCEPT_CAP) * W_CONCEPT_EACH;
  }

  // Themes described in rules text rather than named as traits.
  if (conceptPhraseList.length > 0) {
    const body = lower(card.text);
    if (body) {
      let textHits = 0;
      for (const phrase of conceptPhraseList) {
        if (body.includes(phrase)) textHits += 1;
      }
      score += Math.min(textHits, W_CONCEPT_TEXT_CAP) * W_CONCEPT_TEXT_EACH;
    }
  }

  // Aspect fit. Counted with multiplicity, so a card costing the same aspect
  // twice registers as two requirements.
  const aspects = asArray(card.aspects).map(lower).filter(Boolean);
  if (aspects.length === 0) {
    score += W_ASPECT_NEUTRAL;
  } else if (aspects.every((a) => deckAspectSet.has(a))) {
    score += aspects.length >= 2 ? W_ASPECT_DOUBLE : W_ASPECT_FIT;
  } else if (aspects.some((a) => deckAspectSet.has(a))) {
    score += W_ASPECT_PARTIAL;
  }

  // Tribal overlap, capped so a card with many traits cannot dominate.
  const traits = asArray(card.traits).map(lower).filter(Boolean);
  const shared = traits.filter((t) => deckTraitSet.has(t)).length;
  score += Math.min(shared, W_TRAIT_CAP) * W_TRAIT_EACH;

  if (deckTypeSet.has(lower(card.type))) score += W_TYPE_MATCH;

  // Set proximity to the leader's set: the leader's own set, then either side.
  if (leaderIndex >= 0) {
    const idx = setIndexOf.get(String(card.id || '').split('_')[0]);
    if (idx !== undefined) {
      const distance = Math.abs(idx - leaderIndex);
      if (distance === 0) score += W_SET_LEADER;
      else if (distance === 1) score += W_SET_ADJACENT;
    }
  }

  return score;
}

/**
 * Choose which candidates to send to the model.
 *
 * @param {object} input
 * @param {Array}  input.cards         candidate cards ({id, name, type, cost, aspects, traits})
 * @param {string[]} input.deckAspects aspects of the leader and base
 * @param {string[]} input.deckTraits  traits already present in the deck
 * @param {string[]} [input.deckTypes] card types already present in the deck
 * @param {string[]} [input.conceptTerms] vocabulary terms drawn from the user's
 *   deck concept (see extractConceptTerms)
 * @param {Set<string>} input.ownedIds ids the user owns at least one copy of
 * @param {string} input.leaderSetCode set code of the chosen leader
 * @param {string[]} input.setOrder    set codes in release order
 * @param {number} input.limit         how many to return
 * @returns {Array} the highest-scoring candidates, best first
 */
export function rankCandidates({
  cards,
  deckAspects = [],
  deckTraits = [],
  deckTypes = [],
  conceptTerms = [],
  conceptPhrases = [],
  ownedIds = new Set(),
  leaderSetCode = '',
  setOrder = [],
  limit = 300,
} = {}) {
  if (!Array.isArray(cards) || cards.length === 0) return [];

  const setIndexOf = new Map(setOrder.map((code, i) => [code, i]));
  const leaderIndex = setIndexOf.has(leaderSetCode) ? setIndexOf.get(leaderSetCode) : -1;

  const ctx = {
    deckAspectSet: new Set(deckAspects.map(lower).filter(Boolean)),
    deckTraitSet: new Set(deckTraits.map(lower).filter(Boolean)),
    deckTypeSet: new Set(deckTypes.map(lower).filter(Boolean)),
    conceptTermSet: new Set(asArray(conceptTerms).map(lower).filter(Boolean)),
    conceptPhraseList: asArray(conceptPhrases).map(lower).filter(Boolean),
    ownedIds: ownedIds instanceof Set ? ownedIds : new Set(ownedIds || []),
    setIndexOf,
    leaderIndex,
  };

  // Stable: ties fall back to the original order, so the same deck produces the
  // same prompt and the result does not shuffle between clicks.
  const ordered = cards
    .map((card, index) => ({ card, index, score: scoreCard(card, ctx) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));

  // One slot per distinct card, and that slot goes to the BASE printing.
  // swu-db carries foil printings and prestige variants, so the same card can
  // occupy several slots. This previously de-duplicated by NAME ALONE, which
  // both wasted slots and collapsed genuinely different cards that share a name
  // and differ only by subtitle.
  const seen = new Set();
  const picked = [];
  for (const entry of ordered) {
    if (picked.length >= limit) break;
    const identity = cardIdentity(entry.card);
    if (identity !== '|') {
      if (seen.has(identity)) continue;
      seen.add(identity);
    }
    picked.push(entry.card);
  }
  return picked;
}
