/**
 * The app's one IndexedDB database. Every store is created here, so a
 * version bump can never leave one module opening an older version than
 * another (a lower requested version fails with VersionError).
 *
 * Opening never throws and never hangs: IndexedDB can stall without firing
 * success/error/blocked (WebKit has shipped this), so an open gives up after
 * 2 s and resolves null; callers degrade to fetching / memory.
 *
 * @environment:web-indexeddb
 */
export const DB_NAME = 'swu-holocron';
export const DB_VERSION = 2;
export const STORES = { cardSets: 'cardSets', scanPhotos: 'scanPhotos' };
const OPEN_TIMEOUT_MS = 2000;

export function createDbOpener({ indexedDB = globalThis.indexedDB, openTimeoutMs = OPEN_TIMEOUT_MS } = {}) {
  let dbPromise = null;

  const openOnce = () => new Promise((resolve) => {
    let settled = false;
    const done = (db) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(db);
    };
    const timer = setTimeout(() => done(null), openTimeoutMs);
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      done(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.cardSets)) db.createObjectStore(STORES.cardSets, { keyPath: 'setCode' });
      if (!db.objectStoreNames.contains(STORES.scanPhotos)) db.createObjectStore(STORES.scanPhotos);
    };
    req.onsuccess = () => {
      const db = req.result;
      if (settled) {
        db.close();
        return;
      }
      db.onclose = () => { dbPromise = null; };
      db.onversionchange = () => {
        try { db.close(); } catch { /* already closed */ }
        dbPromise = null;
      };
      done(db);
    };
    req.onerror = () => done(null);
    req.onblocked = () => done(null);
  });

  return {
    open() {
      if (!indexedDB) return Promise.resolve(null);
      if (!dbPromise) {
        const attempt = openOnce();
        dbPromise = attempt;
        attempt.then((db) => { if (!db && dbPromise === attempt) dbPromise = null; });
      }
      return dbPromise;
    },
  };
}
