/**
 * Set discovery.
 *
 * Fetches the swu-db set catalog and publishes it to Firestore as the set
 * registry. This is what replaces the hardcoded SETS list: the seeder iterates
 * whatever the API reports, and the client reads the registry, so a new set
 * appears after the next sync with no code change and no redeploy.
 *
 * The registry is written to the `sets` document that already sits above the
 * per-set subcollections:
 *
 *   cardDatabase/sets              <- registry (this file)
 *   cardDatabase/sets/{CODE}/data  <- per-set cards (seedCardDatabase.js)
 *
 * Usage:
 *   node scripts/setDiscovery.js            write the registry
 *   node scripts/setDiscovery.js --dry-run  print what would be written
 *
 * @environment:firebase
 */

import { API_BASE } from '../src/cardData.js';
import { normalizeSetCatalog, groupSetsForDisplay } from '../src/setCatalog.js';
import { initFirestore } from './firebaseAdmin.js';

const SETS_ENDPOINT = `${API_BASE}/sets`;

/**
 * Fetch and normalise the catalog. Network only — no Firestore.
 * @returns {Promise<Array>} normalised registry entries
 */
export async function fetchSetCatalog(timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(SETS_ENDPOINT, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${SETS_ENDPOINT}`);
    }
    const payload = await response.json();
    const registry = normalizeSetCatalog(payload);

    if (registry.length === 0) {
      // Publishing an empty registry would make every set vanish from the app,
      // so treat it as a failure rather than a valid result.
      throw new Error('Set catalog was empty or unparseable; refusing to continue');
    }
    return registry;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Write the registry to Firestore, merging so per-set subcollections are
 * untouched.
 */
export async function writeSetRegistry(db, appId, registry) {
  const ref = db.collection('artifacts')
    .doc(appId)
    .collection('public')
    .doc('data')
    .collection('cardDatabase')
    .doc('sets');

  await ref.set({
    sets: registry,
    setCount: registry.length,
    discoveredAt: Date.now(),
    source: 'swu-db.com/sets',
  }, { merge: true });

  return registry.length;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.warn('='.repeat(60));
  console.warn('  SWU Holocron - Set Discovery');
  console.warn('='.repeat(60));

  const registry = await fetchSetCatalog();
  const { baseSets, promoSets } = groupSetsForDisplay(registry);

  console.warn(`\nDiscovered ${registry.length} sets (${baseSets.length} base, ${promoSets.length} promo)\n`);
  console.warn('  Base sets:');
  for (const s of baseSets) {
    console.warn(`    ${s.code.padEnd(8)} ${String(s.releaseDate || 'unreleased').padEnd(12)} ${String(s.cardCount ?? '?').padStart(4)}  ${s.name}`);
  }
  console.warn(`\n  Promo/OP sets: ${promoSets.map((s) => s.code).join(', ')}`);

  if (dryRun) {
    console.warn('\n--dry-run: nothing written.');
    return;
  }

  const { APP_ID } = await import('../src/firebase.js');
  const db = await initFirestore();
  const count = await writeSetRegistry(db, APP_ID, registry);
  console.warn(`\n✓ Registry published: ${count} sets`);
}

// Only run when invoked directly, so the exports stay importable from the seeder.
if (process.argv[1] && process.argv[1].endsWith('setDiscovery.js')) {
  main().catch((error) => {
    console.error('\n✗ Set discovery failed:', error.message);
    process.exit(1);
  });
}
