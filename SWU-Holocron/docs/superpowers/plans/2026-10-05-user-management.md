# User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Users tab in the admin console that lists and searches users, shows each user's activity, and grants or revokes Pro and Contributor through admin-only Cloud Functions, auditing every change.

**Architecture:**
- **Function handlers:** `functions/adminUsers.js` holds the three handlers: the admin gate, list, detail and setRole. Auth, a storage adapter and `HttpsError` are injected, so the handlers need no packages and CI can test them.
- **Storage adapter:** `functions/adminUsersStore.js` turns Firestore Admin SDK calls (getAll, count/sum aggregations, audit queries) into plain methods.
- **Exports:** `functions/index.js` exports `adminListUsers`, `adminGetUserDetail` and `adminSetRole`.
- **Client:** `UserAdminService` (callable wrappers) and `AdminUsers.jsx` (the admin tab).

**Tech Stack:** Firebase Functions v2 `onCall`, firebase-admin 13 (`AggregateField`), React 18, Vitest.

**Spec:** `SWU-Holocron/docs/superpowers/specs/2026-10-05-user-management-design.md`

## Global Constraints

- **Where to run things:** npm/npx from `SWU-Holocron/`, lint in the Bash tool, gated commits, commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Testability:** `functions/adminUsers.js` and `functions/adminUsersStore.js` require **no packages** (CI never installs `functions/node_modules`). They are CommonJS, loaded in tests through `createRequire`.
- **Roles:** only `isPro` and `isContributor` are settable. `isAdmin` is always refused. Guests can't hold roles.
- **Audit path:** `artifacts/{APP_ID}/admin/audit/roleChanges/{auto}`.
- **Times:** ms numbers everywhere.
- **Code rules:** services never throw (they return `{ error }`); every hook before any conditional return.
- **Deploy:** functions are deployed by hand (`firebase deploy --only functions:adminListUsers,functions:adminGetUserDetail,functions:adminSetRole`). No workflow deploys them.

## Review Focus

1. **A non-admin or guest caller,** including a signed-in user calling the callable directly, must be refused before any data is read. (Task 1: `refuses non-admins, guests and signed-out callers before reading anything`.)
2. **Any attempt to set `isAdmin`,** or any field other than the two roles, must be refused server-side. (Task 1: `refuses isAdmin and any other field`.)
3. **A role change must always be audited**, and a no-op change must not create noise. (Task 1: `grants and revokes, auditing each change`; `does nothing for an unchanged value`.)
4. **A user with no collection, batches or scans** must get zeros, not an error. (Task 2: `reports zeros for a user with no data`.)
5. **More than 1000 accounts** must all be listed (Auth pages through them). (Task 1: `pages through every account`.)

---

### Task 1: Handlers (`functions/adminUsers.js`)

**Files:** Create `functions/adminUsers.js`; test in `src/test/functions/adminUsers.test.js`.

**Interfaces (produces):**
- `createAdminUsersHandlers({ auth, store, HttpsError, now = () => Date.now() }) → { listUsers, getUserDetail, setRole }`. Each handler takes the `onCall` `request`.
- `auth` is the Admin Auth API: `listUsers(max, pageToken)`, `getUser(uid)`.
- `store` (Task 2) provides:
  - `getProfiles(uids) → { [uid]: profile }`
  - `getProfile(uid) → profile | null`
  - `setRole(uid, role, value)`
  - `addAudit(entry)`
  - `listAudit(uid, limit)`
  - `collectionStats(uid) → { unique, total, lastChangedAt }`
  - `batchStats(uid) → { count, latest }`
  - `deckCount(uid)`
  - `scanUsage(uid) → { date, count } | null`
- `toUser(record, profile)` is exported for reuse.

- [ ] **Step 1: Failing tests:**

```js
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
    setRole: vi.fn(async (uid, role, value) => { store.profiles[uid] = { ...store.profiles[uid], [role]: value }; }),
    addAudit: vi.fn(async (e) => { store.audit.push(e); }),
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
    expect(store.setRole).not.toHaveBeenCalled();
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
    expect(store.setRole).not.toHaveBeenCalled();
    expect(store.audit).toEqual([]);
  });

  it('refuses isAdmin and any other field', async () => {
    const { h, store } = setup();
    for (const role of ['isAdmin', 'email', '']) {
      await expect(h.setRole(as('admin', { uid: 'bob', role, value: true }))).rejects.toMatchObject({ code: 'invalid-argument' });
    }
    await expect(h.setRole(as('admin', { uid: 'bob', role: 'isPro', value: 'yes' }))).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(store.setRole).not.toHaveBeenCalled();
  });

  it('refuses guests and unknown users', async () => {
    const { h } = setup();
    await expect(h.setRole(as('admin', { uid: 'guest1', role: 'isPro', value: true }))).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(h.setRole(as('admin', { uid: 'zed', role: 'isPro', value: true }))).rejects.toMatchObject({ code: 'not-found' });
  });
});
```

  How the listing order works out: bob's `lastRefreshTime` is Oct 5. The others have no refresh time, so they fall back to `lastSignInTime` (Sep 2, tied), and ties are broken by uid: admin, then carol.

- [ ] **Step 2: Run** `npx vitest run src/test/functions/adminUsers.test.js`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `functions/adminUsers.js`:

```js
/**
 * User management for the admin console: list users, show one user's
 * activity, and grant or revoke Pro / Contributor.
 *
 * Admin itself is never settable here -- it stays a Firebase-console change,
 * so an admin session in the app can never mint or remove admins. Every role
 * change is audited. Auth, storage and HttpsError are injected and this file
 * requires no package, so the app's Vitest suite can test it in CI.
 */
const SETTABLE_ROLES = new Set(["isPro", "isContributor"]);

const ms = (time) => {
  const t = time ? Date.parse(time) : NaN;
  return Number.isFinite(t) ? t : null;
};

function providerOf(record) {
  const providers = (record.providerData || []).map((p) => p.providerId);
  if (providers.length === 0) return "guest";
  return providers.includes("google.com") ? "google" : "other";
}

function toUser(record, profile) {
  const lastSignInAt = ms(record.metadata && record.metadata.lastSignInTime);
  return {
    uid: record.uid,
    email: record.email || null,
    displayName: record.displayName || null,
    provider: providerOf(record),
    createdAt: ms(record.metadata && record.metadata.creationTime),
    lastSignInAt,
    lastActiveAt: ms(record.metadata && record.metadata.lastRefreshTime) ?? lastSignInAt,
    roles: {
      isAdmin: Boolean(profile && profile.isAdmin === true),
      isContributor: Boolean(profile && profile.isContributor === true),
      isPro: Boolean(profile && profile.isPro === true),
    },
  };
}

function createAdminUsersHandlers({ auth, store, HttpsError, now = () => Date.now() }) {
  async function requireAdmin(request) {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    const provider = request.auth.token && request.auth.token.firebase && request.auth.token.firebase.sign_in_provider;
    if (provider === "anonymous") throw new HttpsError("permission-denied", "Admins only.");
    const profile = await store.getProfile(request.auth.uid);
    if (!profile || profile.isAdmin !== true) throw new HttpsError("permission-denied", "Admins only.");
    return request.auth;
  }

  async function getRecord(uid) {
    if (typeof uid !== "string" || !uid) throw new HttpsError("invalid-argument", "A uid is required.");
    try {
      return await auth.getUser(uid);
    } catch (err) {
      if (err && err.code === "auth/user-not-found") throw new HttpsError("not-found", "No such user.");
      throw err;
    }
  }

  async function listUsers(request) {
    await requireAdmin(request);
    const includeGuests = Boolean(request.data && request.data.includeGuests);
    const records = [];
    let pageToken;
    do {
      // eslint-disable-next-line no-await-in-loop
      const page = await auth.listUsers(1000, pageToken);
      records.push(...page.users);
      pageToken = page.pageToken;
    } while (pageToken);
    const kept = records.filter((r) => includeGuests || providerOf(r) !== "guest");
    const profiles = await store.getProfiles(kept.map((r) => r.uid));
    const users = kept
      .map((r) => toUser(r, profiles[r.uid]))
      .sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0) || a.uid.localeCompare(b.uid));
    return { users };
  }

  async function getUserDetail(request) {
    await requireAdmin(request);
    const record = await getRecord(request.data && request.data.uid);
    const uid = record.uid;
    const [profile, collection, batches, decks, usage, roleChanges] = await Promise.all([
      store.getProfile(uid), store.collectionStats(uid), store.batchStats(uid),
      store.deckCount(uid), store.scanUsage(uid), store.listAudit(uid, 10),
    ]);
    return {
      user: toUser(record, profile),
      collection,
      batches,
      decks: { count: decks },
      scans: usage ? { lastDay: usage.date, count: usage.count } : null,
      roleChanges,
    };
  }

  async function setRole(request) {
    const caller = await requireAdmin(request);
    const { uid, role, value } = request.data || {};
    if (!SETTABLE_ROLES.has(role)) {
      throw new HttpsError("invalid-argument", "Only Pro and Contributor can be changed here.");
    }
    if (typeof value !== "boolean") throw new HttpsError("invalid-argument", "value must be true or false.");
    const record = await getRecord(uid);
    if (providerOf(record) === "guest") {
      throw new HttpsError("failed-precondition", "Guest accounts can't hold roles.");
    }
    const profile = await store.getProfile(uid);
    const from = Boolean(profile && profile[role] === true);
    if (from === value) return { ok: true, unchanged: true };
    await store.setRole(uid, role, value);
    await store.addAudit({
      uid, email: record.email || null, role, from, to: value,
      byUid: caller.uid, byEmail: (caller.token && caller.token.email) || null, at: now(),
    });
    return { ok: true };
  }

  return { listUsers, getUserDetail, setRole };
}

module.exports = { createAdminUsersHandlers, toUser };
```

- [ ] **Step 4: Run.** Expected: PASS. **Step 5: Commit** — gated, `feat(users): admin user-management handlers`.

---

### Task 2: Firestore adapter (`functions/adminUsersStore.js`)

**Files:** Create `functions/adminUsersStore.js`; test in `src/test/functions/adminUsersStore.test.js`.

**Interface:** `createAdminUsersStore({ db, appId, AggregateField }) →` the `store` used by Task 1.
- `getProfiles` uses `db.getAll` in chunks of 100.
- `collectionStats`:
  - `users/{uid}/collection.aggregate({ unique: AggregateField.count(), total: AggregateField.sum('quantity') })`;
  - the latest document by `timestamp`;
  - returns zeros or null when empty.
- `batchStats`: `users/{uid}/batches` gives `count()` plus the latest by `createdAt` (`cards` comes from `summary.cards`).
- `deckCount`: `users/{uid}/decks.count()`.
- `scanUsage`: the `scanUsage/{uid}` document.
- `setRole`: `set({ [role]: value }, { merge: true })` on `users/{uid}`.
- `addAudit`: `admin/audit/roleChanges.add(entry)`.
- `listAudit(uid, limit)`: `where('uid', '==', uid)` gets everything, then it sorts by `at` descending and slices in memory. That avoids needing a composite index, and per-user audit lists are short.

- [ ] **Step 1: Failing tests,** with a fake Admin Firestore covering the chain methods used:

```js
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
    collection: (path) => query(path, children(path)),
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

  it('merges a role and writes and reads the audit log', async () => {
    const db = fakeDb({ [`${A}/users/u1`]: { isAdmin: false, other: 1 } });
    const s = createAdminUsersStore({ db, appId: 'app', AggregateField });
    await s.setRole('u1', 'isPro', true);
    expect(db.store.get(`${A}/users/u1`)).toEqual({ isAdmin: false, other: 1, isPro: true });
    await s.addAudit({ uid: 'u1', at: 5 });
    expect(db.added).toEqual([{ path: `${A}/admin/audit/roleChanges`, data: { uid: 'u1', at: 5 } }]);
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
```

  Note that `db.collection(path)` takes a slash path. The Admin SDK accepts `db.collection('artifacts/app/users/u1/collection')`, so the adapter builds full paths, and `db.doc(path)` likewise.

- [ ] **Step 2: Fail. Step 3: Implement:**

```js
/**
 * Firestore access for admin user management (Admin SDK). Requires no
 * package: the Firestore handle and AggregateField are injected.
 */
const CHUNK = 100;

function createAdminUsersStore({ db, appId, AggregateField }) {
  const base = `artifacts/${appId}`;
  const userPath = (uid) => `${base}/users/${uid}`;
  const auditPath = `${base}/admin/audit/roleChanges`;

  async function getProfiles(uids) {
    const out = {};
    for (let i = 0; i < uids.length; i += CHUNK) {
      const refs = uids.slice(i, i + CHUNK).map((uid) => db.doc(userPath(uid)));
      if (refs.length === 0) continue;
      // eslint-disable-next-line no-await-in-loop
      const snaps = await db.getAll(...refs);
      for (const snap of snaps) out[snap.id] = snap.exists ? snap.data() : null;
    }
    return out;
  }

  async function getProfile(uid) {
    const snap = await db.doc(userPath(uid)).get();
    return snap.exists ? snap.data() : null;
  }

  async function collectionStats(uid) {
    const col = db.collection(`${userPath(uid)}/collection`);
    const [agg, latest] = await Promise.all([
      col.aggregate({ unique: AggregateField.count(), total: AggregateField.sum("quantity") }).get(),
      col.orderBy("timestamp", "desc").limit(1).get(),
    ]);
    const { unique, total } = agg.data();
    return {
      unique: unique || 0,
      total: total || 0,
      lastChangedAt: latest.empty ? null : latest.docs[0].data().timestamp ?? null,
    };
  }

  async function batchStats(uid) {
    const col = db.collection(`${userPath(uid)}/batches`);
    const [count, latest] = await Promise.all([col.count().get(), col.orderBy("createdAt", "desc").limit(1).get()]);
    const doc = latest.empty ? null : latest.docs[0].data();
    return {
      count: count.data().count || 0,
      latest: doc ? { name: doc.name ?? null, createdAt: doc.createdAt ?? null, cards: (doc.summary && doc.summary.cards) || 0 } : null,
    };
  }

  async function deckCount(uid) {
    return (await db.collection(`${userPath(uid)}/decks`).count().get()).data().count || 0;
  }

  async function scanUsage(uid) {
    const snap = await db.doc(`${base}/scanUsage/${uid}`).get();
    return snap.exists ? snap.data() : null;
  }

  async function setRole(uid, role, value) {
    await db.doc(userPath(uid)).set({ [role]: value }, { merge: true });
  }

  async function addAudit(entry) {
    await db.collection(auditPath).add(entry);
  }

  // No orderBy in the query: where + orderBy on another field would need a
  // composite index, and one user's role history is short.
  async function listAudit(uid, limit) {
    const snap = await db.collection(auditPath).where("uid", "==", uid).get();
    return snap.docs.map((d) => d.data()).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, limit);
  }

  return { getProfiles, getProfile, collectionStats, batchStats, deckCount, scanUsage, setRole, addAudit, listAudit };
}

module.exports = { createAdminUsersStore };
```

- [ ] **Step 4: Pass. Step 5: Commit** — gated, `feat(users): Firestore adapter for user management`.

---

### Task 3: Export the callables (`functions/index.js`)

- [ ] **Step 1:** In `functions/index.js`, after the `locateCard` export, add:

```js
/**
 * User management (admin console). Admin-only: each handler checks the
 * caller's profile. Pro and Contributor can be granted or revoked here; Admin
 * stays a Firebase-console change. Every change is audited at
 * admin/audit/roleChanges. See functions/adminUsers.js.
 */
const { createAdminUsersHandlers } = require("./adminUsers");
const { createAdminUsersStore } = require("./adminUsersStore");
const { AggregateField } = require("firebase-admin/firestore");

const adminUsers = createAdminUsersHandlers({
  auth: admin.auth(),
  store: createAdminUsersStore({ db: admin.firestore(), appId: APP_ID, AggregateField }),
  HttpsError,
});

exports.adminListUsers = onCall({ maxInstances: 2 }, adminUsers.listUsers);
exports.adminGetUserDetail = onCall({ maxInstances: 2 }, adminUsers.getUserDetail);
exports.adminSetRole = onCall({ maxInstances: 2 }, adminUsers.setRole);
```

- [ ] **Step 2:** `node --check functions/index.js`. If `functions/node_modules` is installed locally, also run `node -e "require('./functions/index.js')"` from `SWU-Holocron/`; if not, record a ruling and verify on deploy. **Commit** — `feat(users): export user-management callables`.

---

### Task 4: Rules test for the audit log

**Files:** `src/test/rules/firestore.rules.test.js`.

- [ ] **Step 1:** Add:

```js
describe('role-change audit log', () => {
  beforeEach(async () => {
    await seedDoc(p('admin', 'audit', 'roleChanges', 'a1'), { uid: 'plain-uid', role: 'isPro' });
  });

  it('is readable by admins only', async () => {
    await assertSucceeds(getDoc(doc(asUser('admin-uid'), p('admin', 'audit', 'roleChanges', 'a1'))));
    await assertFails(getDoc(doc(asUser('plain-uid'), p('admin', 'audit', 'roleChanges', 'a1'))));
  });

  it('is never writable from a client, even by an admin', async () => {
    await assertFails(setDoc(doc(asUser('admin-uid'), p('admin', 'audit', 'roleChanges', 'a2')), { uid: 'x' }));
  });
});
```

- [ ] **Step 2:** Try `npm run test:rules`. The existing `admin/**` rule already covers this, so it should pass with no rules change. The emulator needs Java 21; if it can't run here, record a ruling (CI verifies). **Commit** — `test(users): rules for the role audit log`.

---

### Task 5: `UserAdminService` (client)

**Files:** Create `src/services/UserAdminService.js`; test in `src/test/services/UserAdminService.test.js`.

**Interface:**
- `UserAdminService.listUsers({ includeGuests }) → { users } | { error }`
- `getUserDetail(uid) → detail | { error }`
- `setRole(uid, role, value) → { ok, unchanged? } | { error }`

Error mapping:
- `functions/permission-denied` → `'Admins only.'`
- `functions/not-found` or `functions/internal` → `"User management isn't deployed yet, or that user no longer exists."`
- `functions/failed-precondition` and `functions/invalid-argument` → the server's message
- anything else → `"Couldn't reach the server. Try again."`

- [ ] **Step 1: Failing tests:**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ calls: {}, impl: {} }));
vi.mock('../../firebase', () => ({ isConfigured: true }));
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: (f, name) => async (data) => { m.calls[name] = data; return m.impl[name](data); },
}));

import { UserAdminService } from '../../services/UserAdminService';

beforeEach(() => { m.calls = {}; m.impl = {}; });

describe('UserAdminService', () => {
  it('calls each function and returns its data', async () => {
    m.impl.adminListUsers = async () => ({ data: { users: [{ uid: 'a' }] } });
    m.impl.adminGetUserDetail = async () => ({ data: { user: { uid: 'a' } } });
    m.impl.adminSetRole = async () => ({ data: { ok: true } });
    expect(await UserAdminService.listUsers({ includeGuests: true })).toEqual({ users: [{ uid: 'a' }] });
    expect(m.calls.adminListUsers).toEqual({ includeGuests: true });
    expect(await UserAdminService.getUserDetail('a')).toEqual({ user: { uid: 'a' } });
    expect(m.calls.adminGetUserDetail).toEqual({ uid: 'a' });
    expect(await UserAdminService.setRole('a', 'isPro', true)).toEqual({ ok: true });
    expect(m.calls.adminSetRole).toEqual({ uid: 'a', role: 'isPro', value: true });
  });

  it('maps errors and never throws', async () => {
    const fail = (code, message = 'x') => async () => { throw Object.assign(new Error(message), { code }); };
    m.impl.adminListUsers = fail('functions/permission-denied');
    expect(await UserAdminService.listUsers()).toEqual({ error: 'Admins only.' });
    m.impl.adminListUsers = fail('functions/not-found');
    expect((await UserAdminService.listUsers()).error).toMatch(/isn't deployed yet/);
    m.impl.adminSetRole = fail('functions/failed-precondition', "Guest accounts can't hold roles.");
    expect(await UserAdminService.setRole('g', 'isPro', true)).toEqual({ error: "Guest accounts can't hold roles." });
    m.impl.adminGetUserDetail = fail('functions/unavailable');
    expect(await UserAdminService.getUserDetail('a')).toEqual({ error: "Couldn't reach the server. Try again." });
  });
});
```

- [ ] **Step 2: Fail. Step 3: Implement:**

```js
import { getFunctions, httpsCallable } from 'firebase/functions';
import { isConfigured } from '../firebase';

/**
 * Admin user management: thin wrappers over the adminListUsers /
 * adminGetUserDetail / adminSetRole callables. Never throws.
 *
 * @environment:firebase
 */
function message(err) {
  switch (err?.code) {
    case 'functions/permission-denied': return 'Admins only.';
    case 'functions/not-found':
    case 'functions/internal': return "User management isn't deployed yet, or that user no longer exists.";
    case 'functions/failed-precondition':
    case 'functions/invalid-argument': return err.message;
    default: return "Couldn't reach the server. Try again.";
  }
}

async function call(name, data) {
  if (!isConfigured) return { error: 'Not connected to the server.' };
  try {
    const res = await httpsCallable(getFunctions(), name)(data);
    return res.data;
  } catch (err) {
    return { error: message(err) };
  }
}

export const UserAdminService = {
  listUsers: ({ includeGuests = false } = {}) => call('adminListUsers', { includeGuests }),
  getUserDetail: (uid) => call('adminGetUserDetail', { uid }),
  setRole: (uid, role, value) => call('adminSetRole', { uid, role, value }),
};
```

  `UserAdminService.listUsers()`, called with no options, sends `{ includeGuests: false }`.

- [ ] **Step 4: Pass. Step 5: Commit** — gated, `feat(users): client service for user management`.

---

### Task 6: The Users admin tab (`AdminUsers.jsx`)

**Files:**
- Create `src/components/AdminUsers.jsx`; test in `src/components/__tests__/AdminUsers.test.jsx`.
- Modify `src/components/AdminPanel.jsx`: add the admin-only tab `{ id: 'users', label: 'Users', icon: Users }` and `{activeTab === 'users' && isAdmin && <AdminUsers />}`. `Users` is already imported, and is used by Contributors too, so give the Contributors tab `Ticket` instead. Add an AdminPanel test that clicks **Users**, with `../../components/AdminUsers` mocked.

**Interface:** `<AdminUsers now={() => Date.now()} />`.
- **On mount:** `listUsers({ includeGuests })`, reloaded when the guests toggle changes.
- **Controls:**
  - `aria-label="Search users"` filters on email, name or uid;
  - `aria-label="Role filter"` is a select with All, Pro, Contributor and Admin;
  - **Show guests** is a checkbox;
  - a count line, `N users · P Pro · C contributors`.
- **Rows:** each is a `button` named after the user (`displayName ?? email ?? uid`). It shows a provider badge (`Google` or `Guest`), "Joined <date>", "active <relative>" and role badges.
- **Detail panel** (`role="region" aria-label="User details"`), filled by `getUserDetail(uid)`:
  - **Collection:** `<unique> unique · <total> cards`, and "last change <relative>" or "—".
  - **Batches:** `<count>`, plus "latest: <name> (<cards> cards, <date>)".
  - **Decks:** `<count>`.
  - **Scans:** "last scanned <lastDay> (<count>)" or "never".
  - **Roles:** a checkbox switch for each of `Pro` (`aria-label="Pro"`) and `Contributor`.
    - Clicking one opens a confirmation, "Make <name> Pro?" or "Remove Pro from <name>?", with **Confirm** and **Cancel**.
    - Confirm calls `setRole`, then reloads the detail and the list, and shows "<name> sees the change next time they open the app."
    - For a guest, both switches are disabled, with the note "Guest accounts can't hold roles."
  - **Admin:** shown as a badge with the note "Admin is changed in the Firebase console". There is no control for it.
  - **Recent role changes:** "Pro granted by <byEmail> · <date>" or "Contributor removed by …".
- **Errors:** `{ error }` from any call shows `role="alert"` with the message.

- [ ] **Step 1: Failing tests:**

```jsx
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

const m = vi.hoisted(() => ({ listUsers: vi.fn(), getUserDetail: vi.fn(), setRole: vi.fn() }));
vi.mock('../../services/UserAdminService', () => ({ UserAdminService: m }));

import AdminUsers from '../AdminUsers';

const NOW = Date.UTC(2026, 9, 5, 12);
const U = (uid, o = {}) => ({
  uid, email: `${uid}@x.com`, displayName: o.name ?? uid, provider: o.provider ?? 'google',
  createdAt: Date.UTC(2026, 0, 1), lastSignInAt: NOW - 3600e3, lastActiveAt: o.active ?? NOW - 3600e3,
  roles: { isAdmin: false, isContributor: false, isPro: false, ...o.roles },
});
const USERS = [U('loki', { name: 'Loki', roles: { isAdmin: true, isPro: true } }), U('bob', { name: 'Bob', roles: { isPro: true } }), U('cara', { name: 'Cara' })];
const DETAIL = {
  user: USERS[2],
  collection: { unique: 120, total: 300, lastChangedAt: NOW - 7200e3 },
  batches: { count: 2, latest: { name: 'eBay SOR box', createdAt: NOW - 86400e3, cards: 384 } },
  decks: { count: 3 },
  scans: { lastDay: '2026-10-04', count: 40 },
  roleChanges: [{ role: 'isPro', from: true, to: false, byEmail: 'loki@x.com', at: NOW - 86400e3 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  m.listUsers.mockResolvedValue({ users: USERS });
  m.getUserDetail.mockResolvedValue(DETAIL);
  m.setRole.mockResolvedValue({ ok: true });
});

const renderTab = () => render(<AdminUsers now={() => NOW} />);

describe('AdminUsers', () => {
  it('lists users with roles and counts, and searches and filters them', async () => {
    renderTab();
    expect(await screen.findByRole('button', { name: /Bob/ })).toBeInTheDocument();
    expect(screen.getByText('3 users · 2 Pro · 0 contributors')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'car' } });
    expect(screen.queryByRole('button', { name: /Bob/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Role filter'), { target: { value: 'admin' } });
    expect(screen.getByRole('button', { name: /Loki/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cara/ })).not.toBeInTheDocument();
  });

  it('reloads with guests when asked', async () => {
    renderTab();
    await screen.findByRole('button', { name: /Bob/ });
    fireEvent.click(screen.getByLabelText('Show guests'));
    await waitFor(() => expect(m.listUsers).toHaveBeenLastCalledWith({ includeGuests: true }));
  });

  it('shows a user’s activity and role history', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Cara/ }));
    const panel = await screen.findByRole('region', { name: 'User details' });
    await waitFor(() => expect(within(panel).getByText(/120 unique · 300 cards/)).toBeInTheDocument());
    expect(within(panel).getByText(/eBay SOR box \(384 cards/)).toBeInTheDocument();
    expect(within(panel).getByText(/last scanned 2026-10-04 \(40\)/)).toBeInTheDocument();
    expect(within(panel).getByText(/Pro removed by loki@x.com/)).toBeInTheDocument();
    expect(m.getUserDetail).toHaveBeenCalledWith('cara');
  });

  it('confirms before granting Pro, then saves and refreshes', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Cara/ }));
    const panel = await screen.findByRole('region', { name: 'User details' });
    fireEvent.click(await within(panel).findByLabelText('Pro'));
    expect(m.setRole).not.toHaveBeenCalled();
    expect(within(panel).getByText('Make Cara Pro?')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(m.setRole).toHaveBeenCalledWith('cara', 'isPro', true));
    expect(await within(panel).findByText('Cara sees the change next time they open the app.')).toBeInTheDocument();
    expect(m.getUserDetail).toHaveBeenCalledTimes(2);
    expect(m.listUsers).toHaveBeenCalledTimes(2);
  });

  it('keeps Admin read-only and disables roles for guests', async () => {
    const guest = U('g1', { name: 'Guest one', provider: 'guest' });
    m.listUsers.mockResolvedValue({ users: [...USERS, guest] });
    m.getUserDetail.mockResolvedValueOnce({ ...DETAIL, user: USERS[0] });
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Loki/ }));
    const panel = await screen.findByRole('region', { name: 'User details' });
    expect(await within(panel).findByText('Admin is changed in the Firebase console')).toBeInTheDocument();
    expect(within(panel).queryByLabelText('Admin')).not.toBeInTheDocument();
    m.getUserDetail.mockResolvedValueOnce({ ...DETAIL, user: guest });
    fireEvent.click(screen.getByRole('button', { name: /Guest one/ }));
    await waitFor(() => expect(within(panel).getByLabelText('Pro')).toBeDisabled());
    expect(within(panel).getByText("Guest accounts can't hold roles.")).toBeInTheDocument();
  });

  it('shows errors from the server', async () => {
    m.listUsers.mockResolvedValue({ error: 'Admins only.' });
    renderTab();
    expect(await screen.findByRole('alert')).toHaveTextContent('Admins only.');
  });
});
```

  Count line check: Loki and Bob are Pro, so it reads "2 Pro". No contributors.

- [ ] **Step 2: Fail. Step 3: Implement** to the interface above:
  - hooks first;
  - relative time through a small `ago(ms, now)` helper: "just now", "N min ago", "N h ago", "N d ago", or a date beyond 30 days;
  - dates through `toLocaleDateString()`;
  - role checkboxes `checked={detail.user.roles.isPro}`, with `onChange` opening the confirmation instead of saving.

- [ ] **Step 4: Pass**, along with `AdminPanel.test.jsx`. **Step 5: Commit** — gated, `feat(users): Users tab in the admin console`.

---

### Task 7: Docs, full gate and build

- [ ] **`CLAUDE.md`:**
  - Add `artifacts/{APP_ID}/admin/audit/roleChanges/{auto}` to the path list.
  - In **Auth and roles**, after the `isPro` paragraph, add: admins grant and revoke Pro and Contributor from the admin console's **Users** tab, through the `adminSetRole` function; Admin stays console-only; every change is audited; and a user sees a change on their next app load.
  - In the Card scanner section's deploy bullet, add the three new functions to the manual deploy command.
- [ ] **`TESTING.md`:** add a "User management — manual checks" section:
  - deploy the functions;
  - search and filter users;
  - open a user;
  - grant Pro to a test account and check it can scan after reloading;
  - revoke it;
  - check the audit entry in the panel.
- [ ] **Gate:** `npm run test:unit`, lint, `npm run build`, and `node --check functions/index.js`. **Commit** — `docs: user management`.
