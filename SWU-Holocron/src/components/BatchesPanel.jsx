import React, { useCallback, useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { BatchService } from '../services/BatchService';
import BatchReport from './BatchReport';

/** Saved scanning batches in the Command Center; tap one for its report. */
const fmt = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`;
const signed = (v) => `${v >= 0 ? '+' : ''}${fmt(v)}`;

export default function BatchesPanel({ uid, refreshKey = 0 }) {
  // null while loading, 'error' when the list could not be read.
  const [batches, setBatches] = useState(null);
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    if (!uid) return;
    BatchService.listBatches(uid).then((list) => setBatches(Array.isArray(list) ? list : 'error'));
    // refreshKey changes when the scanner closes, so a batch just finished shows.
  }, [uid, refreshKey]);

  useEffect(() => { load(); }, [load]);

  if (!uid) return null;

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 shadow-xl p-4">
      <h3 className="flex items-center gap-2 text-lg font-bold text-white mb-3">
        <Package className="w-5 h-5 text-blue-400" /> Batches
      </h3>
      {batches === null && <p className="text-sm text-gray-500">Loading…</p>}
      {batches === 'error' && <p className="text-sm text-red-400">Couldn&apos;t load your batches. Check your connection and try again.</p>}
      {Array.isArray(batches) && batches.length === 0 && <p className="text-sm text-gray-500">No batches yet</p>}
      {Array.isArray(batches) && batches.length > 0 && (
        <ul className="divide-y divide-gray-800">
          {batches.map((b) => {
            const value = b.summary?.valueAtAdd ?? 0;
            const net = typeof b.pricePaid === 'number' ? Math.round((value - b.pricePaid) * 100) / 100 : null;
            return (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => setOpen(b.id)}
                  className="w-full flex items-center gap-3 py-2 text-left hover:bg-gray-800/50 rounded-lg px-2"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium text-gray-100 truncate">{b.name}</span>
                    <span className="block text-xs text-gray-500">
                      {new Date(b.createdAt).toLocaleDateString()} · {b.summary?.cards ?? 0} cards
                    </span>
                  </span>
                  <span className="text-right text-sm">
                    <span className="block text-gray-200">{fmt(value)}</span>
                    {net !== null && (
                      <span className={`block text-xs ${net >= 0 ? 'text-green-400' : 'text-red-400'}`}>{signed(net)}</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && (
        <BatchReport
          uid={uid}
          batchId={open}
          onClose={() => { setOpen(null); load(); }}
          onDeleted={() => { setOpen(null); load(); }}
        />
      )}
    </div>
  );
}
