import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { parseCSV } from '../utils/csvParser';
import { parsePricePaid } from '../utils/scanDraft';
import { importToCollection } from '../services/importBatch';

const MODES = [
  ['add', 'Add these cards', 'Adds to what you own, like scanning — for a purchase or a trade.'],
  ['replace', 'Replace quantities', 'Sets each card to the number in the file — for restoring a full export.'],
];

/** A CSV import: choose Add or Replace, name the batch, then see its report. */
export default function ImportDialog({
  file, uid, collectionRef, collectionData, onClose, onImported, importImpl = importToCollection, parse = parseCSV,
}) {
  const [parsed, setParsed] = useState(null); // { items, errors } | { failed: true }
  const [mode, setMode] = useState(null);
  const [name, setName] = useState(`Import ${file.name.replace(/\.csv$/i, '')}`);
  const [priceText, setPriceText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { kind: 'status'|'alert', text }

  useEffect(() => {
    let cancelled = false;
    file.text().then((text) => { if (!cancelled) setParsed(parse(text)); })
      .catch(() => { if (!cancelled) setParsed({ failed: true }); });
    return () => { cancelled = true; };
  }, [file, parse]);

  const items = parsed?.items ?? [];
  const cards = items.reduce((s, i) => s + i.quantity, 0);
  const pricePaid = parsePricePaid(priceText);
  const canImport = Boolean(mode) && items.length > 0 && !busy && pricePaid !== undefined && !result;

  const run = async () => {
    setBusy(true);
    const res = await importImpl({
      uid, collectionRef, collectionData, items, mode, name: name.trim() || `Import ${file.name}`, pricePaid: pricePaid ?? null, file: file.name,
    });
    setBusy(false);
    if (res.batchId && res.ok) { onImported(res.batchId); return; }
    if (res.nothing) setResult({ kind: 'status', text: 'Nothing changed — your collection already matches this file.' });
    else if (res.ok) setResult({ kind: 'status', text: `Imported ${res.cards} cards.` });
    else if (res.error === 'report') setResult({ kind: 'alert', text: "Cards imported, but the report couldn't be saved." });
    else {
      const again = mode === 'add' && res.written ? ` Importing again will add those ${res.written} again.` : '';
      setResult({ kind: 'alert', text: `Import stopped after ${res.written ?? 0} cards: ${res.error}.${again}` });
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4">
      <div role="dialog" aria-label="Import cards" className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-gray-900 border border-gray-700 p-4 space-y-3 text-gray-100">
        <h3 className="text-lg font-bold">Import cards</h3>
        <p className="text-sm text-gray-400 break-words">{file.name}</p>
        {parsed === null && <p className="text-sm text-gray-400">Reading file…</p>}
        {parsed?.failed && <p role="alert" className="text-sm text-red-400">Couldn&apos;t read this file.</p>}
        {parsed && !parsed.failed && (items.length === 0
          ? <p className="text-sm text-yellow-300">No cards found in this file.</p>
          : (
            <p className="text-sm">
              {cards} cards in {items.length} {items.length === 1 ? 'row' : 'rows'}
              {parsed.errors?.length > 0 && <span className="text-yellow-300"> · {parsed.errors.length} {parsed.errors.length === 1 ? 'row' : 'rows'} skipped</span>}
            </p>
          ))}

        <fieldset className="space-y-2">
          <legend className="text-xs uppercase tracking-wide text-gray-500">How to import</legend>
          {MODES.map(([id, label, hint]) => (
            <label key={id} className="flex items-start gap-2">
              <input type="radio" name="import-mode" checked={mode === id} onChange={() => setMode(id)} className="mt-1" />
              <span><span className="block">{label}</span><span className="block text-xs text-gray-400">{hint}</span></span>
            </label>
          ))}
        </fieldset>

        <label className="flex flex-col gap-1 text-xs text-gray-400">
          Batch name
          <input aria-label="Batch name" value={name} onChange={(e) => setName(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-100" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-400">
          Price paid (optional)
          <input aria-label="Price paid" inputMode="decimal" value={priceText} onChange={(e) => setPriceText(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-100" />
        </label>
        {pricePaid === undefined && <p className="text-xs text-red-400">Enter a price like 12.50, or leave it empty.</p>}

        {result && <p role={result.kind} className={`text-sm ${result.kind === 'alert' ? 'text-red-400' : 'text-green-400'}`}>{result.text}</p>}

        <div className="flex gap-2 justify-end">
          {result ? (
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-yellow-500 text-black font-semibold">Done</button>
          ) : (
            <>
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-800">Cancel</button>
              <button type="button" onClick={run} disabled={!canImport}
                className="px-4 py-2 rounded-lg bg-yellow-500 text-black font-semibold disabled:opacity-40">{busy ? 'Importing…' : 'Import'}</button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
