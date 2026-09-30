/**
 * Card-scanner batch ("draft"): the rows captured in a scanning session,
 * before the user approves them into their collection.
 *
 * Pure functions over an immutable { rows } value. The storage helpers take
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
  return { rows: draft.rows.map((row) => (wanted.has(row.id) ? fn(row) : row)) };
};

export function addCapture(draft, { id, isFoil, photo }) {
  return {
    rows: [...draft.rows, { id, status: 'reading', isFoil: Boolean(isFoil), qty: 1, photo: photo ?? null }],
  };
}

export function applyResult(draft, id, result) {
  return mapRows(draft, [id], (row) => {
    if (result.status === 'matched') {
      return { ...row, status: 'matched', set: result.set, number: result.number, name: result.name, reason: null, read: null };
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
    reason: null,
    read: null,
  }));
}

export function setFoil(draft, ids, isFoil) {
  return mapRows(draft, ids, (row) => ({ ...row, isFoil: Boolean(isFoil) }));
}

export function removeRows(draft, ids) {
  const gone = new Set(ids);
  return { rows: draft.rows.filter((row) => !gone.has(row.id)) };
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
        isFoil: row.isFoil,
        photo: row.photo,
        hadPhoto: Boolean(row.hadPhoto),
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
    rows: draft.rows
      .filter((row) => !dropped.has(row.id))
      .map((row) => (row.id === keep.id ? { ...row, qty } : row)),
  };
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
  const counts = { reading: 0, matched: 0, unidentified: 0, failed: 0 };
  for (const row of draft.rows) counts[row.status] += row.qty;
  return counts;
}

export function saveDraft(storage, uid, draft) {
  try {
    const rows = draft.rows.map(({ photo, ...row }) => ({ ...row, hadPhoto: Boolean(photo) || Boolean(row.hadPhoto) }));
    storage.setItem(draftKey(uid), JSON.stringify({ rows }));
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
    return {
      rows: parsed.rows
        .filter((row) => row && typeof row.id === 'string')
        .map((row) => ({
          ...row,
          photo: null,
          ...(row.status === 'reading' ? { status: 'failed', reason: 'interrupted' } : {}),
        })),
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
