/**
 * @vitest-environment happy-dom
 * @unit @service
 *
 * PricingService Tests — reads per-set price documents from Firestore.
 *
 * The previous version of this file tested a tcgapi.dev integration that could
 * never have worked: that provider does not carry Star Wars Unlimited. Nothing
 * here calls a pricing API any more.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PricingService } from '../../services/PricingService';

vi.mock('../../firebase', () => ({
  db: { _type: 'firestore', app: { name: 'test-app' } },
  APP_ID: 'test-app-id',
}));

const { mockGetDoc, mockDoc } = vi.hoisted(() => ({
  mockGetDoc: vi.fn(),
  mockDoc: vi.fn((...args) => ({ _path: args.slice(1).join('/') })),
}));

vi.mock('firebase/firestore', () => ({
  doc: mockDoc,
  getDoc: mockGetDoc,
}));

/** A price document shaped exactly as the sync step writes it. */
const SOR_PRICES = {
  setCode: 'SOR',
  groupId: 23405,
  currency: 'USD',
  source: 'tcgcsv',
  cards: {
    '008': {
      productId: 540383,
      url: 'https://www.tcgplayer.com/product/540383/hera',
      std: { market: 0.16, low: 0.04, mid: 0.25, high: 5.11 },
      foil: { market: 0.2, low: 0.1, mid: 0.4, high: 5 },
    },
    '285': {
      productId: 540407,
      std: { market: 2.5, low: 1, mid: 2, high: 9 },
    },
  },
};

const found = (data) => ({ exists: () => true, data: () => data });
const missing = () => ({ exists: () => false, data: () => undefined });

describe('PricingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PricingService._resetCache();
  });

  describe('formatPrice', () => {
    it('formats a price as USD', () => {
      expect(PricingService.formatPrice(4.25)).toBe('$4.25');
      expect(PricingService.formatPrice(0)).toBe('$0.00');
    });

    it('rounds to two decimal places', () => {
      expect(PricingService.formatPrice(12.3456)).toBe('$12.35');
      expect(PricingService.formatPrice(0.005)).toBe('$0.01');
    });

    // toFixed rounds the binary double, not the decimal it looks like: 1.005 is
    // stored as slightly less than 1.005, so it floors. Accepted rather than
    // worked around, because prices arrive from TCGplayer already at two
    // decimals and a half-cent never reaches this function.
    it('rounds the underlying double, which is not always half-up', () => {
      expect(PricingService.formatPrice(1.005)).toBe('$1.00');
    });

    it('says N/A rather than $NaN', () => {
      expect(PricingService.formatPrice(null)).toBe('N/A');
      expect(PricingService.formatPrice(undefined)).toBe('N/A');
      expect(PricingService.formatPrice('abc')).toBe('N/A');
    });
  });

  describe('getSetPrices', () => {
    it('reads the price document beside the set cards', async () => {
      mockGetDoc.mockResolvedValue(found(SOR_PRICES));

      const result = await PricingService.getSetPrices('SOR');

      expect(result).toEqual(SOR_PRICES);
      const path = mockDoc.mock.calls[0].slice(1).join('/');
      expect(path).toBe('artifacts/test-app-id/public/data/cardDatabase/sets/SOR/prices');
    });

    it('uppercases the set code', async () => {
      mockGetDoc.mockResolvedValue(found(SOR_PRICES));
      await PricingService.getSetPrices('sor');
      expect(mockDoc.mock.calls[0].slice(1).join('/')).toContain('/sets/SOR/prices');
    });

    it('returns null for a set with no prices', async () => {
      mockGetDoc.mockResolvedValue(missing());
      expect(await PricingService.getSetPrices('ZZZ')).toBeNull();
    });

    // One read per set, not per card -- the whole point of the redesign.
    it('reads a given set only once', async () => {
      mockGetDoc.mockResolvedValue(found(SOR_PRICES));

      await PricingService.getSetPrices('SOR');
      await PricingService.getSetPrices('SOR');
      await PricingService.getSetPrices('SOR');

      expect(mockGetDoc).toHaveBeenCalledTimes(1);
    });

    it('remembers a miss too, so an unpriced set is not asked for repeatedly', async () => {
      mockGetDoc.mockResolvedValue(missing());

      await PricingService.getSetPrices('ZZZ');
      await PricingService.getSetPrices('ZZZ');

      expect(mockGetDoc).toHaveBeenCalledTimes(1);
    });

    it('returns null when Firestore throws rather than propagating', async () => {
      mockGetDoc.mockRejectedValue(new Error('permission denied'));
      expect(await PricingService.getSetPrices('SOR')).toBeNull();
    });

    it('returns null without a set code', async () => {
      expect(await PricingService.getSetPrices('')).toBeNull();
      expect(await PricingService.getSetPrices(null)).toBeNull();
      expect(mockGetDoc).not.toHaveBeenCalled();
    });
  });

  describe('getCardPrice', () => {
    beforeEach(() => {
      mockGetDoc.mockResolvedValue(found(SOR_PRICES));
    });

    it('returns the standard price', async () => {
      expect(await PricingService.getCardPrice('SOR', '008')).toMatchObject({
        market: 0.16, low: 0.04, isFoil: false, productId: 540383,
      });
    });

    it('returns the foil price when asked', async () => {
      expect(await PricingService.getCardPrice('SOR', '008', true)).toMatchObject({
        market: 0.2, isFoil: true,
      });
    });

    // swu-db writes a foil as a separate card numbered '008F'.
    it('resolves an F-suffixed number to the foil price', async () => {
      expect(await PricingService.getCardPrice('SOR', '008F')).toMatchObject({
        market: 0.2, isFoil: true,
      });
    });

    it('pads an unpadded number', async () => {
      expect(await PricingService.getCardPrice('SOR', 8)).toMatchObject({ market: 0.16 });
    });

    it('falls back to the standard price when there is no foil listing', async () => {
      expect(await PricingService.getCardPrice('SOR', '285', true)).toMatchObject({ market: 2.5 });
    });

    it('returns null for a card with no price entry', async () => {
      expect(await PricingService.getCardPrice('SOR', '999')).toBeNull();
    });

    it('returns null when the set has no prices at all', async () => {
      mockGetDoc.mockResolvedValue(missing());
      expect(await PricingService.getCardPrice('ZZZ', '001')).toBeNull();
    });
  });

  describe('getBulkPrices', () => {
    it('keys results by the caller cardId', async () => {
      mockGetDoc.mockResolvedValue(found(SOR_PRICES));

      const result = await PricingService.getBulkPrices([
        { cardId: 'SOR_008', set: 'SOR', number: '008' },
        { cardId: 'SOR_285', set: 'SOR', number: '285' },
      ]);

      expect(result.SOR_008).toMatchObject({ market: 0.16 });
      expect(result.SOR_285).toMatchObject({ market: 2.5 });
    });

    // The old implementation made one request per card, sequentially, with a
    // delay between each. Fifty cards in one set is now one read.
    it('reads each set once regardless of how many cards it is asked about', async () => {
      mockGetDoc.mockResolvedValue(found(SOR_PRICES));

      await PricingService.getBulkPrices(
        Array.from({ length: 50 }, (_, i) => ({ cardId: `SOR_${i}`, set: 'SOR', number: '008' }))
      );

      expect(mockGetDoc).toHaveBeenCalledTimes(1);
    });

    it('gives null for a card whose set has no prices, without failing the rest', async () => {
      mockGetDoc.mockImplementation((ref) =>
        Promise.resolve(String(ref?._path).includes('/SOR/') ? found(SOR_PRICES) : missing())
      );

      const result = await PricingService.getBulkPrices([
        { cardId: 'SOR_008', set: 'SOR', number: '008' },
        { cardId: 'ZZZ_001', set: 'ZZZ', number: '001' },
      ]);

      expect(result.SOR_008).toMatchObject({ market: 0.16 });
      expect(result.ZZZ_001).toBeNull();
    });

    it('honours the foil flag per card', async () => {
      mockGetDoc.mockResolvedValue(found(SOR_PRICES));

      const result = await PricingService.getBulkPrices([
        { cardId: 'a', set: 'SOR', number: '008', isFoil: false },
        { cardId: 'b', set: 'SOR', number: '008', isFoil: true },
      ]);

      expect(result.a.market).toBe(0.16);
      expect(result.b.market).toBe(0.2);
    });

    it('returns an empty object for empty input', async () => {
      expect(await PricingService.getBulkPrices([])).toEqual({});
      expect(await PricingService.getBulkPrices(null)).toEqual({});
      expect(mockGetDoc).not.toHaveBeenCalled();
    });

    it('skips an entry with no cardId rather than keying on undefined', async () => {
      mockGetDoc.mockResolvedValue(found(SOR_PRICES));
      const result = await PricingService.getBulkPrices([{ set: 'SOR', number: '008' }]);
      expect(result).toEqual({});
    });
  });

  describe('getTCGPlayerUrl', () => {
    it('prefers the exact product page when price data has one', () => {
      expect(PricingService.getTCGPlayerUrl('Hera Syndulla', { url: 'https://x/product/1/y' }))
        .toBe('https://x/product/1/y');
    });

    it('falls back to a name search with no price data', () => {
      const url = PricingService.getTCGPlayerUrl('Hera Syndulla');
      expect(url).toContain('star-wars-unlimited');
      expect(url).toContain('q=Hera%20Syndulla');
    });

    it('encodes characters that would break the query', () => {
      expect(PricingService.getTCGPlayerUrl("Chirrut Îmwe & Baze")).toContain('%26');
    });

    it('survives a missing name', () => {
      expect(PricingService.getTCGPlayerUrl(null)).toContain('q=');
    });
  });
});
