import { describe, it, expect } from 'vitest';
import {
  SWU_CATEGORY_ID,
  buildCategoriesUrl,
  buildGroupsUrl,
  buildProductsUrl,
  buildPricesUrl,
  unwrap,
  extendedValue,
  parseProductNumber,
  priceKeyForCard,
  buildPriceMap,
  matchGroupsToSets,
  lookupCardPrice,
} from '../../tcgPrices.js';
import products from '../fixtures/tcgcsv-products.json';
import prices from '../fixtures/tcgcsv-prices.json';
import groups from '../fixtures/tcgcsv-groups.json';

/**
 * Fixtures are recorded verbatim from tcgcsv.com on 2026-09-27, chosen to cover
 * every product shape the live Spark of Rebellion data contains: a numbered card,
 * a sealed product with no extendedData, a card packaged with a token, and a
 * variant numbered past the base set.
 */

describe('URL builders', () => {
  it('targets Star Wars Unlimited by default', () => {
    expect(SWU_CATEGORY_ID).toBe(79);
    expect(buildGroupsUrl()).toBe('https://tcgcsv.com/tcgplayer/79/groups');
    expect(buildProductsUrl(23405)).toBe('https://tcgcsv.com/tcgplayer/79/23405/products');
    expect(buildPricesUrl(23405)).toBe('https://tcgcsv.com/tcgplayer/79/23405/prices');
    expect(buildCategoriesUrl()).toBe('https://tcgcsv.com/tcgplayer/categories');
  });

  it('accepts another category, so the module is not welded to one game', () => {
    expect(buildProductsUrl(1, 2)).toBe('https://tcgcsv.com/tcgplayer/2/1/products');
  });
});

describe('unwrap', () => {
  it('unwraps the results envelope TCGCSV uses', () => {
    expect(unwrap({ results: [1, 2] })).toEqual([1, 2]);
  });

  it('accepts a bare array', () => {
    expect(unwrap([1])).toEqual([1]);
  });

  it('returns nothing usable rather than throwing', () => {
    expect(unwrap(null)).toEqual([]);
    expect(unwrap({})).toEqual([]);
    expect(unwrap({ results: 'nope' })).toEqual([]);
  });
});

describe('extendedValue', () => {
  const hera = unwrap(products).find((p) => p.productId === 540383);

  it('reads a field out of extendedData', () => {
    expect(extendedValue(hera, 'Number')).toBe('008/252');
    expect(extendedValue(hera, 'Rarity')).toBe('Rare');
  });

  it('returns null for a field that is not there', () => {
    expect(extendedValue(hera, 'Nonexistent')).toBeNull();
  });

  it('survives a product with no extendedData at all', () => {
    expect(extendedValue({ productId: 1 }, 'Number')).toBeNull();
    expect(extendedValue(null, 'Number')).toBeNull();
  });
});

// All four formats below are counted from the live SOR data, not invented.
describe('parseProductNumber', () => {
  it('reads the common "number out of set size" form', () => {
    expect(parseProductNumber('008/252')).toBe('008');
    expect(parseProductNumber('29/252')).toBe('029');
  });

  it('reads a bare number, which variants past the base set use', () => {
    expect(parseProductNumber('285')).toBe('285');
    expect(parseProductNumber('1')).toBe('001');
  });

  it('reads a card packaged with a token', () => {
    expect(parseProductNumber('29 // T02')).toBe('029');
  });

  it('rejects a token, which is not a card we track', () => {
    expect(parseProductNumber('T1 // T02')).toBeNull();
    expect(parseProductNumber('T02')).toBeNull();
  });

  it('rejects nothing and non-numbers', () => {
    expect(parseProductNumber(null)).toBeNull();
    expect(parseProductNumber(undefined)).toBeNull();
    expect(parseProductNumber('')).toBeNull();
    expect(parseProductNumber('Booster Display')).toBeNull();
  });
});

// The one real subtlety: swu-db writes a foil as '059F', TCGCSV has no such
// product and instead gives product '059' a Foil price row.
describe('priceKeyForCard', () => {
  it('maps a plain number to the standard printing', () => {
    expect(priceKeyForCard('059')).toEqual({ number: '059', foil: false });
  });

  it('pads an unpadded number', () => {
    expect(priceKeyForCard('8')).toEqual({ number: '008', foil: false });
    expect(priceKeyForCard(8)).toEqual({ number: '008', foil: false });
  });

  it("resolves swu-db's F suffix to the foil price of the base number", () => {
    expect(priceKeyForCard('059F')).toEqual({ number: '059', foil: true });
    expect(priceKeyForCard('324F')).toEqual({ number: '324', foil: true });
  });

  it('honours the foil flag from a collection key', () => {
    expect(priceKeyForCard('059', true)).toEqual({ number: '059', foil: true });
  });

  it('treats an F-suffixed number as foil even when the flag says otherwise', () => {
    expect(priceKeyForCard('059F', false)).toEqual({ number: '059', foil: true });
  });

  it('rejects what it cannot resolve', () => {
    expect(priceKeyForCard('T02')).toBeNull();
    expect(priceKeyForCard('')).toBeNull();
    expect(priceKeyForCard(null)).toBeNull();
    expect(priceKeyForCard('29 // T02')).toBeNull();
  });
});

describe('buildPriceMap', () => {
  const { cards, skipped } = buildPriceMap(products, prices);

  it('keys a card by its number, not its name', () => {
    expect(cards['008']).toBeDefined();
    expect(cards['008'].productId).toBe(540383);
  });

  it('carries the real market prices through', () => {
    expect(cards['008'].std).toEqual({ market: 0.16, low: 0.04, mid: 0.25, high: 5.11 });
  });

  it('keeps the product url, so a shopper can be sent to the exact listing', () => {
    expect(cards['008'].url).toContain('tcgplayer.com/product/540383');
  });

  it('indexes a card packaged with a token under the card number', () => {
    expect(cards['029']).toBeDefined();
  });

  it('indexes a variant numbered past the base set', () => {
    expect(cards['285']).toBeDefined();
  });

  it('drops sealed product, which has no card number', () => {
    const ids = Object.values(cards).map((c) => c.productId);
    expect(ids).not.toContain(533897); // Booster Display
    expect(skipped).toBeGreaterThan(0);
  });

  it('separates foil from standard', () => {
    const withFoil = Object.values(cards).find((c) => c.foil);
    if (withFoil) {
      expect(withFoil.foil).toHaveProperty('market');
      expect(withFoil.foil).not.toEqual(withFoil.std);
    }
  });

  it('stores a null price as null rather than inventing a number', () => {
    const rows = {
      results: [
        { productId: 1, subTypeName: 'Normal', marketPrice: 1.5, lowPrice: null, midPrice: null, highPrice: null },
      ],
    };
    const prods = { results: [{ productId: 1, extendedData: [{ name: 'Number', value: '001' }] }] };
    expect(buildPriceMap(prods, rows).cards['001'].std).toEqual({
      market: 1.5, low: null, mid: null, high: null,
    });
  });

  it('drops an entry whose every price is null', () => {
    const rows = {
      results: [{ productId: 1, subTypeName: 'Normal', marketPrice: null, lowPrice: null, midPrice: null, highPrice: null }],
    };
    const prods = { results: [{ productId: 1, extendedData: [{ name: 'Number', value: '001' }] }] };
    const result = buildPriceMap(prods, rows);
    expect(result.cards['001']).toBeUndefined();
    expect(result.skipped).toBe(1);
  });

  it('prefers the lower productId when a number appears twice, for run-to-run stability', () => {
    const prods = {
      results: [
        { productId: 900, extendedData: [{ name: 'Number', value: '001' }] },
        { productId: 100, extendedData: [{ name: 'Number', value: '001' }] },
      ],
    };
    const rows = {
      results: [
        { productId: 900, subTypeName: 'Normal', marketPrice: 9 },
        { productId: 100, subTypeName: 'Normal', marketPrice: 1 },
      ],
    };
    expect(buildPriceMap(prods, rows).cards['001'].productId).toBe(100);
  });

  it('survives empty input', () => {
    expect(buildPriceMap(null, null)).toEqual({ cards: {}, skipped: 0 });
  });
});

describe('matchGroupsToSets', () => {
  it('matches by abbreviation, which already equals our set code for the main sets', () => {
    const { matched } = matchGroupsToSets(groups, ['SOR', 'SHD']);
    expect(matched.map((m) => m.setCode)).toEqual(['SOR', 'SHD']);
    expect(matched[0].groupId).toBe(23405);
  });

  it('reports a set with no TCGplayer group rather than guessing', () => {
    const { matched, unmatched } = matchGroupsToSets(groups, ['SOR', 'NOPE']);
    expect(matched).toHaveLength(1);
    expect(unmatched).toEqual(['NOPE']);
  });

  // The promo sets differ in naming: our SOROP against their SOR-WPP.
  it('resolves a set through an alias', () => {
    const { matched, unmatched } = matchGroupsToSets(groups, ['SOROP'], { SOROP: 'SOR-WPP' });
    expect(unmatched).toEqual([]);
    expect(matched[0]).toMatchObject({ setCode: 'SOROP' });
  });

  it('is case insensitive on both sides', () => {
    expect(matchGroupsToSets(groups, ['sor']).matched[0].setCode).toBe('SOR');
  });

  it('ignores a group with no abbreviation', () => {
    const { unmatched } = matchGroupsToSets(groups, ['']);
    expect(unmatched).toEqual([]);
  });

  it('survives empty input', () => {
    expect(matchGroupsToSets(null, null)).toEqual({ matched: [], unmatched: [] });
  });
});

describe('lookupCardPrice', () => {
  const doc = {
    cards: {
      '008': {
        productId: 540383,
        url: 'https://www.tcgplayer.com/product/540383/x',
        std: { market: 0.16, low: 0.04, mid: 0.25, high: 5.11 },
        foil: { market: 0.2, low: 0.1, mid: 0.4, high: 5 },
      },
      '100': { productId: 1, foil: { market: 9, low: 8, mid: 9, high: 10 } },
    },
  };

  it('returns the standard price for a plain number', () => {
    expect(lookupCardPrice(doc, '008')).toMatchObject({
      market: 0.16, printing: 'std', isFoil: false, isFallback: false,
    });
  });

  it('returns the foil price when asked for foil', () => {
    expect(lookupCardPrice(doc, '008', true)).toMatchObject({
      market: 0.2, printing: 'foil', isFoil: true, isFallback: false,
    });
  });

  it("returns the foil price for swu-db's F-suffixed number", () => {
    expect(lookupCardPrice(doc, '008F')).toMatchObject({ market: 0.2, printing: 'foil' });
  });

  it('carries the product link through for the shopping list', () => {
    expect(lookupCardPrice(doc, '008').url).toContain('/product/540383/');
    expect(lookupCardPrice(doc, '008').productId).toBe(540383);
  });

  // Better a rough number than a blank -- but the caller has to be able to tell.
  // A foil row quietly showing a standard price would mislead a buyer, and the
  // two differ materially: one SOR card is 0.27 standard against 0.45 foil.
  it('falls back to the other printing, and says that it did', () => {
    // '100' is foil-only, so a standard request is answered with the foil price.
    expect(lookupCardPrice(doc, '100')).toMatchObject({
      market: 9, printing: 'foil', isFoil: true, isFallback: true,
    });
  });

  it('falls back the other way too', () => {
    // '200' is standard-only, so a foil request is answered with the standard.
    const stdOnly = { cards: { '200': { productId: 5, std: { market: 1, low: 1, mid: 1, high: 1 } } } };
    expect(lookupCardPrice(stdOnly, '200', true)).toMatchObject({
      market: 1, printing: 'std', isFoil: false, isFallback: true,
    });
  });

  it('reports isFoil for what the numbers are, not for what was asked', () => {
    const stdOnly = { cards: { '200': { productId: 5, std: { market: 1 } } } };
    expect(lookupCardPrice(stdOnly, '200F').isFoil).toBe(false);
  });

  it('returns null for a card with no entry', () => {
    expect(lookupCardPrice(doc, '999')).toBeNull();
  });

  it('survives a missing or empty document', () => {
    expect(lookupCardPrice(null, '008')).toBeNull();
    expect(lookupCardPrice({}, '008')).toBeNull();
    expect(lookupCardPrice({ cards: {} }, '008')).toBeNull();
  });

  it('returns null for an unresolvable number', () => {
    expect(lookupCardPrice(doc, 'T02')).toBeNull();
  });
});
