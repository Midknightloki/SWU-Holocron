import { collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, runTransaction, updateDoc } from 'firebase/firestore';
import { db, APP_ID } from '../firebase';
import { defaultBatchName } from '../utils/scanDraft';

/**
 * Scanning batches (a booster box, a pre-release): one Firestore document per
 * batch under the user, appended to on every Add, so a box added in several
 * goes is still one report. Never throws -- a report is never worth failing a
 * collection commit over.
 *
 * @environment:firebase
 */
const cents = (v) => Math.round(v * 100) / 100;
const batchesRef = (uid) => collection(db, 'artifacts', APP_ID, 'users', uid, 'batches');
const batchRef = (uid, id) => doc(db, 'artifacts', APP_ID, 'users', uid, 'batches', id);
const fail = (err) => ({ error: err?.message ?? 'unknown' });

/** Add lines into a batch's card map. A line's first isNew and price stick. */
export function mergeLines(cards, lines) {
  const next = { ...cards };
  for (const { id, ...line } of lines) {
    const prev = next[id];
    next[id] = prev ? { ...prev, qty: prev.qty + line.qty } : { ...line };
  }
  return next;
}

export function summarize(cards) {
  const lines = Object.values(cards);
  const key = (l) => `${l.set}_${l.number}`;
  return {
    cards: lines.reduce((s, l) => s + l.qty, 0),
    unique: new Set(lines.map(key)).size,
    newUnique: new Set(lines.filter((l) => l.isNew).map(key)).size,
    valueAtAdd: cents(lines.reduce((s, l) => s + (typeof l.priceAtAdd === 'number' ? l.priceAtAdd * l.qty : 0), 0)),
  };
}

export const BatchService = {
  async appendToBatch(uid, batch, lines) {
    if (!db) return { error: 'offline' };
    try {
      const ref = batchRef(uid, batch.id);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const exists = snap.exists();
        const data = exists ? snap.data() : { createdAt: batch.createdAt, closedAt: null, cards: {} };
        const cards = mergeLines(data.cards ?? {}, lines);
        // The draft's name and price win only when they changed since its
        // last append: otherwise a rename made from the Batches list would be
        // undone by the next Add.
        const nameChanged = !exists || batch.name !== batch.syncedName;
        const priceChanged = !exists || (batch.pricePaid ?? null) !== (batch.syncedPricePaid ?? null);
        tx.set(ref, {
          ...data,
          name: nameChanged ? (batch.name?.trim() || defaultBatchName(batch.createdAt)) : data.name,
          pricePaid: priceChanged ? (batch.pricePaid ?? null) : (data.pricePaid ?? null),
          cards,
          summary: summarize(cards),
          updatedAt: Date.now(),
        });
      });
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  },

  async closeBatch(uid, id, extra = {}) {
    try {
      await updateDoc(batchRef(uid, id), { ...extra, closedAt: Date.now() });
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  },

  async listBatches(uid) {
    try {
      const snap = await getDocs(query(batchesRef(uid), orderBy('createdAt', 'desc')));
      return snap.docs.map((d) => {
        const { name, createdAt, closedAt, pricePaid, summary } = d.data();
        return { id: d.id, name, createdAt, closedAt: closedAt ?? null, pricePaid: pricePaid ?? null, summary };
      });
    } catch (err) {
      return fail(err);
    }
  },

  async getBatch(uid, id) {
    try {
      const snap = await getDoc(batchRef(uid, id));
      return snap.exists() ? { id, ...snap.data() } : null;
    } catch {
      return null;
    }
  },

  async renameBatch(uid, id, name) {
    try { await updateDoc(batchRef(uid, id), { name }); return { ok: true }; } catch (err) { return fail(err); }
  },

  async setBatchPricePaid(uid, id, pricePaid) {
    try { await updateDoc(batchRef(uid, id), { pricePaid }); return { ok: true }; } catch (err) { return fail(err); }
  },

  async deleteBatch(uid, id) {
    try { await deleteDoc(batchRef(uid, id)); return { ok: true }; } catch (err) { return fail(err); }
  },
};
