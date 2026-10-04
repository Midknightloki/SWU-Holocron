import { describe, it, expect } from 'vitest';
import {
  emptyDraft, draftKey, addCapture, applyResult, markReading, resolveManually,
  setFoil, removeRows, groupRows, setGroupQuantity, toWrites, countByStatus,
  saveDraft, loadDraft, clearDraft,
} from '../../utils/scanDraft';

const memoryStorage = () => {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
};
const throwingStorage = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
  removeItem: () => { throw new Error('denied'); },
};

const LUKE = { status: 'matched', set: 'SOR', number: '012', name: 'Luke Skywalker' };

const capture = (draft, id, isFoil = false) => addCapture(draft, { id, isFoil, photo: `photo-${id}` });
const matched = (draft, id, isFoil = false, result = LUKE) => applyResult(capture(draft, id, isFoil), id, result);

describe('adding and resolving captures', () => {
  it('adds a capture as a reading row with its photo', () => {
    const d = capture(emptyDraft(), 'a', true);
    expect(d.rows).toEqual([{ id: 'a', status: 'reading', isFoil: true, qty: 1, photo: 'photo-a' }]);
  });

  it('keeps the card type from a match and from a manual pick', () => {
    const d = applyResult(capture(emptyDraft(), 'a'), 'a', { ...LUKE, type: 'Leader' });
    expect(groupRows(d)[0].type).toBe('Leader');
    const u = applyResult(capture(emptyDraft(), 'b'), 'b', { status: 'unidentified', reason: 'unreadable', read: null });
    const picked = resolveManually(u, 'b', { Set: 'SOR', Number: 20, Name: 'Echo Base', Type: 'Base' });
    expect(groupRows(picked)[0].type).toBe('Base');
  });

  it('keeps a name-only (no number) match marked, so review can ask to check the printing', () => {
    const d = applyResult(capture(emptyDraft(), 'a'), 'a', { ...LUKE, type: 'Leader', via: 'name' });
    expect(groupRows(d)[0].via).toBe('name');
    expect(groupRows(applyResult(capture(emptyDraft(), 'b'), 'b', LUKE))[0].via).toBeNull();
  });

  it('applies a matched result', () => {
    const d = matched(emptyDraft(), 'a');
    expect(d.rows[0]).toMatchObject({ status: 'matched', set: 'SOR', number: '012', name: 'Luke Skywalker' });
  });

  it('applies an unidentified result and keeps what was read', () => {
    const read = { readable: true, set: 'SOR', number: '999', name: 'Nobody' };
    const d = applyResult(capture(emptyDraft(), 'a'), 'a', { status: 'unidentified', reason: 'no-such-card', read });
    expect(d.rows[0]).toMatchObject({ status: 'unidentified', reason: 'no-such-card', read, photo: 'photo-a' });
  });

  it('applies a failure with its error as the reason', () => {
    const d = applyResult(capture(emptyDraft(), 'a'), 'a', { status: 'failed', error: 'network' });
    expect(d.rows[0]).toMatchObject({ status: 'failed', reason: 'network' });
  });

  it('marks a row reading again for a retry', () => {
    const failed = applyResult(capture(emptyDraft(), 'a'), 'a', { status: 'failed', error: 'network' });
    expect(markReading(failed, 'a').rows[0]).toMatchObject({ status: 'reading', reason: null });
  });

  it('resolves an unidentified row from a picked card', () => {
    const d = applyResult(capture(emptyDraft(), 'a'), 'a', { status: 'unidentified', reason: 'unreadable', read: null });
    const card = { Set: 'SHD', Number: 7, Name: 'Boba Fett' };
    expect(resolveManually(d, 'a', card).rows[0]).toMatchObject({ status: 'matched', set: 'SHD', number: '007', name: 'Boba Fett' });
  });

  it('does not touch other rows', () => {
    let d = capture(capture(emptyDraft(), 'a'), 'b');
    d = applyResult(d, 'a', LUKE);
    expect(d.rows[1].status).toBe('reading');
  });
});

describe('grouping and editing', () => {
  it('groups identical matched captures into one line', () => {
    let d = matched(emptyDraft(), 'a');
    d = matched(d, 'b');
    const groups = groupRows(d);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'SOR_012_std', qty: 2 });
  });

  it('keeps foil and standard copies of the same card apart', () => {
    let d = matched(emptyDraft(), 'a', false);
    d = matched(d, 'b', true);
    expect(groupRows(d).map((g) => g.key)).toEqual(['SOR_012_std', 'SOR_012_foil']);
    expect(toWrites(d).map((w) => w.collectionId)).toEqual(['SOR_012_std', 'SOR_012_foil']);
  });

  it('never groups unidentified rows together', () => {
    let d = applyResult(capture(emptyDraft(), 'a'), 'a', { status: 'unidentified', reason: 'unreadable', read: null });
    d = applyResult(capture(d, 'b'), 'b', { status: 'unidentified', reason: 'unreadable', read: null });
    expect(groupRows(d)).toHaveLength(2);
  });

  it('flips foil on the given rows', () => {
    const d = setFoil(matched(emptyDraft(), 'a'), ['a'], true);
    expect(d.rows[0].isFoil).toBe(true);
  });

  it('sets a group quantity by collapsing it onto one row', () => {
    let d = matched(emptyDraft(), 'a');
    d = matched(d, 'b');
    d = setGroupQuantity(d, 'SOR_012_std', 5);
    expect(d.rows).toHaveLength(1);
    expect(groupRows(d)[0].qty).toBe(5);
  });

  it('removes the group when its quantity is set to zero', () => {
    const d = setGroupQuantity(matched(emptyDraft(), 'a'), 'SOR_012_std', 0);
    expect(d.rows).toEqual([]);
  });

  it('removes rows by id', () => {
    const d = removeRows(capture(capture(emptyDraft(), 'a'), 'b'), ['a']);
    expect(d.rows.map((r) => r.id)).toEqual(['b']);
  });

  it('counts rows by status, summing quantity', () => {
    let d = setGroupQuantity(matched(emptyDraft(), 'a'), 'SOR_012_std', 3);
    d = capture(d, 'b');
    expect(countByStatus(d)).toEqual({ reading: 1, matched: 3, unidentified: 0, failed: 0 });
  });
});

describe('toWrites', () => {
  it('emits one write per matched group, with its row ids', () => {
    let d = matched(emptyDraft(), 'a');
    d = matched(d, 'b');
    expect(toWrites(d)).toEqual([
      { collectionId: 'SOR_012_std', set: 'SOR', number: '012', name: 'Luke Skywalker', isFoil: false, qty: 2, rowIds: ['a', 'b'] },
    ]);
  });

  it('excludes reading, unidentified and failed rows', () => {
    let d = capture(emptyDraft(), 'r');
    d = applyResult(capture(d, 'u'), 'u', { status: 'unidentified', reason: 'unreadable', read: null });
    d = applyResult(capture(d, 'f'), 'f', { status: 'failed', error: 'network' });
    expect(toWrites(d)).toEqual([]);
  });
});

describe('persistence', () => {
  it('round-trips a draft without its photos', () => {
    const storage = memoryStorage();
    const d = matched(emptyDraft(), 'a');
    expect(saveDraft(storage, 'uid-1', d)).toBe(true);
    const loaded = loadDraft(storage, 'uid-1');
    expect(loaded.rows[0]).toMatchObject({ id: 'a', status: 'matched', photo: null, hadPhoto: true });
  });

  it('turns a row still reading at reload into an interrupted failure', () => {
    const storage = memoryStorage();
    saveDraft(storage, 'uid-1', capture(emptyDraft(), 'a'));
    expect(loadDraft(storage, 'uid-1').rows[0]).toMatchObject({ status: 'failed', reason: 'interrupted', photo: null });
  });

  it('keeps each user\'s draft separate', () => {
    const storage = memoryStorage();
    saveDraft(storage, 'user-a', matched(emptyDraft(), 'a'));
    expect(loadDraft(storage, 'user-b')).toEqual(emptyDraft());
    expect(draftKey('user-a')).toBe('swu-scan-draft-user-a');
  });

  it('returns an empty draft for missing or corrupt data', () => {
    const storage = memoryStorage();
    expect(loadDraft(storage, 'uid-1')).toEqual(emptyDraft());
    storage.setItem(draftKey('uid-1'), '{not json');
    expect(loadDraft(storage, 'uid-1')).toEqual(emptyDraft());
    storage.setItem(draftKey('uid-1'), JSON.stringify({ rows: 'nope' }));
    expect(loadDraft(storage, 'uid-1')).toEqual(emptyDraft());
  });

  it('saveDraft returns false instead of throwing', () => {
    expect(saveDraft(throwingStorage, 'uid-1', matched(emptyDraft(), 'a'))).toBe(false);
    expect(saveDraft(null, 'uid-1', emptyDraft())).toBe(false);
  });

  it('loadDraft returns an empty draft when storage throws', () => {
    expect(loadDraft(throwingStorage, 'uid-1')).toEqual(emptyDraft());
    expect(() => clearDraft(throwingStorage, 'uid-1')).not.toThrow();
  });

  it('clears a saved draft', () => {
    const storage = memoryStorage();
    saveDraft(storage, 'uid-1', matched(emptyDraft(), 'a'));
    clearDraft(storage, 'uid-1');
    expect(loadDraft(storage, 'uid-1')).toEqual(emptyDraft());
  });
});
