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

export function resolveScan(read, { setCodes, getCards }) {
  if (!read || read.readable !== true) return unidentified('unreadable', read);

  const set = normalizeSetCode(read.set, setCodes);
  if (!set) return unidentified('unknown-set', read);

  const number = normalizeNumber(read.number);
  if (!number) return unidentified('unreadable', read);

  const card = findByNumber(getCards(set), number);
  if (card && namesMatch(read.name, card)) return matched(set, number, card);

  // Not this card in the printed set: try the promo sets printed with this
  // code. The name check still guards every candidate, so a match here is
  // as trustworthy as one in the printed set.
  for (const code of relatedSetCodes(set, setCodes)) {
    const promo = findByNumber(getCards(code), number);
    if (promo && namesMatch(read.name, promo)) return matched(code, number, promo);
  }

  return unidentified(card ? 'name-mismatch' : 'no-such-card', read);
}
