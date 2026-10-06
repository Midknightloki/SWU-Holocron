import { loadSet } from './setLoader';
import { PricingService } from './PricingService';
import { buildCollectionLines } from '../utils/collectionValue';

/**
 * Everything the collection value report needs: card details for each owned
 * set (through the IndexedDB cache) and today's market price for each owned
 * card. A set that won't load keeps its cards by their stored name; failed
 * prices leave every line unpriced. Never throws.
 */
export async function loadCollectionValue(collectionData, { loadSetImpl = loadSet, pricing = PricingService } = {}) {
  const owned = Object.entries(collectionData ?? {}).filter(([, d]) => (Number(d?.quantity) || 0) > 0);
  const setCodes = [...new Set(owned.map(([, d]) => d.set).filter(Boolean))];
  const cardsBySet = {};
  const missingSets = [];
  await Promise.all(setCodes.map(async (code) => {
    try {
      cardsBySet[code] = (await loadSetImpl(code)).cards ?? [];
    } catch {
      missingSets.push(code);
    }
  }));
  let prices = {};
  let error;
  try {
    prices = await pricing.getBulkPrices(owned.map(([id, d]) => ({
      cardId: id, set: d.set, number: String(d.number), isFoil: Boolean(d.isFoil ?? id.endsWith('_foil')),
    })));
  } catch {
    error = 'prices';
  }
  return { lines: buildCollectionLines(collectionData, cardsBySet, prices), missingSets: missingSets.sort(), ...(error ? { error } : {}) };
}
