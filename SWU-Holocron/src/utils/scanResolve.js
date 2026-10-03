/**
 * Card-scanner resolution: turns what Gemini read off a photo into a card the
 * app knows, or a reason it could not.
 *
 * Pure -- no Firebase, no Vite -- so it is unit-testable and Node-safe.
 *
 * The name check is the accuracy guard. A misread collector number almost
 * never lands on a card with the same name, so requiring both to agree keeps
 * a wrong card from reaching the collection unnoticed.
 */
import { SET_CODE_MAP } from './officialCodeUtils';

export function normalizeSetCode(raw, setCodes) {
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!code) return null;
  if (setCodes.includes(code)) return code;
  const mapped = SET_CODE_MAP[code];
  if (mapped && setCodes.includes(mapped)) return mapped;
  return null;
}

export function normalizeNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const match = String(raw).match(/\d+/);
  if (!match) return null;
  const n = parseInt(match[0], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(n).padStart(3, '0');
}

export function normalizeName(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function namesMatch(readName, card) {
  const read = normalizeName(readName);
  if (!read) return false;
  const title = normalizeName(card.Name);
  const full = normalizeName(`${card.Name ?? ''} ${card.Subtitle ?? ''}`);
  return read === title || read === full;
}

const unidentified = (reason, read) => ({ status: 'unidentified', reason, read: read ?? null });

/**
 * Registered sets that extend a printed set code. Promo sets print their
 * parent's code -- an SHDOP card says "SHD" with its own promo number -- so a
 * read that fails in SHD may be a card in SHDOP, SHDPQ, SHDPQJ, ...
 * (Prefix, not the registry's parentSetId, which is missing on judge sets.)
 */
export function relatedSetCodes(set, setCodes) {
  return setCodes.filter((code) => code !== set && code.startsWith(set));
}

const findByNumber = (cards, number) => (cards ?? []).find((c) => normalizeNumber(c.Number) === number);

const matched = (set, number, card) => ({ status: 'matched', set, number, name: card.Name, type: card.Type ?? null });

// The first card in `codes` (each extended by its promo sets) whose number and
// name both match, as a match result; otherwise null.
function matchIn(codes, setCodes, getCards, number, name) {
  for (const code of codes) {
    for (const candidate of [code, ...relatedSetCodes(code, setCodes)]) {
      const card = findByNumber(getCards(candidate), number);
      if (card && namesMatch(name, card)) return matched(candidate, number, card);
    }
  }
  return null;
}

/**
 * @param {object} read  what Gemini read: { readable, set, number, name }
 * @param {object} ctx
 * @param {string[]} ctx.setCodes  registered set codes
 * @param {(code: string) => object[]|null} ctx.getCards  loaded card data, or null if not loaded
 * @param {string[]} [ctx.hintSets]  sets picked in the scanner: fallbacks when the
 *   printed set code was misread or unreadable. Never override a match on the printed set.
 */
export function resolveScan(read, { setCodes, getCards, hintSets = [] }) {
  if (!read || read.readable !== true) return unidentified('unreadable', read);

  const number = normalizeNumber(read.number);
  if (!number) return unidentified('unreadable', read);

  const set = normalizeSetCode(read.set, setCodes);
  let reason = 'unknown-set';
  if (set) {
    const card = findByNumber(getCards(set), number);
    if (card && namesMatch(read.name, card)) return matched(set, number, card);

    // Not this card in the printed set: try the promo sets printed with this
    // code. The name check still guards every candidate.
    const promo = matchIn(relatedSetCodes(set, setCodes), setCodes, getCards, number, read.name);
    if (promo) return promo;
    reason = card ? 'name-mismatch' : 'no-such-card';
  }

  // The printed set code was misread or illegible: try the sets the user picked.
  const hinted = matchIn(hintSets.filter((code) => code !== set), setCodes, getCards, number, read.name);
  return hinted ?? unidentified(reason, read);
}
