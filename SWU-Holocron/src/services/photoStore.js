import { createDbOpener, STORES } from './appDb';

/**
 * Scanner photos, keyed by draft row id, in IndexedDB -- so a whole box
 * (hundreds of ~0.5 MB JPEGs) never sits in memory, and an app restart
 * mid-batch keeps the photos for review and for reads still to do.
 *
 * Never throws. Without IndexedDB (or if it hangs) photos live in memory for
 * the session, which is how the scanner worked before.
 *
 * @environment:web-indexeddb
 */
const STORE = STORES.scanPhotos;

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

export function createPhotoStore({ indexedDB = globalThis.indexedDB, openTimeoutMs } = {}) {
  const opener = createDbOpener({ indexedDB, openTimeoutMs });
  const memory = new Map();

  return {
    async put(id, base64) {
      const db = await opener.open();
      if (db) {
        try {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(base64, id);
          await done(tx);
          return true;
        } catch {
          // fall through to memory
        }
      }
      memory.set(id, base64);
      return true;
    },

    async get(id) {
      if (memory.has(id)) return memory.get(id);
      const db = await opener.open();
      if (!db) return null;
      try {
        const value = await new Promise((resolve, reject) => {
          const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        return typeof value === 'string' ? value : null;
      } catch {
        return null;
      }
    },

    async remove(ids) {
      ids.forEach((id) => memory.delete(id));
      const db = await opener.open();
      if (!db || ids.length === 0) return;
      try {
        const tx = db.transaction(STORE, 'readwrite');
        ids.forEach((id) => tx.objectStore(STORE).delete(id));
        await done(tx);
      } catch {
        // best effort
      }
    },

    async clear() {
      memory.clear();
      const db = await opener.open();
      if (!db) return;
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        await done(tx);
      } catch {
        // best effort
      }
    },
  };
}

export const PhotoStore = createPhotoStore();
