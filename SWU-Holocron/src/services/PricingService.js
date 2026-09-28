import { db, APP_ID } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { lookupCardPrice } from '../tcgPrices';

/**
 * PricingService — card prices, read from Firestore.
 *
 * WHAT THIS REPLACED, AND WHY
 *
 * The previous version called `api.tcgapi.dev` once per card from the browser,
 * with an `X-API-Key` from `VITE_TCGAPI_KEY`, and cached each result as its own
 * Firestore document. Three things were wrong with that, and the missing key was
 * the least of them:
 *
 *  - That provider does not carry Star Wars Unlimited. Its public game list has
 *    50 entries and none of them is this game, so `?game=swu` could never have
 *    returned anything, key or no key.
 *  - No Firestore rule covers `public/data/priceCache/**`, and Firestore denies by
 *    default, so every cache write failed into a console warning. Prices would
 *    have been re-fetched on every render.
 *  - One request per card meant a fifty-card shopping list made fifty sequential
 *    requests from the browser.
 *
 * Prices now arrive with the weekly card sync, from TCGCSV, stored one document
 * per set beside that set's cards (`src/tcgPrices.js`, `scripts/cardDbSync.js`).
 * Nothing here talks to a pricing API, so there is no key, no CORS dependency, and
 * no per-card round trip: one read serves a whole set and is then memoised.
 *
 * Prices are always optional. Every method degrades to null or an empty result
 * rather than throwing, because a deck is still buildable without them.
 *
 * @environment:firebase
 */

/** setCode -> Promise<priceDoc|null>. Held for the page's lifetime. */
const setPriceCache = new Map();

export const PricingService = {
  /**
   * Prices for one set, or null when that set has none.
   *
   * Memoised per set, including the misses, so a set without prices is asked for
   * once rather than on every render.
   *
   * @param {string} setCode e.g. 'SOR'
   * @returns {Promise<object|null>}
   */
  getSetPrices: async (setCode) => {
    if (!setCode || !db || !APP_ID) return null;

    const code = String(setCode).toUpperCase();
    if (setPriceCache.has(code)) return setPriceCache.get(code);

    const pending = (async () => {
      try {
        const ref = doc(
          db,
          'artifacts', APP_ID,
          'public', 'data',
          'cardDatabase', 'sets',
          code, 'prices'
        );
        const snap = await getDoc(ref);
        return snap.exists() ? snap.data() : null;
      } catch (error) {
        console.warn(`PricingService: could not read prices for ${code}:`, error.message);
        return null;
      }
    })();

    setPriceCache.set(code, pending);
    return pending;
  },

  /**
   * Price for one card.
   *
   * @param {string} setCode
   * @param {string|number} cardNumber
   * @param {boolean} [isFoil]
   * @returns {Promise<{market, low, mid, high, productId, url, isFoil}|null>}
   */
  getCardPrice: async (setCode, cardNumber, isFoil = false) => {
    const priceDoc = await PricingService.getSetPrices(setCode);
    if (!priceDoc) return null;
    return lookupCardPrice(priceDoc, cardNumber, isFoil);
  },

  /**
   * Prices for many cards at once, keyed by the caller's own card id.
   *
   * Reads each distinct set once, not each card once.
   *
   * @param {Array<{cardId: string, set: string, number: string|number, isFoil?: boolean}>} cards
   * @returns {Promise<{[cardId]: priceData|null}>}
   */
  getBulkPrices: async (cards) => {
    if (!Array.isArray(cards) || cards.length === 0) return {};

    const setCodes = [...new Set(cards.map((c) => String(c?.set || '').toUpperCase()).filter(Boolean))];
    const docs = new Map();
    await Promise.all(
      setCodes.map(async (code) => {
        docs.set(code, await PricingService.getSetPrices(code));
      })
    );

    const results = {};
    for (const card of cards) {
      if (!card?.cardId) continue;
      const priceDoc = docs.get(String(card.set || '').toUpperCase());
      results[card.cardId] = priceDoc
        ? lookupCardPrice(priceDoc, card.number, card.isFoil === true)
        : null;
    }
    return results;
  },

  /**
   * Format a price as USD.
   *
   * @param {number|null} price
   * @returns {string} '$4.25', or 'N/A' when there is no number
   */
  formatPrice: (price) => {
    if (price === null || price === undefined || Number.isNaN(Number(price))) {
      return 'N/A';
    }
    return `$${parseFloat(price).toFixed(2)}`;
  },

  /**
   * Where to send someone who wants to buy the card.
   *
   * Prefers the exact product page, which comes from the price data, and falls
   * back to a search by name when the card has no price entry. This is also the
   * single place an affiliate parameter would go once that application clears.
   *
   * @param {string} cardName
   * @param {object|null} [priceData] the result of getCardPrice
   * @returns {string}
   */
  getTCGPlayerUrl: (cardName, priceData = null) => {
    if (priceData?.url) return priceData.url;

    const encoded = encodeURIComponent(cardName || '');
    return `https://www.tcgplayer.com/search/star-wars-unlimited/product?productLineName=star-wars-unlimited&q=${encoded}`;
  },

  /** Drop the memoised set documents. Only needed by tests. */
  _resetCache: () => {
    setPriceCache.clear();
  },
};
