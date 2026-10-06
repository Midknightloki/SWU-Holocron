import { describe, it, expect } from 'vitest';
import { breakdown } from '../../utils/breakdown';

describe('breakdown', () => {
  it('groups by every key a line has, summing quantity and priced value', () => {
    const lines = [
      { qty: 2, k: ['A', 'B'], v: 1.005 },
      { qty: 1, k: ['A'], v: null },
      { qty: 3, k: ['C'], v: 0.1 },
    ];
    expect(breakdown(lines, (l) => l.k, (l) => (l.v === null ? null : l.v * l.qty))).toEqual([
      { key: 'A', count: 3, value: 2.01 },
      { key: 'B', count: 2, value: 2.01 },
      { key: 'C', count: 3, value: 0.3 },
    ]);
  });
});
