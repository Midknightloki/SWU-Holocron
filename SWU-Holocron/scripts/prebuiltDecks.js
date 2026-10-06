/**
 * Weekly sync step: prebuilt (precon) decks from sw-unlimited-db.
 *
 * The site owner (user 3671) publishes each precon as it releases. Nothing
 * reaches collectors until an admin publishes it, and a published deck edited
 * at the source keeps serving its published list until an admin accepts the
 * change:
 *   - new deck                         -> stored as 'review'
 *   - edited, still 'review'           -> contents replaced, still 'review'
 *   - edited, 'published' / 'changed'  -> same cards as published: date adopted
 *                                         (and a pending change dropped);
 *                                         otherwise held in `pending`, 'changed'
 * The TCGplayer precon product list (via TCGCSV) is stored alongside. Every
 * stored deck's missing-card flags are rechecked against the card database.
 * Never fails the card sync: on error it reports `degraded`.
 */
import {
  SOURCE_USER_ID, deckApiUrl, parseDeckApi, findMissingCards, isPreconProduct, suggestProduct, planSync, sameCards, knownIdsFrom,
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

const sameIssues = (a, b) => JSON.stringify((a ?? []).map((i) => i.id).sort()) === JSON.stringify((b ?? []).map((i) => i.id).sort());

// TCGplayer precon products. If any group fails, the stored list is kept
// whole rather than replaced by a partial one.
async function loadProducts({ fetchImpl, headers, productsRef, now }) {
  const stored = async () => ((await productsRef.get()).data()?.products ?? []);
  let groups;
  try {
    groups = (await getJson(fetchImpl, buildGroupsUrl(), { headers }, 'groups')).results ?? [];
  } catch {
    return { products: await stored(), fresh: false };
  }
  const products = [];
  let failed = false;
  for (const g of groups) {
    try {
      const list = (await getJson(fetchImpl, buildProductsUrl(g.groupId), { headers }, 'products')).results ?? [];
      for (const p of list) {
        if (!isPreconProduct(p.name)) continue;
        products.push({
          tcgplayerProductId: p.productId, name: p.name, setCode: g.abbreviation ?? null,
          imageUrl: p.imageUrl ?? null, releasedOn: p.presaleInfo?.releasedOn ?? null,
        });
      }
    } catch {
      failed = true;
    }
  }
  if (failed) return { products: await stored(), fresh: false };
  await productsRef.set({ products, updatedAt: now() });
  return { products, fresh: true };
}

export async function syncPrebuiltDecks({ db, appId, fetchImpl = fetch, wait = sleep, now = () => new Date().toISOString() }) {
  const added = [];
  const changed = [];
  const headers = buildRequestHeaders();
  const data = db.collection('artifacts').doc(appId).collection('public').doc('data');
  try {
    const { products } = await loadProducts({
      fetchImpl, headers, productsRef: data.collection('cardDatabase').doc('preconProducts'), now,
    });

    // Every card id we know, to flag deck cards our database lacks.
    const registry = (await data.collection('cardDatabase').doc('sets').get()).data()?.sets ?? [];
    const known = new Set();
    for (const { code } of registry) {
      const snap = await data.collection('cardDatabase').doc('sets').collection(code).doc('data').get();
      for (const id of knownIdsFrom(snap.exists ? snap.data()?.cards : null)) known.add(id);
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
    const touched = new Set();

    for (const { sourceId, reason } of planSync(listed, stored)) {
      const meta = listed.find((d) => d.id === sourceId);
      const deck = parseDeckApi(await getJson(fetchImpl, deckApiUrl(sourceId), { headers }, `deck ${sourceId}`), sourceId);
      await wait(GAP_MS);
      if (!deck) continue;
      const issues = findMissingCards(deck.cards, known);
      const sourceUpdatedAt = meta.updatedDate ?? null;
      const ref = data.collection('prebuiltDecks').doc(String(sourceId));
      const prior = stored[sourceId];
      touched.add(String(sourceId));

      if (reason === 'new') {
        await ref.set({
          ...deck, sourceUpdatedAt, typeId: meta.typeId ?? null, issues,
          suggestedProduct: suggestProduct(deck, products), product: null, name: deck.sourceName,
          status: 'review', fetchedAt: now(),
        });
        added.push(sourceId);
      } else if (prior.status === 'review') {
        // Not public yet: just take the latest contents.
        await ref.set({
          cards: deck.cards, leaders: deck.leaders, base: deck.base, issues, sourceUpdatedAt,
          suggestedProduct: prior.suggestedProduct ?? suggestProduct(deck, products), fetchedAt: now(),
        }, { merge: true });
      } else if (sameCards(deck.cards, prior.cards)) {
        // Same list as published (a link-added deck adopting its date, or an
        // edit that changed nothing we care about, or was reverted).
        await ref.set({ status: 'published', pending: null, sourceUpdatedAt, issues, fetchedAt: now() }, { merge: true });
      } else {
        // Edited at the source: hold the new list for review, keep serving the published one.
        await ref.set({
          status: 'changed', fetchedAt: now(),
          pending: { cards: deck.cards, leaders: deck.leaders, base: deck.base, issues, sourceUpdatedAt },
        }, { merge: true });
        changed.push(sourceId);
      }
    }

    // Recheck the rest: a set seeded since a deck was stored clears its flags.
    if (known.size > 0) {
      for (const [id, deck] of Object.entries(stored)) {
        if (touched.has(id) || deck.status === 'ignored') continue;
        const issues = findMissingCards(deck.cards ?? [], known);
        if (!sameIssues(issues, deck.issues)) {
          await data.collection('prebuiltDecks').doc(id).set({ issues }, { merge: true });
        }
      }
    }
    return { success: true, added, changed, products: products.length };
  } catch (error) {
    return { success: true, degraded: true, added, changed, products: 0, error: error.message };
  }
}
