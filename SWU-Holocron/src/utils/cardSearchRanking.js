/**
 * Relevance ordering for card search results.
 *
 * The search always matched substrings correctly — "trooper" really did match
 * "Death Star Stormtrooper". What was missing was any notion of relevance:
 * results came back sorted alphabetically, and a trait match ranked exactly as
 * highly as a name match. Against the live database "trooper" returns 29 cards
 * by name and 178 by trait, so the cards the player asked for were scattered
 * among six times as many they did not.
 *
 * Deck building means running this 30-50 times per deck, so where the right
 * card lands in the list is the whole experience.
 *
 * @environment:none — pure functions, safe everywhere
 */

const S_NAME_EXACT = 1000;
const S_NAME_PREFIX = 800;
const S_NAME_WORD_START = 600;
const S_NAME_CONTAINS = 400;
const S_SUBTITLE = 200;
const S_TRAIT_OR_KEYWORD = 100;
const S_TEXT = 50;

const lower = (v) => String(v ?? '').toLowerCase();
const asArray = (v) => (Array.isArray(v) ? v : []);

/**
 * Does any word in `haystack` begin with `needle`?
 * Distinguishes "Death Trooper" from "Stormtrooper" for the query "trooper".
 */
function hasWordStartingWith(haystack, needle) {
  if (!haystack || !needle) return false;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    const before = index === 0 ? ' ' : haystack[index - 1];
    if (!/[a-z0-9]/.test(before)) return true;
    index = haystack.indexOf(needle, index + 1);
  }
  return false;
}

/**
 * Score one card against a query. Higher is more relevant.
 */
function scoreCard(card, query) {
  const name = lower(card?.Name);

  if (name === query) return S_NAME_EXACT;
  if (name.startsWith(query)) return S_NAME_PREFIX;
  if (hasWordStartingWith(name, query)) return S_NAME_WORD_START;
  if (name.includes(query)) return S_NAME_CONTAINS;

  if (lower(card?.Subtitle).includes(query)) return S_SUBTITLE;

  const tagged = [...asArray(card?.Traits), ...asArray(card?.Keywords), ...asArray(card?.Arenas)];
  if (tagged.some((t) => lower(t).includes(query))) return S_TRAIT_OR_KEYWORD;

  if (lower(card?.FrontText).includes(query) || lower(card?.BackText).includes(query)) {
    return S_TEXT;
  }

  return 0;
}

/**
 * Order already-filtered search results by relevance to the query.
 *
 * Does not filter: every card passed in comes back, only reordered. Callers
 * have already decided what matches; this decides what the player sees first.
 *
 * @param {Array} cards results from the existing filter
 * @param {string} query the raw search text
 * @returns {Array} the same cards, most relevant first, ties alphabetical
 */
export function rankSearchResults(cards, query) {
  if (!Array.isArray(cards) || cards.length === 0) return [];

  const byName = (a, b) => lower(a?.Name).localeCompare(lower(b?.Name));
  const q = lower(query).trim();
  if (!q) return [...cards].sort(byName);

  return [...cards]
    .map((card) => ({ card, score: scoreCard(card, q) }))
    .sort((a, b) => (b.score - a.score) || byName(a.card, b.card))
    .map((entry) => entry.card);
}
