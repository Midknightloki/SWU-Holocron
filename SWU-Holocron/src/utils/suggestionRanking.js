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

const asArray = (v) => (Array.isArray(v) ? v : []);
const lower = (v) => String(v ?? '').trim().toLowerCase();

/**
 * Score a single candidate. Higher is better.
 */
function scoreCard(card, ctx) {
  const { deckAspectSet, deckTraitSet, ownedIds, setIndexOf, leaderIndex, deckTypeSet } = ctx;
  let score = 0;

  if (ownedIds.has(card.id)) score += W_OWNED;

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
    ownedIds: ownedIds instanceof Set ? ownedIds : new Set(ownedIds || []),
    setIndexOf,
    leaderIndex,
  };

  // Stable: ties fall back to the original order, so the same deck produces the
  // same prompt and the result does not shuffle between clicks.
  const ordered = cards
    .map((card, index) => ({ card, index, score: scoreCard(card, ctx) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));

  // One slot per distinct card. swu-db carries foil printings (a trailing F on
  // the number) and reprints across sets, so the same card can occupy several
  // slots -- against the live database the top of the ranking was
  // SOR_229 / SOR_229F / SOR_490 / SOR_490F, one card wearing four. Because the
  // list is already sorted, the first occurrence is the best-scoring printing,
  // which is also the owned one when the user has it.
  const seen = new Set();
  const picked = [];
  for (const entry of ordered) {
    if (picked.length >= limit) break;
    const name = lower(entry.card.name);
    if (name) {
      if (seen.has(name)) continue;
      seen.add(name);
    }
    picked.push(entry.card);
  }
  return picked;
}
