/**
 * Official decklist images (two decks per image, "<NAME> DECK LIST") read by
 * the readDecklist function, resolved here to cards. The image never prints a
 * set code: a plain number is in the deck's set, an asterisked one is "a card
 * from a previous set". Like the scanner, a line is only accepted when the
 * number and the name agree. Pure.
 */
import { SET_CODE_MAP } from './officialCodeUtils';
import { cardKey } from './prebuiltDecks';

const CDN_HOST = 'cdn.starwarsunlimited.com';

export function isOfficialImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === CDN_HOST && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** "…/large_SWH_04_…" -> the registry's code for official set 04 (JTL). */
export function setFromImageUrl(url, registry) {
  const match = String(url ?? '').match(/SWH_(\d{2})/);
  if (!match) return null;
  const codes = Object.entries(SET_CODE_MAP).filter(([k, v]) => /^[A-Z]/.test(k) && v === match[1]).map(([k]) => k);
  const known = new Set((registry ?? []).map((s) => s.code));
  return codes.find((code) => known.has(code)) ?? null;
}

export const normalizeName = (s) => String(s ?? '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

export function earlierBaseSets(setCode, registry) {
  const own = (registry ?? []).find((s) => s.code === setCode);
  return (registry ?? [])
    .filter((s) => s.isBaseSet && s.code !== setCode && (!own?.releaseDate || (s.releaseDate ?? '') < own.releaseDate))
    .sort((a, b) => String(b.releaseDate ?? '').localeCompare(String(a.releaseDate ?? '')))
    .map((s) => s.code);
}

const pad = (n) => (/^\d+$/.test(String(n)) ? String(n).padStart(3, '0') : String(n));
const atNumber = (cards, number) => (cards ?? []).find((card) => pad(card.Number) === pad(number));

export function resolveDecklistLine(line, { setCode, cardsBySet, earlierSets }) {
  const wanted = normalizeName(line.name);
  const agrees = (card) => card && normalizeName(card.Name) === wanted;
  const own = line.fromPreviousSet ? null : atNumber(cardsBySet[setCode], line.number);
  if (agrees(own)) return { card: own };
  for (const code of earlierSets ?? []) {
    const card = atNumber(cardsBySet[code], line.number);
    if (agrees(card)) return { card };
  }
  if (own) return { error: 'name-mismatch', candidate: own };
  return { error: 'not-found' };
}

export const titleCase = (s) => String(s ?? '').trim().toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());

const isLeader = (card) => card?.Type === 'Leader';
const isBase = (card) => card?.Type === 'Base';

export function deckCounts(entries) {
  const sum = (pred) => (entries ?? []).filter((e) => pred(e.card)).reduce((s, e) => s + e.qty, 0);
  return { leaders: sum(isLeader), bases: sum(isBase), main: sum((card) => !isLeader(card) && !isBase(card)) };
}

const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck';

/**
 * A removed line is kept, not dropped: an in-set number (the card our database
 * lacks, e.g. a set not seeded yet) stays in the deck flagged as an issue, so
 * adding the deck skips it by name like a deck added from a link; every removed
 * line is also listed in removedLines.
 */
export function buildPrebuiltDeck({ title, entries, setCode, removed = [] }) {
  const qty = new Map();
  for (const { card, qty: n } of entries ?? []) {
    const id = cardKey(card.Set, card.Number);
    qty.set(id, (qty.get(id) ?? 0) + n);
  }
  const issues = [];
  for (const line of removed) {
    if (line.fromPreviousSet) continue;
    const id = cardKey(setCode, line.number);
    qty.set(id, (qty.get(id) ?? 0) + line.qty);
    if (!issues.some((i) => i.id === id)) issues.push({ id, problem: 'unknown-card' });
  }
  const ids = (pred) => [...new Set((entries ?? []).filter((e) => pred(e.card)).map((e) => cardKey(e.card.Set, e.card.Number)))];
  return {
    sourceId: `img-${String(setCode).toLowerCase()}-${slug(title)}`,
    sourceName: titleCase(title),
    leaders: ids(isLeader),
    base: ids(isBase)[0] ?? null,
    cards: [...qty].map(([id, n]) => ({ id, qty: n })).sort((a, b) => a.id.localeCompare(b.id)),
    issues,
    removedLines: removed.map(({ number, name, qty: n, fromPreviousSet }) => ({ number, name, qty: n, fromPreviousSet: Boolean(fromPreviousSet) })),
  };
}
