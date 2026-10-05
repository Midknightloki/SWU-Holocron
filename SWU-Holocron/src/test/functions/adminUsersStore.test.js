import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createAdminUsersStore } = require('../../../functions/adminUsersStore.js');

const AggregateField = { count: () => ({ op: 'count' }), sum: (f) => ({ op: 'sum', f }) };

function fakeDb(docs = {}) {
  const store = new Map(Object.entries(docs));
  const added = [];
  const children = (path) => [...store].filter(([p]) => p.startsWith(`${path}/`) && p.split('/').length === path.split('/').length + 1);
  const query = (path, rows) => ({
    where: (f, op, v) => query(path, rows.filter(([, d]) => d[f] === v)),
    orderBy: (f, dir) => query(path, [...rows].sort(([, a], [, b]) => (dir === 'desc' ? b[f] - a[f] : a[f] - b[f]))),
    limit: (n) => query(path, rows.slice(0, n)),
    get: async () => ({ empty: rows.length === 0, docs: rows.map(([p, d]) => ({ id: p.split('/').pop(), data: () => d })) }),
    count: () => ({ get: async () => ({ data: () => ({ count: rows.length }) }) }),
    aggregate: (spec) => ({
      get: async () => ({
        data: () => Object.fromEntries(Object.entries(spec).map(([k, s]) => [k, s.op === 'count' ? rows.length : rows.reduce((t, [, d]) => t + (d[s.f] ?? 0), 0)])),
      }),
    }),
    add: async (data) => { added.push({ path, data }); },
  });
  const db = {
    added,
    store,
    runTransaction: vi.fn(async (fn) => fn({
      get: async (ref) => ({ exists: store.has(ref.path), data: () => store.get(ref.path) }),
      set: (ref, data, opts) => { store.set(ref.path, opts?.merge ? { ...store.get(ref.path), ...data } : data); },
      create: (ref, data) => { added.push({ path: ref.path.split('/').slice(0, -1).join('/'), data }); store.set(ref.path, data); },
    })),
    collection: (path) => ({ ...query(path, children(path)), doc: () => ({ path: `${path}/auto${added.length}` }) }),
    doc: (path) => ({
      path,
      get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
      set: vi.fn(async (data, opts) => { store.set(path, opts?.merge ? { ...store.get(path), ...data } : data); }),
    }),
    getAll: vi.fn(async (...refs) => refs.map((r) => ({ id: r.path.split('/').pop(), exists: store.has(r.path), data: () => store.get(r.path) }))),
  };
  return db;
}

const A = 'artifacts/app';

describe('createAdminUsersStore', () => {
  it('reads profiles in one batched call', async () => {
    const db = fakeDb({ [`${A}/users/u1`]: { isPro: true } });
    const s = createAdminUsersStore({ db, appId: 'app', AggregateField });
    expect(await s.getProfiles(['u1', 'u2'])).toEqual({ u1: { isPro: true }, u2: null });
    expect(db.getAll).toHaveBeenCalledTimes(1);
    expect(await s.getProfile('u1')).toEqual({ isPro: true });
  });

  it('summarises collection, batches, decks and scans', async () => {
    const db = fakeDb({
      [`${A}/users/u1/collection/SOR_001_std`]: { quantity: 2, timestamp: 10 },
      [`${A}/users/u1/collection/SOR_002_foil`]: { quantity: 1, timestamp: 30 },
      [`${A}/users/u1/batches/b1`]: { name: 'Old', createdAt: 1, summary: { cards: 10 } },
      [`${A}/users/u1/batches/b2`]: { name: 'New box', createdAt: 2, summary: { cards: 384 } },
      [`${A}/users/u1/decks/d1`]: {},
      [`${A}/scanUsage/u1`]: { date: '2026-10-05', count: 40 },
    });
    const s = createAdminUsersStore({ db, appId: 'app', AggregateField });
    expect(await s.collectionStats('u1')).toEqual({ unique: 2, total: 3, lastChangedAt: 30 });
    expect(await s.batchStats('u1')).toEqual({ count: 2, latest: { name: 'New box', createdAt: 2, cards: 384 } });
    expect(await s.deckCount('u1')).toBe(1);
    expect(await s.scanUsage('u1')).toEqual({ date: '2026-10-05', count: 40 });
  });

  it('reports zeros for a user with no data', async () => {
    const s = createAdminUsersStore({ db: fakeDb(), appId: 'app', AggregateField });
    expect(await s.collectionStats('u9')).toEqual({ unique: 0, total: 0, lastChangedAt: null });
    expect(await s.batchStats('u9')).toEqual({ count: 0, latest: null });
    expect(await s.deckCount('u9')).toBe(0);
    expect(await s.scanUsage('u9')).toBeNull();
  });

  it('applies a role change and its audit entry in one transaction', async () => {
    const db = fakeDb({ [`${A}/users/u1`]: { isAdmin: false, other: 1 } });
    const s = createAdminUsersStore({ db, appId: 'app', AggregateField });
    expect(await s.applyRoleChange('u1', 'isPro', true, { uid: 'u1', role: 'isPro', at: 5 })).toEqual({ changed: true });
    expect(db.runTransaction).toHaveBeenCalledTimes(1);
    expect(db.store.get(`${A}/users/u1`)).toEqual({ isAdmin: false, other: 1, isPro: true });
    expect(db.added).toEqual([{ path: `${A}/admin/audit/roleChanges`, data: { uid: 'u1', role: 'isPro', at: 5, from: false, to: true } }]);
  });

  it('writes nothing when the role already has that value', async () => {
    const db = fakeDb({ [`${A}/users/u1`]: { isPro: true } });
    const s = createAdminUsersStore({ db, appId: 'app', AggregateField });
    expect(await s.applyRoleChange('u1', 'isPro', true, { uid: 'u1', at: 5 })).toEqual({ changed: false });
    expect(db.added).toEqual([]);
  });

  it('lists a user’s audit entries newest first', async () => {
    const db = fakeDb({
      [`${A}/admin/audit/roleChanges/a`]: { uid: 'u1', at: 1 },
      [`${A}/admin/audit/roleChanges/b`]: { uid: 'u2', at: 2 },
      [`${A}/admin/audit/roleChanges/c`]: { uid: 'u1', at: 3 },
    });
    const s = createAdminUsersStore({ db, appId: 'app', AggregateField });
    expect((await s.listAudit('u1', 10)).map((e) => e.at)).toEqual([3, 1]);
  });
});
