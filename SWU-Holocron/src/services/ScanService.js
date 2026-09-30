import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, increment, writeBatch } from 'firebase/firestore';
import { db, isConfigured } from '../firebase';
import { CardService } from './CardService';
import { normalizeSetCode, resolveScan } from '../utils/scanResolve';
import { removeRows, toWrites } from '../utils/scanDraft';

/**
 * Card scanner: sends one photo to the scanCard Cloud Function, resolves what
 * it read against the card data the app already has, and commits an approved
 * batch to the user's collection.
 *
 * Commits are additive (increment), unlike CSV import, which overwrites:
 * scanning one more copy of a card you own two of must leave you with three.
 *
 * @environment:firebase
 */

export const COMMIT_CHUNK_SIZE = 400;

const NETWORK_CODES = new Set(['unavailable', 'deadline-exceeded']);

export function mapScanError(err) {
  const code = String(err?.code ?? '').replace(/^functions\//, '');
  if (code === 'resource-exhausted') {
    return { error: 'quota', limit: err.details?.limit ?? null, resetsAt: err.details?.resetsAt ?? null };
  }
  if (code === 'permission-denied' || code === 'unauthenticated') return { error: 'forbidden' };
  if (NETWORK_CODES.has(code) || !code) return { error: 'network' };
  return { error: 'unknown' };
}

// Set data per code, shared across a scanning session. A failed load is
// dropped so the next scan retries it.
const setCache = new Map();

export function resetSetCache() {
  setCache.clear();
}

function cardsForSet(setCode) {
  if (!setCache.has(setCode)) {
    const pending = CardService.fetchSetData(setCode)
      .then((result) => result?.data ?? [])
      .catch((err) => {
        setCache.delete(setCode);
        throw err;
      });
    setCache.set(setCode, pending);
  }
  return setCache.get(setCode);
}

export const ScanService = {
  async scan(imageBase64, setCodes) {
    if (!isConfigured) return { status: 'failed', error: 'unknown' };

    let read;
    try {
      const call = httpsCallable(getFunctions(), 'scanCard');
      read = (await call({ image: imageBase64 })).data;
    } catch (err) {
      return { status: 'failed', ...mapScanError(err) };
    }

    const set = normalizeSetCode(read?.set, setCodes);
    let cards = null;
    if (set) {
      try {
        cards = await cardsForSet(set);
      } catch {
        return { status: 'failed', error: 'network' };
      }
    }

    return resolveScan(read, { setCodes, getCards: (code) => (code === set ? cards : null) });
  },

  async commitDraft(draft, collectionRef, { onProgress = () => {} } = {}) {
    const writes = toWrites(draft);
    let current = draft;

    for (let i = 0; i < writes.length; i += COMMIT_CHUNK_SIZE) {
      const chunk = writes.slice(i, i + COMMIT_CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const write of chunk) {
        batch.set(doc(collectionRef, write.collectionId), {
          quantity: increment(write.qty),
          set: write.set,
          number: write.number,
          name: write.name,
          isFoil: write.isFoil,
          timestamp: Date.now(),
        }, { merge: true });
      }
      await batch.commit();

      // Drop what just landed before touching the next chunk: an increment
      // applied twice counts the card twice, so a retry after a failure here
      // must only ever see the rows that did not make it.
      current = removeRows(current, chunk.flatMap((write) => write.rowIds));
      onProgress(current);
    }

    return current;
  },
};
