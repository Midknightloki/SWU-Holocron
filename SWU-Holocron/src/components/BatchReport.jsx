import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileText, Pencil, Trash2, X } from 'lucide-react';
import { BatchService } from '../services/BatchService';
import { PricingService } from '../services/PricingService';
import { buildReport } from '../utils/batchReport';
import { batchCsvFilename, toBatchCsv } from '../utils/batchCsv';

/**
 * The report for one scanning batch: what came out of it, what it was worth
 * when added and now, and how that compares with what was paid. Printing
 * (Save as PDF) shows only this screen -- see the print rule in index.css.
 * It renders straight under <body> so that rule can take everything else out
 * of the layout; merely hiding it left pages of blank binder behind.
 */
const fmt = (v) => (v === null || v === undefined ? '—' : `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`);
const signed = (v) => (v === null ? '—' : `${v > 0 ? '+' : ''}${fmt(v)}`);

// @environment:web-file-api
function downloadText(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function Stat({ label, value, testId, tone = '' }) {
  return (
    <div className="rounded-lg bg-gray-900 border border-gray-800 p-3 print:bg-white print:border-gray-300">
      <div className="text-xs text-gray-400 print:text-gray-600">{label}</div>
      <div data-testid={testId} className={`text-lg font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function Breakdown({ title, groups }) {
  if (!groups.length) return null;
  return (
    <section className="break-inside-avoid">
      <h3 className="text-sm font-semibold text-gray-300 mb-1 print:text-black">{title}</h3>
      <table className="w-full text-sm">
        <tbody>
          {groups.map((g) => (
            <tr key={g.key} className="border-b border-gray-800 print:border-gray-200">
              <td className="py-1">{g.key}</td>
              <td className="py-1 text-right text-gray-400 print:text-gray-700">{g.count}</td>
              <td className="py-1 text-right w-24">{fmt(g.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CardList({ title, lines, testId, price = true }) {
  return (
    <section className="break-inside-avoid">
      <h3 className="text-sm font-semibold text-gray-300 mb-1 print:text-black">{title}</h3>
      <ul data-testid={testId} className="text-sm divide-y divide-gray-800 print:divide-gray-200">
        {lines.map((l) => (
          <li key={l.id} className="py-1 flex gap-2">
            <span className="text-gray-500 w-20 flex-shrink-0">{l.set} {l.number}</span>
            <span className="flex-1 min-w-0 truncate print:whitespace-normal print:overflow-visible">
              {l.name}{l.isFoil ? ' (foil)' : ''}{l.qty > 1 ? ` ×${l.qty}` : ''}
            </span>
            {price && <span>{fmt(l.priceAtAdd)}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function BatchReport({ uid, batchId, onClose, onDeleted }) {
  // undefined while loading, null when missing.
  const [batch, setBatch] = useState(undefined);
  // undefined while loading, null when unavailable, else { [id]: market }.
  const [prices, setPrices] = useState(undefined);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    BatchService.getBatch(uid, batchId).then((b) => { if (!cancelled) setBatch(b); });
    return () => { cancelled = true; };
  }, [uid, batchId]);

  // Prices depend on the batch's cards, not its name: keyed on the id so a
  // rename does not refetch them.
  const batchKey = batch ? batch.id : null;
  useEffect(() => {
    if (!batch) return undefined;
    let cancelled = false;
    const lines = Object.entries(batch.cards ?? {});
    PricingService.getBulkPrices(lines.map(([id, l]) => ({ cardId: id, set: l.set, number: l.number, isFoil: l.isFoil })))
      .then((result) => {
        if (cancelled) return;
        const now = {};
        for (const [id] of lines) {
          const market = result?.[id]?.market;
          if (typeof market === 'number') now[id] = market;
        }
        setPrices(now);
      })
      .catch(() => { if (!cancelled) setPrices(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchKey]);

  const report = useMemo(() => (batch ? buildReport(batch, prices || null) : null), [batch, prices]);

  const saveName = async () => {
    const name = nameDraft.trim();
    if (!name) return;
    const res = await BatchService.renameBatch(uid, batchId, name);
    if (res?.error) { setError('Could not rename the report.'); return; }
    setBatch((b) => ({ ...b, name }));
    setRenaming(false);
  };

  const remove = async () => {
    const res = await BatchService.deleteBatch(uid, batchId);
    if (res?.error) { setError('Could not delete the report.'); return; }
    onDeleted();
  };

  const shell = (children) => createPortal(
    <div
      id="batch-report"
      role="dialog"
      aria-label="Batch report"
      className="fixed inset-0 z-[80] overflow-y-auto bg-gray-950 text-gray-100 print:static print:bg-white print:text-black"
    >
      <div className="max-w-3xl mx-auto p-4 space-y-5">{children}</div>
    </div>,
    document.body,
  );

  if (batch === undefined) return shell(<p className="text-gray-400">Loading…</p>);
  if (batch === null) {
    return shell(
      <>
        <p className="text-gray-300">Report not found.</p>
        <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg bg-gray-800">Close</button>
      </>,
    );
  }

  let valueNow = fmt(report.valueNow);
  if (prices === undefined) valueNow = '…';
  else if (prices === null) valueNow = 'unavailable';
  let netTone = '';
  if (report.net !== null) netTone = report.net >= 0 ? 'text-green-400 print:text-green-700' : 'text-red-400 print:text-red-700';
  const button = 'flex items-center gap-1 px-3 py-2 rounded-lg bg-gray-800 text-sm';

  return shell(
    <>
      <header className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold truncate print:whitespace-normal">{report.name}</h2>
          <p className="text-sm text-gray-400 print:text-gray-600">{new Date(report.createdAt).toLocaleDateString()}</p>
        </div>
        <button type="button" onClick={onClose} className={`${button} print:hidden`}>
          <X className="w-4 h-4" /> Close
        </button>
      </header>

      <div className="flex flex-wrap gap-2 print:hidden">
        <button type="button" onClick={() => downloadText(toBatchCsv(report), batchCsvFilename(report.name, report.createdAt))} className={button}>
          <Download className="w-4 h-4" /> Download CSV
        </button>
        <button type="button" onClick={() => window.print()} className={button}>
          <FileText className="w-4 h-4" /> Save as PDF
        </button>
        <button type="button" onClick={() => { setNameDraft(report.name); setRenaming(true); }} className={button}>
          <Pencil className="w-4 h-4" /> Rename
        </button>
        <button type="button" onClick={() => setConfirmDelete(true)} className={`${button} text-red-300`}>
          <Trash2 className="w-4 h-4" /> Delete report
        </button>
      </div>

      {renaming && (
        <div className="flex gap-2 print:hidden">
          <input
            aria-label="Batch name"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm"
          />
          <button type="button" onClick={saveName} className="px-3 py-1.5 rounded-lg bg-blue-600 text-sm">Save name</button>
        </div>
      )}
      {confirmDelete && (
        <div className="flex gap-2 print:hidden">
          <button type="button" onClick={remove} className="px-3 py-1.5 rounded-lg bg-red-700 text-sm">Delete — your collection is not affected</button>
          <button type="button" onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 rounded-lg bg-gray-800 text-sm">Keep</button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Cards" value={report.cards} />
        <Stat label="Unique" value={report.unique} />
        <Stat label="New to collection" value={report.newUnique} />
        <Stat label="Value at add" value={fmt(report.valueAtAdd)} testId="value-at-add" />
        <Stat label="Value now" value={valueNow} testId="value-now" />
        <Stat label="Price paid" value={fmt(report.pricePaid)} />
        <Stat label="Net" value={signed(report.net)} testId="net" tone={netTone} />
        <Stat label="Multiple" value={report.multiple === null ? '—' : `${report.multiple}x`} />
      </div>

      <div className="grid sm:grid-cols-2 gap-5">
        <Breakdown title="By rarity" groups={report.byRarity} />
        <Breakdown title="By type" groups={report.byType} />
        <Breakdown title="By aspect" groups={report.byAspect} />
        <Breakdown title="By printing" groups={report.byVariant} />
      </div>

      {report.topPulls.length > 0 && <CardList title="Top pulls" lines={report.topPulls} testId="top-pulls" />}
      {report.newCards.length > 0 && <CardList title="New to your collection" lines={report.newCards} testId="new-cards" />}
      {report.otherFinish.length > 0 && <CardList title="Priced from the other finish" lines={report.otherFinish} testId="other-finish" />}
      {report.unpriced.length > 0 && <CardList title="No price data" lines={report.unpriced} testId="unpriced" price={false} />}
    </>,
  );
}
