import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes, Search } from 'lucide-react';
import { PrebuiltDeckService } from '../services/PrebuiltDeckService';
import { PrebuiltAdds, addPrebuiltToCollection } from '../services/prebuiltAdd';
import { parsePricePaid } from '../utils/scanDraft';
import BatchReport from './BatchReport';

/**
 * Prebuilt decks in the Command Center: one tap adds a precon (or every deck
 * in a product) to the collection, recorded as a batch with its report.
 */
const dateOf = (ms) => new Date(ms).toLocaleDateString();

function groupByProduct(decks) {
  const groups = new Map();
  for (const deck of decks) {
    const key = deck.product?.tcgplayerProductId ? `p${deck.product.tcgplayerProductId}` : `d${deck.id}`;
    const group = groups.get(key) ?? { key, product: deck.product ?? null, decks: [] };
    group.decks.push(deck);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export default function PrebuiltDecksPanel({ uid, collectionRef, collectionData, onAdded }) {
  const [decks, setDecks] = useState([]);
  const [adds, setAdds] = useState({});
  const [search, setSearch] = useState('');
  // { decks, name } -- what Add to collection will add.
  const [pending, setPending] = useState(null);
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [reportId, setReportId] = useState(null);

  const loadAdds = useCallback(() => {
    if (uid) PrebuiltAdds.list(uid).then(setAdds);
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    PrebuiltDeckService.listPublished().then((list) => setDecks(Array.isArray(list) ? list : []));
    loadAdds();
  }, [uid, loadAdds]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (d) => !q
      || d.name?.toLowerCase().includes(q)
      || d.product?.name?.toLowerCase().includes(q)
      || (d.leaders ?? []).some((id) => id.toLowerCase().includes(q));
    return groupByProduct(decks.filter(match));
  }, [decks, search]);

  if (!uid) return null;

  const start = (chosen, name) => {
    setPending({ decks: chosen, name });
    setPrice('');
    setError(null);
    setNotice(null);
  };

  const previouslyAdded = pending?.decks.map((d) => adds[d.sourceId ?? d.id]).find(Boolean);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const res = await addPrebuiltToCollection({
      uid, collectionRef, collectionData, decks: pending.decks, name: pending.name, pricePaid: parsePricePaid(price) ?? null,
    });
    setBusy(false);
    if (res.error && res.error !== 'report') {
      setError("Couldn't add the deck. Try again.");
      return;
    }
    setPending(null);
    const n = res.skipped?.length ?? 0;
    if (n) {
      setNotice(`${n} ${n === 1 ? 'card' : 'cards'} ${n === 1 ? "wasn't" : "weren't"} added: not in our card database yet (${res.skipped.join(', ')})`);
    }
    if (res.error === 'report') setError("Cards added — the batch report couldn't be saved.");
    else setReportId(res.batchId);
    loadAdds();
    onAdded?.();
  };

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 shadow-xl p-4 space-y-3">
      <h3 className="flex items-center gap-2 text-lg font-bold text-white">
        <Boxes className="w-5 h-5 text-blue-400" /> Prebuilt decks
      </h3>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" aria-hidden="true" />
        <input
          aria-label="Search prebuilt decks"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by deck, product or leader"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm"
        />
      </div>

      {notice && <p className="text-sm text-yellow-300">{notice}</p>}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      {pending && (
        <div className="rounded-xl border border-blue-500/40 bg-gray-800/60 p-3 space-y-2">
          <p className="text-sm font-semibold">{pending.name}</p>
          {previouslyAdded && (
            <p className="text-sm text-yellow-300">You added this on {dateOf(previouslyAdded.addedAt)}. Add another copy?</p>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              aria-label="Price paid"
              inputMode="decimal"
              placeholder="Price paid (optional)"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-40 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm"
            />
            <button type="button" disabled={busy} onClick={confirm} className="px-3 py-1.5 rounded-lg bg-yellow-500 text-black text-sm font-bold disabled:opacity-40">
              {busy ? 'Adding…' : 'Add to collection'}
            </button>
            <button type="button" disabled={busy} onClick={() => setPending(null)} className="px-3 py-1.5 rounded-lg bg-gray-700 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {groups.length === 0 && <p className="text-sm text-gray-500">No prebuilt decks yet</p>}
      <ul className="space-y-2">
        {groups.map((group) => (
          <li key={group.key} className="flex gap-3 rounded-xl bg-gray-800/40 p-2">
            {group.product?.imageUrl && (
              <img src={group.product.imageUrl} alt="" className="w-14 h-14 object-contain rounded flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0 space-y-1">
              {group.product && <p className="text-sm font-semibold text-gray-100">{group.product.name}</p>}
              {group.decks.map((deck) => {
                const added = adds[deck.sourceId ?? deck.id];
                return (
                  <div key={deck.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 min-w-0 truncate text-gray-300">{deck.name}</span>
                    {added && <span className="text-xs text-green-400">Added {dateOf(added.addedAt)}</span>}
                    <button
                      type="button"
                      aria-label={`Add ${deck.name}`}
                      onClick={() => start([deck], deck.product?.name ?? deck.name)}
                      className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs"
                    >
                      Add
                    </button>
                  </div>
                );
              })}
              {group.decks.length > 1 && (
                <button
                  type="button"
                  onClick={() => start(group.decks, group.product?.name ?? group.decks[0].name)}
                  className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold"
                >
                  Add all ({group.decks.length})
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {reportId && (
        <BatchReport uid={uid} batchId={reportId} onClose={() => setReportId(null)} onDeleted={() => setReportId(null)} />
      )}
    </div>
  );
}
