import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Download, FileText, ListPlus, SlidersHorizontal, X } from 'lucide-react';
import { loadCollectionValue } from '../services/collectionValueLoader';
import {
  DEFAULT_FILTERS, applyFilters, filterOptions, summarize, sortLines, toCollectionCsv,
} from '../utils/collectionValue';
import { parsePricePaid } from '../utils/scanDraft';
import { buildSurplusLines, deckUsage, toTradeText } from '../utils/surplus';
import { itemsFromSurplus } from '../utils/cardLists';
import SaveListDialog from './SaveListDialog';
import CopyTextButton from './CopyTextButton';

/**
 * What the collection is worth at today's market prices, sliced by any
 * combination of filters. Every number follows the filters, and a breakdown
 * row is a shortcut to filter by it. Printing (Save as PDF) shows only this
 * screen -- it reuses the batch report's print id (see index.css).
 */
const FILTERS_KEY = 'swu-value-filters';
const MODE_KEY = 'swu-value-mode';
const PRICES_KEY = 'swu-value-show-prices';

// @environment:web-localstorage
const readSetting = (key, fallback) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const writeSetting = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered this time.
  }
};
const PAGE = 100;
const LIST_FIELDS = [
  { field: 'sets', label: 'Set', option: 'sets', summary: 'bySet', noun: 'set' },
  { field: 'rarities', label: 'Rarity', option: 'rarities', summary: 'byRarity', noun: 'rarity' },
  { field: 'types', label: 'Type', option: 'types', summary: 'byType', noun: 'type' },
  { field: 'aspects', label: 'Aspect', option: 'aspects', summary: 'byAspect', noun: 'aspect' },
  { field: 'variants', label: 'Printing', option: 'variants', summary: 'byVariant', noun: 'printing' },
];
const money = (v) => (v === null || v === undefined ? '—' : `$${v.toFixed(2)}`);

// Saved filters are checked field by field: anything of the wrong type falls
// back to its default instead of crashing the report (and, being saved,
// crashing it again on every open).
// @environment:web-localstorage
function loadFilters() {
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(FILTERS_KEY));
  } catch {
    return DEFAULT_FILTERS;
  }
  if (!stored || typeof stored !== 'object') return DEFAULT_FILTERS;
  const f = { ...DEFAULT_FILTERS };
  for (const { field } of LIST_FIELDS) {
    if (Array.isArray(stored[field])) f[field] = stored[field].filter((v) => typeof v === 'string');
  }
  if (['all', 'standard', 'foil'].includes(stored.finish)) f.finish = stored.finish;
  if (['all', 'priced', 'unpriced'].includes(stored.price)) f.price = stored.price;
  if (typeof stored.minPrice === 'number' && Number.isFinite(stored.minPrice) && stored.minPrice >= 0) f.minPrice = stored.minPrice;
  if (typeof stored.search === 'string') f.search = stored.search;
  return f;
}

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

const select = 'bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-100';

export default function CollectionValueReport({ uid, collectionData, onClose, load = loadCollectionValue }) {
  // undefined while loading.
  const [data, setData] = useState(undefined);
  const [initialFilters] = useState(loadFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [minPriceText, setMinPriceText] = useState(() => (initialFilters.minPrice ?? '').toString());
  const [sortBy, setSortBy] = useState('value');
  const [sortDir, setSortDir] = useState('desc');
  const [shown, setShown] = useState(PAGE);
  // Save as PDF prints every matching card: render them all, print, page again.
  const [printing, setPrinting] = useState(false);
  const [savingList, setSavingList] = useState(false);
  // The filter controls take a lot of room: collapsed until asked for. The
  // chips below always show what is applied.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // 'all' = the whole collection; 'surplus' = beyond deck use and a playset.
  const [mode, setMode] = useState(() => (readSetting(MODE_KEY, 'all') === 'surplus' ? 'surplus' : 'all'));
  const [showPrices, setShowPrices] = useState(() => readSetting(PRICES_KEY, '1') !== '0');
  // { kind: 'copied', count } | { kind: 'fallback', text } | null

  useEffect(() => {
    let cancelled = false;
    load(collectionData, { uid, includeDecks: true }).then((res) => { if (!cancelled) setData(res); });
    return () => { cancelled = true; };
    // Loaded once per opening: the report is a snapshot of the collection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
    } catch {
      // Not remembered this time.
    }
  }, [filters]);

  useEffect(() => {
    if (!printing) return;
    window.print();
    setPrinting(false);
  }, [printing]);

  const allLines = useMemo(() => data?.lines ?? [], [data]);
  // Surplus never guesses: without the decks it would list deck cards for trade.
  const baseLines = useMemo(() => {
    if (mode !== 'surplus') return allLines;
    if (!data || data.decksError) return [];
    return buildSurplusLines(allLines, deckUsage(data.decks ?? []));
  }, [mode, allLines, data]);
  const options = useMemo(() => filterOptions(baseLines), [baseLines]);
  const activeFilters = useMemo(
    () => (showPrices ? filters : { ...filters, price: 'all', minPrice: null }),
    [filters, showPrices],
  );
  const lines = useMemo(() => applyFilters(baseLines, activeFilters), [baseLines, activeFilters]);
  const summary = useMemo(() => summarize(lines), [lines]);
  const tradeText = useMemo(() => toTradeText(lines, { showPrices }), [lines, showPrices]);
  const byValueHidden = !showPrices && sortBy === 'value';
  const listSortBy = byValueHidden ? 'set' : sortBy;
  const listSortDir = byValueHidden ? 'asc' : sortDir;
  const sorted = useMemo(() => sortLines(lines, listSortBy, listSortDir), [lines, listSortBy, listSortDir]);

  // Any change makes a shown copy box stale.
  const update = (patch) => { setFilters((f) => ({ ...f, ...patch })); setShown(PAGE); };
  const addTo = (field, key) => update({ [field]: filters[field].includes(key) ? filters[field] : [...filters[field], key] });
  const removeFrom = (field, key) => update({ [field]: filters[field].filter((k) => k !== key) });
  const clearAll = () => { setMinPriceText(''); update(DEFAULT_FILTERS); };

  const chips = [
    ...LIST_FIELDS.flatMap(({ field, label }) => filters[field].map((key) => ({ name: `${label}: ${key}`, remove: () => removeFrom(field, key) }))),
    ...(filters.finish !== 'all' ? [{ name: `Finish: ${filters.finish}`, remove: () => update({ finish: 'all' }) }] : []),
    ...(activeFilters.price !== 'all' ? [{ name: `Price: ${activeFilters.price}`, remove: () => update({ price: 'all' }) }] : []),
    ...(activeFilters.minPrice !== null ? [{ name: `Min price: ${money(activeFilters.minPrice)}`, remove: () => { setMinPriceText(''); update({ minPrice: null }); } }] : []),
    ...(filters.search.trim() ? [{ name: `Search: ${filters.search.trim()}`, remove: () => update({ search: '' }) }] : []),
  ];

  const surplusMode = mode === 'surplus';
  // Nothing to export when the decks couldn't be read.
  const noExport = surplusMode && Boolean(data?.decksError);

  const changeMode = (next) => {
    setMode(next);
    setShown(PAGE);
    writeSetting(MODE_KEY, next);
  };

  const togglePrices = () => {
    const next = !showPrices;
    setShowPrices(next);
    writeSetting(PRICES_KEY, next ? '1' : '0');
  };

  const exportCsv = () => {
    const date = new Date().toISOString().slice(0, 10);
    downloadText(
      toCollectionCsv(lines, summary, activeFilters, { showPrices, mode }),
      `${surplusMode ? 'surplus' : 'collection-value'}-${date}.csv`,
    );
  };


  return createPortal(
    <div
      id="batch-report"
      role="dialog"
      aria-label="Market reports"
      className="fixed inset-0 z-[80] overflow-y-auto bg-gray-950 text-gray-100 print:static print:bg-white print:text-black"
    >
      <div className="max-w-4xl mx-auto p-4 space-y-4">
        <header className="flex items-start gap-3">
          <div className="flex-1">
            <h2 className="text-xl font-bold">Market reports</h2>
            <p data-testid="report-mode" className="text-sm text-gray-400">{surplusMode ? 'Surplus / trade list' : 'Collection value'}</p>
          </div>
          <button type="button" onClick={onClose} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-gray-800 text-sm print:hidden">
            <X className="w-4 h-4" /> Close
          </button>
        </header>

        {data === undefined ? (
          <p className="text-gray-400">Loading prices…</p>
        ) : (
          <>
            {data.missingSets?.length > 0 && (
              <p className="text-sm text-yellow-300">
                Couldn&apos;t load card details for {data.missingSets.join(', ')} — their cards show without rarity or type.
              </p>
            )}
            {data.error === 'prices' && <p className="text-sm text-yellow-300">Prices are unavailable right now.</p>}

            <div className="flex flex-wrap gap-2 print:hidden">
              <div className="flex rounded-lg bg-gray-800 p-1 border border-gray-700">
                {[['all', 'All cards'], ['surplus', 'Surplus']].map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={mode === id} onClick={() => changeMode(id)}
                    className={`px-3 py-1 rounded-md text-sm font-semibold ${mode === id ? 'bg-yellow-500 text-black' : 'text-gray-300'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <button type="button" aria-pressed={showPrices} onClick={togglePrices}
                className={`px-3 py-2 rounded-lg text-sm border ${showPrices ? 'bg-gray-800 border-gray-600 text-gray-100' : 'bg-gray-900 border-gray-700 text-gray-500'}`}>
                Show prices
              </button>
            </div>

            {surplusMode && data.decksError && (
              <p role="alert" className="text-sm text-red-400">Couldn&apos;t read your decks, so surplus can&apos;t be worked out.</p>
            )}
            {surplusMode && !data.decksError && baseLines.length === 0 && (
              <p className="text-sm text-gray-400">No surplus — everything you own is in a deck or part of a playset.</p>
            )}

            <div className="flex flex-wrap gap-2 print:hidden">
              <CopyTextButton text={tradeText} count={summary.cards} fallbackLabel="Trade list" disabled={noExport} />
              <button type="button" onClick={exportCsv} disabled={noExport} className="disabled:opacity-40 flex items-center gap-1 px-3 py-2 rounded-lg bg-gray-800 text-sm">
                <Download className="w-4 h-4" /> Download CSV
              </button>
              <button type="button" onClick={() => setPrinting(true)} disabled={noExport} className="disabled:opacity-40 flex items-center gap-1 px-3 py-2 rounded-lg bg-gray-800 text-sm">
                <FileText className="w-4 h-4" /> Save as PDF
              </button>
              {surplusMode && uid && (
                <button type="button" onClick={() => setSavingList(true)} disabled={noExport || lines.length === 0} className="disabled:opacity-40 flex items-center gap-1 px-3 py-2 rounded-lg bg-gray-800 text-sm">
                  <ListPlus className="w-4 h-4" /> Save as trade list
                </button>
              )}
            </div>

            <button
              type="button"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((o) => !o)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm font-semibold print:hidden"
            >
              <span className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
                {chips.length > 0 ? `Filters (${chips.length})` : 'Filters'}
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>

            {filtersOpen && (
            <section className="grid grid-cols-2 sm:grid-cols-3 gap-2 print:hidden" aria-label="Filters">
              {LIST_FIELDS.map(({ field, label, option }) => (
                <label key={field} className="flex flex-col gap-1 text-xs text-gray-400">
                  {label}
                  <select
                    multiple
                    aria-label={label}
                    value={filters[field]}
                    onChange={(e) => update({ [field]: Array.from(e.target.selectedOptions ?? []).map((o) => o.value) })}
                    className={`${select} h-20`}
                  >
                    {options[option].map(({ key, count }) => (
                      <option key={key} value={key}>{key} ({count})</option>
                    ))}
                  </select>
                </label>
              ))}
              <label className="flex flex-col gap-1 text-xs text-gray-400">
                Finish
                <select aria-label="Finish" value={filters.finish} onChange={(e) => update({ finish: e.target.value })} className={select}>
                  <option value="all">All</option>
                  <option value="standard">Standard</option>
                  <option value="foil">Foil</option>
                </select>
              </label>
              {showPrices && (
              <>
              <label className="flex flex-col gap-1 text-xs text-gray-400">
                Price
                <select aria-label="Price" value={filters.price} onChange={(e) => update({ price: e.target.value })} className={select}>
                  <option value="all">All</option>
                  <option value="priced">Priced</option>
                  <option value="unpriced">Unpriced</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-gray-400">
                Minimum price
                <input
                  aria-label="Minimum price"
                  inputMode="decimal"
                  placeholder="e.g. 1.00"
                  value={minPriceText}
                  onChange={(e) => {
                    setMinPriceText(e.target.value);
                    const v = parsePricePaid(e.target.value);
                    if (v !== undefined) update({ minPrice: v });
                  }}
                  className={select}
                />
              </label>
              </>
              )}
              <label className="flex flex-col gap-1 text-xs text-gray-400 col-span-2 sm:col-span-2">
                Search cards
                <input
                  aria-label="Search cards"
                  value={filters.search}
                  onChange={(e) => update({ search: e.target.value })}
                  placeholder="Name or subtitle"
                  className={select}
                />
              </label>
            </section>
            )}

            {chips.length > 0 && (
              <div className="flex flex-wrap gap-2 print:hidden">
                {chips.map((c) => (
                  <button key={c.name} type="button" aria-label={`Remove ${c.name}`} onClick={c.remove}
                    className="px-2 py-1 rounded-full bg-blue-600/30 border border-blue-500/50 text-xs text-blue-200">
                    {c.name} ✕
                  </button>
                ))}
                <button type="button" onClick={clearAll} className="px-2 py-1 rounded-full bg-gray-800 text-xs">Clear all</button>
              </div>
            )}

            {/* Totals */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {showPrices && (
              <div className="rounded-lg bg-gray-900 border border-gray-800 p-3 print:bg-white">
                <div className="text-xs text-gray-400">{surplusMode ? 'Surplus value' : 'Value'}</div>
                <div data-testid="total-value" className="text-lg font-semibold">{summary.pricedShare > 0 ? money(summary.value) : '—'}</div>
                <div data-testid="priced-share" className="text-[11px] text-gray-500">{Math.round(summary.pricedShare * 100)}% of copies priced</div>
              </div>
              )}
              <div className="rounded-lg bg-gray-900 border border-gray-800 p-3 print:bg-white">
                <div className="text-xs text-gray-400">{surplusMode ? 'Surplus cards' : 'Cards'}</div>
                <div data-testid="total-cards" className="text-lg font-semibold">{summary.cards}</div>
              </div>
              <div className="rounded-lg bg-gray-900 border border-gray-800 p-3 print:bg-white">
                <div className="text-xs text-gray-400">Unique</div>
                <div data-testid="total-unique" className="text-lg font-semibold">{summary.unique}</div>
              </div>
              {showPrices && (
              <div className="rounded-lg bg-gray-900 border border-gray-800 p-3 print:bg-white">
                <div className="text-xs text-gray-400">Standard / Foil</div>
                <div className="text-sm font-semibold">{money(summary.standardValue)} / {money(summary.foilValue)}</div>
              </div>
              )}
            </div>

            {/* Breakdowns: each row narrows the report to it */}
            <div className="grid sm:grid-cols-2 gap-4">
              {LIST_FIELDS.map(({ field, label, summary: key, noun }) => summary[key].length > 0 && (
                <section key={field}>
                  <h3 className="text-sm font-semibold text-gray-300 mb-1 print:text-black">By {noun}</h3>
                  <ul className="text-sm">
                    {summary[key].map((g) => (
                      <li key={g.key}>
                        <button
                          type="button"
                          aria-label={`Filter by ${noun} ${g.key}`}
                          onClick={() => addTo(field, g.key)}
                          className="w-full flex gap-2 py-1 border-b border-gray-800 hover:bg-gray-900 text-left print:border-gray-200"
                        >
                          <span className="flex-1">{g.key}</span>
                          <span className="text-gray-400 print:text-gray-700">{g.count}</span>
                          {showPrices && <span className="w-20 text-right">{money(g.value)}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            {/* Every matching card */}
            <section className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                <h3 className="flex-1 text-sm font-semibold text-gray-300">Cards ({sorted.length})</h3>
                <label className="text-xs text-gray-400 flex items-center gap-1">
                  Sort by
                  <select aria-label="Sort by" value={listSortBy} onChange={(e) => setSortBy(e.target.value)} className={select}>
                    {showPrices && <option value="value">Value</option>}
                    <option value="qty">Quantity</option>
                    <option value="name">Name</option>
                    <option value="set">Set</option>
                  </select>
                </label>
                <button type="button" onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))} className="px-2 py-1.5 rounded-lg bg-gray-800 text-xs">
                  {listSortDir === 'desc' ? 'Descending' : 'Ascending'}
                </button>
              </div>
              <ul aria-label="Cards" className="divide-y divide-gray-800 text-sm print:divide-gray-200">
                {(printing ? sorted : sorted.slice(0, shown)).map((l) => (
                  <li key={l.id} className="py-1.5 flex items-center gap-2">
                    <span className="flex-1 min-w-0">
                      <span className="block truncate print:whitespace-normal">{l.name}</span>
                      <span className="block text-xs text-gray-500">{l.set} {l.number} · {l.isFoil ? 'Foil' : 'Standard'}{surplusMode ? '' : ` · ×${l.qty}`}</span>
                      {surplusMode && (
                        <span className="block text-xs text-gray-400">Surplus {l.qty} · own {l.owned} · decks {l.inDecks} · keep {l.kept}</span>
                      )}
                    </span>
                    {showPrices && (
                      <>
                        <span className="text-xs text-gray-400 w-16 text-right">{money(l.unitPrice)}{l.priceIsFallback ? ' ↺' : ''}</span>
                        <span className="w-20 text-right font-semibold">{money(l.value)}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {sorted.length > shown && (
                <button type="button" onClick={() => setShown((n) => n + PAGE)} className="w-full py-2 rounded-lg bg-gray-800 text-sm print:hidden">
                  Show more
                </button>
              )}
              {showPrices && summary.otherFinish.length > 0 && (
                <p className="text-xs text-gray-500">↺ {summary.otherFinish.length} priced from the other finish.</p>
              )}
              {showPrices && summary.unpriced.length > 0 && (
                <p className="text-xs text-gray-500">{summary.unpriced.length} with no price data, not counted in the value.</p>
              )}
            </section>
          </>
        )}
      </div>
      {savingList && (
        <SaveListDialog uid={uid} kind="trade" items={itemsFromSurplus(lines)} source={{ type: 'surplus', label: 'Surplus' }}
          defaultName="Trade list" showPrices={showPrices} onClose={() => setSavingList(false)} />
      )}
    </div>,
    document.body,
  );
}
