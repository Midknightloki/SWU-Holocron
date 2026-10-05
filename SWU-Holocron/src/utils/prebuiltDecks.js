/**
 * Prebuilt (precon) decks: parsing sw-unlimited-db's deck API, and matching a
 * deck to the TCGplayer product it ships in. Pure and Vite-free -- the weekly
 * sync (scripts/prebuiltDecks.js) imports it too.
 *
 * Precons always contain the standard printing of every card, so a deck's
 * `SET_NNN` ids map straight to `SET_NNN_std` collection ids.
 */
export const SOURCE_USER_ID = 3671;
const DECK_API = 'https://sw-unlimited-db.com/umbraco/api/deckapi/get?id=';

export const deckApiUrl = (id) => `${DECK_API}${id}`;

export function parseDeckLink(text) {
  const s = String(text ?? '').trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = /sw-unlimited-db\.com\/decks\/(\d+)/i.exec(s);
  return m ? Number(m[1]) : null;
}

export function splitCardId(id) {
  const i = String(id ?? '').lastIndexOf('_');
  if (i <= 0) return null;
  return { set: id.slice(0, i), number: id.slice(i + 1) };
}

export function parseDeckApi(json, sourceId) {
  if (!json?.leader?.id || !Array.isArray(json.deck)) return null;
  const qty = new Map();
  const add = (id, n) => qty.set(id, (qty.get(id) ?? 0) + (Number(n) || 1));
  add(json.leader.id, json.leader.count);
  if (json.base?.id) add(json.base.id, json.base.count);
  json.deck.forEach((c) => add(c.id, c.count));
  // Twin Suns: the second leader sits in the deck list as a "Leader" entry.
  const leaders = [json.leader.id, ...json.deck.filter((c) => c.unit === 'Leader').map((c) => c.id)];
  return {
    sourceId,
    sourceName: json.metadata?.name ?? `Deck ${sourceId}`,
    leaders: [...new Set(leaders)],
    base: json.base?.id ?? null,
    cards: [...qty].map(([id, n]) => ({ id, qty: n })),
  };
}

export function findMissingCards(cards, knownIds) {
  return cards.filter((c) => !knownIds.has(c.id)).map((c) => ({ id: c.id, problem: 'unknown-card' }));
}

// "<Set> - Spotlight Deck: X", "Twin Suns - X Deck", "<Set> - Two-Player
// Starter", "Intro Battle: Hoth - Learn to Play Kit" -- never a bundle of them.
const PRECON = /^.+ - (spotlight deck: .+|.+ deck|two-player starter|learn to play kit)$/i;
const BUNDLE = /\b(display|pair|case|bundle|box)\b/i;
export const isPreconProduct = (name) => PRECON.test(name ?? '') && !BUNDLE.test(name ?? '');

export function deckSetCode(deck) {
  const m = /\(([A-Z0-9]+)\)\s*$/.exec(deck.sourceName ?? '');
  if (m) return m[1];
  return splitCardId(deck.leaders?.[0])?.set ?? null;
}

const STOP = new Set(['deck', 'spotlight', 'the', 'and', 'of', 'preset', 'two', 'player', 'starter']);
const words = (s) => new Set(String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z0-9]+/)
  .filter((w) => w.length > 2 && !STOP.has(w)));

export function suggestProduct(deck, products) {
  const set = deckSetCode(deck);
  // Same set, and at least one shared name word -- the set's name counts
  // ("Intro Battle: Hoth"), but sharing a set alone is not enough: the site
  // owner's personal decks share sets with the precons too.
  const candidates = products.filter((p) => p.setCode === set);
  const mine = words(deck.sourceName);
  let best = null;
  let bestScore = 0;
  for (const p of candidates) {
    const theirs = words(p.name);
    const score = [...mine].filter((w) => theirs.has(w)).length;
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}

/**
 * Which listed decks to fetch: new ones, and stored ones edited at the source
 * since the copy we hold (for a changed deck, the pending copy). A deck added
 * by link has no source date, so it is fetched once to adopt one. What an
 * update does depends on the stored status -- see the sync.
 */
export function planSync(listed, stored) {
  const out = [];
  for (const deck of listed) {
    const prior = stored[deck.id];
    if (!prior) {
      out.push({ sourceId: deck.id, reason: 'new' });
      continue;
    }
    if (prior.status === 'ignored') continue;
    const held = prior.pending?.sourceUpdatedAt ?? prior.sourceUpdatedAt ?? '';
    if ((deck.updatedDate ?? '') > held) out.push({ sourceId: deck.id, reason: 'update' });
  }
  return out;
}

const cardKey = (cards) => (cards ?? []).map((c) => `${c.id}x${c.qty}`).sort().join(',');
export const sameCards = (a, b) => cardKey(a) === cardKey(b);
