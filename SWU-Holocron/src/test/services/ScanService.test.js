import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  batchSet: vi.fn(),
  commit: vi.fn(),
  fetchSetData: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => mocks.callable),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((ref, id) => ({ id })),
  increment: vi.fn((n) => ({ __increment: n })),
  writeBatch: vi.fn(() => ({ set: mocks.batchSet, commit: mocks.commit })),
}));
vi.mock('../../firebase', () => ({ db: {}, isConfigured: true, APP_ID: 'test-app-id' }));
vi.mock('../../services/CardService', () => ({ CardService: { fetchSetData: mocks.fetchSetData } }));

import { ScanService, mapScanError, resetSetCache, COMMIT_CHUNK_SIZE } from '../../services/ScanService';
import { emptyDraft, addCapture, applyResult } from '../../utils/scanDraft';
import { httpsCallable } from 'firebase/functions';

const SET_CODES = ['SOR', 'SHD'];
const SOR = [{ Set: 'SOR', Number: '012', Name: 'Luke Skywalker', Subtitle: 'Faithful Friend', Type: 'Leader' }];
const READ = { readable: true, set: 'SOR', number: '012', name: 'Luke Skywalker' };

const httpsError = (code, details) => Object.assign(new Error(code), { code: `functions/${code}`, details });

const draftOf = (count) => {
  let d = emptyDraft();
  for (let i = 1; i <= count; i += 1) {
    const id = `r${i}`;
    d = addCapture(d, { id, isFoil: false, photo: null });
    d = applyResult(d, id, { status: 'matched', set: 'SOR', number: String(i).padStart(3, '0'), name: `Card ${i}` });
  }
  return d;
};

beforeEach(() => {
  vi.clearAllMocks();
  resetSetCache();
  mocks.fetchSetData.mockResolvedValue({ data: SOR });
  mocks.commit.mockResolvedValue(undefined);
});

describe('ScanService.scan', () => {
  it('resolves a read against the set data', async () => {
    mocks.callable.mockResolvedValue({ data: READ });
    await expect(ScanService.scan('IMG', SET_CODES)).resolves.toEqual({
      status: 'matched', set: 'SOR', number: '012', name: 'Luke Skywalker', type: 'Leader',
    });
    expect(mocks.callable).toHaveBeenCalledWith({ image: 'IMG' });
  });

  it('loads each set once across scans', async () => {
    mocks.callable.mockResolvedValue({ data: READ });
    await ScanService.scan('IMG', SET_CODES);
    await ScanService.scan('IMG', SET_CODES);
    expect(mocks.fetchSetData).toHaveBeenCalledTimes(1);
  });

  it('does not load set data for an unknown set', async () => {
    mocks.callable.mockResolvedValue({ data: { ...READ, set: 'XYZ' } });
    await expect(ScanService.scan('IMG', SET_CODES)).resolves.toMatchObject({ status: 'unidentified', reason: 'unknown-set' });
    expect(mocks.fetchSetData).not.toHaveBeenCalled();
  });

  it('reports a quota error with its limit and reset time', async () => {
    mocks.callable.mockRejectedValue(httpsError('resource-exhausted', { limit: 1000, resetsAt: '2026-09-30T00:00:00.000Z' }));
    await expect(ScanService.scan('IMG', SET_CODES)).resolves.toEqual({
      status: 'failed', error: 'quota', limit: 1000, resetsAt: '2026-09-30T00:00:00.000Z',
    });
  });

  it('reports a network failure without throwing', async () => {
    mocks.callable.mockRejectedValue(httpsError('unavailable'));
    await expect(ScanService.scan('IMG', SET_CODES)).resolves.toEqual({ status: 'failed', error: 'network' });
  });

  it('reports a failed set-data load as a network failure and retries it next time', async () => {
    mocks.callable.mockResolvedValue({ data: READ });
    mocks.fetchSetData.mockRejectedValueOnce(new Error('offline'));
    await expect(ScanService.scan('IMG', SET_CODES)).resolves.toEqual({ status: 'failed', error: 'network' });
    await expect(ScanService.scan('IMG', SET_CODES)).resolves.toMatchObject({ status: 'matched' });
  });
});

describe('ScanService.scan with promo sets', () => {
  const CODES = ['SHD', 'SHDOP'];
  const DATA = {
    SHD: [{ Set: 'SHD', Number: '010', Name: 'Cad Bane', Type: 'Leader' }],
    SHDOP: [{ Set: 'SHDOP', Number: '10', Name: 'Calculated Lethality', Type: 'Event' }],
  };

  beforeEach(() => {
    mocks.fetchSetData.mockImplementation(async (code) => ({ data: DATA[code] ?? [] }));
  });

  it('loads the related promo set only after the parent set fails, and matches there', async () => {
    mocks.callable.mockResolvedValue({ data: { readable: true, set: 'SHD', number: '10', name: 'Calculated Lethality' } });
    await expect(ScanService.scan('IMG', CODES)).resolves.toMatchObject({ status: 'matched', set: 'SHDOP', number: '010' });
    expect(mocks.fetchSetData.mock.calls.map(([c]) => c)).toEqual(['SHD', 'SHDOP']);
  });

  it('does not touch promo sets when the parent set matches', async () => {
    mocks.callable.mockResolvedValue({ data: { readable: true, set: 'SHD', number: '10', name: 'Cad Bane' } });
    await expect(ScanService.scan('IMG', CODES)).resolves.toMatchObject({ status: 'matched', set: 'SHD' });
    expect(mocks.fetchSetData.mock.calls.map(([c]) => c)).toEqual(['SHD']);
  });

  it('ignores a related set that fails to load', async () => {
    mocks.fetchSetData.mockImplementation(async (code) => {
      if (code === 'SHDOP') throw new Error('offline');
      return { data: DATA[code] };
    });
    mocks.callable.mockResolvedValue({ data: { readable: true, set: 'SHD', number: '10', name: 'Calculated Lethality' } });
    await expect(ScanService.scan('IMG', CODES)).resolves.toMatchObject({ status: 'unidentified', reason: 'name-mismatch' });
  });
});

describe('ScanService.scan with picked sets', () => {
  const CODES = ['SOR', 'SHD'];
  const DATA = {
    SOR: [{ Set: 'SOR', Number: '010', Name: 'Darth Vader', Type: 'Leader' }],
    SHD: [{ Set: 'SHD', Number: '010', Name: 'Cad Bane', Type: 'Leader' }],
  };

  beforeEach(() => {
    mocks.fetchSetData.mockImplementation(async (code) => ({ data: DATA[code] ?? [] }));
  });

  it('falls back to a picked set when Gemini misreads the set code', async () => {
    mocks.callable.mockResolvedValue({ data: { readable: true, set: 'SOR', number: '10', name: 'Cad Bane' } });
    await expect(ScanService.scan('IMG', CODES, { hintSets: ['SHD'] })).resolves.toMatchObject({ status: 'matched', set: 'SHD' });
  });

  it('matches through a picked set when the set code was unreadable', async () => {
    mocks.callable.mockResolvedValue({ data: { readable: true, set: '', number: '10', name: 'Cad Bane' } });
    await expect(ScanService.scan('IMG', CODES, { hintSets: ['SHD'] })).resolves.toMatchObject({ status: 'matched', set: 'SHD' });
    expect(mocks.fetchSetData.mock.calls.map(([c]) => c)).toEqual(['SHD']);
  });

  it('does not load picked sets when the printed set matches', async () => {
    mocks.callable.mockResolvedValue({ data: { readable: true, set: 'SOR', number: '10', name: 'Darth Vader' } });
    await ScanService.scan('IMG', CODES, { hintSets: ['SHD'] });
    expect(mocks.fetchSetData.mock.calls.map(([c]) => c)).toEqual(['SOR']);
  });

  it('prefetches picked sets so the first card from them does not wait, ignoring failures', async () => {
    mocks.fetchSetData.mockImplementation(async (code) => {
      if (code === 'SOR') throw new Error('offline');
      return { data: DATA[code] };
    });
    await expect(ScanService.prefetchSets(['SHD', 'SOR'])).resolves.toBeUndefined();
    mocks.callable.mockResolvedValue({ data: { readable: true, set: 'SHD', number: '10', name: 'Cad Bane' } });
    await ScanService.scan('IMG', CODES);
    expect(mocks.fetchSetData.mock.calls.map(([c]) => c)).toEqual(['SHD', 'SOR']);
  });
});

describe('ScanService.scan with a face-up leader', () => {
  const CODES = ['SOR', 'SHD', 'SHDOP'];
  const DATA = {
    SOR: [{ Set: 'SOR', Number: '017', Name: 'Han Solo', Subtitle: 'Audacious Smuggler', Type: 'Leader' }],
    SHD: [{ Set: 'SHD', Number: '012', Name: 'Han Solo', Subtitle: 'Worth the Risk', Type: 'Leader' }],
  };
  beforeEach(() => {
    mocks.fetchSetData.mockImplementation(async (code) => ({ data: DATA[code] ?? [] }));
  });

  it('loads the base sets only for a card with no number, and matches by name and subtitle', async () => {
    mocks.callable.mockResolvedValue({ data: { readable: true, set: '', number: '', name: 'Han Solo', subtitle: 'Worth the Risk' } });
    await expect(ScanService.scan('IMG', CODES, { baseSets: ['SOR', 'SHD'] }))
      .resolves.toMatchObject({ status: 'matched', set: 'SHD', number: '012' });
    expect(mocks.fetchSetData.mock.calls.map(([c]) => c).sort()).toEqual(['SHD', 'SOR']);
  });

  it('does not download the base sets for a no-number read with no subtitle (it cannot be a leader match)', async () => {
    mocks.callable.mockResolvedValue({ data: { readable: true, set: '', number: '', name: 'Battlefield Medic', subtitle: '' } });
    await expect(ScanService.scan('IMG', CODES, { baseSets: ['SOR', 'SHD'] }))
      .resolves.toMatchObject({ status: 'unidentified', reason: 'no-number' });
    expect(mocks.fetchSetData).not.toHaveBeenCalled();
  });

  it('reports no-number when no leader matches', async () => {
    mocks.callable.mockResolvedValue({ data: { readable: true, set: '', number: '', name: 'Nobody', subtitle: 'Nowhere' } });
    await expect(ScanService.scan('IMG', CODES, { baseSets: ['SOR', 'SHD'] }))
      .resolves.toMatchObject({ status: 'unidentified', reason: 'no-number' });
  });
});

describe('mapScanError', () => {
  it.each([
    ['permission-denied', { error: 'forbidden' }],
    ['unauthenticated', { error: 'forbidden' }],
    ['deadline-exceeded', { error: 'network' }],
    ['internal', { error: 'unknown' }],
  ])('maps %s', (code, expected) => {
    expect(mapScanError(httpsError(code))).toEqual(expected);
  });

  it('treats a plain network error with no code as network', () => {
    expect(mapScanError(new TypeError('Failed to fetch'))).toEqual({ error: 'network' });
  });
});

describe('ScanService.commitDraft', () => {
  it('writes increments, never absolute quantities', async () => {
    let d = draftOf(1);
    d = addCapture(d, { id: 'dup', isFoil: false, photo: null });
    d = applyResult(d, 'dup', { status: 'matched', set: 'SOR', number: '001', name: 'Card 1' });
    await ScanService.commitDraft(d, { id: 'ref' });
    expect(mocks.batchSet).toHaveBeenCalledWith(
      { id: 'SOR_001_std' },
      expect.objectContaining({ quantity: { __increment: 2 }, set: 'SOR', number: '001', name: 'Card 1', isFoil: false }),
      { merge: true },
    );
  });

  it(`commits in chunks of ${COMMIT_CHUNK_SIZE}`, async () => {
    const rest = await ScanService.commitDraft(draftOf(401), { id: 'ref' });
    expect(mocks.commit).toHaveBeenCalledTimes(2);
    expect(mocks.batchSet).toHaveBeenCalledTimes(401);
    expect(rest.rows).toEqual([]);
  });

  it('reports progress after each chunk', async () => {
    const onProgress = vi.fn();
    await ScanService.commitDraft(draftOf(401), { id: 'ref' }, { onProgress });
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls[0][0].rows).toHaveLength(1);
    expect(onProgress.mock.calls[1][0].rows).toHaveLength(0);
  });

  it('leaves exactly the uncommitted rows when a later chunk fails', async () => {
    mocks.commit.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'));
    const onProgress = vi.fn();
    await expect(ScanService.commitDraft(draftOf(401), { id: 'ref' }, { onProgress })).rejects.toThrow('offline');
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress.mock.calls[0][0].rows.map((r) => r.id)).toEqual(['r401']);
  });

  it('refuses a second commit while one is still pending', async () => {
    let release;
    mocks.commit.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = ScanService.commitDraft(draftOf(1), { id: 'ref' });
    await expect(ScanService.commitDraft(draftOf(1), { id: 'ref' })).rejects.toMatchObject({ code: 'commit-in-progress' });
    release();
    await first;
    await expect(ScanService.commitDraft(draftOf(1), { id: 'ref' })).resolves.toEqual({ rows: [] });
  });

  it('allows a new commit after a failed one', async () => {
    mocks.commit.mockRejectedValueOnce(new Error('offline'));
    await expect(ScanService.commitDraft(draftOf(1), { id: 'ref' })).rejects.toThrow('offline');
    await expect(ScanService.commitDraft(draftOf(1), { id: 'ref' })).resolves.toEqual({ rows: [] });
  });

  it('keeps unidentified rows in the draft', async () => {
    let d = draftOf(1);
    d = addCapture(d, { id: 'u', isFoil: false, photo: null });
    d = applyResult(d, 'u', { status: 'unidentified', reason: 'unreadable', read: null });
    const rest = await ScanService.commitDraft(d, { id: 'ref' });
    expect(rest.rows.map((r) => r.id)).toEqual(['u']);
  });
});

describe('ScanService.locateCard', () => {
  it('calls the locateCard function and returns the box', async () => {
    mocks.callable.mockResolvedValue({ data: { found: true, box: [100, 200, 900, 800] } });
    await expect(ScanService.locateCard('IMG')).resolves.toEqual({ found: true, box: [100, 200, 900, 800] });
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'locateCard');
    expect(mocks.callable).toHaveBeenCalledWith({ image: 'IMG' });
  });

  it('normalises a not-found answer', async () => {
    mocks.callable.mockResolvedValue({ data: { found: false } });
    await expect(ScanService.locateCard('IMG')).resolves.toEqual({ found: false, box: null });
  });

  it('maps errors without throwing', async () => {
    mocks.callable.mockRejectedValue(httpsError('resource-exhausted', { limit: 5, resetsAt: 'x' }));
    await expect(ScanService.locateCard('IMG')).resolves.toEqual({ error: 'quota', limit: 5, resetsAt: 'x' });
  });
});
