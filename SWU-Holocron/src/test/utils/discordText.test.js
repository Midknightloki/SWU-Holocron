import { describe, it, expect } from 'vitest';
import { escapeDiscord, splitForDiscord } from '../../utils/discordText';

describe('escapeDiscord', () => {
  it('escapes characters Discord treats as formatting', () => {
    expect(escapeDiscord('*Vader* _Lord_ ~x~ |s| `c`')).toBe('\\*Vader\\* \\_Lord\\_ \\~x\\~ \\|s\\| \\`c\\`');
  });
  it('leaves ordinary text alone', () => {
    expect(escapeDiscord('2× Luke (SOR 005) — $1.50 ea')).toBe('2× Luke (SOR 005) — $1.50 ea');
  });
});

describe('splitForDiscord', () => {
  const card = (i) => `1× Card number ${String(i).padStart(3, '0')} with a long enough name (SOR ${i})`;
  const text = ['Wants: Gaps', '', ...Array.from({ length: 80 }, (_, i) => card(i)), 'Total: 80 cards'].join('\n');

  it('keeps a short text in one part', () => {
    expect(splitForDiscord('Wants: A\n\n1× X\nTotal: 1 cards')).toEqual(['Wants: A\n\n1× X\nTotal: 1 cards']);
  });

  it('splits on line boundaries, every part under the limit', () => {
    const parts = splitForDiscord(text, 2000);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(2000);
    const cardLines = parts.flatMap((p) => p.split('\n')).filter((l) => l.startsWith('1×'));
    expect(cardLines).toHaveLength(80);
  });

  it('repeats the heading with part numbers and ends with the total', () => {
    const parts = splitForDiscord(text, 2000);
    parts.forEach((p, i) => expect(p.split('\n')[0]).toBe(`Wants: Gaps (part ${i + 1} of ${parts.length})`));
    expect(parts.at(-1).endsWith('Total: 80 cards')).toBe(true);
    expect(parts.slice(0, -1).some((p) => p.includes('Total:'))).toBe(false);
  });

  it('splits a list with no heading (the surplus trade text) without repeating a card', () => {
    const trade = [...Array.from({ length: 80 }, (_, i) => card(i)), 'Total: 80 cards · ~$12.00'].join('\n');
    const parts = splitForDiscord(trade, 2000);
    expect(parts.length).toBeGreaterThan(1);
    parts.forEach((p, i) => expect(p.split('\n')[0]).toBe(`Part ${i + 1} of ${parts.length}`));
    const cardLines = parts.flatMap((p) => p.split('\n')).filter((l) => l.startsWith('1×'));
    expect(cardLines).toHaveLength(80);
    expect(new Set(cardLines).size).toBe(80);
    expect(parts.at(-1).endsWith('Total: 80 cards · ~$12.00')).toBe(true);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(2000);
  });
});
