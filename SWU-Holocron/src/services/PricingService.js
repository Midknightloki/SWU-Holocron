import { db, APP_ID } from '../firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

const TCGAPI_BASE = 'https://api.tcgapi.dev/v1';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const RATE_LIMIT_DELAY = 100; // Delay between API calls to respect rate limits

/**
 * PricingService — Fetch and cache card prices from tcgapi.dev
 *
 * Strategy:
 * 1. Check Firestore cache first (fast, reduces API calls)
 * 2. If cache miss or stale (>7 days), call tcgapi.dev API
 * 3. Write fresh data to Firestore cache
 * 4. Return priceData object with marketPrice, lowPrice, highPrice
 *
 * API Key: Read from import.meta.env.VITE_TCGAPI_KEY
 * Cache Path: /artifacts/{APP_ID}/public/data/priceCache/{cardId}
 */
export const PricingService = {
  /**
   * Get price for a single card
   * @param {string} cardId - Card ID in format 'SOR_008'
   * @param {string} cardName - Card name for API lookup 'Hera Syndulla'
   * @returns {Promise<{marketPrice, lowPrice, highPrice, currency, source, tcgplayerUrl, fromCache} | null>}
   */
  getCardPrice: async (cardId, cardName) => {
    if (!cardId || !cardName) {
      console.warn('PricingService: Missing cardId or cardName');
      return null;
    }

    try {
      // Step 1: Check Firestore cache
      const cached = await PricingService._getCachedPrice(cardId);
      if (cached) {
        console.log(`✓ Price cache hit for ${cardId}`);
        return { ...cached, fromCache: true };
      }

      // Step 2: Fetch from API
      const apiKey = import.meta.env.VITE_TCGAPI_KEY;
      if (!apiKey) {
        console.warn('PricingService: VITE_TCGAPI_KEY not set, skipping API call');
        return null;
      }

      const priceData = await PricingService._fetchPriceFromApi(cardName, apiKey);
      if (!priceData) {
        console.warn(`PricingService: No price data found for ${cardName}`);
        return null;
      }

      // Step 3: Cache the result
      await PricingService._cachePrice(cardId, priceData);

      return { ...priceData, fromCache: false };
    } catch (error) {
      console.error(`PricingService: Error fetching price for ${cardId}:`, error);
      return null;
    }
  },

  /**
   * Get prices for multiple cards
   * @param {Array<{cardId, cardName}>} cards - Array of cards to price
   * @returns {Promise<{[cardId]: priceData | null}>}
   */
  getBulkPrices: async (cards) => {
    if (!Array.isArray(cards) || cards.length === 0) {
      return {};
    }

    const results = {};

    // Fetch prices sequentially with delay to respect rate limits
    for (const { cardId, cardName } of cards) {
      const priceData = await PricingService.getCardPrice(cardId, cardName);
      results[cardId] = priceData;

      // Rate limiting: wait before next API call (only if we actually hit the API)
      if (priceData && !priceData.fromCache) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
      }
    }

    return results;
  },

  /**
   * Format price as USD string
   * @param {number} price - Price to format
   * @returns {string} Formatted price like '$4.25' or 'N/A'
   */
  formatPrice: (price) => {
    if (price === null || price === undefined) {
      return 'N/A';
    }
    return `$${parseFloat(price).toFixed(2)}`;
  },

  /**
   * Build TCGplayer search URL for a card
   * @param {string} cardName - Card name to search
   * @returns {string} TCGplayer search URL
   */
  getTCGPlayerUrl: (cardName) => {
    const encoded = encodeURIComponent(cardName);
    return `https://www.tcgplayer.com/search/star-wars-unlimited/product?productLineName=star-wars-unlimited&q=${encoded}`;
  },

  /**
   * Internal: Get cached price from Firestore
   * @private
   */
  _getCachedPrice: async (cardId) => {
    if (!db || !APP_ID) {
      return null;
    }

    try {
      const cacheRef = doc(
        db,
        'artifacts',
        APP_ID,
        'public',
        'data',
        'priceCache',
        cardId
      );
      const snapshot = await getDoc(cacheRef);

      if (!snapshot.exists()) {
        return null;
      }

      const data = snapshot.data();
      const age = Date.now() - data.cachedAt?.toMillis?.();

      // Check if cache is still valid (< 7 days)
      if (age < CACHE_TTL) {
        return {
          marketPrice: data.marketPrice,
          lowPrice: data.lowPrice,
          highPrice: data.highPrice,
          currency: data.currency || 'USD',
          source: 'priceCache',
          tcgplayerUrl: data.tcgplayerUrl
        };
      }
    } catch (error) {
      console.warn(`PricingService: Cache read failed for ${cardId}:`, error.message);
    }

    return null;
  },

  /**
   * Internal: Fetch price from tcgapi.dev API
   * @private
   */
  _fetchPriceFromApi: async (cardName, apiKey) => {
    try {
      const url = `${TCGAPI_BASE}/cards?game=swu&name=${encodeURIComponent(cardName)}`;

      const response = await fetch(url, {
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.warn(`PricingService: API returned ${response.status} for ${cardName}`);
        return null;
      }

      const data = await response.json();

      // Handle array response or object response with data property
      const cards = Array.isArray(data) ? data : (data.data || []);

      if (!Array.isArray(cards) || cards.length === 0) {
        return null;
      }

      // Use first matching card
      const card = cards[0];

      // Extract pricing (API response structure: marketPrice, lowPrice, highPrice)
      const priceData = {
        marketPrice: card.marketPrice || null,
        lowPrice: card.lowPrice || null,
        highPrice: card.highPrice || null,
        currency: 'USD',
        source: 'tcgapi.dev',
        tcgplayerUrl: PricingService.getTCGPlayerUrl(cardName)
      };

      return priceData;
    } catch (error) {
      console.error(`PricingService: API fetch failed for ${cardName}:`, error.message);
      return null;
    }
  },

  /**
   * Internal: Cache price in Firestore
   * @private
   */
  _cachePrice: async (cardId, priceData) => {
    if (!db || !APP_ID) {
      return;
    }

    try {
      const cacheRef = doc(
        db,
        'artifacts',
        APP_ID,
        'public',
        'data',
        'priceCache',
        cardId
      );

      await setDoc(cacheRef, {
        marketPrice: priceData.marketPrice,
        lowPrice: priceData.lowPrice,
        highPrice: priceData.highPrice,
        currency: priceData.currency,
        source: priceData.source,
        tcgplayerUrl: priceData.tcgplayerUrl,
        cachedAt: serverTimestamp()
      });

      console.log(`✓ Cached price for ${cardId}`);
    } catch (error) {
      console.warn(`PricingService: Cache write failed for ${cardId}:`, error.message);
    }
  }
};
