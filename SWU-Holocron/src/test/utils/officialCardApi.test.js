import { describe, it, expect } from 'vitest';
import {
  OFFICIAL_CARD_LIST_ENDPOINT,
  buildCardListUrl,
  MAX_PAGE_SIZE,
} from '../../officialCardApi.js';

/**
 * Regression tests for the official-site scrape returning ~2% of the catalog.
 *
 * The scraper captured whatever /api/card-list request the site's own UI made
 * on page load and reused it, overriding only pagination. That inherited the
 * UI's default type filter:
 *
 *   variantOf null only .................. 3046 cards
 *   variantOf null + the UI type filter ... 183 cards
 *
 * so every set reconciled against ~18 official cards. The query must be built
 * by us, not borrowed from the page.
 */

// A real captured URL, trimmed to the parameters that mattered.
const CAPTURED_UI_URL =
  'https://admin.starwarsunlimited.com/api/card-list?locale=en' +
  '&orderBy%5Bexpansion%5D%5Bid%5D=asc' +
  '&filters%5B%24and%5D%5B0%5D%5BvariantOf%5D%5Bid%5D%5B%24null%5D=true' +
  '&filters%5B%24and%5D%5B1%5D%5B%24or%5D%5B0%5D%5Btype%5D%5Bid%5D%5B%24in%5D%5B0%5D=4' +
  '&filters%5B%24and%5D%5B1%5D%5B%24or%5D%5B0%5D%5Btype%5D%5Bid%5D%5B%24in%5D%5B1%5D=38' +
  '&filters%5B%24and%5D%5B1%5D%5B%24or%5D%5B1%5D%5Btype2%5D%5Bid%5D%5B%24in%5D%5B0%5D=4' +
  '&aspectMethod=0&aspect=0&traitMethod=0&trait=0' +
  '&pagination%5Bpage%5D=1&pagination%5BpageSize%5D=40';

const paramsOf = (url) => new URL(url).searchParams;

describe('buildCardListUrl', () => {
  it('drops the type filter inherited from the site UI', () => {
    const url = buildCardListUrl(CAPTURED_UI_URL, { page: 1, pageSize: 200 });
    const keys = [...paramsOf(url).keys()];

    expect(keys.some((k) => k.includes('[type]'))).toBe(false);
    expect(keys.some((k) => k.includes('[type2]'))).toBe(false);
  });

  it('drops the aspect and trait filters too', () => {
    const params = paramsOf(buildCardListUrl(CAPTURED_UI_URL, { page: 1, pageSize: 200 }));

    expect(params.has('aspect')).toBe(false);
    expect(params.has('aspectMethod')).toBe(false);
    expect(params.has('trait')).toBe(false);
    expect(params.has('traitMethod')).toBe(false);
  });

  it('keeps the variantOf-null filter, which selects canonical cards', () => {
    const params = paramsOf(buildCardListUrl(CAPTURED_UI_URL, { page: 1, pageSize: 200 }));

    expect(params.get('filters[$and][0][variantOf][id][$null]')).toBe('true');
  });

  it('applies the requested pagination', () => {
    const params = paramsOf(buildCardListUrl(CAPTURED_UI_URL, { page: 3, pageSize: 200 }));

    expect(params.get('pagination[page]')).toBe('3');
    expect(params.get('pagination[pageSize]')).toBe('200');
  });

  it('caps pageSize at the API maximum rather than silently over-requesting', () => {
    const params = paramsOf(buildCardListUrl(CAPTURED_UI_URL, { page: 1, pageSize: 9999 }));

    expect(Number(params.get('pagination[pageSize]'))).toBeLessThanOrEqual(MAX_PAGE_SIZE);
  });

  it('keeps the origin and path of a captured URL, in case the host moves', () => {
    const url = new URL(buildCardListUrl(CAPTURED_UI_URL, { page: 1, pageSize: 200 }));

    expect(url.origin).toBe('https://admin.starwarsunlimited.com');
    expect(url.pathname).toBe('/api/card-list');
  });

  it('falls back to the known endpoint when nothing was captured', () => {
    const url = new URL(buildCardListUrl(null, { page: 1, pageSize: 200 }));
    const expected = new URL(OFFICIAL_CARD_LIST_ENDPOINT);

    expect(url.origin).toBe(expected.origin);
    expect(url.pathname).toBe(expected.pathname);
    expect(url.searchParams.get('filters[$and][0][variantOf][id][$null]')).toBe('true');
  });

  it('always sets locale so results are deterministic', () => {
    expect(paramsOf(buildCardListUrl(null, { page: 1, pageSize: 200 })).get('locale')).toBe('en');
  });

  it('produces a stable URL for the same inputs', () => {
    const a = buildCardListUrl(CAPTURED_UI_URL, { page: 2, pageSize: 200 });
    const b = buildCardListUrl(CAPTURED_UI_URL, { page: 2, pageSize: 200 });

    expect(a).toBe(b);
  });
});

describe('page budget', () => {
  it('can request the whole catalog within the page cap', () => {
    // 3046 canonical cards at the time of writing. The old settings were
    // pageSize 40 x maxPages 30 = 1200, which would have truncated the catalog
    // even once the filter bug was fixed.
    const CATALOG_SIZE = 3046;
    const MAX_PAGES = 30;

    expect(MAX_PAGE_SIZE * MAX_PAGES).toBeGreaterThan(CATALOG_SIZE);
  });
});
