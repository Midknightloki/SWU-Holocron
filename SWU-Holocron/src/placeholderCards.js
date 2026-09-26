/**
 * Placeholder cards for cards we know exist but cannot describe.
 *
 * swu-db's set catalog states a card count per set. For three sets that count is
 * higher than what the cards endpoint actually returns, and the official site has
 * no data for them either. Verify treats the gap as a failure, which in CI means
 * a red run and an auto-filed issue every night, forever, for something upstream
 * that nobody here can fix.
 *
 * Suppressing the gap would hide real data loss. So where the catalog says a card
 * exists and no source can describe it, we record a placeholder instead and let
 * the community fill it in through the existing card submission flow.
 *
 * WHY RELEASE DATE IS LOAD-BEARING
 *
 * Measured against the live API on 2026-09-26, the three short sets are not the
 * same kind of problem:
 *
 *   SOROPJ  want 2    got 0    no releaseDate, parent SOR (2024-03-08)
 *   CST     want 3    got 2    released 2026-09-15
 *   IC27    want 194  got 9    releases 2026-11-20
 *
 * SOROPJ and CST are genuinely missing: released product, absent data. IC27 is
 * simply unspoiled -- 9 of 194 cards revealed for a set two months out. Emitting
 * placeholders there would manufacture 185 fake cards for a set nobody has seen,
 * and would do it again, differently, every week as more are revealed.
 *
 * So placeholders are only ever created for a set that has actually been
 * released. A set whose release date is in the future is `awaiting-release`,
 * which is a normal state and not a problem to report.
 *
 * @environment:none — pure functions, Node-safe, no Firebase
 */

import { normalizeCardNumber } from './cardReconcile.js';
import { parseReleaseDate } from './setCatalog.js';

/** Marks a card record as a placeholder rather than real data. */
export const PLACEHOLDER_FLAG = 'isPlaceholder';

export const PLACEHOLDER_TEXT =
  'This card is listed in the set catalogue, but no data source describes it. ' +
  'Submit it to complete the database.';

/**
 * Has this set been released?
 *
 * A set with no release date of its own inherits its parent's — that is the
 * promo case, and it is the whole reason SOROPJ counts as released: it has no
 * date, but it promotes a set from 2024.
 *
 * A set with no date and no datable parent is treated as released. Those are
 * long-standing promo buckets; withholding placeholders from them would be the
 * conservative-looking choice that quietly loses the cards.
 *
 * @param {object} set normalized catalog entry ({ code, releaseDate, parentSetId })
 * @param {Array} catalog the full normalized catalog, for parent lookup
 * @param {number|Date} [now]
 * @returns {boolean}
 */
export function isSetReleased(set, catalog = [], now = Date.now()) {
  if (!set) return false;

  const today = new Date(now).toISOString().slice(0, 10);
  const own = set.releaseDate || null;
  if (own) return own <= today;

  const parentId = set.parentSetId ? String(set.parentSetId).toUpperCase() : null;
  if (parentId) {
    const parent = catalog.find((s) => String(s.code).toUpperCase() === parentId);
    const parentDate = parent?.releaseDate || parseReleaseDate(parent?.releaseDate) || null;
    if (parentDate) return parentDate <= today;
  }

  // No date anywhere. An old promo bucket, not an unannounced set.
  return true;
}

/**
 * How many cards the catalog claims this set has.
 *
 * `numberCards` and `maxElement` disagree in format (`"002"` vs `"3"`) and
 * occasionally in value, so take the larger: a set cannot have fewer cards than
 * its highest card number.
 *
 * @returns {number} 0 when the catalog says nothing usable
 */
export function expectedCardCount(set) {
  const declared = Number(set?.cardCount ?? set?.numberCards ?? 0) || 0;
  const highest = parseInt(String(set?.maxElement ?? '').replace(/\D/g, ''), 10) || 0;
  return Math.max(declared, highest);
}

/**
 * Which card numbers the catalog implies but the fetched cards do not cover.
 *
 * Only numbers inside the expected range are considered. A set whose real cards
 * carry numbers above the count (variants, alternate printings) does not get
 * placeholders invented past the end.
 *
 * @param {object} set normalized catalog entry
 * @param {Array} cards whatever the sources returned for the set
 * @returns {string[]} zero-padded numbers, ascending
 */
export function missingCardNumbers(set, cards = []) {
  const expected = expectedCardCount(set);
  if (expected <= 0) return [];

  const present = new Set(
    (Array.isArray(cards) ? cards : [])
      .map((c) => normalizeCardNumber(c?.Number ?? c?.number))
      .filter(Boolean)
  );

  const missing = [];
  for (let n = 1; n <= expected; n += 1) {
    const number = normalizeCardNumber(n);
    if (!present.has(number)) missing.push(number);
  }
  return missing;
}

/**
 * A single placeholder record, shaped like a card so nothing downstream has to
 * special-case it to render.
 *
 * Everything it does not know is null or empty rather than guessed. A placeholder
 * claiming to be a Unit costing 3 would be worse than no placeholder at all.
 * Identity is name + subtitle everywhere in this app, so the subtitle carries the
 * set and number and each placeholder stays distinct.
 */
export function buildPlaceholderCard(setCode, number) {
  const code = String(setCode || '').toUpperCase();
  const num = normalizeCardNumber(number);

  return {
    Set: code,
    Number: num,
    Name: 'Unknown Card',
    Subtitle: `${code} ${num}`,
    Type: null,
    Cost: null,
    Aspects: [],
    Traits: [],
    Keywords: [],
    Arenas: [],
    Rarity: null,
    FrontText: PLACEHOLDER_TEXT,
    BackText: null,
    [PLACEHOLDER_FLAG]: true,
    placeholderReason: 'catalog-shortfall',
  };
}

/**
 * Placeholders for one set, or none.
 *
 * @param {object} args
 * @param {object} args.set normalized catalog entry
 * @param {Array} args.cards what the sources returned
 * @param {Array} [args.catalog] full catalog, for parent release lookup
 * @param {number|Date} [args.now]
 * @returns {Array} placeholder card records
 */
export function placeholdersForSet({ set, cards = [], catalog = [], now = Date.now() }) {
  if (!set?.code) return [];
  if (!isSetReleased(set, catalog, now)) return [];

  return missingCardNumbers(set, cards).map((number) =>
    buildPlaceholderCard(set.code, number)
  );
}

/**
 * What state a set's data is in, so verify can report honestly without failing
 * over something upstream.
 *
 * - `complete` — every card the catalog implies is present, and real
 * - `complete-with-placeholders` — the gap is filled by placeholders awaiting
 *   submission. Informational: the database knows what it does not know.
 * - `awaiting-release` — short, but the set is not out yet. Normal.
 * - `incomplete` — short, released, and not placeheld. This is a real problem.
 * - `unknown` — the catalog gives no count to check against.
 *
 * @returns {{status: string, expected: number, real: number, placeholders: number, missing: number}}
 */
export function classifySetCompleteness({ set, cards = [], catalog = [], now = Date.now() }) {
  const expected = expectedCardCount(set);
  const all = Array.isArray(cards) ? cards : [];
  const placeholders = all.filter((c) => c?.[PLACEHOLDER_FLAG] === true).length;
  const real = all.length - placeholders;

  if (expected <= 0) {
    return { status: 'unknown', expected, real, placeholders, missing: 0 };
  }

  const missing = Math.max(0, expected - all.length);

  if (missing === 0) {
    return {
      status: placeholders > 0 ? 'complete-with-placeholders' : 'complete',
      expected,
      real,
      placeholders,
      missing,
    };
  }

  if (!isSetReleased(set, catalog, now)) {
    return { status: 'awaiting-release', expected, real, placeholders, missing };
  }

  return { status: 'incomplete', expected, real, placeholders, missing };
}

/** Does this status warrant failing a sync or verify run? */
export function isFailingStatus(status) {
  return status === 'incomplete';
}

/**
 * Bring a set's card list in line with what is currently knowable.
 *
 * Idempotent, and that is the point: it discards every existing placeholder
 * first, then re-derives them from the real cards. So a placeholder disappears by
 * itself once the card it stood in for arrives — whether from an upstream fix or
 * an accepted community submission — without anything having to track which
 * placeholder corresponded to which submission.
 *
 * @param {object} args see placeholdersForSet
 * @returns {{cards: Array, added: string[], removed: string[], real: number}}
 *   `added` and `removed` are card numbers, for logging.
 */
export function applyPlaceholders({ set, cards = [], catalog = [], now = Date.now() }) {
  const all = Array.isArray(cards) ? cards : [];
  const existing = all.filter((c) => c?.[PLACEHOLDER_FLAG] === true);
  const real = all.filter((c) => c?.[PLACEHOLDER_FLAG] !== true);

  const wanted = placeholdersForSet({ set, cards: real, catalog, now });

  const existingNumbers = new Set(existing.map((c) => normalizeCardNumber(c.Number)));
  const wantedNumbers = new Set(wanted.map((c) => normalizeCardNumber(c.Number)));

  const added = [...wantedNumbers].filter((n) => !existingNumbers.has(n));
  const removed = [...existingNumbers].filter((n) => !wantedNumbers.has(n));

  return {
    cards: [...real, ...wanted],
    added,
    removed,
    real: real.length,
  };
}
