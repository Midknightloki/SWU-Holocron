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
    // Read, compare, write and audit in one transaction: a change is never
    // applied without its audit entry, and two admins at once can't record a
    // wrong "from".
    const { changed } = await store.applyRoleChange(uid, role, value, {
      uid, email: record.email || null, role,
      byUid: caller.uid, byEmail: (caller.token && caller.token.email) || null, at: now(),
    });
    return changed ? { ok: true } : { ok: true, unchanged: true };
  }

  return { listUsers, getUserDetail, setRole };
}

module.exports = { createAdminUsersHandlers, toUser };
