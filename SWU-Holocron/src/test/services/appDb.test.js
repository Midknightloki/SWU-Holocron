import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createDbOpener, DB_NAME, DB_VERSION, STORES } from '../../services/appDb';

const openRaw = (factory, version, upgrade) => new Promise((resolve, reject) => {
  const req = factory.open(DB_NAME, version);
  req.onupgradeneeded = () => upgrade?.(req.result);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

describe('appDb', () => {
  it('opens version 2 with both stores', async () => {
    const db = await createDbOpener({ indexedDB: new IDBFactory() }).open();
    expect(DB_VERSION).toBe(2);
    expect([...db.objectStoreNames].sort()).toEqual([STORES.cardSets, STORES.scanPhotos].sort());
  });

  it('upgrades a version-1 database, keeping its card sets', async () => {
    const factory = new IDBFactory();
    const v1 = await openRaw(factory, 1, (db) => db.createObjectStore('cardSets', { keyPath: 'setCode' }));
    await new Promise((resolve) => {
      const tx = v1.transaction('cardSets', 'readwrite');
      tx.objectStore('cardSets').put({ setCode: 'SOR', cards: [1, 2] });
      tx.oncomplete = resolve;
    });
    v1.close();

    const db = await createDbOpener({ indexedDB: factory }).open();
    expect(db.objectStoreNames.contains(STORES.scanPhotos)).toBe(true);
    const record = await new Promise((resolve) => {
      const req = db.transaction('cardSets').objectStore('cardSets').get('SOR');
      req.onsuccess = () => resolve(req.result);
    });
    expect(record.cards).toEqual([1, 2]);
  });

  it('gives up on a hung open', async () => {
    const opener = createDbOpener({ indexedDB: { open: () => ({}) }, openTimeoutMs: 20 });
    await expect(opener.open()).resolves.toBeNull();
  });

  it('returns null without IndexedDB', async () => {
    await expect(createDbOpener({ indexedDB: undefined }).open()).resolves.toBeNull();
  });
});
