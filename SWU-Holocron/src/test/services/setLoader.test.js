import { describe, it, expect, vi } from 'vitest';
import { loadSet } from '../../services/setLoader';

const SOR = [
  { Set: 'SOR', Number: '010', Name: 'B' },
  { Set: 'SOR', Number: '2', Name: 'A' },
];
const sorted = [SOR[1], SOR[0]];

const fakeCache = (stored = {}) => ({
  get: vi.fn(async (code) => stored[code] ?? null),
  set: vi.fn(async (code, cards) => { stored[code] = cards; return true; }),
});

describe('loadSet', () => {
  it('serves a cached set without fetching', async () => {
    const cache = fakeCache({ SOR: sorted });
    const fetchSet = vi.fn();
    await expect(loadSet('SOR', { cache, fetchSet })).resolves.toEqual({ cards: sorted, source: 'cache' });
    expect(fetchSet).not.toHaveBeenCalled();
  });

  it('fetches on a miss, sorts by number, and caches the result', async () => {
    const cache = fakeCache();
    const fetchSet = vi.fn(async () => ({ data: SOR, source: 'Firestore' }));
    await expect(loadSet('SOR', { cache, fetchSet })).resolves.toEqual({ cards: sorted, source: 'Firestore' });
    expect(cache.set).toHaveBeenCalledWith('SOR', sorted);
  });

  it('skips the cache when forced', async () => {
    const cache = fakeCache({ SOR: [{ Set: 'SOR', Number: '1', Name: 'stale' }] });
    const fetchSet = vi.fn(async () => ({ data: SOR, source: 'Firestore' }));
    await expect(loadSet('SOR', { force: true, cache, fetchSet })).resolves.toMatchObject({ cards: sorted });
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('still returns fetched cards when the cache write fails', async () => {
    // The localStorage cache threw QuotaExceededError here, which sent a
    // successful fetch into the "Network offline" collection-only fallback.
    const cache = { get: vi.fn(async () => null), set: vi.fn(async () => { throw new Error('QuotaExceededError'); }) };
    const fetchSet = vi.fn(async () => ({ data: SOR, source: 'Firestore' }));
    await expect(loadSet('SOR', { cache, fetchSet })).resolves.toEqual({ cards: sorted, source: 'Firestore' });
  });

  it('returns fetched cards without waiting for the cache write', async () => {
    const cache = { get: vi.fn(async () => null), set: vi.fn(() => new Promise(() => {})) };
    const fetchSet = vi.fn(async () => ({ data: SOR, source: 'Firestore' }));
    await expect(loadSet('SOR', { cache, fetchSet })).resolves.toEqual({ cards: sorted, source: 'Firestore' });
  });

  it('still fetches when the cache read fails', async () => {
    const cache = { get: vi.fn(async () => { throw new Error('broken'); }), set: vi.fn(async () => true) };
    const fetchSet = vi.fn(async () => ({ data: SOR, source: 'Firestore' }));
    await expect(loadSet('SOR', { cache, fetchSet })).resolves.toMatchObject({ source: 'Firestore' });
  });

  it('propagates a fetch failure so the caller can fall back', async () => {
    const cache = fakeCache();
    const fetchSet = vi.fn(async () => { throw new Error('offline'); });
    await expect(loadSet('SOR', { cache, fetchSet })).rejects.toThrow('offline');
  });
});
