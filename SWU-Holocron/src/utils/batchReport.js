/**
 * Batch report: what a scanning batch (a box, a pre-release) produced and what
 * it is worth. Pure -- built from the saved batch record and, optionally, the
 * current prices. Lines with no price are listed, never counted as $0.
 */
const cents = (v) => Math.round(v * 100) / 100;
const isPriced = (v) => typeof v === 'number' && Number.isFinite(v);
const cardKey = (l) => `${l.set}_${l.number}`;

function breakdown(lines, keysOf) {
  const groups = new Map();
  for (const l of lines) {
    for (const key of keysOf(l)) {
      const g = groups.get(key) ?? { key, count: 0, value: 0 };
      g.count += l.qty;
      if (isPriced(l.priceAtAdd)) g.value += l.priceAtAdd * l.qty;
      groups.set(key, g);
    }
  }
  return [...groups.values()]
    .map((g) => ({ ...g, value: cents(g.value) }))
    .sort((a, b) => b.value - a.value || b.count - a.count || a.key.localeCompare(b.key));
}

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
  const newCards = lines.filter((l) => l.isNew);

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
    otherFinish: lines.filter((l) => l.priceIsFallback && isPriced(l.priceAtAdd)),
    net: pricePaid === null ? null : cents(valueAtAdd - pricePaid),
    multiple: pricePaid ? cents(valueAtAdd / pricePaid) : null,
    byRarity: breakdown(lines, (l) => [l.rarity ?? 'Unknown']),
    byType: breakdown(lines, (l) => [l.type ?? 'Unknown']),
    byAspect: breakdown(lines, (l) => (l.aspects?.length ? l.aspects : ['Neutral'])),
    byVariant: breakdown(lines, (l) => [l.variant ?? 'Unknown']),
    topPulls: [...priced]
      .sort((a, b) => b.priceAtAdd - a.priceAtAdd || a.name.localeCompare(b.name))
      .slice(0, 10),
  };
}
