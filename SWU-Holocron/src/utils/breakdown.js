/**
 * Group report lines by one or more keys each (a dual-aspect card counts in
 * both), summing quantity and priced value. Unpriced lines add to the count,
 * never to the value. Shared by the batch and collection value reports.
 */
const cents = (v) => Math.round(v * 100) / 100;
const isPriced = (v) => typeof v === 'number' && Number.isFinite(v);

export function breakdown(lines, keysOf, valueOf) {
  const groups = new Map();
  for (const line of lines) {
    const value = valueOf(line);
    for (const key of keysOf(line)) {
      const g = groups.get(key) ?? { key, count: 0, value: 0 };
      g.count += line.qty;
      if (isPriced(value)) g.value += value;
      groups.set(key, g);
    }
  }
  return [...groups.values()]
    .map((g) => ({ ...g, value: cents(g.value) }))
    .sort((a, b) => b.value - a.value || b.count - a.count || a.key.localeCompare(b.key));
}
