import { loadSet } from './setLoader';
import { PricingService } from './PricingService';
import { itemsFromGaps, priceRequests } from '../utils/cardLists';

/** Today's market prices for a list's items. Never throws. */
export async function loadListPrices(items, { pricing = PricingService } = {}) {
  const requests = priceRequests(items);
  if (requests.length === 0) return { prices: {} };
  try {
    const prices = await pricing.getBulkPrices(requests);
    const sets = new Set(requests.map((r) => r.set));
    // A denied or offline set read leaves cards unpriced without throwing.
    if ((pricing.failedSets?.() ?? []).some((code) => sets.has(code))) return { prices, error: 'prices' };
    return { prices };
  } catch {
    return { prices: {}, error: 'prices' };
  }
}

/** Wants items for the titles the chosen sets are missing. Never throws. */
export async function loadGapItems(setCodes, collectionData, { mode = 'missing', loadSetImpl = loadSet } = {}) {
  const cardsBySet = {};
  const failedSets = [];
  await Promise.all(setCodes.map(async (code) => {
    try {
      cardsBySet[code] = (await loadSetImpl(code)).cards ?? [];
    } catch {
      failedSets.push(code);
    }
  }));
  return { items: itemsFromGaps(cardsBySet, collectionData, { mode }), failedSets: failedSets.sort() };
}
