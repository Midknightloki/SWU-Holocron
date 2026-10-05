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
