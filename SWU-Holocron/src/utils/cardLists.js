/**
 * Saved card lists: trade lists (cards I can trade) and wants lists (cards I
 * am looking for). Pure. An item is one card in one finish; a wants item's
 * finish may be 'any'.
 */
import { getCollectionId, getPlaysetQuantity } from './collectionHelpers';

const cents = (v) => Math.round(v * 100) / 100;
const BOM = String.fromCharCode(0xfeff);

export const FINISH_LABEL = { standard: 'Standard', foil: 'Foil', any: 'Any finish' };

export const padNumber = (n) => String(n).padStart(3, '0');
export const itemKey = (set, number, finish) => `${set}_${padNumber(number)}_${finish}`;

const makeItem = (set, number, name, subtitle, type, finish, qty) => ({
  set, number: padNumber(number), name: name ?? '', subtitle: subtitle || null, type: type ?? null, finish, qty,
});

export const cardItem = (card, finish = 'any', qty = 1) =>
  makeItem(card.Set, card.Number, card.Name, card.Subtitle, card.Type, finish, qty);

export function itemsFromSurplus(lines) {
  const items = {};
  for (const l of lines ?? []) {
    if (!(l.qty > 0)) continue;
    const finish = l.isFoil ? 'foil' : 'standard';
    items[itemKey(l.set, l.number, finish)] = makeItem(l.set, l.number, l.name, l.subtitle, l.type, finish, l.qty);
  }
  return items;
}

const hasNumber = (c) => c?.Number !== undefined && c?.Number !== null && c.Number !== '';
const byNumber = (a, b) => String(a.Number).localeCompare(String(b.Number), undefined, { numeric: true });

/** Titles (name + subtitle) the collection lacks, counted as the Command Center counts them. */
export function itemsFromGaps(cardsBySet, collectionData, { mode = 'missing' } = {}) {
  const items = {};
  const owned = (set, number, foil) => Number(collectionData?.[getCollectionId(set, number, foil)]?.quantity) || 0;
  for (const [set, cards] of Object.entries(cardsBySet ?? {})) {
    const titles = new Map();
    for (const card of (cards ?? []).filter(hasNumber).sort(byNumber)) {
      const title = `${card.Name}${card.Subtitle ? ` ${card.Subtitle}` : ''}`;
      if (!titles.has(title)) titles.set(title, { card, have: 0 });
      titles.get(title).have += owned(set, card.Number, false) + owned(set, card.Number, true);
    }
    for (const { card, have } of titles.values()) {
      const want = mode === 'playset' ? getPlaysetQuantity(card.Type) : 1;
      if (have >= want) continue;
      items[itemKey(set, card.Number, 'any')] = makeItem(set, card.Number, card.Name, card.Subtitle, card.Type, 'any', want - have);
    }
  }
  return items;
}

export function mergeItems(existing, incoming, { replace = false } = {}) {
  if (replace) return { ...(incoming ?? {}) };
  const next = { ...(existing ?? {}) };
  for (const [key, item] of Object.entries(incoming ?? {})) {
    next[key] = next[key] ? { ...next[key], qty: next[key].qty + item.qty } : { ...item };
  }
  return next;
}

export function itemsFromDeckGaps(gapCards) {
  let items = {};
  for (const g of gapCards ?? []) {
    if (!g?.card || !(g.gap > 0)) continue;
    items = mergeItems(items, { [itemKey(g.card.Set, g.card.Number, 'any')]: cardItem(g.card, 'any', g.gap) });
  }
  return items;
}

export function changeFinish(items, key, finish) {
  const item = items?.[key];
  if (!item || item.finish === finish) return items;
  const rest = { ...items };
  delete rest[key];
  return mergeItems(rest, { [itemKey(item.set, item.number, finish)]: { ...item, finish } });
}

// 'any' asks for the standard price; the pricing service falls back to foil.
export const priceRequests = (items) => Object.entries(items ?? {}).map(([key, it]) => ({
  cardId: key, set: it.set, number: it.number, isFoil: it.finish === 'foil',
}));

const FINISH_ORDER = { standard: 0, foil: 1, any: 2 };
export function listLines(items, pricesByKey = {}) {
  return Object.entries(items ?? {}).map(([key, it]) => {
    const price = pricesByKey?.[key];
    const unitPrice = typeof price?.market === 'number' ? price.market : null;
    return { key, ...it, unitPrice, priceIsFallback: Boolean(price?.isFallback), value: unitPrice === null ? null : cents(unitPrice * it.qty) };
  }).sort((a, b) => a.set.localeCompare(b.set)
    || a.number.localeCompare(b.number, undefined, { numeric: true })
    || FINISH_ORDER[a.finish] - FINISH_ORDER[b.finish]);
}

export function listSummary(lines) {
  const priced = lines.filter((l) => l.unitPrice !== null);
  return {
    cards: lines.reduce((s, l) => s + l.qty, 0),
    unique: lines.length,
    value: cents(priced.reduce((s, l) => s + l.value, 0)),
    priced: priced.length,
  };
}

const heading = (list) => `${list.kind === 'trade' ? 'Trade list' : 'Wants'}: ${list.name}`;
const finishSuffix = (list, l) => {
  if (l.finish === 'foil') return ' — Foil';
  if (l.finish === 'standard' && list.kind === 'wants') return ' — Standard';
  return '';
};

export function toListText(list, lines, { showPrices }) {
  const out = [heading(list), ''];
  for (const l of lines) {
    const price = showPrices && l.unitPrice !== null ? ` — $${l.unitPrice.toFixed(2)} ea` : '';
    const note = l.note ? ` (${l.note})` : '';
    out.push(`${l.qty}× ${l.name}${l.subtitle ? `, ${l.subtitle}` : ''} (${l.set} ${l.number})${finishSuffix(list, l)}${price}${note}`);
  }
  const s = listSummary(lines);
  out.push(`Total: ${s.cards} cards${showPrices && s.priced ? ` · ~$${s.value.toFixed(2)}` : ''}`);
  return out.join('\n');
}

const field = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (values) => values.map(field).join(',');
const money = (v) => (typeof v === 'number' ? v.toFixed(2) : '');

export function toListCsv(list, lines, { showPrices }) {
  const cols = [
    ['Set', (l) => l.set], ['Number', (l) => l.number], ['Name', (l) => l.name], ['Subtitle', (l) => l.subtitle],
    ['Finish', (l) => FINISH_LABEL[l.finish]], ['Qty', (l) => l.qty],
    ...(showPrices ? [['Unit price', (l) => money(l.unitPrice)], ['Value', (l) => money(l.value)]] : []),
    ['Note', (l) => l.note ?? ''],
  ];
  const s = listSummary(lines);
  const out = [row(cols.map(([h]) => h)), ...lines.map((l) => row(cols.map(([, get]) => get(l)))), ''];
  out.push(row(['List', heading(list)]));
  out.push(row(['Cards', s.cards]));
  if (showPrices) out.push(row(['Total value', money(s.value)]));
  return `${BOM}${out.join('\r\n')}`;
}

/** The public copy of a list: self-contained, no owner name, prices only when shown. */
export function toPublicList(list, lines, { showPrices, now }) {
  const s = listSummary(lines);
  const body = {
    kind: list.kind,
    name: list.name,
    showPrices: Boolean(showPrices),
    lines: lines.map((l) => {
      const out = { set: l.set, number: l.number, name: l.name, subtitle: l.subtitle ?? null, finish: l.finish, qty: l.qty };
      if (l.note) out.note = l.note;
      if (l.type) out.type = l.type;
      if (showPrices && l.unitPrice !== null) {
        out.unitPrice = l.unitPrice;
        if (l.priceIsFallback) out.priceIsFallback = true;
      }
      return out;
    }),
    cards: s.cards,
  };
  if (showPrices) {
    body.pricesAsOf = now;
    if (s.priced) body.value = s.value;
  }
  return body;
}

/** A public copy's lines in listLines shape, for text and totals. */
export const publicLines = (doc) => (doc?.lines ?? []).map((l, i) => {
  const unitPrice = typeof l.unitPrice === 'number' ? l.unitPrice : null;
  return {
    key: `${i}`, ...l, subtitle: l.subtitle ?? null, unitPrice, priceIsFallback: Boolean(l.priceIsFallback),
    value: unitPrice === null ? null : cents(unitPrice * l.qty),
  };
});
