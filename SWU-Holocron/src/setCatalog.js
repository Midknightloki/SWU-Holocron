/**
 * Set catalog normalisation.
 *
 * Pure data logic with no Vite-specific imports, so both the browser app and the
 * Node admin scripts can use it (same rule as cardData.js — see CLAUDE.md).
 *
 * Why this exists: the set list used to be hardcoded in six places, so the
 * seeder could only ever seed sets a human had typed in. Sets released a year
 * ago (IBH, TS26, ASH) were simply invisible. The swu-db API publishes a
 * catalog at /sets — including unreleased sets — so discovery replaces curation.
 *
 * The raw API shape is:
 *   { setId, fullName, numberCards, maxElement, isBaseSet?, releaseDate?, parentSetId? }
 *
 * @environment:none — pure functions, safe everywhere
 */

/**
 * Set codes that exist only in this app's history, never in the API.
 *
 * Collection documents are keyed `{SET}_{NUMBER}_{std|foil}`, so cards filed
 * under these codes would be orphaned if the codes stopped resolving. They are
 * kept as legacy buckets; real promos now arrive under their true codes
 * (SOROP, P26, HMWP, …).
 */
export const LEGACY_SET_CODES = ['PROMO', 'OTHER'];

/**
 * Parse the API's M/D/YY release date into an ISO `YYYY-MM-DD` string.
 *
 * @param {string|null|undefined} value
 * @returns {string|null} ISO date, or null when absent/unparseable
 */
export function parseReleaseDate(value) {
  if (!value || typeof value !== 'string') return null;

  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;

  const [, month, day, rawYear] = match;
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;

  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;

  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Normalise the /sets payload into the registry shape written to Firestore.
 *
 * Ordered by release date ascending, with undated sets (mostly promos) last and
 * sorted by code so the output is deterministic between runs — a registry that
 * reshuffles would produce a spurious diff on every sync.
 *
 * @param {unknown} payload raw API response
 * @returns {Array<{code:string,name:string,releaseDate:string|null,isBaseSet:boolean,cardCount:number|null,parentSetId:string|null}>}
 */
export function normalizeSetCatalog(payload) {
  if (!Array.isArray(payload)) return [];

  const seen = new Set();
  const sets = [];

  for (const raw of payload) {
    if (!raw || typeof raw !== 'object') continue;

    const code = typeof raw.setId === 'string' ? raw.setId.trim() : '';
    if (!code || seen.has(code)) continue;
    seen.add(code);

    sets.push({
      code,
      name: typeof raw.fullName === 'string' && raw.fullName.trim() ? raw.fullName.trim() : code,
      releaseDate: parseReleaseDate(raw.releaseDate),
      isBaseSet: raw.isBaseSet === true,
      cardCount: Number.isFinite(raw.numberCards) ? raw.numberCards : null,
      parentSetId: typeof raw.parentSetId === 'string' && raw.parentSetId ? raw.parentSetId : null,
    });
  }

  sets.sort((a, b) => {
    if (a.releaseDate && b.releaseDate) {
      if (a.releaseDate !== b.releaseDate) return a.releaseDate < b.releaseDate ? -1 : 1;
      return a.code < b.code ? -1 : 1;
    }
    if (a.releaseDate) return -1;
    if (b.releaseDate) return 1;
    return a.code < b.code ? -1 : 1;
  });

  return sets;
}

/**
 * Split a registry into base sets and promos for display.
 * `isBaseSet` comes straight from the API, so this costs nothing extra.
 *
 * @param {Array} registry
 * @returns {{baseSets: Array, promoSets: Array}}
 */
export function groupSetsForDisplay(registry) {
  const list = Array.isArray(registry) ? registry : [];
  return {
    baseSets: list.filter((s) => s.isBaseSet),
    promoSets: list.filter((s) => !s.isBaseSet),
  };
}
