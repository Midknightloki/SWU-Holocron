/**
 * The collection value report's model: one line per owned collection doc,
 * priced at today's market, plus the filters, summary, sorting and CSV.
 * Pure. Unpriced lines are listed, never counted as $0.
 */
import { breakdown } from './breakdown';

const cents = (v) => Math.round(v * 100) / 100;
const isPriced = (v) => typeof v === 'number' && Number.isFinite(v);
const padNumber = (n) => (/^\d+$/.test(String(n)) ? String(n).padStart(3, '0') : String(n));

export const DEFAULT_FILTERS = {
  sets: [], rarities: [], types: [], aspects: [], variants: [],
  finish: 'all', price: 'all', minPrice: null, search: '',
};

export function buildCollectionLines(collectionData, cardsBySet, pricesById) {
  const lines = [];
  for (const [id, doc] of Object.entries(collectionData ?? {})) {
    const qty = Number(doc?.quantity) || 0;
    if (qty <= 0) continue;
    const set = doc.set;
    const number = padNumber(doc.number);
    const card = (cardsBySet?.[set] ?? []).find((c) => padNumber(c.Number) === number);
    const price = pricesById?.[id] ?? null;
    const unitPrice = isPriced(price?.market) ? price.market : null;
    lines.push({
      id, set, number,
      name: card?.Name ?? doc.name ?? `${set} ${number}`,
      subtitle: card?.Subtitle ?? null,
      type: card?.Type ?? 'Unknown',
      rarity: card?.Rarity ?? 'Unknown',
      aspects: card?.Aspects ?? [],
      variant: card?.VariantType ?? 'Unknown',
      isFoil: Boolean(doc.isFoil ?? id.endsWith('_foil')),
      qty,
      unitPrice,
      priceIsFallback: Boolean(price?.isFallback),
      value: unitPrice === null ? null : cents(unitPrice * qty),
      url: price?.url ?? null,
    });
  }
  return lines;
}

const aspectKeys = (l) => (l.aspects.length ? l.aspects : ['Neutral']);
const inList = (list, value) => list.length === 0 || list.includes(value);

export function applyFilters(lines, filters) {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const q = f.search.trim().toLowerCase();
  return lines.filter((l) => {
    if (!inList(f.sets, l.set) || !inList(f.rarities, l.rarity) || !inList(f.types, l.type) || !inList(f.variants, l.variant)) return false;
    if (f.aspects.length && !aspectKeys(l).some((a) => f.aspects.includes(a))) return false;
    if (f.finish === 'foil' && !l.isFoil) return false;
    if (f.finish === 'standard' && l.isFoil) return false;
    if (f.price === 'priced' && l.unitPrice === null) return false;
    if (f.price === 'unpriced' && l.unitPrice !== null) return false;
    if (isPriced(f.minPrice) && (l.unitPrice === null || l.unitPrice < f.minPrice)) return false;
    if (q && !`${l.name} ${l.subtitle ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

const count = (lines, keysOf) => {
  const m = new Map();
  for (const l of lines) for (const k of keysOf(l)) m.set(k, (m.get(k) ?? 0) + l.qty);
  return [...m].map(([key, n]) => ({ key, count: n })).sort((a, b) => a.key.localeCompare(b.key));
};

export function filterOptions(lines) {
  return {
    sets: count(lines, (l) => [l.set]),
    rarities: count(lines, (l) => [l.rarity]),
    types: count(lines, (l) => [l.type]),
    aspects: count(lines, aspectKeys),
    variants: count(lines, (l) => [l.variant]),
  };
}

export function summarize(lines) {
  const valueOf = (l) => l.value;
  const cards = lines.reduce((s, l) => s + l.qty, 0);
  const priced = lines.filter((l) => l.value !== null);
  const sum = (ls) => cents(ls.reduce((s, l) => s + l.value, 0));
  return {
    cards,
    unique: new Set(lines.map((l) => `${l.set}_${l.number}`)).size,
    value: sum(priced),
    pricedShare: cards ? priced.reduce((s, l) => s + l.qty, 0) / cards : 0,
    standardValue: sum(priced.filter((l) => !l.isFoil)),
    foilValue: sum(priced.filter((l) => l.isFoil)),
    bySet: breakdown(lines, (l) => [l.set], valueOf),
    byRarity: breakdown(lines, (l) => [l.rarity], valueOf),
    byType: breakdown(lines, (l) => [l.type], valueOf),
    byAspect: breakdown(lines, aspectKeys, valueOf),
    byVariant: breakdown(lines, (l) => [l.variant], valueOf),
    unpriced: lines.filter((l) => l.unitPrice === null),
    otherFinish: lines.filter((l) => l.priceIsFallback && l.unitPrice !== null),
  };
}

const COMPARE = {
  value: (a, b) => (a.value ?? 0) - (b.value ?? 0),
  qty: (a, b) => a.qty - b.qty,
  name: (a, b) => a.name.localeCompare(b.name),
  set: (a, b) => a.set.localeCompare(b.set) || a.number.localeCompare(b.number, undefined, { numeric: true }),
};

export function sortLines(lines, by = 'value', dir = 'desc') {
  const cmp = COMPARE[by] ?? COMPARE.value;
  const sign = dir === 'asc' ? 1 : -1;
  return [...lines].sort((a, b) => {
    // Unpriced always sort last when ordering by value.
    if (by === 'value' && (a.value === null) !== (b.value === null)) return a.value === null ? 1 : -1;
    return sign * cmp(a, b) || a.id.localeCompare(b.id);
  });
}

const field = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const money = (v) => (isPriced(v) ? v.toFixed(2) : '');
const row = (values) => values.map(field).join(',');

export function describeFilters(filters) {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const parts = [];
  if (f.sets.length) parts.push(`Set: ${f.sets.join('/')}`);
  if (f.rarities.length) parts.push(`Rarity: ${f.rarities.join('/')}`);
  if (f.types.length) parts.push(`Type: ${f.types.join('/')}`);
  if (f.aspects.length) parts.push(`Aspect: ${f.aspects.join('/')}`);
  if (f.variants.length) parts.push(`Printing: ${f.variants.join('/')}`);
  if (f.finish !== 'all') parts.push(`Finish: ${f.finish}`);
  if (f.price !== 'all') parts.push(`Price: ${f.price}`);
  if (isPriced(f.minPrice)) parts.push(`Min price: ${money(f.minPrice)}`);
  if (f.search.trim()) parts.push(`Search: ${f.search.trim()}`);
  return parts.join('; ') || 'None';
}

export function toCollectionCsv(lines, summary, filters) {
  const out = [row(['Set', 'Number', 'Name', 'Subtitle', 'Type', 'Rarity', 'Aspects', 'Variant', 'Finish', 'Qty', 'Unit price', 'Value', 'Price note'])];
  for (const l of sortLines(lines, 'set', 'asc')) {
    const note = l.unitPrice === null ? 'no price data' : l.priceIsFallback ? 'from other finish' : '';
    out.push(row([l.set, l.number, l.name, l.subtitle, l.type, l.rarity, l.aspects.join('/'), l.variant,
      l.isFoil ? 'Foil' : 'Standard', l.qty, money(l.unitPrice), money(l.value), note]));
  }
  out.push('');
  out.push(row(['Total value', money(summary.value)]));
  out.push(row(['Cards', summary.cards]));
  out.push(row(['Unique cards', summary.unique]));
  out.push(row(['Priced share', `${Math.round(summary.pricedShare * 100)}%`]));
  out.push(row(['Filters', describeFilters(filters)]));
  return `\uFEFF${out.join('\r\n')}`;
}
