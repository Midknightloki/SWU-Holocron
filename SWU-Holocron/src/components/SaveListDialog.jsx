import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ListService } from '../services/ListService';
import { mergeItems } from '../utils/cardLists';

/**
 * Save cards as a new list, or into an existing one: a trade list is replaced
 * (it is a snapshot of the surplus), a wants list is added to.
 */
export default function SaveListDialog({ uid, kind, items, source = null, defaultName, onClose, service = ListService }) {
  const [lists, setLists] = useState([]);
  const [choice, setChoice] = useState('new');
  const [name, setName] = useState(defaultName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [savedTo, setSavedTo] = useState(null);
  const trade = kind === 'trade';
  const count = Object.values(items ?? {}).reduce((s, i) => s + i.qty, 0);

  useEffect(() => {
    let cancelled = false;
    service.listLists(uid, kind).then((res) => { if (!cancelled && res.lists) setLists(res.lists); });
    return () => { cancelled = true; };
  }, [uid, kind, service]);

  const save = async () => {
    setSaving(true);
    setError(false);
    let res;
    let label;
    if (choice === 'new') {
      label = name.trim() || defaultName;
      res = await service.createList(uid, { kind, name: label, items, source });
    } else {
      const target = lists.find((l) => l.id === choice);
      label = target.name;
      res = await service.updateList(uid, target.id, { items: mergeItems(target.items, items, { replace: trade }), source });
    }
    setSaving(false);
    if (res?.error) setError(true); else setSavedTo(label);
  };

  const title = trade ? 'Save as trade list' : 'Save as wants list';
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 print:hidden">
      <div role="dialog" aria-label={title} className="w-full max-w-md rounded-xl bg-gray-900 border border-gray-700 p-4 space-y-3 text-gray-100">
        <h3 className="text-lg font-bold">{title}</h3>
        {savedTo ? (
          <>
            <p role="status" className="text-green-400">Saved to “{savedTo}”</p>
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-yellow-500 text-black font-semibold">Done</button>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-400">{count === 0 ? 'Nothing to save.' : `${count} cards`}</p>
            <label className="flex items-center gap-2">
              <input type="radio" name="save-target" checked={choice === 'new'} onChange={() => setChoice('new')} />
              New list
            </label>
            {choice === 'new' && (
              <input aria-label="New list name" value={name} onChange={(e) => setName(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5" />
            )}
            {lists.map((l) => (
              <label key={l.id} className="flex items-center gap-2">
                <input type="radio" name="save-target" checked={choice === l.id} onChange={() => setChoice(l.id)} />
                {trade ? `Replace “${l.name}”` : `Add to “${l.name}”`}
              </label>
            ))}
            {error && <p role="alert" className="text-sm text-red-400">Couldn&apos;t save — check your connection.</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-800">Cancel</button>
              <button type="button" onClick={save} disabled={count === 0 || saving}
                className="px-4 py-2 rounded-lg bg-yellow-500 text-black font-semibold disabled:opacity-40">Save</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
