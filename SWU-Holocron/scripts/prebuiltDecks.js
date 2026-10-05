/**
 * Weekly sync step: prebuilt (precon) decks from sw-unlimited-db.
 *
 * The site owner (user 3671) publishes each precon as it releases. New or
 * edited decks are stored for an admin to review (status 'review' / 'changed');
 * nothing reaches collectors until it is published in the admin console. The
 * TCGplayer precon product list (via TCGCSV) is stored alongside, for the
 * product a deck ships in. Never fails the card sync: on any error it reports
 * `degraded`.
 */
import {
  SOURCE_USER_ID, deckApiUrl, parseDeckApi, findMissingCards, isPreconProduct, suggestProduct, planSync,
} from '../src/utils/prebuiltDecks.js';
import { buildGroupsUrl, buildProductsUrl, buildRequestHeaders } from '../src/tcgPrices.js';

const QUERY_URL = 'https://sw-unlimited-db.com/api/proxy/api/decks/query';
const GAP_MS = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(fetchImpl, url, init, label) {
  const res = await fetchImpl(url, init);
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  return res.json();
}

export async function syncPrebuiltDecks({ db, appId, fetchImpl = fetch, wait = sleep, now = () => new Date().toISOString() }) {
  const added = [];
  const changed = [];
  const headers = buildRequestHeaders();
  const data = db.collection('artifacts').doc(appId).collection('public').doc('data');
  try {
    // Precon products (TCGCSV), for product suggestions and the admin picker.
    const groups = (await getJson(fetchImpl, buildGroupsUrl(), { headers }, 'groups')).results ?? [];
    const products = [];
    for (const g of groups) {
      const list = (await getJson(fetchImpl, buildProductsUrl(g.groupId), { headers }, 'products')).results ?? [];
      for (const p of list) {
        if (!isPreconProduct(p.name)) continue;
        products.push({
          tcgplayerProductId: p.productId, name: p.name, setCode: g.abbreviation ?? null,
          imageUrl: p.imageUrl ?? null, releasedOn: p.presaleInfo?.releasedOn ?? null,
        });
      }
    }
    await data.collection('cardDatabase').doc('preconProducts').set({ products, updatedAt: now() });

    // Every card id we know, to flag deck cards our database lacks.
    const registry = (await data.collection('cardDatabase').doc('sets').get()).data()?.sets ?? [];
    const known = new Set();
    for (const { code } of registry) {
      const snap = await data.collection('cardDatabase').doc('sets').collection(code).doc('data').get();
      for (const c of (snap.exists ? snap.data()?.cards : null) ?? []) known.add(`${c.Set}_${c.Number}`);
    }

    // The owner's published decks, and what we already hold.
    const listed = [];
    for (let page = 1; ; page += 1) {
      const body = JSON.stringify({ userId: SOURCE_USER_ID, status: 1, take: 100, page, cards: [] });
      const res = await getJson(fetchImpl, QUERY_URL, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body }, 'deck query');
      listed.push(...(res.items ?? []));
      await wait(GAP_MS);
      if (page >= (res.totalPages ?? 1)) break;
    }
    const storedSnap = await data.collection('prebuiltDecks').get();
    const stored = Object.fromEntries(storedSnap.docs.map((d) => [d.id, d.data()]));

    for (const { sourceId, reason } of planSync(listed, stored)) {
      const meta = listed.find((d) => d.id === sourceId);
      const deck = parseDeckApi(await getJson(fetchImpl, deckApiUrl(sourceId), { headers }, `deck ${sourceId}`), sourceId);
      await wait(GAP_MS);
      if (!deck) continue;
      const issues = findMissingCards(deck.cards, known);
      const ref = data.collection('prebuiltDecks').doc(String(sourceId));
      if (reason === 'new') {
        await ref.set({
          ...deck, sourceUpdatedAt: meta.updatedDate ?? null, typeId: meta.typeId ?? null, issues,
          suggestedProduct: suggestProduct(deck, products), product: null, name: deck.sourceName,
          status: 'review', fetchedAt: now(),
        });
        added.push(sourceId);
      } else {
        // Edited at the source: hold the new list for review, keep serving the published one.
        await ref.set({
          status: 'changed', fetchedAt: now(),
          pending: { cards: deck.cards, leaders: deck.leaders, base: deck.base, issues, sourceUpdatedAt: meta.updatedDate ?? null },
        }, { merge: true });
        changed.push(sourceId);
      }
    }
    return { success: true, added, changed, products: products.length };
  } catch (error) {
    return { success: true, degraded: true, added, changed, products: 0, error: error.message };
  }
}
