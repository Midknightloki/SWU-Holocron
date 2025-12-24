import { API_BASE } from '../constants';
import { db, APP_ID } from '../firebase';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';

export const CardService = {
  getCollectionId: (set, number, isFoil) => `${set}_${number}_${isFoil ? 'foil' : 'std'}`,
  
  getCardImage: (set, number) => `${API_BASE}/cards/${set}/${number}?format=image`,
  
  getBackImage: (set, number) => `${API_BASE}/cards/${set}/${number}?format=image&face=back`,

  // Get list of available sets from Firestore or by checking the API
  getAvailableSets: async () => {
    // Try to get from cache first
    const cacheKey = 'swu-available-sets';
    const cachedData = localStorage.getItem(cacheKey);
    if (cachedData) {
      try {
        const { sets, timestamp } = JSON.parse(cachedData);
        // Cache for 24 hours
        if (Date.now() - timestamp < 24 * 60 * 60 * 1000) {
          console.log('✓ Using cached available sets:', sets);
          return sets;
        }
      } catch (e) {
        // Invalid cache, continue to fetch
      }
    }

    // Check Firestore for available sets
    if (db && APP_ID) {
      try {
        const setsRef = collection(
          db,
          'artifacts', APP_ID,
          'public', 'data',
          'cardDatabase', 'sets'
        );
        
        const snapshot = await getDocs(setsRef);
        const availableSets = [];
        
        for (const docSnap of snapshot.docs) {
          const setCode = docSnap.id;
          // Check if the set has actual data
          try {
            const dataDocRef = doc(
              db,
              'artifacts', APP_ID,
              'public', 'data',
              'cardDatabase', 'sets',
              setCode, 'data'
            );
            const dataSnap = await getDoc(dataDocRef);
            if (dataSnap.exists() && dataSnap.data().totalCards > 0) {
              availableSets.push(setCode);
            }
          } catch (e) {
            // Skip sets that can't be read
            console.warn(`Could not read set ${setCode}:`, e.message);
          }
        }
        
        if (availableSets.length > 0) {
          console.log('✓ Available sets from Firestore:', availableSets);
          // Cache the result
          localStorage.setItem(cacheKey, JSON.stringify({
            sets: availableSets,
            timestamp: Date.now()
          }));
          return availableSets;
        }
      } catch (error) {
        console.warn('Could not fetch sets from Firestore:', error.message);
      }
    }

    // Fallback: Try to detect sets by attempting to fetch from API
    // This is a fallback when Firestore isn't available
    const knownSets = ['SOR', 'SHD', 'TWI', 'JTL', 'LOF', 'SEC', 'ALT'];
    const availableSets = [];
    
    for (const setCode of knownSets) {
      try {
        const response = await CardService.fetchWithTimeout(
          `${API_BASE}/cards/${setCode}`,
          {},
          5000
        );
        if (response.ok) {
          const data = await response.json();
          const cardList = Array.isArray(data) ? data : (data.data || []);
          if (cardList.length > 0) {
            availableSets.push(setCode);
          }
        }
      } catch (e) {
        // Set not available, skip
      }
    }
    
    if (availableSets.length > 0) {
      console.log('✓ Available sets from API check:', availableSets);
      // Cache the result
      localStorage.setItem(cacheKey, JSON.stringify({
        sets: availableSets,
        timestamp: Date.now()
      }));
      return availableSets;
    }

    // Return empty array if nothing works - will fall back to constants
    console.warn('Could not determine available sets, using defaults');
    return [];
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
        // Path: artifacts/{APP_ID}/public/data/cardDatabase/sets/{setCode}/data
        const docRef = doc(
          db, 
          'artifacts', APP_ID, 
          'public', 'data', 
          'cardDatabase', 'sets',
          setCode, 'data'
        );
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

    // Strategy 2: Legacy Cache (Fallback)
    // This is kept for backward compatibility during migration
    // TODO: Remove after all users migrated to new schema
    if (db) {
      try {
        const legacyRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'sets', setCode);
        const legacySnap = await getDoc(legacyRef);
        if (legacySnap.exists()) {
          const data = legacySnap.data();
          const age = Date.now() - (data.timestamp || 0);
          if (age < 7 * 24 * 60 * 60 * 1000) { // 7 days
            console.log(`✓ Loaded from legacy cache (${setCode})`);
            return { data: data.cards, source: 'Legacy Cache' };
          }
        }
      } catch (e) {
        console.warn("Legacy cache read failed:", e);
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