import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import BatchesPanel from './BatchesPanel';
import ListView from './ListView';
import WantsFromGaps from './WantsFromGaps';
import { ListService } from '../services/ListService';

const TAB_KEY = 'swu-saved-lists-tab';
const TABS = [['batches', 'Batches'], ['trade', 'Trade lists'], ['wants', 'Wants lists']];

// @environment:web-localstorage
const readTab = () => {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return TABS.some(([id]) => id === t) ? t : 'batches';
  } catch {
    return 'batches';
  }
};
const writeTab = (t) => {
  try {
    localStorage.setItem(TAB_KEY, t);
  } catch {
    // Not remembered this time.
  }
};

const cardCount = (list) => Object.values(list.items ?? {}).reduce((s, i) => s + (i.qty ?? 0), 0);

/** Batches, trade lists and wants lists, opened from the Command Center. */
export default function SavedListsPage({ uid, collectionData, batchesRefresh = 0, onClose, service = ListService, initialTab }) {
  const [tab, setTab] = useState(() => initialTab ?? readTab());
  const [lists, setLists] = useState(null); // null loading | array | 'error'
  const [openList, setOpenList] = useState(null);
  const [newMenu, setNewMenu] = useState(false);
  const [gaps, setGaps] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (tab === 'batches' || openList) return undefined;
    let cancelled = false;
    setLists(null);
    service.listLists(uid, tab).then((res) => {
      if (!cancelled) setLists(res.error ? 'error' : res.lists);
    });
    return () => { cancelled = true; };
  }, [tab, uid, service, openList, reload]);

  const changeTab = (t) => { setTab(t); setNewMenu(false); writeTab(t); };
  const openById = useCallback(async (id) => {
    setGaps(false);
    setNewMenu(false);
    const res = await service.getList(uid, id);
    if (res.list) setOpenList(res.list); else setReload((n) => n + 1);
  }, [service, uid]);
  const createEmpty = async () => {
    const res = await service.createList(uid, { kind: 'wants', name: 'Wants list' });
    if (res.id) openById(res.id); else setLists('error');
  };
  const back = () => { setOpenList(null); setReload((n) => n + 1); };

  return createPortal(
    <div
      id={openList ? 'batch-report' : undefined}
      role="dialog"
      aria-label="Saved reports/lists"
      className="fixed inset-0 z-[80] overflow-y-auto bg-gray-950 text-gray-100 print:static print:bg-white print:text-black"
    >
      <div className="max-w-4xl mx-auto p-4 space-y-4">
        <header className="flex items-start gap-3 print:hidden">
          <h2 className="flex-1 text-xl font-bold">Saved reports/lists</h2>
          <button type="button" onClick={onClose} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-gray-800 text-sm">
            <X className="w-4 h-4" /> Close
          </button>
        </header>

        {openList ? (
          <ListView uid={uid} list={openList} collectionData={collectionData} onBack={back} onDeleted={back} service={service} />
        ) : (
          <>
            <div role="tablist" className="flex rounded-lg bg-gray-800 p-1 border border-gray-700">
              {TABS.map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => changeTab(id)}
                  className={`flex-1 px-3 py-1.5 rounded-md text-sm font-semibold ${tab === id ? 'bg-yellow-500 text-black' : 'text-gray-300'}`}>
                  {label}
                </button>
              ))}
            </div>

            {tab === 'batches' && <BatchesPanel uid={uid} refreshKey={batchesRefresh} />}

            {tab === 'wants' && (
              <div className="space-y-2">
                <button type="button" onClick={() => setNewMenu((v) => !v)} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-yellow-500 text-black text-sm font-semibold">
                  <Plus className="w-4 h-4" /> New wants list
                </button>
                {newMenu && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setGaps(true)} className="px-3 py-2 rounded-lg bg-gray-800 text-sm">Fill gaps in my collection</button>
                    <button type="button" onClick={createEmpty} className="px-3 py-2 rounded-lg bg-gray-800 text-sm">Empty list</button>
                  </div>
                )}
              </div>
            )}

            {tab !== 'batches' && lists === null && <p className="text-sm text-gray-500">Loading…</p>}
            {tab !== 'batches' && lists === 'error' && (
              <p role="alert" className="text-sm text-red-400">Couldn&apos;t load your lists. Check your connection and try again.</p>
            )}
            {tab === 'trade' && Array.isArray(lists) && lists.length === 0 && (
              <p className="text-sm text-gray-500">No trade lists yet. Open Market reports → Surplus and choose Save as trade list.</p>
            )}
            {tab === 'wants' && Array.isArray(lists) && lists.length === 0 && (
              <p className="text-sm text-gray-500">No wants lists yet.</p>
            )}
            {tab !== 'batches' && Array.isArray(lists) && lists.length > 0 && (
              <ul className="divide-y divide-gray-800">
                {lists.map((l) => (
                  <li key={l.id}>
                    <button type="button" onClick={() => setOpenList(l)} className="w-full py-2 px-2 text-left hover:bg-gray-800/50 rounded-lg">
                      <span className="block font-medium truncate">{l.name}</span>
                      {l.source?.label && <span className="block text-xs text-gray-500">{l.source.label}</span>}
                      <span className="block text-xs text-gray-500">{cardCount(l)} cards · {new Date(l.updatedAt).toLocaleDateString()}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      {gaps && <WantsFromGaps uid={uid} collectionData={collectionData} onCreated={openById} onClose={() => setGaps(false)} service={service} />}
    </div>,
    document.body,
  );
}
