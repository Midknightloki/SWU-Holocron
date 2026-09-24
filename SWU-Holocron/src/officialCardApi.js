/**
 * Official site (starwarsunlimited.com) card-list query construction.
 *
 * Pure URL logic with no Vite-specific imports, so the Node scraper and the
 * test suite can both import it (same rule as cardData.js — see CLAUDE.md).
 *
 * WHY THIS EXISTS
 *
 * The scraper used to capture whatever /api/card-list request the site's own UI
 * fired on page load and reuse it, overriding only the pagination parameters.
 * That silently inherited the UI's default filters — in particular a
 * `type[id][$in]` list — which cut the result to a fraction of the catalog:
 *
 *   no filters ............................ 10031 cards (includes variants)
 *   variantOf null only ...................  3046 cards (canonical printings)
 *   variantOf null + the UI type filter ...   183 cards  <-- what we were getting
 *
 * Spread over 28 expansions that is roughly 6 cards per set, so reconciliation
 * ran against ~2% of the data while reporting success. Borrowing another
 * application's query means inheriting its filters, and those can change at any
 * time without warning. We build our own.
 *
 * @environment:none — pure functions, safe everywhere
 */

/** Fallback endpoint, used when nothing was captured from the page. */
export const OFFICIAL_CARD_LIST_ENDPOINT =
  'https://admin.starwarsunlimited.com/api/card-list';

/**
 * Largest page the API is asked for. 3046 canonical cards needs 16 pages at
 * this size; the previous 40 combined with a 30-page cap allowed only 1200,
 * which would have truncated the catalog even after the filter was fixed.
 */
export const MAX_PAGE_SIZE = 200;

/** Selects canonical printings, excluding alternate-art and reprint variants. */
const VARIANT_FILTER_KEY = 'filters[$and][0][variantOf][id][$null]';

/**
 * Build a card-list request URL.
 *
 * Only the origin and path of `capturedUrl` are reused — every query parameter
 * is discarded and rebuilt, so a filter change on the site cannot leak in.
 *
 * @param {string|null} capturedUrl URL observed from the page, or null
 * @param {{page:number, pageSize:number}} options
 * @returns {string}
 */
export function buildCardListUrl(capturedUrl, { page = 1, pageSize = MAX_PAGE_SIZE } = {}) {
  let base;
  try {
    base = new URL(capturedUrl || OFFICIAL_CARD_LIST_ENDPOINT);
  } catch {
    base = new URL(OFFICIAL_CARD_LIST_ENDPOINT);
  }

  // Keep the endpoint, discard the UI's query entirely.
  const url = new URL(`${base.origin}${base.pathname}`);

  const size = Math.min(Math.max(1, Number(pageSize) || MAX_PAGE_SIZE), MAX_PAGE_SIZE);

  url.searchParams.set('locale', 'en');
  url.searchParams.set(VARIANT_FILTER_KEY, 'true');
  url.searchParams.set('pagination[page]', String(Math.max(1, Number(page) || 1)));
  url.searchParams.set('pagination[pageSize]', String(size));

  return url.toString();
}
