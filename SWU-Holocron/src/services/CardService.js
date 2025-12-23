import { API_BASE } from '../constants';
import { db, APP_ID } from '../firebase';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';

export const CardService = {
  getCollectionId: (set, number, isFoil) => `${set}_${number}_${isFoil ? 'foil' : 'std'}`,
  
  getCardImage: (set, number) => `${API_BASE}/cards/${set}/${number}?format=image`,
  
  getBackImage: (set, number) => `${API_BASE}/cards/${set}/${number}?format=image&face=back`,

  // Get list of available sets from Firestore
  getAvailableSets: async () => {
    if (!db || !APP_ID) return [];
    
    try {
      const setsCollectionRef = collection(
        db, 
        'artifacts', APP_ID, 
        'public', 'data', 
        'cardDatabase', 'sets'
      );
      
      const snapshot = await getDocs(setsCollectionRef);
      const availableSets = [];
      
      for (const docSnap of snapshot.docs) {
        const setCode = docSnap.id;
        if (setCode !== 'data') { // Skip any non-set documents
          // Check if the set has a data subdocument
          const dataDoc = await getDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'cardDatabase', 'sets', setCode, 'data'));
          if (dataDoc.exists() && dataDoc.data().totalCards > 0) {
            availableSets.push(setCode);
          }
        }
      }
      
      console.log('✓ Available sets:', availableSets);
      return availableSets;
    } catch (error) {
      console.error('Error fetching available sets:', error);
      return [];
    }
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