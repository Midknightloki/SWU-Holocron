import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({ docs: new Map(), fail: false, hang: false, next: 0 }));
vi.mock('../../firebase', () => ({ db: {}, APP_ID: 'app' }));
vi.mock('firebase/firestore', () => {
  const path = (segs) => segs.join('/');
  const guard = () => { if (store.fail) throw new Error('offline'); };
  // Offline, the real SDK queues a write and its promise never settles.
  const pending = () => new Promise(() => {});
  return {
    doc: (db, ...segs) => ({ path: path(segs) }),
    collection: (db, ...segs) => ({ path: path(segs) }),
    query: (ref) => ref,
    orderBy: () => null,
    addDoc: async (ref, data) => { if (store.hang) return pending(); guard(); const id = `l${++store.next}`; store.docs.set(`${ref.path}/${id}`, data); return { id }; },
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
    updateDoc: async (ref, patch) => { if (store.hang) return pending(); guard(); store.docs.set(ref.path, { ...store.docs.get(ref.path), ...patch }); },
    deleteDoc: async (ref) => { if (store.hang) return pending(); guard(); store.docs.delete(ref.path); },
    setDoc: async (ref, data) => { if (store.hang) return pending(); guard(); store.docs.set(ref.path, data); },
    deleteField: () => '__delete__',
    writeBatch: () => {
      const ops = [];
      return {
        set: (ref, data) => ops.push(() => store.docs.set(ref.path, data)),
        update: (ref, patch) => ops.push(() => {
          const next = { ...store.docs.get(ref.path), ...patch };
          for (const k of Object.keys(next)) if (next[k] === '__delete__') delete next[k];
          store.docs.set(ref.path, next);
        }),
        delete: (ref) => ops.push(() => store.docs.delete(ref.path)),
        commit: async () => { if (store.hang) return pending(); guard(); ops.forEach((op) => op()); },
      };
    },
  };
});

import { ListService, newListCode } from '../../services/ListService';

const BASE = 'artifacts/app/users/u1/lists';
beforeEach(() => { store.docs.clear(); store.fail = false; store.hang = false; store.next = 0; vi.useRealTimers(); });

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

  it('gives up on a write that never settles (offline) instead of hanging', async () => {
    vi.useFakeTimers();
    store.hang = true;
    const calls = [
      ListService.createList('u1', { kind: 'wants', name: 'x' }),
      ListService.updateList('u1', 'a', { name: 'y' }),
      ListService.deleteList('u1', 'a'),
    ];
    await vi.advanceTimersByTimeAsync(8000);
    expect(await Promise.all(calls)).toEqual([{ error: 'timeout' }, { error: 'timeout' }, { error: 'timeout' }]);
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

const PUB = 'artifacts/app/publicLists';
const BODY = { kind: 'trade', name: 'Dupes', showPrices: false, lines: [], cards: 0 };

describe('sharing', () => {
  beforeEach(() => { store.docs.set(`${BASE}/l1`, { kind: 'trade', name: 'Dupes', updatedAt: 1 }); });

  it('makes 8-character codes without look-alike characters', () => {
    const code = newListCode();
    expect(code).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
  });

  it('shares: writes the public copy and records the code on the list', async () => {
    const res = await ListService.shareList('u1', 'l1', BODY, { makeCode: () => 'abcd2345' });
    expect(res).toEqual({ code: 'abcd2345' });
    expect(store.docs.get(`${PUB}/abcd2345`)).toMatchObject({ ...BODY, uid: 'u1' });
    expect(store.docs.get(`${BASE}/l1`).publicCode).toBe('abcd2345');
  });

  it('tries another code when one is taken', async () => {
    store.docs.set(`${PUB}/taken111`, { uid: 'x' });
    const codes = ['taken111', 'free2222'];
    expect(await ListService.shareList('u1', 'l1', BODY, { makeCode: () => codes.shift() })).toEqual({ code: 'free2222' });
  });

  it('updates the public copy', async () => {
    await ListService.shareList('u1', 'l1', BODY, { makeCode: () => 'abcd2345' });
    expect(await ListService.updatePublic('u1', 'abcd2345', { ...BODY, name: 'New' })).toEqual({ ok: true });
    expect(store.docs.get(`${PUB}/abcd2345`)).toMatchObject({ name: 'New', uid: 'u1' });
  });

  it('stops sharing: removes the copy and the code', async () => {
    await ListService.shareList('u1', 'l1', BODY, { makeCode: () => 'abcd2345' });
    expect(await ListService.unshareList('u1', 'l1', 'abcd2345')).toEqual({ ok: true });
    expect(store.docs.has(`${PUB}/abcd2345`)).toBe(false);
    expect(store.docs.get(`${BASE}/l1`)).not.toHaveProperty('publicCode');
  });

  it('deleting a shared list removes its public copy', async () => {
    await ListService.shareList('u1', 'l1', BODY, { makeCode: () => 'abcd2345' });
    expect(await ListService.deleteList('u1', 'l1', 'abcd2345')).toEqual({ ok: true });
    expect(store.docs.has(`${BASE}/l1`)).toBe(false);
    expect(store.docs.has(`${PUB}/abcd2345`)).toBe(false);
  });

  it('reads a public list, or not-found', async () => {
    store.docs.set(`${PUB}/abcd2345`, { ...BODY, uid: 'u1' });
    expect((await ListService.getPublicList('abcd2345')).list).toMatchObject({ code: 'abcd2345', name: 'Dupes' });
    expect(await ListService.getPublicList('nope2345')).toEqual({ error: 'not-found' });
  });

  it('returns errors instead of throwing', async () => {
    store.fail = true;
    expect(await ListService.shareList('u1', 'l1', BODY, { makeCode: () => 'abcd2345' })).toEqual({ error: 'offline' });
    expect(await ListService.updatePublic('u1', 'abcd2345', BODY)).toEqual({ error: 'offline' });
    expect(await ListService.unshareList('u1', 'l1', 'abcd2345')).toEqual({ error: 'offline' });
    expect(await ListService.getPublicList('abcd2345')).toEqual({ error: 'offline' });
  });
});
