import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ClipboardCopy, Download, FileText, Minus, Plus, Trash2, X } from 'lucide-react';
import CardPickerModal from './CardPickerModal';
import { ListService } from '../services/ListService';
import { loadListPrices } from '../services/listLoader';
import { downloadText } from '../utils/downloadText';
import {
  FINISH_LABEL, cardItem, changeFinish, itemKey, listLines, listSummary, mergeItems, toListCsv, toListText,
} from '../utils/cardLists';

const money = (v) => `$${v.toFixed(2)}`;
const btn = 'flex items-center gap-1 px-3 py-2 rounded-lg bg-gray-800 text-sm';
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list';

/** One saved list: edit it in place and share it. Every edit saves at once. */
export default function ListView({ uid, list, collectionData, onBack, onDeleted, service = ListService, loadPrices = loadListPrices }) {
  const [items, setItems] = useState(list.items ?? {});
  const [name, setName] = useState(list.name);
  const [savedName, setSavedName] = useState(list.name);
  const [showPrices, setShowPrices] = useState(list.showPrices !== false);
  const [prices, setPrices] = useState(null);
  const [priceError, setPriceError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [copyState, setCopyState] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const wants = list.kind === 'wants';

  // Re-price only when the set of cards changes, not on every quantity tap.
  const priceKey = Object.keys(items).sort().join('|');
  useEffect(() => {
    let cancelled = false;
    loadPrices(items).then((res) => {
      if (cancelled) return;
      setPrices(res.prices ?? {});
      setPriceError(Boolean(res.error));
    });
    return () => { cancelled = true; };
  }, [priceKey]); // eslint-disable-line react-hooks/exhaustive-deps -- keyed on the card set

  useEffect(() => {
    if (!printing) return;
    window.print();
    setPrinting(false);
  }, [printing]);

  const lines = useMemo(() => listLines(items, prices ?? {}), [items, prices]);
  const summary = useMemo(() => listSummary(lines), [lines]);

  const save = async (patch) => {
    setCopyState(null);
    const res = await service.updateList(uid, list.id, patch);
    setSaveError(Boolean(res?.error));
  };
  const saveItems = (next) => { setItems(next); save({ items: next }); };

  const setQty = (key, qty) => saveItems({ ...items, [key]: { ...items[key], qty } });
  const remove = (key) => { const next = { ...items }; delete next[key]; saveItems(next); };
  const setFinish = (key, finish) => saveItems(changeFinish(items, key, finish));
  const setNote = (key, note) => {
    const trimmed = note.trim();
    if ((items[key].note ?? '') === trimmed) return;
    const next = { ...items[key] };
    if (trimmed) next.note = trimmed; else delete next.note;
    saveItems({ ...items, [key]: next });
  };
  const addCard = (card) => {
    setPicking(false);
    saveItems(mergeItems(items, { [itemKey(card.Set, card.Number, 'any')]: cardItem(card, 'any', 1) }));
  };
  const rename = () => {
    const trimmed = name.trim();
    if (!trimmed) { setName(savedName); return; }
    if (trimmed === savedName) return;
    setSavedName(trimmed);
    save({ name: trimmed });
  };
  const togglePrices = () => { const next = !showPrices; setShowPrices(next); save({ showPrices: next }); };

  const current = { kind: list.kind, name: savedName };
  const copyText = async () => {
    const text = toListText(current, lines, { showPrices });
    try {
      await navigator.clipboard.writeText(text);
      setCopyState({ kind: 'copied', count: summary.cards });
    } catch {
      setCopyState({ kind: 'fallback', text });
    }
  };
  const exportCsv = () => {
    const date = new Date().toISOString().slice(0, 10);
    downloadText(toListCsv(current, lines, { showPrices }), `${slug(savedName)}-${date}.csv`);
  };
  const del = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    const res = await service.deleteList(uid, list.id);
    if (res?.error) { setSaveError(true); setConfirmDelete(false); return; }
    onDeleted();
  };

  return (
    <section aria-label={savedName} className="space-y-4">
      <div className="flex items-center gap-2 print:hidden">
        <button type="button" onClick={onBack} className={btn}><ArrowLeft className="w-4 h-4" /> Back</button>
      </div>
      <input
        aria-label="List name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={rename}
        className="w-full bg-transparent text-xl font-bold border-b border-gray-800 focus:border-yellow-500 outline-none py-1 print:border-0"
      />
      {list.source?.label && <p className="text-xs text-gray-500">From {list.source.label}</p>}

      {saveError && <p role="alert" className="text-sm text-red-400">Couldn&apos;t save — check your connection.</p>}
      {showPrices && priceError && <p className="text-sm text-yellow-300">Prices are unavailable right now.</p>}

      <div className="flex flex-wrap gap-2 print:hidden">
        <button type="button" aria-pressed={showPrices} onClick={togglePrices}
          className={`px-3 py-2 rounded-lg text-sm border ${showPrices ? 'bg-gray-800 border-gray-600 text-gray-100' : 'bg-gray-900 border-gray-700 text-gray-500'}`}>
          Show prices
        </button>
        {wants && <button type="button" onClick={() => setPicking(true)} className={btn}><Plus className="w-4 h-4" /> Add card</button>}
        <button type="button" onClick={copyText} disabled={lines.length === 0} className={`${btn} disabled:opacity-40`}><ClipboardCopy className="w-4 h-4" /> Copy as text</button>
        <button type="button" onClick={exportCsv} disabled={lines.length === 0} className={`${btn} disabled:opacity-40`}><Download className="w-4 h-4" /> Download CSV</button>
        <button type="button" onClick={() => setPrinting(true)} disabled={lines.length === 0} className={`${btn} disabled:opacity-40`}><FileText className="w-4 h-4" /> Save as PDF</button>
      </div>

      {copyState?.kind === 'copied' && <p role="status" className="text-sm text-green-400 print:hidden">Copied {copyState.count} cards</p>}
      {copyState?.kind === 'fallback' && (
        <div className="space-y-1 print:hidden">
          <p className="text-xs text-gray-400">Select and copy:</p>
          <textarea readOnly aria-label="List text" value={copyState.text} rows={6} onFocus={(e) => e.target.select()}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs font-mono" />
        </div>
      )}

      <div className="flex gap-4 text-sm">
        <span>Cards <strong data-testid="list-cards">{summary.cards}</strong></span>
        {showPrices && summary.priced > 0 && <span>Value <strong data-testid="list-value">{money(summary.value)}</strong></span>}
      </div>

      {lines.length === 0 ? (
        <p className="text-sm text-gray-500">{wants ? 'No cards yet — use Add card.' : 'No cards in this list.'}</p>
      ) : (
        <ul className="divide-y divide-gray-800">
          {lines.map((l) => (
            <li key={l.key} data-testid="list-row" className="py-2 space-y-1">
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0">
                  <span className="block font-medium truncate">{l.name}{l.subtitle ? `, ${l.subtitle}` : ''}</span>
                  <span className="block text-xs text-gray-500">{l.set} {l.number}{wants ? '' : ` · ${FINISH_LABEL[l.finish]}`}
                    {/* The finish picker is hidden in print: say it in the PDF. */}
                    {wants && <span data-testid="print-finish" className="hidden print:inline"> · {FINISH_LABEL[l.finish]}</span>}
                  </span>
                </span>
                {showPrices && l.unitPrice !== null && (
                  <span className="text-xs text-gray-400 text-right">{money(l.unitPrice)}{l.priceIsFallback ? ' ↺' : ''}</span>
                )}
                <div className="flex items-center gap-1 print:hidden">
                  <button type="button" aria-label={`Fewer ${l.name}`} disabled={l.qty <= 1} onClick={() => setQty(l.key, l.qty - 1)}
                    className="p-1 rounded-full bg-gray-800 disabled:opacity-30"><Minus className="w-3 h-3" /></button>
                  <span className="w-6 text-center font-bold">{l.qty}</span>
                  <button type="button" aria-label={`More ${l.name}`} onClick={() => setQty(l.key, l.qty + 1)}
                    className="p-1 rounded-full bg-gray-800"><Plus className="w-3 h-3" /></button>
                  <button type="button" aria-label={`Remove ${l.name}`} onClick={() => remove(l.key)}
                    className="p-1 rounded-full text-gray-400 hover:text-red-400"><X className="w-4 h-4" /></button>
                </div>
                <span className="hidden print:inline">×{l.qty}</span>
              </div>
              <div className="flex gap-2 print:hidden">
                {wants && (
                  <select aria-label={`Finish for ${l.name}`} value={l.finish} onChange={(e) => setFinish(l.key, e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs">
                    {['any', 'standard', 'foil'].map((f) => <option key={f} value={f}>{FINISH_LABEL[f]}</option>)}
                  </select>
                )}
                <input aria-label={`Note for ${l.name}`} defaultValue={l.note ?? ''} placeholder="Note"
                  onBlur={(e) => setNote(l.key, e.target.value)}
                  className="flex-1 bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs" />
              </div>
              {l.note && <p className="hidden print:block text-xs">{l.note}</p>}
            </li>
          ))}
        </ul>
      )}

      <div className="pt-4 print:hidden">
        <button type="button" onClick={del} className={`${btn} text-red-300`}>
          <Trash2 className="w-4 h-4" /> {confirmDelete ? 'Tap again to delete' : 'Delete list'}
        </button>
      </div>

      {picking && <CardPickerModal collectionData={collectionData} onSelect={addCard} onClose={() => setPicking(false)} />}
    </section>
  );
}
