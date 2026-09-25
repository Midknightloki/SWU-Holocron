/**
 * Reconciliation between the swu-db API and the official site.
 *
 * Pure logic, no Vite-specific imports, so the Node pipeline and the test suite
 * can both use it (same rule as cardData.js — see CLAUDE.md).
 *
 * The official site is the source of truth for card text and stats; swu-db
 * supplies breadth. Where the official site has a card swu-db lacks, it is
 * added — that fallback is the whole reason the scrape exists.
 *
 * TWO DEFECTS THIS MODULE FIXES
 *
 * 1. Match key. swu-db zero-pads numbers to three digits and stores them as
 *    strings ("005", "059F"); the official site returns unpadded integers (5).
 *    Keying on raw values meant "005" never matched 5, so cards 1-99 in every
 *    set skipped reconciliation entirely and 956 cards looked like holes when
 *    they were duplicates waiting to happen. The app already treats this
 *    padding as load-bearing in getCollectionId; reconciliation now agrees.
 *
 * 2. Comparison. Fields were compared with ===, so "7" vs 7 and
 *    ["IMPERIAL"] vs ["Imperial"] registered as corrections. That rewrote the
 *    database on every run without ever converging, and buried the ~150 real
 *    differences in ~14,000 spurious ones.
 *
 * @environment:none — pure functions, safe everywhere
 */

/**
 * Normalise a card number for comparison: pad the numeric part to three digits
 * and upper-case any variant suffix.
 *
 * @param {string|number|null|undefined} value
 * @returns {string} normalised number, or '' when unusable
 */
export function normalizeCardNumber(value) {
  if (value === null || value === undefined) return '';

  const raw = String(value).trim().toUpperCase();
  if (!raw) return '';

  const match = raw.match(/^(\d+)(.*)$/);
  if (!match) return raw;

  const [, digits, suffix] = match;
  return `${digits.padStart(3, '0')}${suffix}`;
}

/**
 * Key used to match a swu-db card against an official one.
 *
 * A variant suffix is stripped, so a foil printing matches its base card and
 * inherits the same corrections — swu-db carries 436 foil entries for SOR alone
 * and the official site has none.
 *
 * @param {string} setCode
 * @param {string|number} number
 * @returns {string}
 */
export function cardMatchKey(setCode, number) {
  const normalized = normalizeCardNumber(number);
  const base = normalized.replace(/[^0-9].*$/, '');
  return `${String(setCode || '').trim().toUpperCase()}_${base}`;
}

const isAbsent = (v) => v === null || v === undefined || v === '';

/**
 * Token cards (Experience, Shield) are numbered 1 and 2 by the official site
 * *within each set*, colliding with the real cards 1 and 2 -- usually leaders.
 * They cannot be matched by Set+Number, so they are excluded from
 * reconciliation rather than allowed to hijack a real card.
 */
export const isTokenCard = (card) => String(card?.Type || '').trim().toLowerCase().startsWith('token');

/**
 * Compare two field values for *semantic* equality.
 *
 * Deliberately tolerant of representation (numeric strings, letter case,
 * surrounding whitespace) and deliberately strict about everything else:
 * different text, different numbers, different list contents and different list
 * order all remain differences. Booleans are never equated with numbers.
 *
 * @returns {boolean}
 */
export function valuesEqual(a, b) {
  if (a === b) return true;
  if (isAbsent(a) && isAbsent(b)) return true;
  if (isAbsent(a) || isAbsent(b)) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, i) => valuesEqual(item, b[i]));
  }

  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;

  // "7" and 7 are the same cost; "7" and 70 are not.
  const numA = typeof a === 'number' ? a : (String(a).trim() !== '' && !Number.isNaN(Number(a)) ? Number(a) : null);
  const numB = typeof b === 'number' ? b : (String(b).trim() !== '' && !Number.isNaN(Number(b)) ? Number(b) : null);
  if (numA !== null && numB !== null) return numA === numB;

  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/**
 * Reconcile one set.
 *
 * Returns new card objects; the caller's arrays are not mutated.
 *
 * @param {{setCode:string, apiCards:Array, officialCards:Array, fields:string[]}} input
 * @returns {{cards:Array, overrides:Array, added:Array, refused:Array}}
 */
export function reconcileSet({ setCode, apiCards = [], officialCards = [], fields = [] }) {
  const overrides = [];
  const added = [];
  const refused = [];

  const officialIndex = new Map();
  for (const card of officialCards) {
    if (isTokenCard(card)) continue;
    const key = cardMatchKey(card.Set || setCode, card.Number);
    // First entry wins: a later collision must never silently replace an
    // already-indexed card.
    if (!officialIndex.has(key)) officialIndex.set(key, card);
  }

  const matchedOfficialKeys = new Set();

  const cards = apiCards.map((apiCard) => {
    const key = cardMatchKey(apiCard.Set || setCode, apiCard.Number);
    const officialCard = officialIndex.get(key);
    if (!officialCard) return apiCard;

    matchedOfficialKeys.add(key);

    let updated = apiCard;
    for (const field of fields) {
      if (!(field in officialCard)) continue;
      if (valuesEqual(apiCard[field], officialCard[field])) continue;

      // Official is authoritative for fields it actually HAS. An absent value
      // is not an authoritative "no" -- the scraper once coerced missing data
      // into false/null/'' and destroyed 667 real values per run. Refusals are
      // reported rather than silently skipped, so a mapping regression is
      // visible instead of invisible. An empty array or a zero is a value, not
      // an absence.
      if (isAbsent(officialCard[field]) && !isAbsent(apiCard[field])) {
        refused.push({
          set: setCode,
          number: apiCard.Number,
          field,
          keptValue: apiCard[field],
          reason: 'official value absent',
        });
        continue;
      }

      if (updated === apiCard) updated = { ...apiCard };
      overrides.push({
        set: setCode,
        number: apiCard.Number,
        field,
        apiValue: apiCard[field],
        officialValue: officialCard[field],
      });
      updated[field] = officialCard[field];
    }
    return updated;
  });

  // Anything the official site has that swu-db does not is a genuine hole.
  // After key normalisation these are real; before it, there were 956 false ones.
  for (const [key, officialCard] of officialIndex) {
    if (matchedOfficialKeys.has(key)) continue;
    const card = { ...officialCard, Set: officialCard.Set || setCode, source: 'official-site' };
    added.push(card);
    cards.push(card);
  }

  return { cards, overrides, added, refused };
}
