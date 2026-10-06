import { addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocs, orderBy, query, updateDoc, writeBatch } from 'firebase/firestore';
import { db, APP_ID } from '../firebase';

/**
 * Saved trade and wants lists, one document per list under the user. Never
 * throws -- every method returns { error } on failure.
 *
 * @environment:firebase
 */
const listsRef = (uid) => collection(db, 'artifacts', APP_ID, 'users', uid, 'lists');
const listRef = (uid, id) => doc(db, 'artifacts', APP_ID, 'users', uid, 'lists', id);
// Shared copies: `publicLists/{code}` is 4 segments, a valid document path.
const publicListRef = (code) => doc(db, 'artifacts', APP_ID, 'publicLists', code);
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i look-alikes
const randomValues = (n) => crypto.getRandomValues(new Uint32Array(n));
export const newListCode = (rand = randomValues) => Array.from(rand(8), (v) => CODE_CHARS[v % CODE_CHARS.length]).join('');
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

  async deleteList(uid, id, code) {
    if (!db) return { error: 'offline' };
    try {
      if (code) {
        // A shared list takes its public copy with it: no orphaned link.
        const batch = writeBatch(db);
        batch.delete(listRef(uid, id));
        batch.delete(publicListRef(code));
        await settle(batch.commit());
      } else {
        await settle(deleteDoc(listRef(uid, id)));
      }
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  },

  async shareList(uid, listId, body, { makeCode = newListCode } = {}) {
    if (!db) return { error: 'offline' };
    try {
      let code = null;
      for (let i = 0; i < 5 && !code; i++) {
        const candidate = makeCode();
        const taken = await settle(getDoc(publicListRef(candidate)));
        if (!taken.exists()) code = candidate;
      }
      if (!code) return { error: 'no-code' };
      const now = Date.now();
      const batch = writeBatch(db);
      batch.set(publicListRef(code), { ...body, uid, updatedAt: now });
      batch.update(listRef(uid, listId), { publicCode: code, updatedAt: now });
      await settle(batch.commit());
      return { code };
    } catch (err) {
      return fail(err);
    }
  },

  async updatePublic(uid, code, body) {
    if (!db) return { error: 'offline' };
    try {
      // An update, never a set: a late or queued write must not bring back a
      // copy whose sharing was stopped (here or on another device). Fields
      // the body no longer has -- prices turned off -- are removed.
      await settle(updateDoc(publicListRef(code), {
        value: deleteField(), pricesAsOf: deleteField(), ...body, uid, updatedAt: Date.now(),
      }));
      return { ok: true };
    } catch (err) {
      if (err?.code === 'not-found' || err?.code === 'permission-denied') return { error: 'not-shared' };
      return fail(err);
    }
  },

  async unshareList(uid, listId, code) {
    if (!db) return { error: 'offline' };
    try {
      const batch = writeBatch(db);
      batch.delete(publicListRef(code));
      batch.update(listRef(uid, listId), { publicCode: deleteField(), updatedAt: Date.now() });
      await settle(batch.commit());
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  },

  /** Anyone can read a shared list -- no sign-in needed. */
  async getPublicList(code) {
    if (!db) return { error: 'offline' };
    try {
      const snap = await getDoc(publicListRef(code));
      return snap.exists() ? { list: { code, ...snap.data() } } : { error: 'not-found' };
    } catch (err) {
      return fail(err);
    }
  },
};
