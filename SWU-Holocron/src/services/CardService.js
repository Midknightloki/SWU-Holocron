import { API_BASE, SETS } from '../constants';
import { LEGACY_SET_CODES } from '../setCatalog';
import { db, APP_ID } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

export const CardService = {
  getCollectionId: (set, number, isFoil) => `${set}_${number}_${isFoil ? 'foil' : 'std'}`,

  getCardImage: (set, number) => `${API_BASE}/cards/${set}/${number}?format=image`,

  getBackImage: (set, number) => `${API_BASE}/cards/${set}/${number}?format=image&face=back`,

  /**
   * Read the set registry published by scripts/setDiscovery.js.
   *
   * This replaces a loop that probed each of nine hardcoded set codes with one
   * document read. More importantly it is self-updating: a set the seeder
   * discovers appears here without any code change.
   *
   * Falls back to the bundled SETS so the app still works offline, on a cold
   * database, or if the rules deny the read -- but a fallback can never contain
   * a set nobody has typed in, so it is a degraded mode, not a substitute.
   *
   * @environment:firebase
   * @returns {Promise<Array<{code:string,name:string,isBaseSet:boolean,releaseDate:string|null}>>}
   */
  getSetRegistry: async () => {
    const fallback = () => SETS.map((s) => ({
      code: s.code,
      name: s.name,
      isBaseSet: !LEGACY_SET_CODES.includes(s.code),
      releaseDate: null,
      cardCount: null,
      parentSetId: null,
    }));

    if (!db || !APP_ID) return fallback();

    try {
      // cardDatabase(coll) -> sets(doc): 6 segments, a valid document ref.
      const registryRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'cardDatabase', 'sets');
      const snap = await getDoc(registryRef);

      if (snap.exists()) {
        const sets = snap.data()?.sets;
        if (Array.isArray(sets) && sets.length > 0) {
          return sets;
        }
      }
      console.warn('Set registry empty or missing; run `npm run admin:discover-sets`');
    } catch (error) {
      console.warn('Could not read set registry:', error.message);
    }

    return fallback();
  },

  /**
   * Set codes the app should offer, newest first.
   *
   * Legacy pseudo-codes (PROMO, OTHER) are appended because existing collection
   * documents are keyed with them -- dropping them would orphan those cards.
   * They are not real API sets and will never come back from discovery.
   *
   * @environment:web-localstorage
   * @returns {Promise<string[]>}
   */
  getAvailableSets: async () => {
    const cacheKey = 'swu-available-sets';

    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const { sets, timestamp } = JSON.parse(cached);
        if (Array.isArray(sets) && Date.now() - timestamp < 24 * 60 * 60 * 1000) {
          return sets;
        }
      } catch (e) {
        // corrupt cache entry -- fall through and refetch
      }
    }

    const registry = await CardService.getSetRegistry();
    const codes = registry.map((s) => s.code);

    for (const legacy of LEGACY_SET_CODES) {
      if (!codes.includes(legacy)) codes.push(legacy);
    }

    try {
      localStorage.setItem(cacheKey, JSON.stringify({ sets: codes, timestamp: Date.now() }));
    } catch (e) {
      // storage full or unavailable -- the value is a convenience, not required
    }

    return codes;
  },

  fetchWithTimeout: async (url, options = {}, timeout = 35000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      return response;
    } catch (error) {
      clearTimeout(id);
      throw error;
    }
  },

  fetchSetData: async (setCode) => {
    // Strategy 1: Firestore Card Database (Primary Source)
    // @environment:firebase
    if (db) {
      try {
        // Path: artifacts/{APP_ID}/public/data/cardDatabase/sets/{setCode}/data (8 segments = valid doc ref)
        // cardDatabase(col) → sets(doc) → {setCode}(col) → data(doc)
        const docRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'cardDatabase', 'sets', setCode, 'data');
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          console.log(`✓ Loaded ${data.totalCards} cards from Firestore (${setCode})`);
          return {
            data: data.cards,
            source: 'Firestore Database',
            version: data.syncVersion,
            lastSync: data.lastSync
          };
        } else {
          console.warn(`No Firestore data for ${setCode}, database may need seeding`);
        }
      } catch (e) {
        console.error("Firestore read failed:", e);
      }
    }

    // Strategy 3: Direct API (Emergency Fallback Only)
    // This should rarely be hit if background sync is working
    console.warn(`⚠ No Firestore data found for ${setCode}, attempting direct API fetch`);
    const targetUrl = `${API_BASE}/cards/${setCode}`;

    try {
      const response = await CardService.fetchWithTimeout(targetUrl, {}, 10000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      const cardList = Array.isArray(data) ? data : (data.data || []);

      if (cardList.length > 0) {
        console.log(`✓ Fetched ${cardList.length} cards from API (${setCode})`);
        return { data: cardList, source: 'Direct API (Fallback)' };
      }
    } catch (e) {
      console.error(`Direct API fetch failed for ${setCode}:`, e.message);
    }

    throw new Error(`Unable to load card data for ${setCode}. Database may need seeding.`);
  }
};
