/**
 * Batch report: what a scanning batch (a box, a pre-release) produced and what
 * it is worth. Pure -- built from the saved batch record and, optionally, the
 * current prices. Lines with no price are listed, never counted as $0.
 */
import { breakdown } from './breakdown';

const cents = (v) => Math.round(v * 100) / 100;
const isPriced = (v) => typeof v === 'number' && Number.isFinite(v);
const cardKey = (l) => `${l.set}_${l.number}`;

// Batch lines are valued at the price when they were added.
const atAdd = (l) => (isPriced(l.priceAtAdd) ? l.priceAtAdd * l.qty : null);

export function buildReport(batch, currentPrices = null) {
  const lines = Object.entries(batch.cards ?? {})
    .map(([id, l]) => ({
      id,
      ...l,
      qty: l.qty ?? 0,
      priceNow: currentPrices && isPriced(currentPrices[id]) ? currentPrices[id] : null,
    }))
    .sort((a, b) => a.set.localeCompare(b.set)
      || String(a.number).localeCompare(String(b.number), undefined, { numeric: true })
      || a.id.localeCompare(b.id));

  const priced = lines.filter((l) => isPriced(l.priceAtAdd));
  const valueAtAdd = cents(priced.reduce((s, l) => s + l.priceAtAdd * l.qty, 0));
  const valueNow = currentPrices
    ? cents(lines.reduce((s, l) => s + (isPriced(l.priceNow) ? l.priceNow * l.qty : 0), 0))
    : null;
  const pricePaid = isPriced(batch.pricePaid) ? batch.pricePaid : null;
  // One entry per card: new in both finishes is still one new card.
  const newCards = lines.filter((l, i) => l.isNew && lines.findIndex((o) => o.isNew && cardKey(o) === cardKey(l)) === i);

  return {
    name: batch.name,
    createdAt: batch.createdAt,
    closedAt: batch.closedAt ?? null,
    pricePaid,
    lines,
    cards: lines.reduce((s, l) => s + l.qty, 0),
    unique: new Set(lines.map(cardKey)).size,
    newUnique: new Set(newCards.map(cardKey)).size,
    newCards,
    valueAtAdd,
    valueNow,
    unpriced: lines.filter((l) => !isPriced(l.priceAtAdd)),
    // Lines left out of valueNow for want of a current price, so a drop in
    // value can be told apart from missing data.
    unpricedNow: currentPrices ? lines.filter((l) => !isPriced(l.priceNow)).length : null,
    otherFinish: lines.filter((l) => l.priceIsFallback && isPriced(l.priceAtAdd)),
    net: pricePaid === null ? null : cents(valueAtAdd - pricePaid),
    multiple: pricePaid ? cents(valueAtAdd / pricePaid) : null,
    byRarity: breakdown(lines, (l) => [l.rarity ?? 'Unknown'], atAdd),
    byType: breakdown(lines, (l) => [l.type ?? 'Unknown'], atAdd),
    byAspect: breakdown(lines, (l) => (l.aspects?.length ? l.aspects : ['Neutral']), atAdd),
    byVariant: breakdown(lines, (l) => [l.variant ?? 'Unknown'], atAdd),
    topPulls: [...priced]
      .sort((a, b) => b.priceAtAdd - a.priceAtAdd || a.name.localeCompare(b.name))
      .slice(0, 10),
  };
}
