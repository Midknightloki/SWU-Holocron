import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createCardCache, LEGACY_PREFIX } from '../../services/cardCache';

// The card cache used to live in localStorage with no TTL. At ~650 KB per base
// set it filled the ~5 MB origin quota, after which every other localStorage
// write failed silently -- rig calibration, scan drafts, even caching later sets.

const memoryStorage = (entries = {}) => {
  const data = new Map(Object.entries(entries));
  return {
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    keys: () => [...data.keys()],
  };
};

const SOR = [{ Set: 'SOR', Number: '001', Name: 'Director Krennic' }];
const SHD = [{ Set: 'SHD', Number: '001', Name: 'Cad Bane' }];

let cache;
beforeEach(() => {
  cache = createCardCache({ indexedDB: new IDBFactory() });
});

describe('cardCache', () => {
  it('stores and returns a set', async () => {
    expect(await cache.set('SOR', SOR)).toBe(true);
    expect(await cache.get('SOR')).toEqual(SOR);
  });

  it('returns null for a set it has never seen', async () => {
    expect(await cache.get('TWI')).toBeNull();
  });

  it('keeps sets separate and overwrites on re-save', async () => {
    await cache.set('SOR', SOR);
    await cache.set('SHD', SHD);
    const updated = [...SOR, { Set: 'SOR', Number: '002', Name: 'Iden Versio' }];
    await cache.set('SOR', updated);
    expect(await cache.get('SOR')).toEqual(updated);
    expect(await cache.get('SHD')).toEqual(SHD);
  });

  it('holds far more than the old localStorage quota', async () => {
    // 51 sets at ~650 KB each would be ~33 MB; check a 6 MB set round-trips.
    const big = Array.from({ length: 6000 }, (_, i) => ({ Set: 'BIG', Number: String(i), Text: 'x'.repeat(1000) }));
    expect(await cache.set('BIG', big)).toBe(true);
    expect((await cache.get('BIG')).length).toBe(6000);
  });

  describe('migration from localStorage', () => {
    it('moves every legacy set into IndexedDB and frees the localStorage keys', async () => {
      const storage = memoryStorage({
        [`${LEGACY_PREFIX}SOR`]: JSON.stringify(SOR),
        [`${LEGACY_PREFIX}SHD`]: JSON.stringify(SHD),
        'swu-scan-rig': '{"keep":"me"}',
      });
      expect(await cache.migrateFromLocalStorage(storage)).toBe(2);
      expect(await cache.get('SOR')).toEqual(SOR);
      expect(await cache.get('SHD')).toEqual(SHD);
      expect(storage.keys()).toEqual(['swu-scan-rig']);
    });

    it('drops a corrupt legacy entry instead of keeping it', async () => {
      const storage = memoryStorage({ [`${LEGACY_PREFIX}SOR`]: '{not json' });
      expect(await cache.migrateFromLocalStorage(storage)).toBe(0);
      expect(storage.keys()).toEqual([]);
    });

    it('keeps legacy entries when IndexedDB is unavailable, so offline data is not lost', async () => {
      const noIdb = createCardCache({ indexedDB: undefined });
      const storage = memoryStorage({ [`${LEGACY_PREFIX}SOR`]: JSON.stringify(SOR) });
      expect(await noIdb.migrateFromLocalStorage(storage)).toBe(0);
      expect(storage.keys()).toEqual([`${LEGACY_PREFIX}SOR`]);
    });

    it('falls back to a legacy entry on a cache miss, migrating it on the way', async () => {
      const storage = memoryStorage({ [`${LEGACY_PREFIX}SOR`]: JSON.stringify(SOR) });
      expect(await cache.get('SOR', storage)).toEqual(SOR);
      expect(storage.keys()).toEqual([]);
      expect(await cache.get('SOR')).toEqual(SOR);
    });

    it('never throws when localStorage itself throws', async () => {
      const throwing = { get length() { throw new Error('denied'); }, getItem: () => { throw new Error('denied'); } };
      await expect(cache.migrateFromLocalStorage(throwing)).resolves.toBe(0);
      await expect(cache.get('SOR', throwing)).resolves.toBeNull();
    });
  });

  describe('without IndexedDB', () => {
    it('reports misses and failed saves instead of throwing', async () => {
      const noIdb = createCardCache({ indexedDB: undefined });
      expect(await noIdb.get('SOR')).toBeNull();
      expect(await noIdb.set('SOR', SOR)).toBe(false);
    });
  });
});
