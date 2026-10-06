import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({ docs: new Map(), fail: false, next: 0 }));
vi.mock('../../firebase', () => ({ db: {}, APP_ID: 'app' }));
vi.mock('firebase/firestore', () => {
  const path = (segs) => segs.join('/');
  const guard = () => { if (store.fail) throw new Error('offline'); };
  return {
    doc: (db, ...segs) => ({ path: path(segs) }),
    collection: (db, ...segs) => ({ path: path(segs) }),
    query: (ref) => ref,
    orderBy: () => null,
    addDoc: async (ref, data) => { guard(); const id = `l${++store.next}`; store.docs.set(`${ref.path}/${id}`, data); return { id }; },
    getDoc: async (ref) => { guard(); return { exists: () => store.docs.has(ref.path), data: () => store.docs.get(ref.path) }; },
    getDocs: async (ref) => {
      guard();
      return {
        docs: [...store.docs.entries()]
          .filter(([p]) => p.startsWith(`${ref.path}/`))
          .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
          .map(([p, d]) => ({ id: p.split('/').pop(), data: () => d })),
      };
    },
    updateDoc: async (ref, patch) => { guard(); store.docs.set(ref.path, { ...store.docs.get(ref.path), ...patch }); },
    deleteDoc: async (ref) => { guard(); store.docs.delete(ref.path); },
  };
});

import { ListService } from '../../services/ListService';

const BASE = 'artifacts/app/users/u1/lists';
beforeEach(() => { store.docs.clear(); store.fail = false; store.next = 0; });

describe('ListService', () => {
  it('creates a list with timestamps and defaults', async () => {
    const { id } = await ListService.createList('u1', { kind: 'wants', name: '  Gaps  ', items: { a: { qty: 1 } } });
    const saved = store.docs.get(`${BASE}/${id}`);
    expect(saved).toMatchObject({ kind: 'wants', name: 'Gaps', items: { a: { qty: 1 } }, source: null, showPrices: true });
    expect(saved.createdAt).toBe(saved.updatedAt);
  });

  it('names an unnamed list by kind', async () => {
    const { id } = await ListService.createList('u1', { kind: 'trade', name: ' ' });
    expect(store.docs.get(`${BASE}/${id}`).name).toBe('Trade list');
  });

  it('lists newest first, filtered by kind', async () => {
    store.docs.set(`${BASE}/a`, { kind: 'trade', name: 'A', updatedAt: 1 });
    store.docs.set(`${BASE}/b`, { kind: 'wants', name: 'B', updatedAt: 3 });
    store.docs.set(`${BASE}/c`, { kind: 'trade', name: 'C', updatedAt: 2 });
    expect((await ListService.listLists('u1', 'trade')).lists.map((l) => l.id)).toEqual(['c', 'a']);
    expect((await ListService.listLists('u1')).lists).toHaveLength(3);
  });

  it('gets one list, or not-found', async () => {
    store.docs.set(`${BASE}/a`, { kind: 'trade', name: 'A', updatedAt: 1 });
    expect((await ListService.getList('u1', 'a')).list).toMatchObject({ id: 'a', name: 'A' });
    expect(await ListService.getList('u1', 'zz')).toEqual({ error: 'not-found' });
  });

  it('updates and stamps updatedAt', async () => {
    store.docs.set(`${BASE}/a`, { kind: 'trade', name: 'A', updatedAt: 1 });
    expect(await ListService.updateList('u1', 'a', { name: 'B' })).toEqual({ ok: true });
    expect(store.docs.get(`${BASE}/a`)).toMatchObject({ name: 'B' });
    expect(store.docs.get(`${BASE}/a`).updatedAt).toBeGreaterThan(1);
  });

  it('deletes', async () => {
    store.docs.set(`${BASE}/a`, { kind: 'trade', updatedAt: 1 });
    expect(await ListService.deleteList('u1', 'a')).toEqual({ ok: true });
    expect(store.docs.has(`${BASE}/a`)).toBe(false);
  });

  it('returns errors instead of throwing', async () => {
    store.fail = true;
    expect(await ListService.createList('u1', { kind: 'wants', name: 'x' })).toEqual({ error: 'offline' });
    expect(await ListService.listLists('u1')).toEqual({ error: 'offline' });
    expect(await ListService.getList('u1', 'a')).toEqual({ error: 'offline' });
    expect(await ListService.updateList('u1', 'a', {})).toEqual({ error: 'offline' });
    expect(await ListService.deleteList('u1', 'a')).toEqual({ error: 'offline' });
  });
});
