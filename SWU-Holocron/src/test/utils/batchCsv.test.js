import { describe, it, expect } from 'vitest';
import { toBatchCsv, batchCsvFilename, BATCH_CSV_HEADER } from '../../utils/batchCsv';
import { buildReport } from '../../utils/batchReport';
import { parseCSV } from '../../utils/csvParser';

const batch = {
  name: 'eBay, "SOR" box', createdAt: Date.UTC(2026, 9, 5), pricePaid: 10,
  cards: {
    SOR_010_std: { set: 'SOR', number: '010', name: 'Luke Skywalker, "Faithful"', type: 'Leader', rarity: 'Rare', aspects: ['Vigilance', 'Heroism'], variant: 'Normal', isFoil: false, qty: 2, isNew: true, priceAtAdd: 5 },
    SOR_051_std: { set: 'SOR', number: '051', name: 'Mystery', type: 'Unit', rarity: 'Common', aspects: [], variant: 'Normal', isFoil: false, qty: 1, isNew: false, priceAtAdd: null },
  },
};

describe('toBatchCsv', () => {
  const rows = toBatchCsv(buildReport(batch, { SOR_010_std: 6 })).split('\r\n');

  it('starts with a UTF-8 byte order mark, then the header', () => {
    expect(rows[0]).toBe(`\uFEFF${BATCH_CSV_HEADER.join(',')}`);
  });

  it('reads back through the collection CSV importer', () => {
    const { items } = parseCSV(toBatchCsv(buildReport(batch)));
    expect(items).toEqual([
      { set: 'SOR', number: '010', name: 'Luke Skywalker, "Faithful"', quantity: 2, isFoil: false },
      { set: 'SOR', number: '051', name: 'Mystery', quantity: 1, isFoil: false },
    ]);
  });

  it('quotes fields with commas and doubles quotes', () => {
    expect(rows[1]).toBe('SOR,010,"Luke Skywalker, ""Faithful""",Leader,Rare,Vigilance/Heroism,Normal,No,2,Yes,5.00,10.00,6.00');
  });

  it('leaves null prices blank', () => {
    expect(rows[2]).toBe('SOR,051,Mystery,Unit,Common,,Normal,No,1,No,,,');
  });

  it('appends summary rows after a blank line', () => {
    expect(rows[3]).toBe('');
    expect(rows).toContain('Batch,"eBay, ""SOR"" box"');
    expect(rows).toContain('Value at add,10.00');
    expect(rows).toContain('Price paid,10.00');
    expect(rows).toContain('Net,0.00');
    expect(rows).toContain('Multiple,1x');
  });
});

describe('batchCsvFilename', () => {
  it('slugs the name and adds the date', () => {
    expect(batchCsvFilename('eBay, "SOR" box!', Date.UTC(2026, 9, 5))).toBe('ebay-sor-box-2026-10-05.csv');
    expect(batchCsvFilename('', Date.UTC(2026, 9, 5))).toBe('batch-2026-10-05.csv');
  });
});
