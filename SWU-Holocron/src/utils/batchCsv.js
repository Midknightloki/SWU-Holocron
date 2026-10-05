/**
 * CSV export of a batch report: one row per card line, then summary rows.
 * Quoting follows RFC 4180 (fields with a comma, quote or newline are quoted,
 * quotes doubled), the same standard csvParser.js reads.
 *
 * It starts with a UTF-8 byte order mark: without one, Excel on Windows reads
 * the file as ANSI and garbles accented names (Padmé).
 */
export const BATCH_CSV_HEADER = ['Set', 'Number', 'Name', 'Type', 'Rarity', 'Aspects', 'Variant', 'Foil', 'Qty', 'New', 'Price at add', 'Value at add', 'Price now'];

const field = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const money = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : '');
const row = (values) => values.map(field).join(',');

export function toBatchCsv(report) {
  const lines = [row(BATCH_CSV_HEADER)];
  for (const l of report.lines) {
    lines.push(row([
      l.set, l.number, l.name, l.type, l.rarity, (l.aspects ?? []).join('/'), l.variant,
      l.isFoil ? 'Yes' : 'No', l.qty, l.isNew ? 'Yes' : 'No',
      money(l.priceAtAdd), money(typeof l.priceAtAdd === 'number' ? l.priceAtAdd * l.qty : null), money(l.priceNow),
    ]));
  }
  lines.push('');
  lines.push(row(['Batch', report.name]));
  lines.push(row(['Cards', report.cards]));
  lines.push(row(['Unique cards', report.unique]));
  lines.push(row(['New unique cards', report.newUnique]));
  lines.push(row(['Value at add', money(report.valueAtAdd)]));
  lines.push(row(['Value now', money(report.valueNow)]));
  lines.push(row(['Price paid', money(report.pricePaid)]));
  lines.push(row(['Net', money(report.net)]));
  lines.push(row(['Multiple', report.multiple === null ? '' : `${report.multiple}x`]));
  return `﻿${lines.join('\r\n')}`;
}

export function batchCsvFilename(name, createdAt) {
  const slug = String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'batch';
  const date = new Date(createdAt).toISOString().slice(0, 10);
  return `${slug}-${date}.csv`;
}
