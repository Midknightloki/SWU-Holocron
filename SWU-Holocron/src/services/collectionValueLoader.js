import { loadSet } from './setLoader';
import { PricingService } from './PricingService';
import { DeckService } from './DeckService';
import { buildCollectionLines } from '../utils/collectionValue';
import { LEGACY_SET_CODES } from '../setCatalog';

/**
 * Everything the collection value report needs: card details for each owned
 * set (through the IndexedDB cache) and today's market price for each owned
 * card. A set that won't load keeps its cards by their stored name; failed
 * prices leave every line unpriced. Never throws.
 */
export async function loadCollectionValue(collectionData, {
  loadSetImpl = loadSet, pricing = PricingService, uid, includeDecks = false, decksService = DeckService,
} = {}) {
  const owned = Object.entries(collectionData ?? {}).filter(([, d]) => (Number(d?.quantity) || 0) > 0);
  // PROMO/OTHER are legacy collection buckets, not sets: there is nothing to
  // load, and trying fails every time.
  const setCodes = [...new Set(owned.map(([, d]) => d.set).filter((code) => code && !LEGACY_SET_CODES.includes(code)))];
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
  // A failed read (offline, denied) leaves cards unpriced without throwing:
  // say so, rather than show an unexplained $0.
  if (!error && (pricing.failedSets?.() ?? []).some((code) => setCodes.includes(code))) error = 'prices';
  // The surplus report needs the decks; without them it must not guess.
  let decks;
  let decksError;
  if (includeDecks) {
    try {
      decks = await decksService.listDecks(uid);
    } catch {
      decksError = true;
    }
  }
  return {
    lines: buildCollectionLines(collectionData, cardsBySet, prices),
    missingSets: missingSets.sort(),
    ...(error ? { error } : {}),
    ...(decks ? { decks } : {}),
    ...(decksError ? { decksError } : {}),
  };
}
