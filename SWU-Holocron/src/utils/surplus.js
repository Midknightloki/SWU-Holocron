/**
 * Surplus: copies owned beyond what decks use and a playset kept back.
 * A playset is 3 of a card's Normal printing in standard (1 for a leader or
 * base) and 1 of every other printing or finish. Deck usage is summed across
 * all decks; a deck card takes its printing's standard copies, then foil.
 * Pure. Lines are value-report lines; a surplus line's qty is the surplus.
 */
const cents = (v) => Math.round(v * 100) / 100;
const padNumber = (n) => (/^\d+$/.test(String(n)) ? String(n).padStart(3, '0') : String(n));
const printingId = (id) => {
  const i = String(id ?? '').lastIndexOf('_');
  return i > 0 ? `${id.slice(0, i)}_${padNumber(id.slice(i + 1))}` : null;
};

export function deckUsage(decks) {
  const usage = {};
  const add = (id, n) => {
    const key = printingId(id);
    if (key && n > 0) usage[key] = (usage[key] ?? 0) + n;
  };
  for (const deck of decks ?? []) {
    for (const [id, n] of Object.entries(deck.cards ?? {})) add(id, Number(n) || 0);
    for (const [id, n] of Object.entries(deck.sideboard ?? {})) add(id, Number(n) || 0);
    if (deck.leaderId) add(deck.leaderId, 1);
    if (deck.baseId) add(deck.baseId, 1);
  }
  return usage;
}

const isPlaysetPrinting = (l) => !l.isFoil && (l.variant === 'Normal' || l.variant === 'Unknown');

export function keepFor(line) {
  if (!isPlaysetPrinting(line)) return 1;
  return line.type === 'Leader' || line.type === 'Base' ? 1 : 3;
}

export function buildSurplusLines(lines, usage) {
  const remaining = { ...usage };
  // Standard before foil within a printing.
  const ordered = [...lines].sort((a, b) => Number(a.isFoil) - Number(b.isFoil));
  const out = [];
  for (const l of ordered) {
    const key = `${l.set}_${l.number}`;
    const inDecks = Math.min(l.qty, remaining[key] ?? 0);
    if (inDecks) remaining[key] -= inDecks;
    const kept = Math.min(keepFor(l), l.qty - inDecks);
    const surplus = l.qty - inDecks - kept;
    if (surplus <= 0) continue;
    out.push({
      ...l, owned: l.qty, inDecks, kept, qty: surplus,
      value: l.unitPrice === null ? null : cents(l.unitPrice * surplus),
    });
  }
  // Back to the order they came in.
  return lines.map((l) => out.find((s) => s.id === l.id)).filter(Boolean);
}

export function toTradeText(lines, { showPrices }) {
  const sorted = [...lines].sort((a, b) => a.set.localeCompare(b.set) || a.number.localeCompare(b.number, undefined, { numeric: true }) || Number(a.isFoil) - Number(b.isFoil));
  const out = sorted.map((l) => {
    const price = showPrices && l.unitPrice !== null ? ` — $${l.unitPrice.toFixed(2)} ea` : '';
    return `${l.qty}× ${l.name}${l.subtitle ? `, ${l.subtitle}` : ''} (${l.set} ${l.number})${l.isFoil ? ' — Foil' : ''}${price}`;
  });
  const cards = lines.reduce((s, l) => s + l.qty, 0);
  const priced = lines.filter((l) => l.unitPrice !== null);
  const value = cents(priced.reduce((s, l) => s + l.unitPrice * l.qty, 0));
  out.push(`Total: ${cards} cards${showPrices && priced.length ? ` · ~$${value.toFixed(2)}` : ''}`);
  return out.join('\n');
}
