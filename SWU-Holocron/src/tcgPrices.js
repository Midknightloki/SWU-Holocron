/**
 * Card prices from TCGCSV.
 *
 * WHY NOT TCGPLAYER DIRECTLY
 *
 * TCGplayer closed its API to new applicants in late 2024 — "We are no longer
 * granting new API access at this time." Their affiliate programme is a separate
 * thing and does not grant data access. TCGCSV is a free public mirror of
 * TCGplayer's own catalogue and pricing, refreshed daily around 20:00 UTC, with
 * no key and no application.
 *
 * It does publish usage guidelines (https://tcgcsv.com/docs#usage-guidelines) and
 * they shape this design rather than merely permitting it:
 *
 *  - A descriptive `User-Agent` is mandatory. A generic one is blocked outright,
 *    which is how the first dry run of this failed -- Node's default is refused.
 *  - Browser requests are blocked by CORS. The operator states the data "is
 *    intended to be pulled by back-end scripts or server-side applications" and
 *    asks that it be stored in your own database rather than fetched from
 *    user-facing code. That is exactly what the sync step and the per-set
 *    Firestore documents do; a client-side version was never possible.
 *  - At most 10,000 requests per 24 hours, 100ms apart. A full refresh here is
 *    about 51 requests.
 *  - The data rebuilds once a day, so `last-updated.txt` should be checked first
 *    and a sync skipped when nothing has changed.
 *
 * It still depends on one operator's TCGplayer key, so it remains a single point
 * of failure we are accepting knowingly. Everything is confined to this module and
 * the sync step, so replacing the provider means rewriting one file.
 *
 * WHAT MAKES THE MAPPING WORK
 *
 * Products carry the card number in `extendedData`, so a price maps to one of our
 * cards by number rather than by name — no fuzzy matching, and variants do not
 * collide. Verified against Spark of Rebellion: all 510 numbers TCGCSV publishes
 * matched a swu-db number exactly, none missed.
 *
 * Foils differ between the two sources and this is the one subtlety. swu-db lists
 * a foil as a separate card with an `F` suffix (`059F`); TCGCSV lists one product
 * (`059`) with a `Normal` and a `Foil` price row. So `059F` resolves to the foil
 * price of `059`, and so does the `_foil` half of our own collection key.
 *
 * @environment:none — pure functions, Node-safe, no Firebase
 */

/** Star Wars Unlimited on TCGplayer. Verified against /tcgplayer/categories. */
export const SWU_CATEGORY_ID = 79;

const BASE = 'https://tcgcsv.com/tcgplayer';

/**
 * Identifies this application to TCGCSV, which their guidelines require and
 * which they enforce: a generic User-Agent is refused with a plain-text scolding
 * rather than JSON, so the failure looks like a parse error.
 *
 * Kept in step with package.json by hand. A wrong patch number is harmless; a
 * missing header is not.
 */
export const USER_AGENT = 'SWU-Holocron/1.0.1';

/** Headers every TCGCSV request must carry. */
export function buildRequestHeaders() {
  return { 'User-Agent': USER_AGENT, Accept: 'application/json' };
}

/**
 * The build timestamp of the data, as plain text.
 *
 * Checked before a sync: the mirror rebuilds once a day, and re-pulling 50 files
 * that have not changed is exactly what the guidelines ask callers not to do.
 */
export function buildLastUpdatedUrl() {
  return 'https://tcgcsv.com/last-updated.txt';
}

export function buildCategoriesUrl() {
  return `${BASE}/categories`;
}

export function buildGroupsUrl(categoryId = SWU_CATEGORY_ID) {
  return `${BASE}/${categoryId}/groups`;
}

export function buildProductsUrl(groupId, categoryId = SWU_CATEGORY_ID) {
  return `${BASE}/${categoryId}/${groupId}/products`;
}

export function buildPricesUrl(groupId, categoryId = SWU_CATEGORY_ID) {
  return `${BASE}/${categoryId}/${groupId}/prices`;
}

/** TCGCSV wraps everything in `results`; tolerate a bare array too. */
export function unwrap(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

/** Read one named field out of a product's extendedData. */
export function extendedValue(product, fieldName) {
  const found = (product?.extendedData || []).find((e) => e?.name === fieldName);
  return found ? String(found.value) : null;
}

/**
 * The card number a TCGCSV product refers to, in our zero-padded form.
 *
 * Four formats occur in the live data, all from Spark of Rebellion alone:
 *
 *   '008/252'    252 of them — number out of set size
 *   '285'        258 of them — variants numbered past the base set
 *   '29 // T02'   32 of them — a card packaged with a token
 *   'T1 // T02'    2 of them — a token, which is not a card we track
 *
 * Taking the text before the first `/` handles all four: the token formats fall
 * out because `T1` is not numeric.
 *
 * @param {string|null} raw the extendedData Number value
 * @returns {string|null} '008', or null when this is not one of our cards
 */
export function parseProductNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const head = String(raw).split('/')[0].trim();
  if (!/^\d+$/.test(head)) return null;
  return head.padStart(3, '0');
}

/**
 * Which price a card number wants: the base number, and whether it is the foil.
 *
 * `059F` is swu-db's way of writing the foil of `059`. TCGCSV has no such
 * product, so the suffix has to be resolved here.
 *
 * @param {string|number} cardNumber a number from our card data
 * @param {boolean} [isFoil] the foil flag from a collection key
 * @returns {{number: string, foil: boolean}|null}
 */
export function priceKeyForCard(cardNumber, isFoil = false) {
  if (cardNumber === null || cardNumber === undefined) return null;
  const raw = String(cardNumber).trim().toUpperCase();
  if (!raw) return null;

  const match = raw.match(/^(\d+)(F?)$/);
  if (!match) return null;

  return {
    number: match[1].padStart(3, '0'),
    foil: isFoil || match[2] === 'F',
  };
}

function normalizePriceRow(row) {
  const value = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    market: value(row?.marketPrice),
    low: value(row?.lowPrice),
    mid: value(row?.midPrice),
    high: value(row?.highPrice),
  };
}

/** Does this entry carry any usable number at all? */
function hasAnyPrice(prices) {
  return Object.values(prices || {}).some((v) => v !== null);
}

/**
 * Fold products and price rows into one map keyed by card number.
 *
 * Products without a card number — sealed boxes, displays, tokens — are dropped:
 * this app prices singles. A product with no price row at all is dropped too,
 * rather than stored as an entry full of nulls.
 *
 * @param {Array} products from buildProductsUrl
 * @param {Array} priceRows from buildPricesUrl
 * @returns {{cards: object, skipped: number}} cards keyed '008' -> entry
 */
export function buildPriceMap(products, priceRows) {
  const rowsByProduct = new Map();
  for (const row of unwrap(priceRows)) {
    if (!row?.productId) continue;
    if (!rowsByProduct.has(row.productId)) rowsByProduct.set(row.productId, []);
    rowsByProduct.get(row.productId).push(row);
  }

  const cards = {};
  let skipped = 0;

  for (const product of unwrap(products)) {
    const number = parseProductNumber(extendedValue(product, 'Number'));
    if (!number) {
      skipped += 1;
      continue;
    }

    const rows = rowsByProduct.get(product.productId) || [];
    const entry = { productId: product.productId };
    if (product.url) entry.url = product.url;

    for (const row of rows) {
      const prices = normalizePriceRow(row);
      if (!hasAnyPrice(prices)) continue;
      if (row.subTypeName === 'Foil') entry.foil = prices;
      else if (row.subTypeName === 'Normal') entry.std = prices;
    }

    if (!entry.std && !entry.foil) {
      skipped += 1;
      continue;
    }

    // A number can appear twice across a set only if TCGplayer splits a printing.
    // Keep the lower productId, which is the earlier listing, for stability
    // between runs rather than letting fetch order decide.
    const existing = cards[number];
    if (!existing || product.productId < existing.productId) {
      cards[number] = entry;
    }
  }

  return { cards, skipped };
}

/**
 * Pair our set codes with TCGCSV groups.
 *
 * TCGCSV's `abbreviation` already matches our internal code for the sets that
 * matter — 14 of them, covering 87% of catalogued cards. The rest are promo,
 * judge and showcase sets whose abbreviations differ (`SOR-WPP`, `JDG`, `OPP`);
 * `aliases` exists for those, so they can be added one at a time without
 * touching this function.
 *
 * @param {Array} groups from buildGroupsUrl
 * @param {string[]} setCodes our set codes
 * @param {object} [aliases] our code -> TCGCSV abbreviation
 * @returns {{matched: Array<{setCode: string, groupId: number, name: string}>, unmatched: string[]}}
 */
export function matchGroupsToSets(groups, setCodes = [], aliases = {}) {
  const byAbbr = new Map();
  for (const group of unwrap(groups)) {
    const abbr = String(group?.abbreviation || '').trim().toUpperCase();
    if (abbr && group?.groupId) byAbbr.set(abbr, group);
  }

  const matched = [];
  const unmatched = [];

  // A default parameter only covers `undefined`, and callers pass through
  // whatever a Firestore read gave them, which can be null.
  for (const raw of Array.isArray(setCodes) ? setCodes : []) {
    const code = String(raw || '').trim().toUpperCase();
    if (!code) continue;

    const wanted = String(aliases[code] || code).toUpperCase();
    const group = byAbbr.get(wanted);
    if (group) {
      matched.push({ setCode: code, groupId: group.groupId, name: group.name || code });
    } else {
      unmatched.push(code);
    }
  }

  return { matched, unmatched };
}

/**
 * Look one card's prices up in a stored set price document.
 *
 * Not every card has both printings. Across Spark of Rebellion, 436 of 510 have
 * both, 58 are standard-only and 16 are foil-only. So a request can be answered
 * with the printing that was not asked for, and the result has to say so --
 * foils are not priced the same as standards (one SOR card sits at 0.27 standard
 * against 0.45 foil), and a foil row quietly showing a standard price would
 * mislead someone about to spend money.
 *
 * `printing` is therefore what the numbers actually are, and `isFallback` says
 * the other printing was asked for and not available. `isFoil` describes the
 * numbers, not the request.
 *
 * @param {object} priceDoc the document written by the sync step
 * @param {string|number} cardNumber
 * @param {boolean} [wantFoil]
 * @returns {{market, low, mid, high, productId, url, printing, isFoil, isFallback}|null}
 */
export function lookupCardPrice(priceDoc, cardNumber, wantFoil = false) {
  const key = priceKeyForCard(cardNumber, wantFoil);
  if (!key) return null;

  const entry = priceDoc?.cards?.[key.number];
  if (!entry) return null;

  const wanted = key.foil ? entry.foil : entry.std;
  const other = key.foil ? entry.std : entry.foil;

  // Showing the other printing beats showing nothing -- it is still roughly what
  // the card costs -- but only when the caller can tell that is what happened.
  const prices = wanted || other;
  if (!prices) return null;

  const printing = wanted ? (key.foil ? 'foil' : 'std') : (key.foil ? 'std' : 'foil');

  return {
    ...prices,
    productId: entry.productId,
    url: entry.url || null,
    printing,
    isFoil: printing === 'foil',
    isFallback: !wanted,
  };
}
