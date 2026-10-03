/**
 * Card-set cache in IndexedDB.
 *
 * This replaces `localStorage['swu-cards-{SET}']`. At ~650 KB per base set the
 * old cache filled the browser's ~5 MB localStorage quota, after which every
 * other localStorage write failed silently: rig calibration, scan drafts, and
 * caching any further set (whose fetch then fell through to the "offline"
 * collection-only fallback). IndexedDB's quota is a share of free disk space.
 *
 * Like the old cache it has no TTL: a set is served until loadSetData(force).
 *
 * Never throws. With no IndexedDB (very old browsers, some private modes) get
 * misses and set reports false, and the app simply fetches each time.
 *
 * @environment:web-indexeddb @environment:web-localstorage (migration only)
 */
export const LEGACY_PREFIX = 'swu-cards-';
const DB_NAME = 'swu-holocron';
const DB_VERSION = 1;
const STORE = 'cardSets';
// IndexedDB can hang without ever firing success/error/blocked (WebKit has
// shipped this). Give up quickly: the app just fetches the set instead.
const OPEN_TIMEOUT_MS = 2000;
const READ_TIMEOUT_MS = 2000;

const defaultLocalStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const request = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const withTimeout = (promise, ms, fallback) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve(fallback), ms);
  promise.then(
    (value) => { clearTimeout(timer); resolve(value); },
    () => { clearTimeout(timer); resolve(fallback); },
  );
});

export function createCardCache({ indexedDB = globalThis.indexedDB, openTimeoutMs = OPEN_TIMEOUT_MS } = {}) {
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
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'setCode' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // A late success after the timeout: don't leak the connection.
      if (settled) {
        db.close();
        return;
      }
      // iOS drops connections when a PWA is backgrounded; a version bump in
      // another tab must not be blocked by this one. Either way, forget the
      // connection so the next call reopens.
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

  const open = () => {
    if (!indexedDB) return Promise.resolve(null);
    if (!dbPromise) {
      const attempt = openOnce();
      dbPromise = attempt;
      // A failed or timed-out open is not cached for the whole session.
      attempt.then((db) => { if (!db && dbPromise === attempt) dbPromise = null; });
    }
    return dbPromise;
  };

  const put = async (setCode, cards) => {
    const db = await open();
    if (!db) return false;
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ setCode, cards, savedAt: Date.now() });
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      return true;
    } catch {
      return false;
    }
  };

  const read = async (setCode) => {
    const db = await open();
    if (!db) return null;
    try {
      const record = await withTimeout(
        request(db.transaction(STORE, 'readonly').objectStore(STORE).get(setCode)),
        READ_TIMEOUT_MS,
        null,
      );
      return Array.isArray(record?.cards) ? record.cards : null;
    } catch {
      return null;
    }
  };

  // Move one legacy localStorage entry into IndexedDB. The key is removed once
  // it is safely stored (or found corrupt); it is kept when IndexedDB is
  // unavailable, so offline data is never thrown away.
  const migrateKey = async (storage, key) => {
    let cards = null;
    try {
      cards = JSON.parse(storage.getItem(key));
    } catch {
      cards = null;
    }
    if (!Array.isArray(cards)) {
      storage.removeItem(key);
      return null;
    }
    if (!(await put(key.slice(LEGACY_PREFIX.length), cards))) return null;
    storage.removeItem(key);
    return cards;
  };

  return {
    /**
     * Cached cards for a set, or null. On a miss, a leftover localStorage
     * entry for that set is migrated and returned.
     */
    async get(setCode, storage = defaultLocalStorage()) {
      const cards = await read(setCode);
      if (cards) return cards;
      try {
        if (storage?.getItem(`${LEGACY_PREFIX}${setCode}`) == null) return null;
        return await migrateKey(storage, `${LEGACY_PREFIX}${setCode}`);
      } catch {
        return null;
      }
    },

    /** @returns {Promise<boolean>} whether the set was stored */
    set(setCode, cards) {
      return put(setCode, cards);
    },

    /**
     * Move every legacy `swu-cards-*` entry into IndexedDB, freeing the
     * localStorage space it held. Run once at startup.
     * @returns {Promise<number>} how many sets were moved
     */
    /** Test hook: the current connection promise. */
    _connectionForTests() {
      return open();
    },

    async migrateFromLocalStorage(storage = defaultLocalStorage()) {
      if (!(await open())) return 0;
      let moved = 0;
      try {
        const keys = [];
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i);
          if (key?.startsWith(LEGACY_PREFIX)) keys.push(key);
        }
        for (const key of keys) {
          if (await migrateKey(storage, key)) moved += 1;
        }
      } catch {
        // localStorage unavailable: nothing to migrate.
      }
      return moved;
    },
  };
}

export const CardCache = createCardCache();
