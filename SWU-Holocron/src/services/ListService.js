import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, updateDoc } from 'firebase/firestore';
import { db, APP_ID } from '../firebase';

/**
 * Saved trade and wants lists, one document per list under the user. Never
 * throws -- every method returns { error } on failure.
 *
 * @environment:firebase
 */
const listsRef = (uid) => collection(db, 'artifacts', APP_ID, 'users', uid, 'lists');
const listRef = (uid, id) => doc(db, 'artifacts', APP_ID, 'users', uid, 'lists', id);
const fail = (err) => ({ error: err?.message ?? 'unknown' });
const DEFAULT_NAME = { trade: 'Trade list', wants: 'Wants list' };

// Offline, Firestore queues a write and its promise never settles. Stop
// waiting so the screen can say the change isn't saved, rather than look
// saved while it sits in a queue a reload would drop.
export const WRITE_TIMEOUT_MS = 8000;
const settle = (promise) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), WRITE_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

export const ListService = {
  async listLists(uid, kind) {
    if (!db) return { error: 'offline' };
    try {
      const snap = await getDocs(query(listsRef(uid), orderBy('updatedAt', 'desc')));
      const lists = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((l) => !kind || l.kind === kind);
      return { lists };
    } catch (err) {
      return fail(err);
    }
  },

  async getList(uid, id) {
    if (!db) return { error: 'offline' };
    try {
      const snap = await getDoc(listRef(uid, id));
      return snap.exists() ? { list: { id, ...snap.data() } } : { error: 'not-found' };
    } catch (err) {
      return fail(err);
    }
  },

  async createList(uid, { kind, name, items = {}, source = null, showPrices = true }) {
    if (!db) return { error: 'offline' };
    try {
      const now = Date.now();
      const ref = await settle(addDoc(listsRef(uid), {
        kind, name: name?.trim() || DEFAULT_NAME[kind], items, source, showPrices, createdAt: now, updatedAt: now,
      }));
      return { id: ref.id };
    } catch (err) {
      return fail(err);
    }
  },

  async updateList(uid, id, patch) {
    if (!db) return { error: 'offline' };
    try {
      await settle(updateDoc(listRef(uid, id), { ...patch, updatedAt: Date.now() }));
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  },

  async deleteList(uid, id) {
    if (!db) return { error: 'offline' };
    try {
      await settle(deleteDoc(listRef(uid, id)));
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  },
};
