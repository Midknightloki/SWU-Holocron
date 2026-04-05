/**
 * @vitest-environment happy-dom
 * @unit @service
 *
 * PricingService Tests — pricing cache layer and tcgapi.dev integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PricingService } from '../../services/PricingService';

// ---------------------------------------------------------------------------
// Firebase mocks — use plain vi.fn() so each test controls behavior directly
// ---------------------------------------------------------------------------

vi.mock('../../firebase', () => ({
  db: { _type: 'firestore', app: { name: 'test-app' } },
  APP_ID: 'test-app-id',
}));

// vi.hoisted ensures these are available when the factory runs (vi.mock is hoisted)
const { mockGetDoc, mockSetDoc, mockDoc } = vi.hoisted(() => ({
  mockGetDoc: vi.fn(),
  mockSetDoc: vi.fn(),
  mockDoc: vi.fn((...args) => ({
    _path: args.slice(1).join('/'),
    _type: 'DocumentReference',
  })),
}));

vi.mock('firebase/firestore', () => ({
  doc: mockDoc,
  getDoc: mockGetDoc,
  setDoc: mockSetDoc,
  serverTimestamp: vi.fn(() => ({ _type: 'serverTimestamp' })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CACHE_MISS = { exists: () => false, data: () => null };

const cacheHit = (data) => ({ exists: () => true, data: () => data });

const freshCacheData = {
  marketPrice: 5.0,
  lowPrice: 3.0,
  highPrice: 7.0,
  currency: 'USD',
  source: 'tcgapi.dev',
  cachedAt: { toMillis: () => Date.now() }, // fresh — within 7 days
  tcgplayerUrl: 'https://www.tcgplayer.com/search/star-wars-unlimited/product?q=Hera',
};

const staleCacheData = {
  ...freshCacheData,
  cachedAt: { toMillis: () => Date.now() - 8 * 24 * 60 * 60 * 1000 }, // 8 days ago
};

const apiResponse = (prices = [{ marketPrice: 5.0, lowPrice: 3.0, highPrice: 7.0 }]) => ({
  ok: true,
  json: async () => prices,
});

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

global.fetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // Default: cache miss + API key present
  mockGetDoc.mockResolvedValue(CACHE_MISS);
  mockSetDoc.mockResolvedValue(undefined);
  import.meta.env.VITE_TCGAPI_KEY = 'test-api-key';
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PricingService', () => {

  describe('formatPrice', () => {
    it('formats price as USD string', () => {
      expect(PricingService.formatPrice(4.25)).toBe('$4.25');
      expect(PricingService.formatPrice(100)).toBe('$100.00');
      expect(PricingService.formatPrice(0.99)).toBe('$0.99');
    });

    it('handles null/undefined price', () => {
      expect(PricingService.formatPrice(null)).toBe('N/A');
      expect(PricingService.formatPrice(undefined)).toBe('N/A');
    });

    it('rounds to 2 decimal places', () => {
      expect(PricingService.formatPrice(4.256)).toBe('$4.26');
      expect(PricingService.formatPrice(4.254)).toBe('$4.25');
    });
  });

  describe('getTCGPlayerUrl', () => {
    it('builds TCGplayer search URL', () => {
      const url = PricingService.getTCGPlayerUrl('Hera Syndulla');
      expect(url).toContain('https://www.tcgplayer.com/search/star-wars-unlimited/product');
      expect(url).toContain('productLineName=star-wars-unlimited');
      expect(url).toContain('Hera%20Syndulla');
    });

    it('encodes special characters', () => {
      const url = PricingService.getTCGPlayerUrl('Card & Name');
      expect(url).toContain('Card%20%26%20Name');
    });
  });

  describe('getCardPrice', () => {
    it('returns null if cardId or cardName is missing', async () => {
      expect(await PricingService.getCardPrice(null, 'Hera')).toBeNull();
      expect(await PricingService.getCardPrice('SOR_001', null)).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns null (without calling API) if API key is not set', async () => {
      import.meta.env.VITE_TCGAPI_KEY = ''; // empty string is falsy, avoids string "undefined" issue
      // Cache miss configured in beforeEach
      const result = await PricingService.getCardPrice('SOR_001', 'Hera Syndulla');
      expect(result).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('fetches from API on cache miss and writes to cache', async () => {
      // cache miss (default from beforeEach)
      global.fetch.mockResolvedValue(apiResponse());

      const result = await PricingService.getCardPrice('SOR_001', 'Hera Syndulla');

      expect(result).not.toBeNull();
      expect(result.marketPrice).toBe(5.0);
      expect(result.fromCache).toBe(false);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://api.tcgapi.dev/v1'),
        expect.any(Object)
      );
      expect(mockSetDoc).toHaveBeenCalled();
    });

    it('returns cached data (no API call) on fresh cache hit', async () => {
      mockGetDoc.mockResolvedValue(cacheHit(freshCacheData));

      const result = await PricingService.getCardPrice('SOR_001', 'Hera Syndulla');

      expect(result).not.toBeNull();
      expect(result.fromCache).toBe(true);
      expect(result.marketPrice).toBe(5.0);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockSetDoc).not.toHaveBeenCalled();
    });

    it('re-fetches from API when cache is stale (>7 days)', async () => {
      mockGetDoc.mockResolvedValue(cacheHit(staleCacheData));
      global.fetch.mockResolvedValue(apiResponse([{ marketPrice: 6.0, lowPrice: 4.0, highPrice: 8.0 }]));

      const result = await PricingService.getCardPrice('SOR_001', 'Hera Syndulla');

      expect(global.fetch).toHaveBeenCalled();
      expect(mockSetDoc).toHaveBeenCalled();
      expect(result.fromCache).toBe(false);
    });

    it('handles API network error gracefully', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'));
      const result = await PricingService.getCardPrice('SOR_001', 'Hera Syndulla');
      expect(result).toBeNull();
    });

    it('handles non-200 API response gracefully', async () => {
      global.fetch.mockResolvedValue({ ok: false, status: 404 });
      const result = await PricingService.getCardPrice('SOR_001', 'Unknown Card');
      expect(result).toBeNull();
    });

    it('handles empty API response array gracefully', async () => {
      global.fetch.mockResolvedValue(apiResponse([]));
      const result = await PricingService.getCardPrice('SOR_001', 'Unknown Card');
      expect(result).toBeNull();
    });

    it('includes tcgplayerUrl in result', async () => {
      global.fetch.mockResolvedValue(apiResponse());
      const result = await PricingService.getCardPrice('SOR_001', 'Hera Syndulla');
      expect(result.tcgplayerUrl).toContain('https://www.tcgplayer.com');
      expect(result.tcgplayerUrl).toContain('Hera%20Syndulla');
    });
  });

  describe('getBulkPrices', () => {
    it('returns empty object for empty array', async () => {
      expect(await PricingService.getBulkPrices([])).toEqual({});
    });

    it('returns empty object for null input', async () => {
      expect(await PricingService.getBulkPrices(null)).toEqual({});
    });

    it('fetches prices for multiple cards', async () => {
      global.fetch.mockResolvedValue(apiResponse());

      const cards = [
        { cardId: 'SOR_001', cardName: 'Hera Syndulla' },
        { cardId: 'SOR_002', cardName: 'Yoda' },
      ];

      const result = await PricingService.getBulkPrices(cards);
      expect(result['SOR_001']).not.toBeNull();
      expect(result['SOR_002']).not.toBeNull();
      expect(result['SOR_001'].marketPrice).toBe(5.0);
    });

    it('handles partial failures — null for failed lookups', async () => {
      let callCount = 0;
      global.fetch.mockImplementation(async () => {
        callCount++;
        return callCount === 1
          ? apiResponse()
          : { ok: false, status: 404 };
      });

      const cards = [
        { cardId: 'SOR_001', cardName: 'Hera Syndulla' },
        { cardId: 'SOR_002', cardName: 'Unknown Card' },
      ];

      const result = await PricingService.getBulkPrices(cards);
      expect(result['SOR_001']).not.toBeNull();
      expect(result['SOR_002']).toBeNull();
    });
  });
});
