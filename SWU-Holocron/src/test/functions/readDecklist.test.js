// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createReadDecklistHandler, isOfficialImageUrl, sanitizeDecklist } = require('../../../functions/readDecklist.js');

class FakeHttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const APP = 'test-app';
const fakeDb = (docs = {}) => ({ doc: (path) => ({ get: async () => ({ exists: path in docs, data: () => docs[path] }) }) });
const ADMIN = { [`artifacts/${APP}/users/a1`]: { isAdmin: true } };
const URL_OK = 'https://cdn.starwarsunlimited.com//large_SWH_04_Article_Spotlight_Decks_Decklist_v02_1f4852aef7.jpg';
const READ = { decks: [{ title: 'BOBA FETT', lines: [{ number: '9', fromPreviousSet: false, name: 'Boba Fett', qty: 1 }] }] };

const make = (o = {}) => {
  const deps = {
    db: fakeDb(ADMIN), appId: APP, HttpsError: FakeHttpsError, logger: { error: vi.fn() },
    readImage: vi.fn(async () => READ),
    fetchImage: vi.fn(async () => ({ contentType: 'image/jpeg', bytes: Buffer.from('abc') })),
    ...o,
  };
  return { deps, handler: createReadDecklistHandler(deps) };
};
const call = (handler, data, auth = { uid: 'a1', token: {} }) => handler({ auth, data });

describe('isOfficialImageUrl', () => {
  it('accepts only https links on the official CDN', () => {
    expect(isOfficialImageUrl(URL_OK)).toBe(true);
    expect(isOfficialImageUrl('http://cdn.starwarsunlimited.com/x.png')).toBe(false);
    expect(isOfficialImageUrl('https://cdn.starwarsunlimited.com.evil.com/x.png')).toBe(false);
    expect(isOfficialImageUrl('https://evil.com@cdn.starwarsunlimited.com/x.png')).toBe(false);
    expect(isOfficialImageUrl('https://evil.com/?u=https://cdn.starwarsunlimited.com/x.png')).toBe(false);
    expect(isOfficialImageUrl('not a url')).toBe(false);
  });
});

describe('readDecklist', () => {
  it('requires a signed-in admin', async () => {
    const { handler } = make({ db: fakeDb({ [`artifacts/${APP}/users/u1`]: { isPro: true } }) });
    await expect(call(handler, { imageUrl: URL_OK }, null)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(call(handler, { imageUrl: URL_OK }, { uid: 'u1', token: {} })).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('reads an official link: fetches it and returns the sanitised decks', async () => {
    const { deps, handler } = make();
    expect(await call(handler, { imageUrl: URL_OK })).toEqual(READ);
    expect(deps.fetchImage).toHaveBeenCalledWith(URL_OK);
    expect(deps.readImage).toHaveBeenCalledWith(Buffer.from('abc').toString('base64'), 'image/jpeg');
  });

  it('refuses other links without fetching them', async () => {
    const { deps, handler } = make();
    await expect(call(handler, { imageUrl: 'https://evil.com/x.png' })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(deps.fetchImage).not.toHaveBeenCalled();
  });

  it('takes exactly one of a link or an uploaded image', async () => {
    const { handler } = make();
    await expect(call(handler, {})).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call(handler, { imageUrl: URL_OK, image: 'YWJj', mimeType: 'image/png' })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('reads an uploaded image of an allowed type', async () => {
    const { deps, handler } = make();
    expect(await call(handler, { image: 'YWJj', mimeType: 'image/png' })).toEqual(READ);
    expect(deps.readImage).toHaveBeenCalledWith('YWJj', 'image/png');
    await expect(call(handler, { image: 'YWJj', mimeType: 'image/gif' })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call(handler, { image: 'not base64!', mimeType: 'image/png' })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('refuses a fetched file that is not an image or is too large', async () => {
    const html = make({ fetchImage: vi.fn(async () => ({ contentType: 'text/html', bytes: Buffer.from('<html>') })) });
    await expect(call(html.handler, { imageUrl: URL_OK })).rejects.toMatchObject({ code: 'invalid-argument' });
    const big = make({ fetchImage: vi.fn(async () => ({ contentType: 'image/png', bytes: Buffer.alloc(8 * 1024 * 1024 + 1) })) });
    await expect(call(big.handler, { imageUrl: URL_OK })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('maps download and reading failures to errors', async () => {
    const down = make({ fetchImage: vi.fn(async () => { throw new Error('404'); }) });
    await expect(call(down.handler, { imageUrl: URL_OK })).rejects.toMatchObject({ code: 'unavailable' });
    const bad = make({ readImage: vi.fn(async () => { throw new Error('vertex'); }) });
    await expect(call(bad.handler, { imageUrl: URL_OK })).rejects.toMatchObject({ code: 'internal' });
  });
});

describe('sanitizeDecklist', () => {
  it('cleans numbers and quantities, keeps the star as fromPreviousSet, drops empty rows and decks', () => {
    expect(sanitizeDecklist({ decks: [
      { title: ' LEIA ORGANA ', lines: [
        { number: '93*', fromPreviousSet: false, name: ' C-3PO ', qty: 2 },
        { number: '010', fromPreviousSet: false, name: 'Leia Organa', qty: '1' },
        { number: '', fromPreviousSet: false, name: 'x', qty: 1 },
        { number: '5', fromPreviousSet: false, name: 'Big', qty: 99 },
      ] },
      { title: 'EMPTY', lines: [] },
    ] })).toEqual({ decks: [{ title: 'LEIA ORGANA', lines: [
      { number: '93', fromPreviousSet: true, name: 'C-3PO', qty: 2 },
      { number: '010', fromPreviousSet: false, name: 'Leia Organa', qty: 1 },
      { number: '5', fromPreviousSet: false, name: 'Big', qty: 9 },
    ] }] });
    expect(sanitizeDecklist(null)).toEqual({ decks: [] });
  });

  it('keeps digits only, even if a rarity letter is read into the number', () => {
    const out = sanitizeDecklist({ decks: [{ title: 'X', lines: [{ number: 'S9', fromPreviousSet: false, name: 'Boba Fett', qty: 1 }, { number: 'C 026*', fromPreviousSet: false, name: 'Jabba', qty: 1 }] }] });
    expect(out.decks[0].lines.map((l) => [l.number, l.fromPreviousSet])).toEqual([['9', false], ['026', true]]);
  });
});
