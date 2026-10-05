import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({ docs: new Map(), fail: false }));
vi.mock('../../firebase', () => ({ db: {}, APP_ID: 'app' }));
vi.mock('firebase/firestore', () => {
  const path = (segs) => segs.join('/');
  return {
    doc: (db, ...segs) => ({ path: path(segs) }),
    collection: (db, ...segs) => ({ path: path(segs) }),
    query: (ref) => ref,
    orderBy: () => null,
    getDoc: async (ref) => ({ exists: () => store.docs.has(ref.path), data: () => store.docs.get(ref.path) }),
    getDocs: async (ref) => ({
      docs: [...store.docs.entries()]
        .filter(([p]) => p.startsWith(`${ref.path}/`))
        .sort(([, a], [, b]) => b.createdAt - a.createdAt)
        .map(([p, d]) => ({ id: p.split('/').pop(), data: () => d })),
    }),
    updateDoc: async (ref, patch) => {
      if (store.fail) throw new Error('offline');
      store.docs.set(ref.path, { ...store.docs.get(ref.path), ...patch });
    },
    deleteDoc: async (ref) => { store.docs.delete(ref.path); },
    runTransaction: async (db, fn) => {
      if (store.fail) throw new Error('offline');
      return fn({
        get: async (ref) => ({ exists: () => store.docs.has(ref.path), data: () => store.docs.get(ref.path) }),
        set: (ref, data) => store.docs.set(ref.path, data),
      });
    },
  };
});

import { BatchService, mergeLines, summarize } from '../../services/BatchService';

const BATCH = { id: 'b1', name: 'eBay SOR box', pricePaid: 90, createdAt: 100 };
const L = (o) => ({ id: 'SOR_010_std', set: 'SOR', number: '010', name: 'Luke', type: 'Leader', rarity: 'Rare', aspects: [], variant: 'Normal', isFoil: false, qty: 1, isNew: true, priceAtAdd: 5, ...o });
const PATH = 'artifacts/app/users/u1/batches/b1';

beforeEach(() => { store.docs.clear(); store.fail = false; });

describe('BatchService', () => {
  it('creates the batch on the first append, with a summary', async () => {
    expect(await BatchService.appendToBatch('u1', BATCH, [L({ qty: 2 })])).toEqual({ ok: true });
    const doc = store.docs.get(PATH);
    expect(doc).toMatchObject({ name: 'eBay SOR box', pricePaid: 90, createdAt: 100, closedAt: null });
    expect(doc.cards.SOR_010_std).toMatchObject({ qty: 2, isNew: true, priceAtAdd: 5 });
    expect(doc.summary).toEqual({ cards: 2, unique: 1, newUnique: 1, valueAtAdd: 10 });
  });

  it('merges quantities across appends, keeping the first isNew and price', async () => {
    await BatchService.appendToBatch('u1', BATCH, [L()]);
    await BatchService.appendToBatch('u1', { ...BATCH, name: 'Renamed' }, [L({ qty: 3, isNew: false, priceAtAdd: 9 }), L({ id: 'SOR_011_std', number: '011', name: 'Leia', isNew: false, priceAtAdd: null })]);
    const doc = store.docs.get(PATH);
    expect(doc.cards.SOR_010_std).toMatchObject({ qty: 4, isNew: true, priceAtAdd: 5 });
    expect(doc.name).toBe('Renamed');
    expect(doc.summary).toEqual({ cards: 5, unique: 2, newUnique: 1, valueAtAdd: 20 });
  });

  it('closes, lists, gets, renames, prices and deletes', async () => {
    await BatchService.appendToBatch('u1', BATCH, [L()]);
    await BatchService.appendToBatch('u1', { ...BATCH, id: 'b0', createdAt: 50 }, [L()]);
    await BatchService.closeBatch('u1', 'b1');
    expect(store.docs.get(PATH).closedAt).toEqual(expect.any(Number));
    const list = await BatchService.listBatches('u1');
    expect(list.map((b) => b.id)).toEqual(['b1', 'b0']);
    expect(list[0]).toMatchObject({ name: 'eBay SOR box', summary: { cards: 1 } });
    expect(list[0].cards).toBeUndefined();
    expect(await BatchService.getBatch('u1', 'b1')).toMatchObject({ id: 'b1', cards: expect.any(Object) });
    await BatchService.renameBatch('u1', 'b1', 'Box #2');
    await BatchService.setBatchPricePaid('u1', 'b1', 75);
    expect(store.docs.get(PATH)).toMatchObject({ name: 'Box #2', pricePaid: 75 });
    await BatchService.deleteBatch('u1', 'b1');
    expect(await BatchService.getBatch('u1', 'b1')).toBeNull();
  });

  it('keeps a stored rename unless the draft changed the name or price since its last append', async () => {
    await BatchService.appendToBatch('u1', BATCH, [L()]);
    await BatchService.renameBatch('u1', 'b1', 'Renamed in the list');
    await BatchService.appendToBatch('u1', { ...BATCH, syncedName: BATCH.name, syncedPricePaid: 90 }, [L()]);
    expect(store.docs.get(PATH)).toMatchObject({ name: 'Renamed in the list', pricePaid: 90 });
    await BatchService.appendToBatch('u1', { ...BATCH, name: 'Typed in Review', syncedName: BATCH.name, pricePaid: 50, syncedPricePaid: 90 }, [L()]);
    expect(store.docs.get(PATH)).toMatchObject({ name: 'Typed in Review', pricePaid: 50 });
  });

  it('never saves a blank name', async () => {
    await BatchService.appendToBatch('u1', { ...BATCH, name: '   ', createdAt: Date.UTC(2026, 9, 5, 12) }, [L()]);
    expect(store.docs.get(PATH).name).toBe('Batch Oct 5');
  });

  it('returns errors instead of throwing', async () => {
    store.fail = true;
    await expect(BatchService.appendToBatch('u1', BATCH, [L()])).resolves.toEqual({ error: 'offline' });
    await expect(BatchService.closeBatch('u1', 'b1')).resolves.toEqual({ error: 'offline' });
  });

  it('mergeLines and summarize are pure', () => {
    const cards = mergeLines({}, [L(), L()]);
    expect(cards.SOR_010_std.qty).toBe(2);
    expect(summarize(cards)).toEqual({ cards: 2, unique: 1, newUnique: 1, valueAtAdd: 10 });
  });
});
