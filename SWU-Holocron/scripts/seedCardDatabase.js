/**
 * Admin Script: Seed Card Database
 * 
 * This script fetches card data from the SWU-DB API and populates
 * the Firestore card database. Run this once to initialize the database.
 * 
 * Usage:
 *   node scripts/seedCardDatabase.js
 * 
 * Environment Variables:
 *   FIREBASE_SERVICE_ACCOUNT - Path to Firebase service account JSON
 *   Or run in browser with admin auth
 */

import { SETS } from '../src/constants.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Can be used in Node.js (with service account) or browser (with auth)
const isNode = typeof process !== 'undefined' && process.versions?.node;

let admin, db;

if (isNode) {
  // Node.js environment (GitHub Actions, local script)
  let serviceAccount;
  
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    // Local development - load from file
    const keyPath = join(__dirname, '..', 'firebase-admin-key.json');
    try {
      serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
    } catch (error) {
      console.error('❌ Error loading firebase-admin-key.json');
      console.error('   Please download service account key from Firebase Console:');
      console.error('   https://console.firebase.google.com/project/swu-holocron-93a18/settings/serviceaccounts/adminsdk');
      console.error('   Save it as: firebase-admin-key.json in the project root');
      process.exit(1);
    }
  }
  
  admin = await import('firebase-admin');
  admin.default.initializeApp({
    credential: admin.default.credential.cert(serviceAccount)
  });
  db = admin.default.firestore();
} else {
  // Browser environment (admin panel)
  const { db: firestoreDb } = await import('../src/firebase.js');
  db = firestoreDb;
}

// Import APP_ID from firebase.js to ensure consistency
const { APP_ID: FIREBASE_APP_ID } = await import('../src/firebase.js');
const APP_ID = FIREBASE_APP_ID;
const API_BASE = 'https://api.swu-db.com';

/**
 * Fetch card data from SWU-DB API with retries
 */
async function fetchSetFromAPI(setCode, retries = 3) {
  const url = `${API_BASE}/cards/${setCode}`;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Fetching ${setCode} (attempt ${attempt}/${retries})...`);
      
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      const cards = Array.isArray(data) ? data : (data.data || []);
      
      if (cards.length === 0) {
        throw new Error('Empty card array returned');
      }
      
      console.log(`✓ Fetched ${cards.length} cards from ${setCode}`);
      return cards;
      
    } catch (error) {
      console.error(`✗ Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        throw new Error(`Failed to fetch ${setCode} after ${retries} attempts: ${error.message}`);
      }
      
      // Exponential backoff
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`  Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Calculate hash of card data for change detection
 */
function calculateDataHash(cards) {
  const sortedCards = cards
    .map(c => `${c.Set}|${c.Number}|${c.Name}|${c.FrontText || ''}`)
    .sort()
    .join('::');
  
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < sortedCards.length; i++) {
    const char = sortedCards.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

/**
 * Save set data to Firestore
 */
async function saveSetToFirestore(setCode, setName, cards) {
  const setRef = db.collection('artifacts')
    .doc(APP_ID)
    .collection('public')
    .doc('data')
    .collection('cardDatabase')
    .doc('sets')
    .collection(setCode)
    .doc('data');
  
  const dataHash = calculateDataHash(cards);
  
  // Check if data has changed
  const existing = await setRef.get();
  if (existing.exists && existing.data().dataHash === dataHash) {
    console.log(`  No changes detected for ${setCode}, skipping write`);
    return { updated: false, cardCount: cards.length };
  }
  
  const setData = {
    code: setCode,
    name: setName,
    totalCards: cards.length,
    lastSync: Date.now(),
    syncVersion: '1.0',
    syncSource: 'swu-db.com',
    dataHash: dataHash,
    cards: cards
  };
  
  await setRef.set(setData);
  console.log(`✓ Saved ${cards.length} cards to Firestore (${setCode})`);
  
  return { updated: true, cardCount: cards.length };
}

/**
 * Update sync metadata
 */
async function updateSyncMetadata(results, startTime) {
  const metadataRef = db.collection('artifacts')
    .doc(APP_ID)
    .collection('public')
    .doc('data')
    .collection('cardDatabase')
    .doc('metadata');
  
  const setVersions = {};
  let totalCards = 0;
  let updatedSets = 0;
  
  for (const [setCode, result] of Object.entries(results)) {
    if (result.success) {
      setVersions[setCode] = '1.0';
      totalCards += result.cardCount;
      if (result.updated) updatedSets++;
    }
  }
  
  const duration = Date.now() - startTime;
  
  await metadataRef.set({
    lastFullSync: Date.now(),
    syncStatus: 'healthy',
    totalCards: totalCards,
    setVersions: setVersions,
    lastDuration: duration,
    updatedSets: updatedSets
  });
  
  console.log(`✓ Updated sync metadata (${duration}ms)`);
}

/**
 * Create sync log entry
 */
async function createSyncLog(results, startTime, errors) {
  const logRef = db.collection('artifacts')
    .doc(APP_ID)
    .collection('admin')
    .doc('sync')
    .collection('logs')
    .doc(Date.now().toString());
  
  const successfulSets = Object.entries(results)
    .filter(([_, r]) => r.success)
    .map(([code, _]) => code);
  
  const totalCards = Object.values(results)
    .reduce((sum, r) => sum + (r.cardCount || 0), 0);
  
  const updatedSets = Object.values(results)
    .filter(r => r.updated)
    .length;
  
  await logRef.set({
    timestamp: Date.now(),
    type: 'full',
    status: errors.length === 0 ? 'success' : 'partial',
    sets: successfulSets,
    cardCount: totalCards,
    duration: Date.now() - startTime,
    source: 'swu-db.com',
    errors: errors,
    changes: {
      updated: updatedSets,
      failed: errors.length
    }
  });
  
  console.log(`✓ Created sync log`);
}

/**
 * Main sync function
 */
async function seedCardDatabase() {
  console.log('='.repeat(60));
  console.log('  SWU Holocron - Card Database Seeding');
  console.log('='.repeat(60));
  console.log('');
  
  const startTime = Date.now();
  const results = {};
  const errors = [];
  
  for (const set of SETS) {
    try {
      console.log(`\n[${set.code}] ${set.name}`);
      console.log('-'.repeat(40));
      
      const cards = await fetchSetFromAPI(set.code);
      const result = await saveSetToFirestore(set.code, set.name, cards);
      
      results[set.code] = {
        success: true,
        cardCount: result.cardCount,
        updated: result.updated
      };
      
    } catch (error) {
      console.error(`✗ Failed to process ${set.code}:`, error.message);
      errors.push({
        set: set.code,
        error: error.message,
        timestamp: Date.now()
      });
      
      results[set.code] = {
        success: false,
        error: error.message
      };
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('  Finalizing Sync');
  console.log('='.repeat(60));
  
  await updateSyncMetadata(results, startTime);
  await createSyncLog(results, startTime, errors);
  
  const duration = Date.now() - startTime;
  const successCount = Object.values(results).filter(r => r.success).length;
  const totalCards = Object.values(results).reduce((sum, r) => sum + (r.cardCount || 0), 0);
  
  console.log('');
  console.log('Summary:');
  console.log(`  ✓ Successful sets: ${successCount}/${SETS.length}`);
  console.log(`  ✓ Total cards: ${totalCards}`);
  console.log(`  ✗ Errors: ${errors.length}`);
  console.log(`  ⏱ Duration: ${(duration / 1000).toFixed(2)}s`);
  console.log('');
  
  if (errors.length > 0) {
    console.log('Errors:');
    errors.forEach(e => console.log(`  - ${e.set}: ${e.error}`));
    console.log('');
  }
  
  console.log('='.repeat(60));
  console.log(errors.length === 0 ? '  ✓ Seeding Complete!' : '  ⚠ Seeding Completed with Errors');
  console.log('='.repeat(60));
  
  return {
    success: errors.length === 0,
    results,
    errors,
    duration
  };
}

// Export for use as module or run directly
export { seedCardDatabase };

// Run if called directly
if (isNode) {
  const scriptPath = fileURLToPath(import.meta.url);
  const execPath = process.argv[1];
  
  if (scriptPath === execPath || scriptPath.replace(/\\/g, '/') === execPath.replace(/\\/g, '/')) {
    seedCardDatabase()
      .then(() => {
        console.log('\nExiting...');
        process.exit(0);
      })
      .catch(error => {
        console.error('\n✗ Fatal error:', error);
        console.error(error.stack);
        process.exit(1);
      });
  }
}
