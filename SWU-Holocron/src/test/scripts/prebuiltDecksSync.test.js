import { describe, it, expect, vi } from 'vitest';
import { syncPrebuiltDecks } from '../../../scripts/prebuiltDecks.js';

function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const ref = (path) => ({
    collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`), get: async () => ({ docs: [...docs].filter(([p]) => p.startsWith(`${path}/${name}/`) && p.split('/').length === path.split('/').length + 2).map(([p, d]) => ({ id: p.split('/').pop(), data: () => d })) }) }),
    doc: (id) => ref(`${path}/${id}`),
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    set: async (data, opts) => { docs.set(path, opts?.merge ? { ...docs.get(path), ...data } : data); },
  });
  return { docs, collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }) };
}

const BASE = 'artifacts/app/public/data';
const json = (body, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body, text: async () => JSON.stringify(body) });
const PALPATINE = { metadata: { name: 'Emperor Palpatine (ASH)' }, leader: { id: 'ASH_015', count: 1 }, base: { id: 'ASH_021', count: 1 }, deck: [{ unit: 'Unit', id: 'ASH_118', count: 3 }] };

function fetcher({ listed, decks, groups = [], products = {} }) {
  return vi.fn(async (url, init) => {
    if (url.includes('/decks/query')) return json({ items: listed, totalPages: 1 });
    const id = /deckapi\/get\?id=(\d+)/.exec(url)?.[1];
    if (id) return json(decks[id]);
    if (url.endsWith('/groups')) return json({ results: groups });
    const g = /\/79\/(\d+)\/products/.exec(url)?.[1];
    if (g) return json({ results: products[g] ?? [] });
    return json({}, false);
  });
}

const seedCards = {
  [`${BASE}/cardDatabase/sets`]: { sets: [{ code: 'ASH' }] },
  [`${BASE}/cardDatabase/sets/ASH/data`]: { cards: [{ Set: 'ASH', Number: '015' }, { Set: 'ASH', Number: '021' }] },
};
const groups = [{ groupId: 9, name: 'Ashes of the Empire', abbreviation: 'ASH' }];
const products = { 9: [
  { productId: 2, name: 'Ashes of the Empire - Spotlight Deck: Emperor Palpatine', imageUrl: 'img', presaleInfo: { releasedOn: '2026-07-24T00:00:00' } },
  { productId: 7, name: 'Ashes of the Empire - Spotlight Deck Display', imageUrl: 'x', presaleInfo: {} },
] };

describe('syncPrebuiltDecks', () => {
  it('stores a new deck for review, with issues and a suggested product', async () => {
    const db = fakeDb(seedCards);
    const fetchImpl = fetcher({ listed: [{ id: 151901, updatedDate: '2026-07-23T08:22:33Z', typeId: 1 }], decks: { 151901: PALPATINE }, groups, products });
    const res = await syncPrebuiltDecks({ db, appId: 'app', fetchImpl, wait: async () => {}, now: () => 'NOW' });
    expect(res).toMatchObject({ success: true, added: [151901], changed: [], products: 1 });
    const doc = db.docs.get(`${BASE}/prebuiltDecks/151901`);
    expect(doc).toMatchObject({
      status: 'review', sourceName: 'Emperor Palpatine (ASH)', sourceUpdatedAt: '2026-07-23T08:22:33Z', typeId: 1,
      leaders: ['ASH_015'], base: 'ASH_021', name: 'Emperor Palpatine (ASH)', product: null, fetchedAt: 'NOW',
      issues: [{ id: 'ASH_118', problem: 'unknown-card' }],
      suggestedProduct: { tcgplayerProductId: 2, setCode: 'ASH', imageUrl: 'img', releasedOn: '2026-07-24T00:00:00' },
    });
    expect(db.docs.get(`${BASE}/cardDatabase/preconProducts`).products.map((p) => p.tcgplayerProductId)).toEqual([2]);
    const query = fetchImpl.mock.calls.find(([u]) => u.includes('/decks/query'));
    expect(JSON.parse(query[1].body)).toMatchObject({ userId: 3671, status: 1 });
    expect(query[1].headers['User-Agent']).toMatch(/SWU-Holocron/);
  });

  it('marks an edited published deck changed and keeps its published cards', async () => {
    const published = { status: 'published', sourceUpdatedAt: '2026-07-01T00:00:00Z', cards: [{ id: 'ASH_015', qty: 1 }] };
    const db = fakeDb({ ...seedCards, [`${BASE}/prebuiltDecks/151901`]: published });
    const fetchImpl = fetcher({ listed: [{ id: 151901, updatedDate: '2026-08-01T00:00:00Z' }], decks: { 151901: PALPATINE }, groups, products });
    const res = await syncPrebuiltDecks({ db, appId: 'app', fetchImpl, wait: async () => {} });
    expect(res.changed).toEqual([151901]);
    const doc = db.docs.get(`${BASE}/prebuiltDecks/151901`);
    expect(doc.status).toBe('changed');
    expect(doc.cards).toEqual([{ id: 'ASH_015', qty: 1 }]);
    expect(doc.pending.cards).toHaveLength(3);
    expect(doc.pending.sourceUpdatedAt).toBe('2026-08-01T00:00:00Z');
  });

  it('updates a deck still awaiting review in place, never exposing it to collectors', async () => {
    const review = { status: 'review', sourceUpdatedAt: '2026-07-01T00:00:00Z', cards: [{ id: 'ASH_015', qty: 1 }], name: 'Kept name' };
    const db = fakeDb({ ...seedCards, [`${BASE}/prebuiltDecks/151901`]: review });
    const fetchImpl = fetcher({ listed: [{ id: 151901, updatedDate: '2026-08-01T00:00:00Z' }], decks: { 151901: PALPATINE }, groups, products });
    const res = await syncPrebuiltDecks({ db, appId: 'app', fetchImpl, wait: async () => {} });
    const doc = db.docs.get(`${BASE}/prebuiltDecks/151901`);
    expect(doc.status).toBe('review');
    expect(doc.cards).toHaveLength(3);
    expect(doc.sourceUpdatedAt).toBe('2026-08-01T00:00:00Z');
    expect(doc.name).toBe('Kept name');
    expect(res.changed).toEqual([]);
  });

  it('adopts the source date for a published deck added by link when its cards match', async () => {
    const cards = [{ id: 'ASH_015', qty: 1 }, { id: 'ASH_021', qty: 1 }, { id: 'ASH_118', qty: 3 }];
    const db = fakeDb({ ...seedCards, [`${BASE}/prebuiltDecks/151901`]: { status: 'published', sourceUpdatedAt: null, cards } });
    const fetchImpl = fetcher({ listed: [{ id: 151901, updatedDate: '2026-08-01T00:00:00Z' }], decks: { 151901: PALPATINE }, groups, products });
    const res = await syncPrebuiltDecks({ db, appId: 'app', fetchImpl, wait: async () => {} });
    const doc = db.docs.get(`${BASE}/prebuiltDecks/151901`);
    expect(doc).toMatchObject({ status: 'published', sourceUpdatedAt: '2026-08-01T00:00:00Z' });
    expect(doc.pending ?? null).toBeNull();
    expect(res.changed).toEqual([]);
  });

  it('settles a changed deck whose source went back to the published list', async () => {
    const cards = [{ id: 'ASH_015', qty: 1 }, { id: 'ASH_021', qty: 1 }, { id: 'ASH_118', qty: 3 }];
    const changed = { status: 'changed', sourceUpdatedAt: '2026-07-01', cards, pending: { cards: [{ id: 'X_1', qty: 1 }], sourceUpdatedAt: '2026-08-01' } };
    const db = fakeDb({ ...seedCards, [`${BASE}/prebuiltDecks/151901`]: changed });
    const fetchImpl = fetcher({ listed: [{ id: 151901, updatedDate: '2026-09-01' }], decks: { 151901: PALPATINE }, groups, products });
    await syncPrebuiltDecks({ db, appId: 'app', fetchImpl, wait: async () => {} });
    expect(db.docs.get(`${BASE}/prebuiltDecks/151901`)).toMatchObject({ status: 'published', pending: null, sourceUpdatedAt: '2026-09-01' });
  });

  it('keeps syncing decks when a TCGplayer group fails, and keeps the stored product list', async () => {
    const db = fakeDb({ ...seedCards, [`${BASE}/cardDatabase/preconProducts`]: { products: [{ tcgplayerProductId: 2, name: 'Ashes of the Empire - Spotlight Deck: Emperor Palpatine', setCode: 'ASH' }] } });
    const base = fetcher({ listed: [{ id: 151901, updatedDate: 'a' }], decks: { 151901: PALPATINE }, groups: [...groups, { groupId: 10, abbreviation: 'SOR' }], products });
    const fetchImpl = vi.fn(async (url, init) => (url.includes('/79/10/products') ? json({}, false) : base(url, init)));
    const res = await syncPrebuiltDecks({ db, appId: 'app', fetchImpl, wait: async () => {} });
    expect(res.added).toEqual([151901]);
    expect(db.docs.get(`${BASE}/prebuiltDecks/151901`).suggestedProduct.tcgplayerProductId).toBe(2);
    expect(db.docs.get(`${BASE}/cardDatabase/preconProducts`).products).toHaveLength(1);
  });

  it('rechecks stored decks for cards our database has gained since', async () => {
    const stored = { status: 'published', sourceUpdatedAt: 'z', cards: [{ id: 'ASH_015', qty: 1 }], issues: [{ id: 'ASH_015', problem: 'unknown-card' }] };
    const db = fakeDb({ ...seedCards, [`${BASE}/prebuiltDecks/1`]: stored });
    const fetchImpl = fetcher({ listed: [{ id: 1, updatedDate: 'a' }], decks: {}, groups, products });
    await syncPrebuiltDecks({ db, appId: 'app', fetchImpl, wait: async () => {} });
    expect(db.docs.get(`${BASE}/prebuiltDecks/1`).issues).toEqual([]);
  });

  it('leaves ignored and unchanged decks alone', async () => {
    const db = fakeDb({ ...seedCards, [`${BASE}/prebuiltDecks/1`]: { status: 'ignored', sourceUpdatedAt: '2026-01-01' } });
    const fetchImpl = fetcher({ listed: [{ id: 1, updatedDate: '2026-09-01' }], decks: {}, groups, products });
    const res = await syncPrebuiltDecks({ db, appId: 'app', fetchImpl, wait: async () => {} });
    expect(res).toMatchObject({ added: [], changed: [] });
    expect(fetchImpl.mock.calls.some(([u]) => u.includes('deckapi'))).toBe(false);
  });

  it('degrades instead of failing when sw-unlimited-db is down', async () => {
    const db = fakeDb(seedCards);
    const fetchImpl = vi.fn(async () => json({}, false));
    const res = await syncPrebuiltDecks({ db, appId: 'app', fetchImpl, wait: async () => {} });
    expect(res).toMatchObject({ success: true, degraded: true });
    expect(res.error).toMatch(/HTTP 500/);
  });

  it('waits between requests to sw-unlimited-db', async () => {
    const db = fakeDb(seedCards);
    const wait = vi.fn(async () => {});
    const fetchImpl = fetcher({ listed: [{ id: 1, updatedDate: 'a' }, { id: 2, updatedDate: 'a' }], decks: { 1: PALPATINE, 2: PALPATINE }, groups, products });
    await syncPrebuiltDecks({ db, appId: 'app', fetchImpl, wait });
    expect(wait).toHaveBeenCalledWith(1000);
    expect(wait.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
