import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({ docs: new Map(), fail: false }));
vi.mock('../../firebase', () => ({ db: {}, APP_ID: 'app' }));
vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(), httpsCallable: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: (db, ...s) => ({ path: s.join('/') }),
  collection: (db, ...s) => ({ path: s.join('/') }),
  query: (ref, ...filters) => ({ ...ref, filters }),
  where: (field, op, value) => ({ field, op, value }),
  getDoc: async (ref) => ({ exists: () => store.docs.has(ref.path), data: () => store.docs.get(ref.path) }),
  getDocs: async (ref) => ({
    docs: [...store.docs].filter(([p, d]) => p.startsWith(`${ref.path}/`) && (ref.filters ?? []).every((f) => f.value.includes(d[f.field])))
      .map(([p, d]) => ({ id: p.split('/').pop(), data: () => d })),
  }),
  setDoc: async (ref, data) => { if (store.fail) throw new Error('offline'); store.docs.set(ref.path, data); },
  updateDoc: async (ref, patch) => { if (store.fail) throw new Error('offline'); store.docs.set(ref.path, { ...store.docs.get(ref.path), ...patch }); },
  deleteField: () => undefined,
}));

import { PrebuiltDeckService } from '../../services/PrebuiltDeckService';

const P = 'artifacts/app/public/data/prebuiltDecks';
const API = { metadata: { name: 'Emperor Palpatine (ASH)' }, leader: { id: 'ASH_015', count: 1 }, base: { id: 'ASH_021', count: 1 }, deck: [{ id: 'ASH_118', count: 3 }] };
const ok = (body) => ({ ok: true, json: async () => body });

beforeEach(() => { store.docs.clear(); store.fail = false; });

describe('PrebuiltDeckService', () => {
  const IMG_DECK = { sourceId: 'img-jtl-boba-fett', sourceName: 'Boba Fett', leaders: ['JTL_009'], base: 'JTL_024', cards: [{ id: 'JTL_009', qty: 1 }] };

  it('saves a deck read from an image for review, with its source', async () => {
    expect(await PrebuiltDeckService.addFromImage(IMG_DECK, { url: 'https://cdn.starwarsunlimited.com/x.png', setCode: 'JTL' })).toEqual({ ok: true, id: 'img-jtl-boba-fett' });
    expect(store.docs.get(`${P}/img-jtl-boba-fett`)).toMatchObject({
      status: 'review', name: 'Boba Fett', issues: [], product: null, leaders: ['JTL_009'],
      source: { type: 'image', url: 'https://cdn.starwarsunlimited.com/x.png', setCode: 'JTL' },
    });
  });

  it('never overwrites a deck already stored under that id', async () => {
    store.docs.set(`${P}/img-jtl-boba-fett`, { status: 'published' });
    expect(await PrebuiltDeckService.addFromImage(IMG_DECK, { setCode: 'JTL' })).toEqual({ error: 'exists' });
    expect(store.docs.get(`${P}/img-jtl-boba-fett`).status).toBe('published');
  });

  it('reads a decklist image through the function, and reports its error', async () => {
    const callable = vi.fn(async () => ({ data: { decks: [{ title: 'X', lines: [] }] } }));
    expect(await PrebuiltDeckService.readDecklistImage({ imageUrl: 'u' }, { callable })).toEqual({ decks: [{ title: 'X', lines: [] }] });
    expect(callable).toHaveBeenCalledWith({ imageUrl: 'u' });
    const failing = vi.fn(async () => { throw Object.assign(new Error('Only official starwarsunlimited.com images can be read.'), { code: 'functions/invalid-argument' }); });
    expect(await PrebuiltDeckService.readDecklistImage({ imageUrl: 'u' }, { callable: failing })).toEqual({ error: 'Only official starwarsunlimited.com images can be read.' });
  });

  it('adds a deck from a link for review, flagging unknown cards', async () => {
    const fetchImpl = vi.fn(async () => ok(API));
    const loadKnownIds = vi.fn(async () => new Set(['ASH_015', 'ASH_021']));
    const res = await PrebuiltDeckService.addFromLink('https://sw-unlimited-db.com/decks/151901', { fetchImpl, loadKnownIds });
    // Only the sets the deck uses are loaded, not the whole card database.
    expect(loadKnownIds).toHaveBeenCalledWith(['ASH']);
    expect(res).toEqual({ ok: true, id: 151901 });
    expect(fetchImpl).toHaveBeenCalledWith('https://sw-unlimited-db.com/umbraco/api/deckapi/get?id=151901');
    expect(store.docs.get(`${P}/151901`)).toMatchObject({ status: 'review', name: 'Emperor Palpatine (ASH)', issues: [{ id: 'ASH_118', problem: 'unknown-card' }], product: null });
  });

  it('refuses a bad link, a missing deck and a deck already stored', async () => {
    const loadKnownIds = async () => new Set();
    expect(await PrebuiltDeckService.addFromLink('nope', { loadKnownIds })).toEqual({ error: 'bad-link' });
    expect(await PrebuiltDeckService.addFromLink('5', { fetchImpl: async () => ({ ok: false, status: 404 }), loadKnownIds })).toEqual({ error: 'not-found' });
    store.docs.set(`${P}/5`, { status: 'published' });
    expect(await PrebuiltDeckService.addFromLink('5', { fetchImpl: async () => ok(API), loadKnownIds })).toEqual({ error: 'exists' });
  });

  it('publishes with a product and a name, ignores, and unpublishes', async () => {
    store.docs.set(`${P}/1`, { status: 'review' });
    const product = { tcgplayerProductId: 2, name: 'ASH - Spotlight Deck: Emperor Palpatine' };
    await PrebuiltDeckService.publish('1', { product, name: 'Emperor Palpatine Spotlight' }, 'admin');
    expect(store.docs.get(`${P}/1`)).toMatchObject({ status: 'published', product, name: 'Emperor Palpatine Spotlight', publishedBy: 'admin', publishedAt: expect.any(Number) });
    await PrebuiltDeckService.unpublish('1');
    expect(store.docs.get(`${P}/1`).status).toBe('review');
    await PrebuiltDeckService.ignore('1');
    expect(store.docs.get(`${P}/1`).status).toBe('ignored');
  });

  it('does not flag cards from a set that could not be loaded', async () => {
    const loadKnownIds = async () => null; // nothing could be checked
    await PrebuiltDeckService.addFromLink('151901', { fetchImpl: async () => ok(API), loadKnownIds });
    expect(store.docs.get(`${P}/151901`).issues).toEqual([]);
  });

  it('unpublishing a changed deck takes its newer list back to review', async () => {
    store.docs.set(`${P}/1`, { status: 'changed', cards: [{ id: 'A_001', qty: 1 }], pending: { cards: [{ id: 'B_001', qty: 2 }], issues: [], sourceUpdatedAt: 'T2' } });
    await PrebuiltDeckService.unpublish('1');
    expect(store.docs.get(`${P}/1`)).toMatchObject({ status: 'review', cards: [{ id: 'B_001', qty: 2 }], sourceUpdatedAt: 'T2', pending: undefined });
  });

  it('accepts a changed deck by moving the pending list in', async () => {
    store.docs.set(`${P}/1`, { status: 'changed', cards: [{ id: 'A_001', qty: 1 }], pending: { cards: [{ id: 'B_001', qty: 2 }], leaders: ['B_001'], base: null, issues: [], sourceUpdatedAt: 'T2' } });
    await PrebuiltDeckService.acceptChanges('1');
    expect(store.docs.get(`${P}/1`)).toMatchObject({ status: 'published', cards: [{ id: 'B_001', qty: 2 }], leaders: ['B_001'], sourceUpdatedAt: 'T2', pending: undefined });
  });

  it('lists published decks (including changed ones) and products', async () => {
    store.docs.set(`${P}/1`, { status: 'published' });
    store.docs.set(`${P}/2`, { status: 'review' });
    store.docs.set(`${P}/3`, { status: 'changed' });
    store.docs.set('artifacts/app/public/data/cardDatabase/preconProducts', { products: [{ tcgplayerProductId: 2 }] });
    expect((await PrebuiltDeckService.listPublished()).map((d) => d.id).sort()).toEqual(['1', '3']);
    expect((await PrebuiltDeckService.listDecks()).map((d) => d.id).sort()).toEqual(['1', '2', '3']);
    expect(await PrebuiltDeckService.listProducts()).toEqual([{ tcgplayerProductId: 2 }]);
  });

  it('returns errors instead of throwing', async () => {
    store.fail = true;
    await expect(PrebuiltDeckService.publish('1', {}, 'a')).resolves.toEqual({ error: 'offline' });
  });
});
