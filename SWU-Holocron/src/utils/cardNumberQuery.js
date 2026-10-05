/**
 * Search by collector number: "12", "#012", "SOR 12", "sor-012".
 *
 * A number query matches the exact number (12 is not 112), and the set when
 * one is given. Searches OR this with their name/text match, so a name with
 * digits in it still finds what it always did.
 *
 * @environment:none — pure functions, safe everywhere
 */
const NUMBER_QUERY = /^(?:([a-z][a-z0-9]*)\s*[\s#-]\s*)?#?(\d{1,4})$/i;

export function parseNumberQuery(raw) {
  const match = NUMBER_QUERY.exec(String(raw ?? '').trim());
  if (!match) return null;
  return { set: match[1] ? match[1].toUpperCase() : null, number: Number(match[2]) };
}

export function matchesNumberQuery(card, raw) {
  const query = parseNumberQuery(raw);
  if (!query) return false;
  if (query.set && String(card?.Set ?? '').toUpperCase() !== query.set) return false;
  return Number.parseInt(card?.Number, 10) === query.number;
}

/** The binder's search box: name, or collector number. Empty matches all. */
export function matchesNameOrNumber(card, raw) {
  const term = String(raw ?? '').trim().toLowerCase();
  if (!term) return true;
  return Boolean(card?.Name?.toLowerCase().includes(term)) || matchesNumberQuery(card, term);
}
