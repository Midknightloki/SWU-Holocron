import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createPhotoStore } from '../../services/photoStore';

describe('photoStore', () => {
  it('stores, reads, removes and clears photos', async () => {
    const store = createPhotoStore({ indexedDB: new IDBFactory() });
    expect(await store.put('a', 'AAA')).toBe(true);
    await store.put('b', 'BBB');
    expect(await store.get('a')).toBe('AAA');
    await store.remove(['a']);
    expect(await store.get('a')).toBeNull();
    expect(await store.get('b')).toBe('BBB');
    await store.clear();
    expect(await store.get('b')).toBeNull();
  });

  it('survives a new store instance on the same database (an app restart)', async () => {
    const factory = new IDBFactory();
    await createPhotoStore({ indexedDB: factory }).put('a', 'AAA');
    expect(await createPhotoStore({ indexedDB: factory }).get('a')).toBe('AAA');
  });

  it('falls back to memory without IndexedDB', async () => {
    const store = createPhotoStore({ indexedDB: undefined });
    expect(await store.put('a', 'AAA')).toBe(true);
    expect(await store.get('a')).toBe('AAA');
    await store.remove(['a']);
    expect(await store.get('a')).toBeNull();
  });

  it('falls back to memory when IndexedDB hangs, and never throws', async () => {
    const store = createPhotoStore({ indexedDB: { open: () => ({}) }, openTimeoutMs: 10 });
    await expect(store.put('a', 'AAA')).resolves.toBe(true);
    await expect(store.get('a')).resolves.toBe('AAA');
    await expect(store.remove(['x'])).resolves.toBeUndefined();
  });
});
