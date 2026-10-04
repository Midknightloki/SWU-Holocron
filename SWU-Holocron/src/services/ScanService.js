import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, increment, writeBatch } from 'firebase/firestore';
import { db, isConfigured } from '../firebase';
import { CardService } from './CardService';
import { normalizeSetCode, relatedSetCodes, resolveScan } from '../utils/scanResolve';
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

// One commit at a time per page. Firestore's web SDK queues writes while
// offline, so a commit can stay pending indefinitely; if the user closed the
// scanner and reopened it, the saved draft would still hold every row and a
// second Add would queue the same increments again. Refusing here is what
// stops that double count.
let commitInFlight = false;

export const ScanService = {
  /**
   * @param {string[]} [options.hintSets] sets picked in the scanner, tried when
   *   the printed set code was misread or illegible
   * @param {string[]} [options.baseSets] base sets, searched for a face-up
   *   leader (no collector number) after the hints; loaded only when needed
   */
  async scan(imageBase64, setCodes, { hintSets = [], baseSets = [] } = {}) {
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

    const loaded = set ? { [set]: cards } : {};
    const hints = hintSets.filter((code) => setCodes.includes(code));
    const bases = baseSets.filter((code) => setCodes.includes(code));
    const resolve = () => resolveScan(read, { setCodes, getCards: (code) => loaded[code] ?? null, hintSets: hints, baseSets: bases });

    const first = resolve();
    if (first.status !== 'unidentified' || !['no-such-card', 'name-mismatch', 'unknown-set', 'no-number'].includes(first.reason)) {
      return first;
    }

    // Only now load what a fallback needs: the promo sets printed with this
    // code, and the picked sets with their promo sets. A set that fails to
    // load is skipped.
    const extra = new Set(set ? relatedSetCodes(set, setCodes) : []);
    // A face-up leader (no number) is looked up by name in the base sets too.
    // Only with a subtitle: without one, matchLeader can't match anything, and
    // the base sets are ~7 MB of downloads for nothing.
    if (first.reason === 'no-number' && String(read?.subtitle ?? '').trim()) bases.forEach((code) => extra.add(code));
    for (const code of hints) {
      extra.add(code);
      relatedSetCodes(code, setCodes).forEach((c) => extra.add(c));
    }
    Object.keys(loaded).forEach((code) => extra.delete(code));
    if (extra.size === 0) return first;

    const codes = [...extra];
    const results = await Promise.allSettled(codes.map((code) => cardsForSet(code)));
    codes.forEach((code, i) => {
      if (results[i].status === 'fulfilled') loaded[code] = results[i].value;
    });
    return resolve();
  },

  /** Warm the per-session set cache (e.g. for sets picked in the scanner). Never throws. */
  async prefetchSets(codes) {
    await Promise.allSettled(codes.map((code) => cardsForSet(code)));
  },

  /** Finds the card in a rig-calibration photo. Never throws. */
  async locateCard(imageBase64) {
    if (!isConfigured) return { error: 'unknown' };
    try {
      const call = httpsCallable(getFunctions(), 'locateCard');
      const data = (await call({ image: imageBase64 })).data;
      return { found: data?.found === true, box: data?.found === true ? data.box ?? null : null };
    } catch (err) {
      return mapScanError(err);
    }
  },

  async commitDraft(draft, collectionRef, { onProgress = () => {} } = {}) {
    if (commitInFlight) {
      throw Object.assign(new Error('A previous save is still in progress.'), { code: 'commit-in-progress' });
    }
    commitInFlight = true;
    try {
      return await commitChunks(draft, collectionRef, onProgress);
    } finally {
      commitInFlight = false;
    }
  },
};

async function commitChunks(draft, collectionRef, onProgress) {
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
}
