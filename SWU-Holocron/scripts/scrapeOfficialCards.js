/**
 * Official Site Card Scraper (headless browser version)
 *
 * This script uses Playwright to load the official starwarsunlimited.com card
 * list, capture the client-side card API responses, and persist promo cards to
 * Firestore. It keeps the SWU-DB data untouched by writing into `official-data`
 * documents per set.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OFFICIAL_BASE_URL = 'https://starwarsunlimited.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

// Can be used in Node.js (with service account) or browser (with auth)
const isNode = typeof process !== 'undefined' && process.versions?.node;

let admin;
let db;

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
      console.error('   Please download service account key from Firebase Console');
      process.exit(1);
    }
  }

  admin = await import('firebase-admin');
  admin.default.initializeApp({
    credential: admin.default.credential.cert(serviceAccount)
  });
  db = admin.default.firestore();
} else {
  const { db: firestoreDb } = await import('../src/firebase.js');
  db = firestoreDb;
}

// Import APP_ID from firebase.js to ensure consistency
const { APP_ID: FIREBASE_APP_ID } = await import('../src/firebase.js');
const APP_ID = FIREBASE_APP_ID;

function mapOfficialCardToInternal(officialCard) {
  const src = officialCard.attributes || officialCard;

  const expansion = src.expansion?.data?.attributes || {};
  const rarity = src.rarity?.data?.attributes || {};
  const type = src.type?.data?.attributes || {};
  const type2 = src.type2?.data?.attributes || {};

  const aspects = Array.isArray(src.aspects?.data)
    ? src.aspects.data.map(a => a.attributes?.englishName || a.attributes?.name).filter(Boolean)
    : src.aspects || src.affinities || [];

  const traits = Array.isArray(src.traits?.data)
    ? src.traits.data.map(t => t.attributes?.name).filter(Boolean)
    : src.traits || [];

  const keywords = Array.isArray(src.keywords?.data)
    ? src.keywords.data.map(k => k.attributes?.name).filter(Boolean)
    : src.keywords || [];

  const arenas = Array.isArray(src.arenas?.data)
    ? src.arenas.data.map(a => a.attributes?.name).filter(Boolean)
    : src.arena || null;

  const setCode = expansion.code || src.expansionCode || src.set || src.setCode || 'UNKNOWN';
  const setName = expansion.name || src.expansionName || src.setName || src.set || 'Unknown Set';
  const cardId = src.cardId || src.id || src.cardUid || officialCard.id;
  const frontArt = src.artFront?.data?.attributes?.url || src.frontArt || src.imageUrl || null;
  const backArt = src.artBack?.data?.attributes?.url || src.backArt || null;

  return {
    Name: src.name ?? src.title ?? null,
    Subtitle: src.subtitle ?? src.subTitle ?? null,
    Number: src.number ?? src.cardNumber ?? src.serialCode ?? null,
    Set: setCode,
    SetName: setName,
    Type: type.name || type.value || src.type || null,
    Type2: type2.name || type2.value || null,
    Cost: src.cost ?? null,
    Power: src.power ?? src.attack ?? null,
    HP: src.hp ?? src.health ?? null,
    Rarity: rarity.name || rarity.englishName || src.rarity || null,
    Unique: src.unique ?? false,
    Aspects: aspects,
    Traits: traits,
    FrontText: src.text ?? src.frontText ?? src.description ?? '',
    BackText: src.deployBox ?? src.epicAction ?? src.backText ?? null,
    Keywords: keywords,
    Arena: arenas,
    DoubleSided: src.doubleSided ?? false,
    FrontArt: frontArt,
    BackArt: backArt,
    OfficialUrl: src.url || (cardId ? `${OFFICIAL_BASE_URL}/cards?cid=${cardId}` : null),
    OfficialCode: src.officialCode ?? src.cardCode ?? src.serialCode ?? src.cardUid ?? null,
    _scrapedFrom: 'official',
    _scrapedAt: Date.now()
  };
}

function cleanUndefined(card) {
  const cleaned = {};
  for (const [key, value] of Object.entries(card)) {
    cleaned[key] = value === undefined ? null : value;
  }
  return cleaned;
}

function containsCards(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (Array.isArray(payload)) return payload.every(item => typeof item === 'object');
  if (Array.isArray(payload.cards)) return true;
  if (Array.isArray(payload.data?.cards)) return true;
  if (Array.isArray(payload.data)) return payload.data.every(item => typeof item === 'object');
  if (Array.isArray(payload.results)) return true;
  return false;
}

function extractCardsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.cards)) return payload.cards;
  if (Array.isArray(payload.data?.cards)) return payload.data.cards;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.results)) return payload.results;
  return [];
}

function collectCardsFromPayloads(payloads) {
  const seen = new Set();
  const cards = [];

  for (const payload of payloads) {
    const extracted = extractCardsFromPayload(payload.json);
    for (const card of extracted) {
      const setCode = card.expansionCode || card.set || card.setCode || 'UNK';
      const identifier = card.id || card.number || card.cardNumber || card.title || card.name || 'unknown';
      const key = `${setCode}-${identifier}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cards.push(card);
    }
  }

  return cards;
}

function filterPromoCards(cards) {
  const promoSets = ['PROMO', 'P25', 'J25', 'J24', 'C25', 'C24', 'G25', 'GG', 'IBH'];

  return cards.filter(card => {
    const set = card.Set || card.expansionCode || card.set || card.setCode;
    return promoSets.includes(set);
  });
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let lastHeight = document.body.scrollHeight;
      const interval = setInterval(() => {
        window.scrollBy(0, 1200);
        if (document.body.scrollHeight === lastHeight) {
          clearInterval(interval);
          resolve();
        }
        lastHeight = document.body.scrollHeight;
      }, 200);
    });
  });
}

async function fetchCardPages(page, baseUrl, pageSize = 200, maxPages = 30) {
  if (!baseUrl) return [];

  const urlObj = new URL(baseUrl);
  urlObj.searchParams.set('pagination[pageSize]', String(pageSize));

  const payloads = [];
  let totalCardsFromMeta = null;

  for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
    urlObj.searchParams.set('pagination[page]', String(pageNum));
    const url = urlObj.toString();

    const { status, json } = await page.evaluate(async (targetUrl) => {
      try {
        const res = await fetch(targetUrl, {
          headers: {
            Accept: 'application/json',
            'Accept-Language': 'en-US,en;q=0.9'
          }
        });
        const statusCode = res.status;
        let body = null;
        try {
          body = await res.json();
        } catch (err) {
          body = null;
        }
        return { status: statusCode, json: body };
      } catch (error) {
        return { status: 0, json: null };
      }
    }, url);

    if (status !== 200 || !json) {
      console.log(`  ↳ stop paging: HTTP ${status} at page ${pageNum} (${url})`);
      break;
    }

    if (!containsCards(json)) {
      console.log(`  ↳ stop paging: no cards payload at page ${pageNum}`);
      break;
    }

    const cards = extractCardsFromPayload(json);
    const count = cards.length;
    if (count === 0) {
      console.log(`  ↳ stop paging: empty page ${pageNum}`);
      break;
    }

    payloads.push({ url, json });
    console.log(`  ↳ API page ${pageNum}: ${count} cards`);

    // Capture total from meta if present
    if (json?.meta?.pagination?.total && totalCardsFromMeta == null) {
      totalCardsFromMeta = json.meta.pagination.total;
    }

    if (count < pageSize) {
      console.log(`  ↳ stop paging: last page ${pageNum}`);
      break;
    }
  }

  if (totalCardsFromMeta != null) {
    console.log(`  ↳ API reported total cards: ${totalCardsFromMeta}`);
  }

  return payloads;
}

async function scrapeWithBrowser(searchFilter = '') {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (error) {
    throw new Error('playwright is required. Install with: npm install --save-dev playwright');
  }

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1366, height: 768 }
  });
  const page = await context.newPage();

  const payloads = [];
  const seenUrls = new Set();
  let cardListBaseUrl = null;

  page.on('response', async (response) => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';
    if (!contentType.includes('application/json')) return;
    if (seenUrls.has(url)) return;
    seenUrls.add(url);

    try {
      const json = await response.json();
      if (!cardListBaseUrl && url.includes('/api/card-list') && !url.includes('/api/card-list/meta')) {
        cardListBaseUrl = url;
      }
      if (containsCards(json)) {
        payloads.push({ url, json });
        const count = extractCardsFromPayload(json).length;
        if (count > 0) {
          console.log(`  ↳ captured ${count} cards from ${url}`);
        }
      }
    } catch (error) {
      // Ignore parse errors
    }
  });

  const targetUrl = `${OFFICIAL_BASE_URL}/cards${searchFilter ? '?' + searchFilter : ''}`;
  console.log(`Launching headless browser: ${targetUrl}`);

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle');

  await autoScroll(page);

  let loadMoreClicks = 0;
  while (await page.$('button:has-text("Load more")')) {
    await page.click('button:has-text("Load more")');
    loadMoreClicks += 1;
    await page.waitForTimeout(1200);
    await autoScroll(page);
  }

  await page.waitForTimeout(1500);

  const clientMeta = await page.evaluate(() => {
    const data = window.__NEXT_DATA__?.props?.pageProps || {};
    return {
      expansions: data.expansions || data.filters?.expansions || [],
      aspects: data.aspects || [],
      traits: data.traits || [],
      keywords: data.keywords || [],
      rarities: data.rarities || []
    };
  });

  const apiPayloads = await fetchCardPages(page, cardListBaseUrl, 40, 30);
  await browser.close();
  const allPayloads = [...payloads, ...apiPayloads];
  const cards = collectCardsFromPayloads(allPayloads);

  return {
    cards,
    expansions: clientMeta.expansions || [],
    metadata: {
      scrapedAt: Date.now(),
      source: 'starwarsunlimited.com',
      loadMoreClicks,
      payloadsCaptured: allPayloads.length,
      cardListBaseUrl,
      clientMeta
    }
  };
}

async function saveScrapedCards(cards, options = {}) {
  const { promoOnly = false } = options;

  const cardsToSave = promoOnly ? filterPromoCards(cards) : cards;

  if (cardsToSave.length === 0) {
    console.log('⚠️  No cards to save');
    return { saved: 0, skipped: 0 };
  }

  console.log(`\nSaving ${cardsToSave.length} cards to Firestore...`);

  const cardsBySet = {};
  for (const card of cardsToSave) {
    const setCode = card.Set;
    if (!cardsBySet[setCode]) {
      cardsBySet[setCode] = [];
    }
    cardsBySet[setCode].push(card);
  }

  let saved = 0;
  let skipped = 0;

  for (const [setCode, setCards] of Object.entries(cardsBySet)) {
    try {
      const setRef = db.collection('artifacts')
        .doc(APP_ID)
        .collection('public')
        .doc('data')
        .collection('cardDatabase')
        .doc('sets')
        .collection(setCode)
        .doc('official-data');

      const setData = {
        code: setCode,
        name: setCards[0].SetName,
        totalCards: setCards.length,
        lastSync: Date.now(),
        syncVersion: '1.1-browser',
        syncSource: 'starwarsunlimited.com',
        cards: setCards
      };

      await setRef.set(setData);
      console.log(`  ✓ Saved ${setCards.length} cards to ${setCode}`);
      saved += setCards.length;
    } catch (error) {
      console.error(`  ✗ Failed to save ${setCode}:`, error.message);
      skipped += setCards.length;
    }
  }

  return { saved, skipped };
}

async function scrapeOfficialCards(options = {}) {
  const {
    promoOnly = false,
    dryRun = false,
    searchFilter = ''
  } = options;

  console.log('='.repeat(60));
  console.log('  SWU Holocron - Official Site Card Scraper');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Mode: ${promoOnly ? 'Promotional cards only' : 'All cards'}`);
  console.log(`Dry run: ${dryRun ? 'Yes (no Firestore writes)' : 'No'}`);
  console.log('');

  const startTime = Date.now();

  try {
    const { cards, expansions, metadata } = await scrapeWithBrowser(searchFilter);

    console.log(`\nCaptured ${cards.length} raw cards from ${expansions.length} expansions (via browser)`);

    const mappedCards = cards
      .map(mapOfficialCardToInternal)
      .map(cleanUndefined)
      .filter(c => c.Name && c.Set);

    const cardsToProcess = promoOnly ? filterPromoCards(mappedCards) : mappedCards;

    console.log(`\nCards to process: ${cardsToProcess.length}`);

    if (promoOnly) {
      const promoSets = new Set(cardsToProcess.map(c => c.Set));
      console.log(`Promo sets found: ${Array.from(promoSets).join(', ') || 'None'}`);
    }

    let result = { saved: 0, skipped: 0 };
    if (!dryRun) {
      result = await saveScrapedCards(cardsToProcess, { promoOnly });
    } else {
      console.log('\n🔍 DRY RUN - No data will be saved');
      console.log(`Would save ${cardsToProcess.length} cards`);
    }

    const duration = Date.now() - startTime;

    console.log('\n' + '='.repeat(60));
    console.log('  Summary');
    console.log('='.repeat(60));
    console.log(`  ✓ Scraped (raw): ${cards.length} cards`);
    console.log(`  ✓ Processed: ${cardsToProcess.length} cards`);
    console.log(`  ✓ Saved: ${result.saved} cards`);
    console.log(`  ✗ Skipped: ${result.skipped} cards`);
    console.log(`  ⏱ Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log('='.repeat(60));

    return {
      success: result.skipped === 0,
      cards: cardsToProcess,
      metadata,
      result
    };
  } catch (error) {
    console.error('\n✗ Fatal error:', error);
    console.error(error.stack);
    throw error;
  }
}

export { scrapeOfficialCards, mapOfficialCardToInternal, filterPromoCards };

if (isNode) {
  const scriptPath = fileURLToPath(import.meta.url);
  const execPath = process.argv[1];

  if (scriptPath === execPath || scriptPath.replace(/\\/g, '/') === execPath.replace(/\\/g, '/')) {
    const args = process.argv.slice(2);
    const options = {
      promoOnly: args.includes('--promo-only'),
      dryRun: args.includes('--dry-run'),
      searchFilter: args.find(arg => arg.startsWith('--filter='))?.split('=')[1] || ''
    };

    scrapeOfficialCards(options)
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
