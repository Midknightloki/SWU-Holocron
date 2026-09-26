/**
 * Card identity and base-printing selection.
 *
 * A card is identified by **name + subtitle**. Among printings sharing that
 * identity, the **lowest card number is the base printing**; higher numbers are
 * prestige and showcase variants, and a trailing letter marks a foil.
 *
 * Getting this wrong misleads twice over. Searching "Fett's Firespray: Feared
 * Silhouette" returned the prestige variant, and then reported it missing from
 * the collection — because the player owns the base printing, not the prestige.
 *
 * This lived in two places that disagreed with each other:
 *
 *   AdvancedSearch      used the right identity (name + subtitle) but kept the
 *                       first printing in filter order, not the lowest number
 *   suggestionRanking   de-duplicated by NAME ALONE, so two different cards
 *                       sharing a name collapsed into one
 *
 * One helper, so they cannot drift apart again.
 *
 * @environment:none — pure functions, safe everywhere
 */

const lower = (v) => String(v ?? '').trim().toLowerCase();

/** Field names differ between card records and prompt-shaped candidates. */
const nameOf = (card) => card?.Name ?? card?.name;
const subtitleOf = (card) => card?.Subtitle ?? card?.subtitle;

/** Set code, from a card record or the prefix of a composite id. */
const setOf = (card) => {
  if (card?.Set) return String(card.Set);
  const id = card?.id;
  if (typeof id === 'string' && id.includes('_')) return id.slice(0, id.indexOf('_'));
  return '';
};

/**
 * Card number, which may carry a foil or variant suffix.
 * Prompt-shaped candidates only have a composite id like "SOR_059F".
 */
const numberOf = (card) => {
  if (card?.Number !== undefined && card?.Number !== null) return card.Number;
  const id = card?.id;
  if (typeof id === 'string' && id.includes('_')) return id.slice(id.indexOf('_') + 1);
  return null;
};

/**
 * Identity of the card a printing represents: name + subtitle.
 *
 * @param {object} card
 * @returns {string}
 */
export function cardIdentity(card) {
  return `${lower(nameOf(card))}|${lower(subtitleOf(card))}`;
}

/**
 * Numeric value of a card number, ignoring any foil or variant suffix.
 *
 * Unparseable numbers sort LAST, so a malformed record can never be mistaken
 * for the base printing.
 *
 * @param {string|number|null|undefined} value
 * @returns {number}
 */
export function cardNumberValue(value) {
  if (value === null || value === undefined || value === '') return Number.MAX_SAFE_INTEGER;
  const match = String(value).trim().match(/^(\d+)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

/** True when a printing carries a foil/variant suffix after its number. */
const hasVariantSuffix = (card) => /^\d+\D/.test(String(numberOf(card) ?? '').trim());

/**
 * The base printing among several of the same card: lowest number, preferring
 * the non-foil when numbers tie.
 *
 * @param {Array} printings
 * @returns {object|null}
 */
export function pickBasePrinting(printings, { baseSetCodes } = {}) {
  if (!Array.isArray(printings) || printings.length === 0) return null;

  // Card numbers are only comparable WITHIN a set: a promo set numbers from 1,
  // so raw comparison across sets hands the base slot to the promo. Fett's
  // Firespray "Feared Silhouette" is JTL_240 in its base set and JTLOP_18 as an
  // OP promo, and 18 < 240.
  const known = baseSetCodes instanceof Set ? baseSetCodes : new Set(baseSetCodes || []);
  const fromBaseSet = (card) => known.size > 0 && known.has(setOf(card));

  return printings.reduce((best, candidate) => {
    const bestBase = fromBaseSet(best);
    const candidateBase = fromBaseSet(candidate);
    if (bestBase !== candidateBase) return candidateBase ? candidate : best;

    const bestValue = cardNumberValue(numberOf(best));
    const candidateValue = cardNumberValue(numberOf(candidate));
    if (candidateValue !== bestValue) return candidateValue < bestValue ? candidate : best;

    // Same number: the plain printing beats the foil.
    if (hasVariantSuffix(best) && !hasVariantSuffix(candidate)) return candidate;
    return best;
  });
}

/**
 * Reduce a list of printings to one entry per card, each the base printing.
 *
 * Identity order is preserved: a card keeps the position where it first
 * appeared, so an existing sort is not disturbed.
 *
 * @param {Array} cards
 * @returns {Array}
 */
export function dedupeToBasePrintings(cards, options = {}) {
  if (!Array.isArray(cards) || cards.length === 0) return [];

  const order = [];
  const byIdentity = new Map();

  for (const card of cards) {
    const identity = cardIdentity(card);
    if (!byIdentity.has(identity)) {
      byIdentity.set(identity, [card]);
      order.push(identity);
    } else {
      byIdentity.get(identity).push(card);
    }
  }

  return order.map((identity) => pickBasePrinting(byIdentity.get(identity), options));
}
