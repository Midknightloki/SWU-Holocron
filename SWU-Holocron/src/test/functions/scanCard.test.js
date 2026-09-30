// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createScanCardHandler, DEFAULT_SCAN_DAILY_LIMIT } = require('../../../functions/scanCard.js');

class FakeHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const APP = 'test-app';
const profilePath = (uid) => `artifacts/${APP}/users/${uid}`;
const usagePath = (uid) => `artifacts/${APP}/scanUsage/${uid}`;
const CONFIG_PATH = `artifacts/${APP}/config/scanner`;

function fakeDb(docs = {}) {
  const store = new Map(Object.entries(docs));
  const snap = (path) => ({ exists: store.has(path), data: () => store.get(path) });
  return {
    store,
    doc: (path) => ({ path, get: async () => snap(path) }),
    runTransaction: async (fn) => fn({
      get: async (ref) => snap(ref.path),
      set: (ref, data) => { store.set(ref.path, data); },
    }),
  };
}

const IMAGE = Buffer.from('fake-jpeg-bytes').toString('base64');
const READ = { readable: true, set: 'SOR', number: '012', name: 'Luke Skywalker' };
const NOW = new Date('2026-09-29T15:00:00Z');

const request = (uid, { anonymous = false, image = IMAGE } = {}) => ({
  auth: uid ? { uid, token: { firebase: { sign_in_provider: anonymous ? 'anonymous' : 'google.com' } } } : undefined,
  data: { image },
});

const setup = (docs, readCard = vi.fn(async () => READ)) => {
  const db = fakeDb(docs);
  const handler = createScanCardHandler({ db, appId: APP, readCard, HttpsError: FakeHttpsError, now: () => NOW });
  return { db, handler, readCard };
};

const expectCode = async (promise, code) => {
  await expect(promise).rejects.toMatchObject({ code });
};

describe('scanCard handler', () => {
  it('rejects an unauthenticated caller', async () => {
    const { handler, readCard } = setup({});
    await expectCode(handler(request(null)), 'unauthenticated');
    expect(readCard).not.toHaveBeenCalled();
  });

  it('rejects an anonymous guest even with isPro on the profile', async () => {
    const { handler } = setup({ [profilePath('g')]: { isPro: true } });
    await expectCode(handler(request('g', { anonymous: true })), 'permission-denied');
  });

  it('rejects a signed-in user who is neither Pro nor admin', async () => {
    const { handler, readCard } = setup({ [profilePath('u')]: {} });
    await expectCode(handler(request('u')), 'permission-denied');
    expect(readCard).not.toHaveBeenCalled();
  });

  it('rejects a user with no profile document', async () => {
    const { handler } = setup({});
    await expectCode(handler(request('nobody')), 'permission-denied');
  });

  it('rejects a missing or malformed image', async () => {
    const { handler } = setup({ [profilePath('p')]: { isPro: true } });
    await expectCode(handler(request('p', { image: null })), 'invalid-argument');
    await expectCode(handler(request('p', { image: 'not base64!' })), 'invalid-argument');
  });

  it('rejects an image over 2 MB', async () => {
    const { handler } = setup({ [profilePath('p')]: { isPro: true } });
    const big = 'A'.repeat(Math.ceil((2 * 1024 * 1024 + 10) * 4 / 3));
    await expectCode(handler(request('p', { image: big })), 'invalid-argument');
  });

  it('lets a Pro user scan and counts the scan', async () => {
    const { handler, db } = setup({ [profilePath('p')]: { isPro: true } });
    await expect(handler(request('p'))).resolves.toEqual(READ);
    expect(db.store.get(usagePath('p'))).toEqual({ date: '2026-09-29', count: 1 });
  });

  it('lets an admin scan without isPro and does not count it', async () => {
    const { handler, db } = setup({ [profilePath('a')]: { isAdmin: true } });
    await expect(handler(request('a'))).resolves.toEqual(READ);
    expect(db.store.has(usagePath('a'))).toBe(false);
  });

  it('never limits an admin, even over the cap', async () => {
    const { handler } = setup({
      [profilePath('a')]: { isAdmin: true },
      [CONFIG_PATH]: { dailyLimit: 1 },
      [usagePath('a')]: { date: '2026-09-29', count: 50 },
    });
    await expect(handler(request('a'))).resolves.toEqual(READ);
  });

  it('enforces the configured daily limit with the reset time', async () => {
    const { handler, readCard } = setup({
      [profilePath('p')]: { isPro: true },
      [CONFIG_PATH]: { dailyLimit: 2 },
      [usagePath('p')]: { date: '2026-09-29', count: 2 },
    });
    await expect(handler(request('p'))).rejects.toMatchObject({
      code: 'resource-exhausted',
      details: { limit: 2, resetsAt: '2026-09-30T00:00:00.000Z' },
    });
    expect(readCard).not.toHaveBeenCalled();
  });

  it('resets the count on a new UTC day', async () => {
    const { handler, db } = setup({
      [profilePath('p')]: { isPro: true },
      [CONFIG_PATH]: { dailyLimit: 2 },
      [usagePath('p')]: { date: '2026-09-28', count: 2 },
    });
    await expect(handler(request('p'))).resolves.toEqual(READ);
    expect(db.store.get(usagePath('p'))).toEqual({ date: '2026-09-29', count: 1 });
  });

  it.each([
    ['missing config', {}],
    ['zero', { [CONFIG_PATH]: { dailyLimit: 0 } }],
    ['a string', { [CONFIG_PATH]: { dailyLimit: '50' } }],
    ['a fraction', { [CONFIG_PATH]: { dailyLimit: 2.5 } }],
  ])('falls back to %s → the default limit', async (_label, extra) => {
    const { handler } = setup({
      [profilePath('p')]: { isPro: true },
      [usagePath('p')]: { date: '2026-09-29', count: DEFAULT_SCAN_DAILY_LIMIT - 1 },
      ...extra,
    });
    await expect(handler(request('p'))).resolves.toEqual(READ);
    await expectCode(handler(request('p')), 'resource-exhausted');
    expect(DEFAULT_SCAN_DAILY_LIMIT).toBe(1000);
  });

  it('maps a Gemini failure to internal', async () => {
    const { handler } = setup({ [profilePath('p')]: { isPro: true } }, vi.fn(async () => { throw new Error('vertex down'); }));
    await expectCode(handler(request('p')), 'internal');
  });

  it('sanitises the read into four well-typed fields', async () => {
    const messy = { readable: 'yes', set: '  SOR ', number: 12, name: 'x'.repeat(500), extra: 'dropped' };
    const { handler } = setup({ [profilePath('p')]: { isPro: true } }, vi.fn(async () => messy));
    const out = await handler(request('p'));
    expect(out).toEqual({ readable: false, set: 'SOR', number: '', name: 'x'.repeat(100) });
  });
});
