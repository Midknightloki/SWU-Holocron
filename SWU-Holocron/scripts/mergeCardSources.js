/**
 * Merge Card Sources
 *
 * Reconciles SWU-DB API data (stored in `data` docs) with official site
 * scraped data (stored in `official-data` docs) for each set.
 *
 * Resolution rules:
 *   - Cards matched by Set + Number
 *   - Official site fields win on overlap (source of truth)
 *   - SWU-DB fills fields the official site doesn't provide
 *   - Cards only on official site are added (real FFG-published cards)
 *   - Cards only in SWU-DB are kept (community data, not yet on official)
 *
 * Usage:
 *   node scripts/mergeCardSources.js [--dry-run] [--set=SOR]
 */

import { SETS } from '../src/cardData.js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isNode = typeof process !== 'undefined' && process.versions?.node;
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const setFilter = args.find(a => a.startsWith('--set='))?.split('=')[1];

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

/**
 * Fields where official data takes precedence over SWU-DB when both are present.
 * Other fields from SWU-DB are kept as enrichment.
 */
const OFFICIAL_PRIORITY_FIELDS = [
  'Name', 'Subtitle', 'Number', 'Set', 'SetName', 'Type', 'Type2',
  'Cost', 'Power', 'HP', 'Rarity', 'Unique', 'Aspects', 'Traits',
  'FrontText', 'BackText', 'Keywords', 'Arena', 'DoubleSided',
  'FrontArt', 'BackArt', 'OfficialUrl', 'OfficialCode'
];

/**
 * Build a lookup key for matching cards across sources
 */
function cardKey(card) {
  const set = card.Set || card.set || 'UNK';
  const num = String(card.Number || card.number || card.cardNumber || '000').padStart(3, '0');
  return `${set}_${num}`;
}

/**
 * Merge a single card from both sources. Official wins on priority fields.
 */
function mergeCard(swudbCard, officialCard) {
  if (!swudbCard) {
    // Official-only card — use as-is, mark source
    return { ...officialCard, _mergeSource: 'official-only' };
  }

  if (!officialCard) {
    // SWU-DB-only card — keep as-is, mark source
    return { ...swudbCard, _mergeSource: 'swudb-only' };
  }

  // Both sources present — merge with official priority
  const merged = { ...swudbCard };
  const overrides = [];

  for (const field of OFFICIAL_PRIORITY_FIELDS) {
    const officialVal = officialCard[field];
    const swudbVal = swudbCard[field];

    // Skip if official doesn't have this field or it's null/empty
    if (officialVal === undefined || officialVal === null || officialVal === '') continue;

    // Skip empty arrays
    if (Array.isArray(officialVal) && officialVal.length === 0) continue;

    // Check if values differ
    const differs = JSON.stringify(officialVal) !== JSON.stringify(swudbVal);
    if (differs && swudbVal !== undefined && swudbVal !== null) {
      overrides.push({
        field,
        swudb: swudbVal,
        official: officialVal
      });
    }

    merged[field] = officialVal;
  }

  merged._mergeSource = 'merged';
  if (overrides.length > 0) {
    merged._overrides = overrides;
  }

  return merged;
}

/**
 * Read a Firestore set document
 */
async function readSetDoc(setCode, docName) {
  const docRef = db.collection('artifacts')
    .doc(APP_ID)
    .collection('public')
    .doc('data')
    .collection('cardDatabase')
    .doc('sets')
    .collection(setCode)
    .doc(docName);

  const snap = await docRef.get();
  if (!snap.exists) return null;
  return snap.data();
}

/**
 * Write merged data back to the `data` doc
 */
async function writeSetDoc(setCode, setName, cards) {
  const docRef = db.collection('artifacts')
    .doc(APP_ID)
    .collection('public')
    .doc('data')
    .collection('cardDatabase')
    .doc('sets')
    .collection(setCode)
    .doc('data');

  await docRef.set({
    code: setCode,
    name: setName,
    totalCards: cards.length,
    lastSync: Date.now(),
    syncVersion: '2.0-merged',
    syncSource: 'swudb+official',
    cards
  });
}

/**
 * Merge a single set's data
 */
async function mergeSet(setCode, setName) {
  const swudbData = await readSetDoc(setCode, 'data');
  const officialData = await readSetDoc(setCode, 'official-data');

  const swudbCards = swudbData?.cards || [];
  const officialCards = officialData?.cards || [];

  if (swudbCards.length === 0 && officialCards.length === 0) {
    return { setCode, status: 'empty', merged: 0, officialOnly: 0, swudbOnly: 0, overrides: 0 };
  }

  // Build lookup maps
  const swudbMap = new Map();
  for (const card of swudbCards) {
    swudbMap.set(cardKey(card), card);
  }

  const officialMap = new Map();
  for (const card of officialCards) {
    officialMap.set(cardKey(card), card);
  }

  // Collect all unique keys
  const allKeys = new Set([...swudbMap.keys(), ...officialMap.keys()]);

  const mergedCards = [];
  let officialOnlyCount = 0;
  let swudbOnlyCount = 0;
  let overrideCount = 0;

  for (const key of allKeys) {
    const swudbCard = swudbMap.get(key) || null;
    const officialCard = officialMap.get(key) || null;
    const merged = mergeCard(swudbCard, officialCard);

    if (merged._mergeSource === 'official-only') officialOnlyCount++;
    if (merged._mergeSource === 'swudb-only') swudbOnlyCount++;
    if (merged._overrides?.length > 0) overrideCount += merged._overrides.length;

    mergedCards.push(merged);
  }

  // Sort by card number
  mergedCards.sort((a, b) => {
    const numA = parseInt(a.Number || '0', 10);
    const numB = parseInt(b.Number || '0', 10);
    return numA - numB;
  });

  return {
    setCode,
    setName,
    status: 'ok',
    merged: mergedCards.length,
    swudbCount: swudbCards.length,
    officialCount: officialCards.length,
    officialOnly: officialOnlyCount,
    swudbOnly: swudbOnlyCount,
    overrides: overrideCount,
    cards: mergedCards
  };
}

/**
 * Write log file
 */
function writeLog(results, duration) {
  const logDir = join(__dirname, '..', 'logs');
  try { mkdirSync(logDir, { recursive: true }); } catch { /* exists */ }

  const date = new Date().toISOString().slice(0, 10);
  const logPath = join(logDir, `card-sync-${date}.json`);

  const logData = {
    timestamp: new Date().toISOString(),
    duration: `${(duration / 1000).toFixed(2)}s`,
    sets: results.map(r => ({
      set: r.setCode,
      status: r.status,
      merged: r.merged,
      swudbCount: r.swudbCount,
      officialCount: r.officialCount,
      officialOnly: r.officialOnly,
      swudbOnly: r.swudbOnly,
      overrides: r.overrides
    }))
  };

  // Collect all overrides for the log
  const allOverrides = [];
  for (const r of results) {
    if (!r.cards) continue;
    for (const card of r.cards) {
      if (card._overrides) {
        allOverrides.push({
          set: r.setCode,
          card: `${card.Number} ${card.Name}`,
          overrides: card._overrides
        });
      }
    }
  }
  logData.overrides = allOverrides;

  writeFileSync(logPath, JSON.stringify(logData, null, 2));
  console.log(`\n📝 Log written to ${logPath}`);
}

/**
 * Main merge function
 */
async function mergeCardSources() {
  console.log('='.repeat(60));
  console.log('  SWU Holocron - Merge Card Sources');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Dry run: ${dryRun ? 'Yes (no Firestore writes)' : 'No'}`);
  if (setFilter) console.log(`Set filter: ${setFilter}`);
  console.log('');

  const startTime = Date.now();
  const setsToProcess = setFilter
    ? SETS.filter(s => s.code === setFilter.toUpperCase())
    : SETS;

  if (setsToProcess.length === 0) {
    console.error(`❌ No sets match filter: ${setFilter}`);
    process.exit(1);
  }

  const results = [];

  for (const set of setsToProcess) {
    console.log(`\n[${set.code}] ${set.name}`);
    console.log('-'.repeat(40));

    try {
      const result = await mergeSet(set.code, set.name);
      results.push(result);

      if (result.status === 'empty') {
        console.log('  ⚠️  No data from either source');
        continue;
      }

      console.log(`  SWU-DB: ${result.swudbCount} cards`);
      console.log(`  Official: ${result.officialCount} cards`);
      console.log(`  → Merged: ${result.merged} cards`);

      if (result.officialOnly > 0) {
        console.log(`  + ${result.officialOnly} official-only cards added`);
      }
      if (result.swudbOnly > 0) {
        console.log(`  ~ ${result.swudbOnly} SWU-DB-only cards kept`);
      }
      if (result.overrides > 0) {
        console.log(`  ⚡ ${result.overrides} field overrides (official wins)`);
      }

      if (!dryRun && result.cards) {
        await writeSetDoc(set.code, set.name, result.cards);
        console.log(`  ✓ Written to Firestore`);
      }

    } catch (error) {
      console.error(`  ✗ Error: ${error.message}`);
      results.push({ setCode: set.code, status: 'error', error: error.message });
    }
  }

  const duration = Date.now() - startTime;

  // Write log
  writeLog(results, duration);

  // Summary
  const totalMerged = results.reduce((s, r) => s + (r.merged || 0), 0);
  const totalOverrides = results.reduce((s, r) => s + (r.overrides || 0), 0);
  const totalOfficialOnly = results.reduce((s, r) => s + (r.officialOnly || 0), 0);
  const errors = results.filter(r => r.status === 'error');

  console.log('\n' + '='.repeat(60));
  console.log('  Summary');
  console.log('='.repeat(60));
  console.log(`  ✓ Total merged cards: ${totalMerged}`);
  console.log(`  + Official-only cards: ${totalOfficialOnly}`);
  console.log(`  ⚡ Field overrides: ${totalOverrides}`);
  console.log(`  ✗ Errors: ${errors.length}`);
  console.log(`  ⏱ Duration: ${(duration / 1000).toFixed(2)}s`);
  console.log('='.repeat(60));

  return { results, duration, totalMerged, totalOverrides, errors };
}

export { mergeCardSources };

if (isNode) {
  const scriptPath = fileURLToPath(import.meta.url);
  const execPath = process.argv[1];

  if (scriptPath === execPath || scriptPath.replace(/\\/g, '/') === execPath.replace(/\\/g, '/')) {
    mergeCardSources()
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
