/**
 * Unified Card Database Sync Orchestrator
 *
 * Runs the full pipeline: seed -> scrape -> reconcile -> verify -> log
 *
 * Usage:
 *   node scripts/cardDbSync.js
 *   node scripts/cardDbSync.js --skip-scrape  (API seed + verify only)
 *   node scripts/cardDbSync.js --scrape-only   (official scrape only)
 */

import { execSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { initFirestore } from './firebaseAdmin.js';
import { reconcileSet } from '../src/cardReconcile.js';
import { applyPlaceholders, classifySetCompleteness } from '../src/placeholderCards.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const skipScrape = process.argv.includes('--skip-scrape');
const scrapeOnly = process.argv.includes('--scrape-only');

const RECONCILE_FIELDS = [
  'Name', 'Subtitle', 'Cost', 'Power', 'HP', 'FrontText', 'BackText',
  'Type', 'Rarity', 'Unique', 'Aspects', 'Traits', 'Keywords', 'Arena', 'DoubleSided'
];

function runStep(label, command) {
  const start = Date.now();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Step: ${label}`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    const output = execSync(command, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
      // 20 minutes. Seeding 51 discovered sets takes ~13s each (~11 min);
      // the previous 5-minute cap predates set discovery and would kill
      // the seed step partway through.
      timeout: 1200000
    });
    const duration_ms = Date.now() - start;
    console.log(output);
    console.log(`  ${label} completed in ${(duration_ms / 1000).toFixed(1)}s`);
    return { success: true, duration_ms, output: output.trim() };
  } catch (error) {
    const duration_ms = Date.now() - start;
    const output = (error.stdout || '') + '\n' + (error.stderr || '');
    console.error(`  ${label} FAILED (${(duration_ms / 1000).toFixed(1)}s):`);
    console.error(output);
    return { success: false, duration_ms, output: output.trim(), error: error.message };
  }
}

async function reconcile() {
  const start = Date.now();
  console.log(`\n${'='.repeat(60)}`);
  console.log('  Step: Reconcile (official wins over API)');
  console.log(`${'='.repeat(60)}\n`);

  const overrides = [];
  const addedCards = [];
  const refusedOverrides = [];
  let setsProcessed = 0;

  try {
    // Dynamic imports to avoid top-level Firebase client SDK initialization conflicts
    const { SETS } = await import('../src/cardData.js');
    const { APP_ID } = await import('../src/firebase.js');

    const db = await initFirestore();

    // Reconcile whatever the seeder actually published, not the fallback list.
    // Iterating cardData.js SETS here would cover 14 sets out of 51 and would
    // also probe PROMO/OTHER, which are legacy buckets with no API set behind
    // them.
    const registrySnap = await db.collection('artifacts')
      .doc(APP_ID)
      .collection('public')
      .doc('data')
      .collection('cardDatabase')
      .doc('sets')
      .get();

    const registry = registrySnap.exists ? registrySnap.data()?.sets : null;
    const setsToReconcile = Array.isArray(registry) && registry.length > 0 ? registry : SETS;
    if (!Array.isArray(registry) || registry.length === 0) {
      console.warn('  No set registry found; reconciling the fallback list only.');
    }
    console.log(`  Reconciling ${setsToReconcile.length} sets`);

    for (const set of setsToReconcile) {
      try {
        const setBase = db.collection('artifacts')
          .doc(APP_ID)
          .collection('public')
          .doc('data')
          .collection('cardDatabase')
          .doc('sets')
          .collection(set.code);

        const dataDocRef = setBase.doc('data');
        const officialDocRef = setBase.doc('official-data');

        const [dataSnap, officialSnap] = await Promise.all([
          dataDocRef.get(),
          officialDocRef.get()
        ]);

        if (!dataSnap.exists) {
          console.log(`  ${set.code}: no API data doc, skipping`);
          continue;
        }

        if (!officialSnap.exists) {
          console.log(`  ${set.code}: no official data doc, skipping reconcile`);
          setsProcessed++;
          continue;
        }

        const data = dataSnap.data();
        const officialData = officialSnap.data();

        const result = reconcileSet({
          setCode: set.code,
          apiCards: data.cards || [],
          officialCards: officialData.cards || [],
          fields: RECONCILE_FIELDS,
        });

        overrides.push(...result.overrides);
        addedCards.push(...result.added.map((c) => ({ set: set.code, number: c.Number, name: c.Name })));
        refusedOverrides.push(...(result.refused || []));

        if (result.overrides.length > 0 || result.added.length > 0) {
          await dataDocRef.update({ cards: result.cards });
          const parts = [];
          if (result.overrides.length) parts.push(`${result.overrides.length} field(s) overridden`);
          if (result.added.length) parts.push(`${result.added.length} card(s) added from official`);
          console.log(`  ${set.code}: ${parts.join(', ')}`);
        } else {
          console.log(`  ${set.code}: no disagreements`);
        }

        setsProcessed++;
      } catch (error) {
        console.error(`  ${set.code}: ERROR - ${error.message}`);
      }
    }

    const duration_ms = Date.now() - start;
    console.log(`\n  Reconcile completed in ${(duration_ms / 1000).toFixed(1)}s`);
    console.log(`  Sets processed: ${setsProcessed}, overrides: ${overrides.length}, added: ${addedCards.length}, refused (official value absent): ${refusedOverrides.length}`);

    return { success: true, duration_ms, overrides, addedCards, refusedOverrides, setsProcessed };
  } catch (error) {
    const duration_ms = Date.now() - start;
    console.error(`  Reconcile FAILED: ${error.message}`);
    return { success: false, duration_ms, overrides, addedCards, refusedOverrides, setsProcessed, error: error.message };
  }
}

/**
 * Fill catalog shortfalls with placeholder cards.
 *
 * Runs after reconcile, so it only ever fills a gap that neither swu-db nor the
 * official site could cover. Idempotent: it rebuilds the placeholder set from the
 * real cards each time, so one disappears by itself when the card it stood in for
 * finally arrives.
 *
 * Never touches a set whose release date is still ahead of us -- see
 * src/placeholderCards.js for why that guard is the whole design.
 */
async function fillPlaceholders() {
  const start = Date.now();
  console.log(`\n${'='.repeat(60)}`);
  console.log('  Step: Placeholders (catalog says it exists, no source describes it)');
  console.log(`${'='.repeat(60)}\n`);

  const added = [];
  const removed = [];
  const statuses = {};
  let setsProcessed = 0;

  try {
    const { SETS } = await import('../src/cardData.js');
    const { APP_ID } = await import('../src/firebase.js');

    const db = await initFirestore();

    const registrySnap = await db.collection('artifacts')
      .doc(APP_ID)
      .collection('public')
      .doc('data')
      .collection('cardDatabase')
      .doc('sets')
      .get();

    const registry = registrySnap.exists ? registrySnap.data()?.sets : null;
    const catalog = Array.isArray(registry) && registry.length > 0 ? registry : SETS;
    if (!Array.isArray(registry) || registry.length === 0) {
      console.warn('  No set registry found; using the fallback list only.');
    }

    for (const set of catalog) {
      try {
        const dataDocRef = db.collection('artifacts')
          .doc(APP_ID)
          .collection('public')
          .doc('data')
          .collection('cardDatabase')
          .doc('sets')
          .collection(set.code)
          .doc('data');

        const snap = await dataDocRef.get();
        if (!snap.exists) {
          console.log(`  ${set.code}: no data doc, skipping`);
          continue;
        }

        const cards = snap.data()?.cards || [];
        const result = applyPlaceholders({ set, cards, catalog });

        if (result.added.length > 0 || result.removed.length > 0) {
          await dataDocRef.update({ cards: result.cards });
          const parts = [];
          if (result.added.length) parts.push(`+${result.added.length} placeholder(s): ${result.added.join(', ')}`);
          if (result.removed.length) parts.push(`-${result.removed.length} stale: ${result.removed.join(', ')}`);
          console.log(`  ${set.code}: ${parts.join('; ')}`);
          added.push(...result.added.map((n) => `${set.code}_${n}`));
          removed.push(...result.removed.map((n) => `${set.code}_${n}`));
        }

        const classification = classifySetCompleteness({ set, cards: result.cards, catalog });
        statuses[set.code] = classification;

        // `incomplete` is the only status that means something is actually wrong:
        // released, short, and not placeheld. Everything else is a normal state.
        if (classification.status === 'incomplete') {
          console.warn(`  ${set.code}: INCOMPLETE - ${classification.missing} card(s) unaccounted for`);
        } else if (classification.status === 'awaiting-release') {
          console.log(`  ${set.code}: awaiting release, ${classification.real}/${classification.expected} revealed`);
        }

        setsProcessed++;
      } catch (error) {
        console.error(`  ${set.code}: ERROR - ${error.message}`);
      }
    }

    const duration_ms = Date.now() - start;
    const incomplete = Object.entries(statuses).filter(([, c]) => c.status === 'incomplete').map(([code]) => code);
    const placeheld = Object.entries(statuses).filter(([, c]) => c.status === 'complete-with-placeholders').map(([code]) => code);

    console.log(`\n  Placeholders completed in ${(duration_ms / 1000).toFixed(1)}s`);
    console.log(`  Sets processed: ${setsProcessed}, placeholders added: ${added.length}, stale removed: ${removed.length}`);
    if (placeheld.length) console.log(`  Complete with placeholders: ${placeheld.join(', ')}`);
    if (incomplete.length) console.warn(`  Still incomplete: ${incomplete.join(', ')}`);

    return { success: true, duration_ms, added, removed, statuses, setsProcessed, incomplete, placeheld };
  } catch (error) {
    const duration_ms = Date.now() - start;
    console.error(`  Placeholders FAILED: ${error.message}`);
    return { success: false, duration_ms, added, removed, statuses, setsProcessed, error: error.message };
  }
}

async function main() {
  const pipelineStart = Date.now();
  const errors = [];

  console.log('\n' + '='.repeat(60));
  console.log('  SWU Holocron - Card Database Sync Orchestrator');
  console.log('='.repeat(60));

  if (skipScrape) console.log('\n  Mode: --skip-scrape (API seed + verify only)');
  if (scrapeOnly) console.log('\n  Mode: --scrape-only (official scrape only)');

  const steps = {};

  // Step 1 - Seed from API
  if (!scrapeOnly) {
    steps.seed = runStep('Seed from API', 'node scripts/seedCardDatabase.js');
    if (!steps.seed.success) {
      errors.push('Seed step failed');
    }
  } else {
    steps.seed = { success: true, skipped: true, duration_ms: 0, output: 'Skipped (--scrape-only)' };
  }

  // Step 2 - Scrape official site
  if (!skipScrape) {
    steps.scrape = runStep('Scrape official site', 'node scripts/scrapeOfficialCards.js');
    if (!steps.scrape.success) {
      // Check if it was a Playwright not-installed error
      if (steps.scrape.output && steps.scrape.output.includes('playwright')) {
        console.warn('\n  WARNING: Playwright may not be installed. Scrape skipped.');
        console.warn('  Install with: npx playwright install chromium\n');
      }
      errors.push('Scrape step failed');
    }
  } else {
    steps.scrape = { success: true, skipped: true, duration_ms: 0, output: 'Skipped (--skip-scrape)' };
  }

  // Step 3 - Reconcile (runs unless scrape was skipped — needs official-data docs to exist)
  if (!skipScrape) {
    steps.reconcile = await reconcile();
    if (!steps.reconcile.success) {
      errors.push('Reconcile step failed');
    }
  } else {
    steps.reconcile = { success: true, skipped: true, duration_ms: 0, overrides: [], addedCards: [], setsProcessed: 0 };
  }

  // Step 4 - Placeholders (after reconcile: only fills what neither source had)
  steps.placeholders = await fillPlaceholders();
  if (!steps.placeholders.success) {
    errors.push('Placeholder step failed');
  }

  // Step 5 - Verify
  steps.verify = runStep('Verify database', 'node scripts/verifyCardDatabase.js');
  if (!steps.verify.success) {
    errors.push('Verify step failed');
  }

  // Step 5 - Write log
  const totalDuration = Date.now() - pipelineStart;

  const logData = {
    timestamp: new Date().toISOString(),
    duration_ms: totalDuration,
    steps: {
      seed: {
        success: steps.seed.success,
        duration_ms: steps.seed.duration_ms,
        output: steps.seed.output || ''
      },
      scrape: {
        success: steps.scrape.success,
        duration_ms: steps.scrape.duration_ms,
        output: steps.scrape.output || ''
      },
      placeholders: {
        success: steps.placeholders.success,
        duration_ms: steps.placeholders.duration_ms,
        added: steps.placeholders.added || [],
        removed: steps.placeholders.removed || [],
        incomplete: steps.placeholders.incomplete || [],
        placeheld: steps.placeholders.placeheld || []
      },
      reconcile: {
        success: steps.reconcile.success,
        overrides: steps.reconcile.overrides || [],
        addedCards: steps.reconcile.addedCards || [],
        refusedOverrides: steps.reconcile.refusedOverrides || [],
        setsProcessed: steps.reconcile.setsProcessed || 0
      },
      verify: {
        success: steps.verify.success,
        duration_ms: steps.verify.duration_ms,
        output: steps.verify.output || ''
      }
    },
    summary: {
      setsProcessed: steps.reconcile.setsProcessed || 0,
      totalOverrides: (steps.reconcile.overrides || []).length,
      totalCardsAddedFromOfficial: (steps.reconcile.addedCards || []).length,
      errors
    }
  };

  const logsDir = join(projectRoot, 'logs');
  mkdirSync(logsDir, { recursive: true });

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '');
  const logPath = join(logsDir, `card-sync-${dateStr}-${timeStr}.json`);
  writeFileSync(logPath, JSON.stringify(logData, null, 2), 'utf8');
  console.log(`\n  Log written to: ${logPath}`);

  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log('  SYNC SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Duration: ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(`  Seed: ${steps.seed.success ? 'OK' : 'FAILED'}`);
  console.log(`  Scrape: ${steps.scrape.success ? 'OK' : 'FAILED'}`);
  console.log(`  Reconcile: ${steps.reconcile.success ? 'OK' : 'FAILED'} (${(steps.reconcile.overrides || []).length} overrides, ${(steps.reconcile.addedCards || []).length} added)`);
  console.log(`  Verify: ${steps.verify.success ? 'OK' : 'FAILED'}`);
  console.log(`  Errors: ${errors.length}`);
  console.log('='.repeat(60) + '\n');

  if (errors.length > 0) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error('\nFatal error:', error);
  process.exit(1);
});
