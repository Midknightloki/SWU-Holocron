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
import { applyPlaceholders, classifySetCompleteness, isFailingStatus } from '../src/placeholderCards.js';
import {
  buildGroupsUrl,
  buildLastUpdatedUrl,
  buildPricesUrl,
  buildProductsUrl,
  buildPriceMap,
  buildRequestHeaders,
  matchGroupsToSets,
} from '../src/tcgPrices.js';
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

        // A set whose cards endpoint returns nothing never gets a data doc from
        // the seeder, so the set the placeholder step exists for is precisely the
        // one with no document to update. SOROPJ is that set: the catalogue says
        // two cards, both sources return zero, and verify then reports the whole
        // set missing. Create the document from placeholders alone.
        const cards = snap.exists ? (snap.data()?.cards || []) : [];
        const result = applyPlaceholders({ set, cards, catalog });

        if (!snap.exists) {
          if (result.cards.length === 0) {
            console.log(`  ${set.code}: no data doc and nothing to placehold, skipping`);
            continue;
          }

          await dataDocRef.set({
            code: set.code,
            name: set.name || set.code,
            totalCards: result.cards.length,
            lastSync: Date.now(),
            syncVersion: '1.0',
            // Deliberately not a real content hash: it can never equal one, so
            // the seeder always overwrites this document once actual cards
            // appear upstream. Non-empty because verify flags a missing hash.
            dataHash: 'placeholders-only',
            syncSource: 'placeholder',
            cards: result.cards,
          });
          console.log(`  ${set.code}: created from ${result.cards.length} placeholder(s): ${result.added.join(', ')}`);
          added.push(...result.added.map((n) => `${set.code}_${n}`));
          statuses[set.code] = classifySetCompleteness({ set, cards: result.cards, catalog });
          setsProcessed++;
          continue;
        }

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
        } else if (classification.status === 'incomplete-unnumbered') {
          console.log(`  ${set.code}: ${classification.missing} card(s) short, but its numbering cannot be reasoned about -- not placeheld`);
        } else if (classification.status === 'awaiting-release') {
          console.log(`  ${set.code}: awaiting release, ${classification.real}/${classification.expected} revealed`);
        }

        setsProcessed++;
      } catch (error) {
        console.error(`  ${set.code}: ERROR - ${error.message}`);
      }
    }

    const duration_ms = Date.now() - start;
    const incomplete = Object.entries(statuses).filter(([, c]) => isFailingStatus(c.status)).map(([code]) => code);
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

/**
 * Sets whose TCGplayer abbreviation differs from our internal code.
 *
 * 14 sets match by code with no help, covering 87% of catalogued cards. These are
 * the promo, judge and showcase sets, which TCGplayer names differently. Adding a
 * line here is all it takes to start pricing one; leaving it out means that set
 * has no prices, which the UI already handles.
 */
const PRICE_SET_ALIASES = {
  SOROP: 'SOR-WPP',
  SHDOP: 'SHD-WPP',
  TWIOP: 'TWI-WPP',
  JTLOP: 'JTL-WPP',
  LOFOP: 'LOFWPP',
  SECOP: 'SECWPP',
  LAWP: 'LAW-WPP',
  ASHOP: 'ASHWPP',
  C24: 'CE2024',
  C25: 'CE2025',
  // GFT is the "2025 Gift Box", which is our G25 -- not GG, which is Gamegenic
  // (accessories). Pairing them by eye would have attached Gift Box prices to
  // Gamegenic products.
  G25: 'GFT',
};

/**
 * Sets left unpriced on purpose, so nobody wastes time "finishing" the table.
 *
 * Several of ours map to a single TCGplayer group: PSOR, PSHD and PTWI are all
 * prerelease promos and TCGplayer files them together under PRE, as it does with
 * JDG for judge promos, EEP for event exclusives, OPP for organized play and SN1
 * for season-one regionals.
 *
 * Because a price document is keyed by card number within one of our sets, two of
 * our sets sharing a group would read each other's numbers -- PSOR 001 and
 * PSHD 001 both resolving to PRE's card 001, at most one of which is right. That
 * needs the group's card list inspected per set, not an alias guessed here.
 */
const PRICE_GROUPS_NEEDING_INVESTIGATION = ['PRE', 'JDG', 'EEP', 'OPP', 'SN1'];

/**
 * Fetch card prices from TCGCSV and store one document per set.
 *
 * Why here and not in the browser: the app is offline-first and the live external
 * API should almost never be hit at runtime (see CLAUDE.md). One request per set
 * refreshes everything, where the previous client-side design made one request
 * per card -- fifty sequential requests to render one shopping list.
 *
 * Prices land beside the card data at
 * `cardDatabase/sets/{SET}/prices`, which the existing rule covers: readable by
 * any signed-in user, writable by nobody but the Admin SDK.
 *
 * A failure here does not fail the sync. Prices are a convenience; card data is
 * not, and a pricing mirror going down should not turn the weekly run red.
 */
/**
 * Fetch from TCGCSV and fail with the body, not just the status.
 *
 * The first run of this step reported `groups HTTP 401` and nothing else, which
 * could equally have meant a blocked address or a blocked User-Agent. TCGCSV
 * answers a blocked User-Agent with 401 and a plain-text explanation, so the body
 * is the part that tells you which. Include it.
 */
async function fetchTcgcsv(url, headers, label) {
  const res = await fetch(url, { headers });
  if (res.ok) return res;

  let hint = '(no body)';
  try {
    hint = (await res.text()).slice(0, 300).replace(/\s+/g, ' ').trim();
  } catch {
    // Body already consumed or unreadable; the status alone will have to do.
  }
  throw new Error(`${label} HTTP ${res.status} - ${hint}`);
}

async function syncPrices() {
  const start = Date.now();
  console.log(`\n${'='.repeat(60)}`);
  console.log('  Step: Prices (TCGCSV mirror of TCGplayer)');
  console.log(`${'='.repeat(60)}\n`);

  const priced = [];
  const failed = [];
  let unpriceable = [];
  let totalCards = 0;

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

    // TCGCSV requires a descriptive User-Agent and answers 401 without one.
    const headers = buildRequestHeaders();
    console.log(`  Identifying as User-Agent: ${headers['User-Agent']}`);

    // The mirror rebuilds once a day, and their guidelines ask callers to check
    // this first so an unchanged day costs one request rather than fifty.
    const stampRes = await fetch(buildLastUpdatedUrl(), { headers });
    const upstreamStamp = stampRes.ok ? (await stampRes.text()).trim() : null;
    if (upstreamStamp) {
      console.log(`  Upstream data built ${upstreamStamp}`);
    } else {
      console.warn(`  Could not read last-updated.txt (HTTP ${stampRes.status}); continuing without the unchanged check`);
    }

    const metaRef = db.collection('artifacts')
      .doc(APP_ID)
      .collection('public')
      .doc('data')
      .collection('cardDatabase')
      .doc('priceMetadata');
    const metaSnap = await metaRef.get();
    const lastStamp = metaSnap.exists ? metaSnap.data()?.upstreamStamp : null;

    if (upstreamStamp && lastStamp === upstreamStamp) {
      console.log('  Unchanged since the last sync, skipping (as the guidelines ask)');
      return {
        success: true, skipped: true, duration_ms: Date.now() - start,
        priced: [], failed: [], unpriceable: [], totalCards: 0,
      };
    }

    const groupsRes = await fetchTcgcsv(buildGroupsUrl(), headers, 'groups');
    const groups = await groupsRes.json();

    const { matched, unmatched } = matchGroupsToSets(
      groups,
      catalog.map((s) => s.code),
      PRICE_SET_ALIASES
    );
    unpriceable = unmatched;

    console.log(`  ${matched.length} of ${catalog.length} sets have a TCGplayer group`);

    for (const { setCode, groupId, name } of matched) {
      try {
        const [productsRes, pricesRes] = await Promise.all([
          fetchTcgcsv(buildProductsUrl(groupId), headers, 'products'),
          fetchTcgcsv(buildPricesUrl(groupId), headers, 'prices'),
        ]);

        const { cards, skipped } = buildPriceMap(await productsRes.json(), await pricesRes.json());
        const count = Object.keys(cards).length;

        if (count === 0) {
          // Two innocent causes, both seen in the live data. An unreleased set has
          // products but almost no market prices yet (HMW, IC27), and a few promo
          // sets carry no card Number upstream at all, so their prices cannot be
          // attributed to a card without name matching (SECOP). Neither is an
          // error, and an unreleased set fills itself in once it is out.
          console.log(`  ${setCode}: no priced singles (unreleased, or no card numbers upstream), skipping`);
          continue;
        }

        await db.collection('artifacts')
          .doc(APP_ID)
          .collection('public')
          .doc('data')
          .collection('cardDatabase')
          .doc('sets')
          .collection(setCode)
          .doc('prices')
          .set({
            setCode,
            groupId,
            groupName: name,
            currency: 'USD',
            source: 'tcgcsv',
            fetchedAt: Date.now(),
            cardCount: count,
            cards,
          });

        totalCards += count;
        priced.push(setCode);
        console.log(`  ${setCode}: ${count} card(s) priced (${skipped} non-single product(s) skipped)`);

        // TCGCSV publishes no rate limit, so be a considerate client anyway.
        await new Promise((resolve) => setTimeout(resolve, 150));
      } catch (error) {
        console.warn(`  ${setCode}: price fetch failed - ${error.message}`);
        failed.push(setCode);
      }
    }

    // Recorded only when nothing failed, so a partial run is retried rather than
    // being remembered as complete.
    if (upstreamStamp && failed.length === 0) {
      await metaRef.set({
        upstreamStamp,
        source: 'tcgcsv',
        syncedAt: Date.now(),
        setsPriced: priced.length,
        cardsPriced: totalCards,
      });
    }

    const duration_ms = Date.now() - start;
    console.log(`\n  Prices completed in ${(duration_ms / 1000).toFixed(1)}s`);
    console.log(`  Sets priced: ${priced.length}, cards priced: ${totalCards}, failed: ${failed.length}`);
    if (unpriceable.length) {
      console.log(`  No TCGplayer group (unpriced): ${unpriceable.join(', ')}`);
      console.log(`  Some of those share a group (${PRICE_GROUPS_NEEDING_INVESTIGATION.join(', ')}) and need checking per set, not an alias.`);
    }

    return { success: true, duration_ms, priced, failed, unpriceable, totalCards };
  } catch (error) {
    const duration_ms = Date.now() - start;
    // Deliberately not an error: see the note above on why prices cannot fail the run.
    console.warn(`  Prices step could not run: ${error.message}`);
    return { success: true, degraded: true, duration_ms, priced, failed, unpriceable, totalCards, error: error.message };
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

  // Step 5 - Prices. Never fails the run; see syncPrices.
  steps.prices = await syncPrices();

  // Step 6 - Verify
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
      prices: {
        success: steps.prices.success,
        degraded: steps.prices.degraded || false,
        duration_ms: steps.prices.duration_ms,
        setsPriced: (steps.prices.priced || []).length,
        cardsPriced: steps.prices.totalCards || 0,
        failed: steps.prices.failed || [],
        unpriceable: steps.prices.unpriceable || []
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
  console.log(`  Placeholders: ${steps.placeholders.success ? 'OK' : 'FAILED'} (+${(steps.placeholders.added || []).length}, -${(steps.placeholders.removed || []).length} stale)`);
  const priceState = steps.prices.degraded ? 'DEGRADED' : (steps.prices.skipped ? 'SKIPPED (unchanged)' : 'OK');
  console.log(`  Prices: ${priceState} (${(steps.prices.priced || []).length} sets, ${steps.prices.totalCards || 0} cards)`);
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
