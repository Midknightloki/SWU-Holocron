/**
 * Card-scanner batch ("draft"): the rows captured in a scanning session,
 * before the user approves them into their collection.
 *
 * Pure functions over an immutable { rows, batch? } value. The storage helpers take
 * the storage object as a parameter so tests need no real localStorage, and
 * they never throw -- a private window or a full quota must not stop scanning.
 *
 * The key is per uid: a shared key would let one account's unsaved batch be
 * committed into another account's collection on a shared device.
 *
 * @environment:web-localstorage (saveDraft / loadDraft / clearDraft)
 */
import { getCollectionId } from './collectionHelpers';
import { normalizeNumber } from './scanResolve';

export const DRAFT_KEY_PREFIX = 'swu-scan-draft-';
export const draftKey = (uid) => `${DRAFT_KEY_PREFIX}${uid}`;
export const emptyDraft = () => ({ rows: [] });

const mapRows = (draft, ids, fn) => {
  const wanted = new Set(ids);
  return { ...draft, rows: draft.rows.map((row) => (wanted.has(row.id) ? fn(row) : row)) };
};

// The photo itself lives in the photo store (IndexedDB), keyed by row id; a
// row only records that it has one, so a whole box never sits in memory.
export function addCapture(draft, { id, isFoil }) {
  return {
    ...draft,
    rows: [...draft.rows, { id, status: 'reading', isFoil: Boolean(isFoil), qty: 1, hasPhoto: true }],
  };
}

/** Rows the reading queue has paused (daily limit, offline): kept, not committed. */
export function markWaiting(draft, ids, reason) {
  return mapRows(draft, ids, (row) => ({ ...row, status: 'waiting', reason }));
}

export function applyResult(draft, id, result) {
  return mapRows(draft, [id], (row) => {
    if (result.status === 'matched') {
      return { ...row, status: 'matched', set: result.set, number: result.number, name: result.name, type: result.type ?? null, via: result.via ?? null, reason: null, read: null };
    }
    if (result.status === 'unidentified') {
      return { ...row, status: 'unidentified', reason: result.reason, read: result.read ?? null };
    }
    return { ...row, status: 'failed', reason: result.error ?? 'unknown' };
  });
}

export function markReading(draft, id) {
  return mapRows(draft, [id], (row) => ({ ...row, status: 'reading', reason: null }));
}

export function resolveManually(draft, id, card) {
  return mapRows(draft, [id], (row) => ({
    ...row,
    status: 'matched',
    set: card.Set,
    number: normalizeNumber(card.Number),
    name: card.Name,
    type: card.Type ?? null,
    reason: null,
    read: null,
  }));
}

export function setFoil(draft, ids, isFoil) {
  return mapRows(draft, ids, (row) => ({ ...row, isFoil: Boolean(isFoil) }));
}

export function removeRows(draft, ids) {
  const gone = new Set(ids);
  return { ...draft, rows: draft.rows.filter((row) => !gone.has(row.id)) };
}

export const groupKey = (row) =>
  row.status === 'matched' ? getCollectionId(row.set, row.number, row.isFoil) : row.id;

export function groupRows(draft) {
  const groups = new Map();
  for (const row of draft.rows) {
    const key = groupKey(row);
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
      existing.qty += row.qty;
    } else {
      groups.set(key, {
        key,
        rows: [row],
        qty: row.qty,
        status: row.status,
        set: row.set,
        number: row.number,
        name: row.name,
        type: row.type ?? null,
        via: row.via ?? null,
        isFoil: row.isFoil,
        hasPhoto: Boolean(row.hasPhoto),
        read: row.read ?? null,
        reason: row.reason ?? null,
      });
    }
  }
  return [...groups.values()];
}

export function setGroupQuantity(draft, key, qty) {
  const members = draft.rows.filter((row) => groupKey(row) === key);
  if (members.length === 0) return draft;
  if (qty <= 0) return removeRows(draft, members.map((row) => row.id));
  const [keep, ...rest] = members;
  const dropped = new Set(rest.map((row) => row.id));
  return {
    ...draft,
    rows: draft.rows
      .filter((row) => !dropped.has(row.id))
      .map((row) => (row.id === keep.id ? { ...row, qty } : row)),
  };
}

// Batch metadata (a box, a pre-release): created on the first capture, kept
// with the rows, and carried by every helper above so no edit loses it.
export const defaultBatchName = (ms) => `Batch ${new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

export function ensureBatch(draft, now, id) {
  // A batch whose cards were all added is finished: the next capture starts
  // the next box, rather than merging two boxes (and two prices) into one.
  const finished = draft.batch?.appended && draft.rows.length === 0;
  if (draft.batch && !finished) return draft;
  return { ...draft, batch: { id, name: defaultBatchName(now), pricePaid: null, createdAt: now } };
}

export function setBatchName(draft, name) {
  return draft.batch ? { ...draft, batch: { ...draft.batch, name } } : draft;
}

export function setPricePaid(draft, amount) {
  const pricePaid = typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 ? amount : null;
  return draft.batch ? { ...draft, batch: { ...draft.batch, pricePaid } } : draft;
}

export function toWrites(draft) {
  return groupRows(draft)
    .filter((group) => group.status === 'matched')
    .map((group) => ({
      collectionId: group.key,
      set: group.set,
      number: group.number,
      name: group.name,
      isFoil: group.isFoil,
      qty: group.qty,
      rowIds: group.rows.map((row) => row.id),
    }));
}

export function countByStatus(draft) {
  const counts = { reading: 0, matched: 0, unidentified: 0, failed: 0, waiting: 0 };
  for (const row of draft.rows) {
    if (row.status in counts) counts[row.status] += row.qty;
  }
  return counts;
}

export function saveDraft(storage, uid, draft) {
  try {
    storage.setItem(draftKey(uid), JSON.stringify({ rows: draft.rows, batch: draft.batch ?? null }));
    return true;
  } catch {
    return false;
  }
}

export function loadDraft(storage, uid) {
  try {
    const raw = storage.getItem(draftKey(uid));
    if (!raw) return emptyDraft();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.rows)) return emptyDraft();
    const batch = parsed.batch && typeof parsed.batch.id === 'string' ? parsed.batch : undefined;
    // Rows still reading stay reading: the scanner queues them again if their
    // photo is in the store. Drafts from before the photo store carried the
    // image inline -- drop it rather than hold it in memory.
    return {
      rows: parsed.rows
        .filter((row) => row && typeof row.id === 'string')
        .map(({ photo, hadPhoto, ...row }) => ({ ...row, hasPhoto: Boolean(row.hasPhoto) })),
      ...(batch ? { batch } : {}),
    };
  } catch {
    return emptyDraft();
  }
}

export function clearDraft(storage, uid) {
  try {
    storage.removeItem(draftKey(uid));
  } catch {
    // Storage unavailable: nothing was persisted, so there is nothing to clear.
  }
}
