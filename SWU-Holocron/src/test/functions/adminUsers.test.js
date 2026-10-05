import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createAdminUsersHandlers } = require('../../../functions/adminUsers.js');

class FakeHttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const record = (uid, o = {}) => ({
  uid, email: `${uid}@x.com`, displayName: uid.toUpperCase(),
  providerData: o.guest ? [] : [{ providerId: 'google.com' }],
  metadata: { creationTime: 'Mon, 01 Sep 2026 00:00:00 GMT', lastSignInTime: o.signIn ?? 'Tue, 02 Sep 2026 00:00:00 GMT', lastRefreshTime: o.refresh ?? null },
});

function setup({ users = [record('admin'), record('bob'), record('guest1', { guest: true })], profiles = { admin: { isAdmin: true } } } = {}) {
  const pages = [];
  for (let i = 0; i < users.length; i += 2) pages.push(users.slice(i, i + 2));
  const auth = {
    listUsers: vi.fn(async (max, token) => {
      const i = token ? Number(token) : 0;
      return { users: pages[i] ?? [], pageToken: i + 1 < pages.length ? String(i + 1) : undefined };
    }),
    getUser: vi.fn(async (uid) => {
      const u = users.find((x) => x.uid === uid);
      if (!u) throw Object.assign(new Error('nope'), { code: 'auth/user-not-found' });
      return u;
    }),
  };
  const store = {
    profiles: { ...profiles },
    audit: [],
    getProfiles: vi.fn(async (uids) => Object.fromEntries(uids.map((u) => [u, store.profiles[u] ?? null]))),
    getProfile: vi.fn(async (uid) => store.profiles[uid] ?? null),
    // One atomic step in the real store (a transaction): read, compare, write + audit.
    applyRoleChange: vi.fn(async (uid, role, value, entry) => {
      const from = store.profiles[uid]?.[role] === true;
      if (from === value) return { changed: false };
      store.profiles[uid] = { ...store.profiles[uid], [role]: value };
      store.audit.push({ ...entry, from, to: value });
      return { changed: true };
    }),
    listAudit: vi.fn(async (uid) => store.audit.filter((e) => e.uid === uid).reverse()),
    collectionStats: vi.fn(async () => ({ unique: 120, total: 300, lastChangedAt: 5 })),
    batchStats: vi.fn(async () => ({ count: 2, latest: { name: 'Box', createdAt: 4, cards: 384 } })),
    deckCount: vi.fn(async () => 3),
    scanUsage: vi.fn(async () => ({ date: '2026-10-05', count: 40 })),
  };
  const h = createAdminUsersHandlers({ auth, store, HttpsError: FakeHttpsError, now: () => 1000 });
  return { h, auth, store };
}

const as = (uid, data = {}, anonymous = false) => ({
  auth: uid ? { uid, token: { email: `${uid}@x.com`, firebase: { sign_in_provider: anonymous ? 'anonymous' : 'google.com' } } } : undefined,
  data,
});

describe('admin gate', () => {
  it('refuses non-admins, guests and signed-out callers before reading anything', async () => {
    const { h, auth, store } = setup();
    await expect(h.listUsers(as('bob'))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(h.listUsers(as('admin', {}, true))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(h.listUsers(as(null))).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(h.setRole(as('bob', { uid: 'bob', role: 'isPro', value: true }))).rejects.toMatchObject({ code: 'permission-denied' });
    expect(auth.listUsers).not.toHaveBeenCalled();
    expect(store.applyRoleChange).not.toHaveBeenCalled();
  });
});

describe('listUsers', () => {
  it('pages through every account, merges roles and hides guests by default', async () => {
    const users = [record('admin'), record('bob', { refresh: 'Sun, 05 Oct 2026 00:00:00 GMT' }), record('guest1', { guest: true }), record('carol')];
    const { h, auth } = setup({ users, profiles: { admin: { isAdmin: true }, bob: { isPro: true } } });
    const { users: list } = await h.listUsers(as('admin'));
    expect(auth.listUsers).toHaveBeenCalledTimes(2);
    expect(list.map((u) => u.uid)).toEqual(['bob', 'admin', 'carol']); // most recently active first
    expect(list[0]).toEqual({
      uid: 'bob', email: 'bob@x.com', displayName: 'BOB', provider: 'google',
      createdAt: Date.parse('Mon, 01 Sep 2026 00:00:00 GMT'),
      lastSignInAt: Date.parse('Tue, 02 Sep 2026 00:00:00 GMT'),
      lastActiveAt: Date.parse('Sun, 05 Oct 2026 00:00:00 GMT'),
      roles: { isAdmin: false, isContributor: false, isPro: true },
    });
    const withGuests = await h.listUsers(as('admin', { includeGuests: true }));
    expect(withGuests.users.find((u) => u.uid === 'guest1').provider).toBe('guest');
  });
});

describe('getUserDetail', () => {
  it('returns the user, their activity and recent role changes', async () => {
    const { h, store } = setup();
    store.audit.push({ uid: 'bob', role: 'isPro', from: false, to: true, at: 1 });
    const d = await h.getUserDetail(as('admin', { uid: 'bob' }));
    expect(d).toMatchObject({
      user: { uid: 'bob' },
      collection: { unique: 120, total: 300, lastChangedAt: 5 },
      batches: { count: 2, latest: { name: 'Box' } },
      decks: { count: 3 },
      scans: { lastDay: '2026-10-05', count: 40 },
      roleChanges: [{ role: 'isPro', to: true }],
    });
    expect(store.listAudit).toHaveBeenCalledWith('bob', 10);
  });

  it('says not-found for an unknown user', async () => {
    const { h } = setup();
    await expect(h.getUserDetail(as('admin', { uid: 'zed' }))).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('setRole', () => {
  it('grants and revokes, auditing each change', async () => {
    const { h, store } = setup();
    expect(await h.setRole(as('admin', { uid: 'bob', role: 'isPro', value: true }))).toEqual({ ok: true });
    expect(store.profiles.bob).toEqual({ isPro: true });
    expect(store.audit[0]).toEqual({ uid: 'bob', email: 'bob@x.com', role: 'isPro', from: false, to: true, byUid: 'admin', byEmail: 'admin@x.com', at: 1000 });
    await h.setRole(as('admin', { uid: 'bob', role: 'isPro', value: false }));
    expect(store.audit[1]).toMatchObject({ from: true, to: false });
    await h.setRole(as('admin', { uid: 'bob', role: 'isContributor', value: true }));
    expect(store.profiles.bob).toMatchObject({ isContributor: true });
  });

  it('does nothing for an unchanged value', async () => {
    const { h, store } = setup({ profiles: { admin: { isAdmin: true }, bob: { isPro: true } } });
    expect(await h.setRole(as('admin', { uid: 'bob', role: 'isPro', value: true }))).toEqual({ ok: true, unchanged: true });
    expect(store.audit).toEqual([]);
  });

  it('refuses isAdmin and any other field', async () => {
    const { h, store } = setup();
    for (const role of ['isAdmin', 'email', '']) {
      await expect(h.setRole(as('admin', { uid: 'bob', role, value: true }))).rejects.toMatchObject({ code: 'invalid-argument' });
    }
    await expect(h.setRole(as('admin', { uid: 'bob', role: 'isPro', value: 'yes' }))).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(store.applyRoleChange).not.toHaveBeenCalled();
  });

  it('refuses guests and unknown users', async () => {
    const { h } = setup();
    await expect(h.setRole(as('admin', { uid: 'guest1', role: 'isPro', value: true }))).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(h.setRole(as('admin', { uid: 'zed', role: 'isPro', value: true }))).rejects.toMatchObject({ code: 'not-found' });
  });
});
