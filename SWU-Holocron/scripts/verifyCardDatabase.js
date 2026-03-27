/**
 * Card Database Verification Script
 *
 * Verifies the Firestore card database integrity:
 * - Checks all sets are present
 * - Validates card counts
 * - Compares with API (optional)
 * - Reports any inconsistencies
 *
 * Usage:
 *   node scripts/verifyCardDatabase.js [--compare-api]
 */

import { SETS } from '../src/cardData.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isNode = typeof process !== 'undefined' && process.versions?.node;
const shouldCompareAPI = process.argv.includes('--compare-api');

let admin, db;

if (isNode) {
  let serviceAccount;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    const keyPath = join(__dirname, '..', 'firebase-admin-key.json');
    try {
      serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
    } catch (error) {
      console.error('❌ Error loading firebase-admin-key.json');
      process.exit(1);
    }
  }

  admin = await import('firebase-admin');
  admin.default.initializeApp({
    credential: admin.default.credential.cert(serviceAccount)
  });
  db = admin.default.firestore();
}

const { APP_ID: FIREBASE_APP_ID } = await import('../src/firebase.js');
const APP_ID = FIREBASE_APP_ID;
const API_BASE = 'https://api.swu-db.com';

async function verifyFirestoreData() {
  console.log('\n📊 Verifying Firestore Card Database\n');
  console.log('='.repeat(60));

  const issues = [];
  const stats = {
    setsFound: 0,
    setsMissing: 0,
    totalCards: 0
  };

  for (const set of SETS) {
    try {
      const docRef = db.collection('artifacts')
        .doc(APP_ID)
        .collection('public')
        .doc('data')
        .collection('cardDatabase')
        .doc('sets')
        .collection(set.code)
        .doc('data');

      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        console.log(`❌ ${set.code} - NOT FOUND`);
        issues.push(`Set ${set.code} missing from database`);
        stats.setsMissing++;
        continue;
      }

      const data = docSnap.data();
      const cardCount = data.cards?.length || 0;
      const age = Date.now() - (data.lastSync || 0);
      const ageHours = Math.floor(age / 3600000);

      console.log(`✅ ${set.code} - ${cardCount} cards (synced ${ageHours}h ago)`);

      stats.setsFound++;
      stats.totalCards += cardCount;

      // Validate structure
      if (!data.cards || !Array.isArray(data.cards)) {
        issues.push(`${set.code}: cards array missing or invalid`);
      }

      if (!data.dataHash) {
        issues.push(`${set.code}: dataHash missing`);
      }

      if (age > 7 * 24 * 3600000) {
        issues.push(`${set.code}: data older than 7 days`);
      }

    } catch (error) {
      console.log(`❌ ${set.code} - ERROR: ${error.message}`);
      issues.push(`${set.code}: ${error.message}`);
      stats.setsMissing++;
    }
  }

  console.log('='.repeat(60));
  console.log(`\nSummary:`);
  console.log(`  Sets found: ${stats.setsFound}/${SETS.length}`);
  console.log(`  Total cards: ${stats.totalCards}`);
  console.log(`  Issues: ${issues.length}`);

  return { stats, issues };
}

async function compareWithAPIData() {
  console.log('\n\n🔄 Comparing with API\n');
  console.log('='.repeat(60));

  const differences = [];

  for (const set of SETS) {
    try {
      // Fetch from Firestore
      const docRef = db.collection('artifacts')
        .doc(APP_ID)
        .collection('public')
        .doc('data')
        .collection('cardDatabase')
        .doc('sets')
        .collection(set.code)
        .doc('data');

      const docSnap = await docRef.get();
      const firestoreCards = docSnap.exists ? docSnap.data().cards : [];

      // Fetch from API
      console.log(`Fetching ${set.code} from API...`);
      const response = await fetch(`${API_BASE}/cards/${set.code}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const apiData = await response.json();
      const apiCards = Array.isArray(apiData) ? apiData : (apiData.data || []);

      // Compare counts
      if (firestoreCards.length !== apiCards.length) {
        differences.push(
          `${set.code}: Count mismatch (Firestore: ${firestoreCards.length}, API: ${apiCards.length})`
        );
        console.log(`⚠️  ${set.code} - Count mismatch (FS: ${firestoreCards.length}, API: ${apiCards.length})`);
      } else {
        console.log(`✅ ${set.code} - Counts match (${apiCards.length} cards)`);
      }

      // Sample check: verify first card
      if (firestoreCards.length > 0 && apiCards.length > 0) {
        const fsFirst = firestoreCards[0];
        const apiFirst = apiCards.find(c => c.Number === fsFirst.Number);

        if (!apiFirst) {
          differences.push(`${set.code}: Card ${fsFirst.Number} not found in API`);
        } else if (fsFirst.Name !== apiFirst.Name) {
          differences.push(
            `${set.code}: Card ${fsFirst.Number} name mismatch (FS: "${fsFirst.Name}", API: "${apiFirst.Name}")`
          );
        }
      }

      // Brief delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.log(`❌ ${set.code} - ERROR: ${error.message}`);
      differences.push(`${set.code}: API comparison failed - ${error.message}`);
    }
  }

  console.log('='.repeat(60));
  console.log(`\nDifferences found: ${differences.length}`);

  return differences;
}

async function verifyMetadata() {
  console.log('\n\n📋 Checking Sync Metadata\n');
  console.log('='.repeat(60));

  try {
    const metadataRef = db.collection('artifacts')
      .doc(APP_ID)
      .collection('public')
      .doc('data')
      .collection('cardDatabase')
      .doc('metadata');

    const metadataSnap = await metadataRef.get();

    if (!metadataSnap.exists) {
      console.log('❌ Metadata document not found');
      return { exists: false };
    }

    const metadata = metadataSnap.data();

    console.log(`Sync Status: ${metadata.syncStatus || 'unknown'}`);
    console.log(`Last Sync: ${metadata.lastFullSync ? new Date(metadata.lastFullSync).toLocaleString() : 'never'}`);
    console.log(`Total Cards: ${metadata.totalCards || 0}`);
    console.log(`Sets: ${Object.keys(metadata.setVersions || {}).join(', ')}`);
    console.log(`Duration: ${metadata.lastDuration ? (metadata.lastDuration / 1000).toFixed(2) + 's' : 'unknown'}`);

    return { exists: true, data: metadata };

  } catch (error) {
    console.log(`❌ Error reading metadata: ${error.message}`);
    return { exists: false, error: error.message };
  }
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  SWU Holocron - Card Database Verification');
  console.log('='.repeat(60));

  // Verify Firestore data
  const { stats, issues } = await verifyFirestoreData();

  // Check metadata
  await verifyMetadata();

  // Compare with API if requested
  let differences = [];
  if (shouldCompareAPI) {
    differences = await compareWithAPIData();
  }

  // Final report
  console.log('\n\n' + '='.repeat(60));
  console.log('  VERIFICATION REPORT');
  console.log('='.repeat(60));

  console.log(`\n✅ Sets verified: ${stats.setsFound}/${SETS.length}`);
  console.log(`📊 Total cards: ${stats.totalCards}`);

  if (issues.length > 0) {
    console.log(`\n⚠️  Issues found (${issues.length}):`);
    issues.forEach((issue, i) => console.log(`  ${i + 1}. ${issue}`));
  }

  if (shouldCompareAPI && differences.length > 0) {
    console.log(`\n⚠️  API differences (${differences.length}):`);
    differences.forEach((diff, i) => console.log(`  ${i + 1}. ${diff}`));
  }

  if (issues.length === 0 && differences.length === 0) {
    console.log(`\n✅ Database verification passed with no issues!`);
  } else {
    console.log(`\n⚠️  Database verification completed with warnings.`);
  }

  console.log('\n' + '='.repeat(60));

  return {
    success: issues.length === 0 && differences.length === 0,
    issues,
    differences,
    stats
  };
}

// Run if called directly
if (isNode) {
  const scriptPath = fileURLToPath(import.meta.url);
  const execPath = process.argv[1];

  if (scriptPath === execPath || scriptPath.replace(/\\/g, '/') === execPath.replace(/\\/g, '/')) {
    main()
      .then((result) => {
        process.exit(result.success ? 0 : 1);
      })
      .catch(error => {
        console.error('\n❌ Fatal error:', error);
        process.exit(1);
      });
  }
}

export { verifyFirestoreData, compareWithAPIData, verifyMetadata };
