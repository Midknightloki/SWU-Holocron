import { CardService } from './CardService';
import { CardCache } from './cardCache';

/**
 * Cards for one set: the IndexedDB cache first (no TTL, as before), otherwise
 * CardService's own Firestore -> legacy cache -> live API fallback, then cached.
 *
 * A cache failure never fails the load. The old localStorage cache threw
 * QuotaExceededError on write once full, and that turned a successful fetch
 * into App's "Network offline" collection-only fallback.
 *
 * @returns {Promise<{ cards: object[], source: string }>} rejects only if the fetch fails
 */
export async function loadSet(setCode, { force = false, cache = CardCache, fetchSet = CardService.fetchSetData } = {}) {
  if (!force) {
    let cached = null;
    try {
      cached = await cache.get(setCode);
    } catch {
      cached = null;
    }
    if (cached) return { cards: cached, source: 'cache' };
  }

  const { data, source } = await fetchSet(setCode);
  const cards = [...data].sort((a, b) => String(a.Number).localeCompare(String(b.Number), undefined, { numeric: true }));
  try {
    await cache.set(setCode, cards);
  } catch {
    // Not cached this time; it is fetched again next load.
  }
  return { cards, source };
}
