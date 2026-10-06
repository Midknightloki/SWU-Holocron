import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardCopy, Loader2 } from 'lucide-react';
import { ListService } from '../services/ListService';
import { CardService } from '../services/CardService';
import { FINISH_LABEL, listSummary, publicLines, toListText } from '../utils/cardLists';

const money = (v) => `$${v.toFixed(2)}`;
const HEADING = { trade: 'Trade list', wants: 'Wants list' };

/** A shared trade or wants list, for anyone with the link. No sign-in. */
export default function PublicListView({ code, service = ListService }) {
  const [state, setState] = useState({ status: 'loading' });
  const [copyState, setCopyState] = useState(null);

  useEffect(() => {
    let cancelled = false;
    service.getPublicList(code).then((res) => {
      if (cancelled) return;
      if (res.list) setState({ status: 'ok', list: res.list });
      else setState({ status: res.error === 'not-found' ? 'gone' : 'error' });
    });
    return () => { cancelled = true; };
  }, [code, service]);

  const doc = state.list;
  const lines = useMemo(() => publicLines(doc), [doc]);
  const summary = useMemo(() => listSummary(lines), [lines]);
  const heading = doc ? `${HEADING[doc.kind] ?? 'List'}: ${doc.name}` : '';
  const showPrices = Boolean(doc?.showPrices);

  useEffect(() => {
    if (heading) document.title = `${heading} — SWU Holocron`;
  }, [heading]);

  const copyText = async () => {
    const text = toListText(doc, lines, { showPrices });
    try {
      await navigator.clipboard.writeText(text);
      setCopyState({ kind: 'copied' });
    } catch {
      setCopyState({ kind: 'fallback', text });
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <main className="max-w-3xl mx-auto p-4 space-y-4">
        {state.status === 'loading' && (
          <p className="flex items-center gap-2 text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Loading list…</p>
        )}
        {state.status === 'gone' && <p className="text-gray-300">This list isn&apos;t shared any more.</p>}
        {state.status === 'error' && (
          <p role="alert" className="text-red-400">Couldn&apos;t load this list. Check your connection and try again.</p>
        )}
        {state.status === 'ok' && (
          <>
            <header className="space-y-1">
              <h1 className="text-2xl font-bold">{heading}</h1>
              <p className="text-sm text-gray-400">
                {summary.cards} cards
                {showPrices && typeof doc.value === 'number' && <> · <span data-testid="public-value">{money(doc.value)}</span></>}
              </p>
              {showPrices && doc.pricesAsOf && (
                <p className="text-xs text-gray-500">Prices as of {new Date(doc.pricesAsOf).toLocaleDateString()} (market)</p>
              )}
            </header>

            <button type="button" onClick={copyText} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-gray-800 text-sm">
              <ClipboardCopy className="w-4 h-4" /> Copy as text
            </button>
            {copyState?.kind === 'copied' && <p role="status" className="text-sm text-green-400">Copied</p>}
            {copyState?.kind === 'fallback' && (
              <textarea readOnly aria-label="List text" value={copyState.text} rows={6} onFocus={(e) => e.target.select()}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs font-mono" />
            )}

            <ul className="divide-y divide-gray-800">
              {lines.map((l) => (
                <li key={l.key} data-testid="public-row" className="flex items-center gap-3 py-2">
                  <img src={CardService.getCardImage(l.set, l.number)} alt="" loading="lazy"
                    onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                    className="w-10 h-14 object-cover rounded bg-gray-800 shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium truncate">{l.name}{l.subtitle ? `, ${l.subtitle}` : ''}</span>
                    <span className="block text-xs text-gray-500">{l.set} {l.number} · {FINISH_LABEL[l.finish] ?? l.finish}</span>
                    {l.note && <span className="block text-xs text-gray-400">{l.note}</span>}
                  </span>
                  {showPrices && l.unitPrice !== null && <span className="text-xs text-gray-400">{money(l.unitPrice)}</span>}
                  <span className="w-8 text-right font-bold">×{l.qty}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <footer className="pt-6 text-center text-xs text-gray-500">
          <a href="/" className="hover:text-gray-300">Made with SWU Holocron</a>
        </footer>
      </main>
    </div>
  );
}
