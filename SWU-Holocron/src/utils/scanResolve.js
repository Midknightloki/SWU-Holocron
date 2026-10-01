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

export function resolveScan(read, { setCodes, getCards }) {
  if (!read || read.readable !== true) return unidentified('unreadable', read);

  const set = normalizeSetCode(read.set, setCodes);
  if (!set) return unidentified('unknown-set', read);

  const number = normalizeNumber(read.number);
  if (!number) return unidentified('unreadable', read);

  const card = (getCards(set) ?? []).find((c) => normalizeNumber(c.Number) === number);
  if (!card) return unidentified('no-such-card', read);

  if (!namesMatch(read.name, card)) return unidentified('name-mismatch', read);

  return { status: 'matched', set, number, name: card.Name, type: card.Type ?? null };
}
