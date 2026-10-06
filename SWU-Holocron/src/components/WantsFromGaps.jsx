import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CardService } from '../services/CardService';
import { ListService } from '../services/ListService';
import { loadGapItems } from '../services/listLoader';
import { LEGACY_SET_CODES } from '../setCatalog';

const NAMES = { missing: 'Wants: missing titles', playset: 'Wants: playsets' };

/** A wants list that fills the collection's gaps in the chosen sets. */
export default function WantsFromGaps({
  uid, collectionData, onCreated, onClose,
  service = ListService, loadGaps = loadGapItems, getRegistry = () => CardService.getSetRegistry(),
}) {
  const [sets, setSets] = useState([]);
  const [picked, setPicked] = useState([]);
  const [mode, setMode] = useState('missing');
  const [name, setName] = useState(NAMES.missing);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { text, openId? } | { error }

  useEffect(() => {
    let cancelled = false;
    getRegistry().then((registry) => {
      if (cancelled) return;
      setSets((registry ?? []).filter((s) => !LEGACY_SET_CODES.includes(s.code)));
    }).catch(() => { if (!cancelled) setMessage({ error: "Couldn't load the set list." }); });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- load once

  const changeMode = (next) => {
    if (name === NAMES[mode]) setName(NAMES[next]);
    setMode(next);
  };
  const toggle = (code) => setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));

  const create = async () => {
    setBusy(true);
    setMessage(null);
    const codes = sets.map((s) => s.code).filter((c) => picked.includes(c));
    const { items, failedSets } = await loadGaps(codes, collectionData, { mode });
    if (Object.keys(items).length === 0) {
      setBusy(false);
      setMessage({ text: failedSets.length
        ? `Couldn't load ${failedSets.join(', ')}.`
        : `No gaps in the chosen sets — you own every ${mode === 'playset' ? 'playset' : 'title'}.` });
      return;
    }
    const label = `${mode === 'playset' ? 'playsets' : 'missing titles'} in ${codes.filter((c) => !failedSets.includes(c)).join(', ')}`;
    const res = await service.createList(uid, { kind: 'wants', name, items, source: { type: 'gaps', label } });
    setBusy(false);
    if (res?.error) { setMessage({ error: "Couldn't save — check your connection." }); return; }
    if (failedSets.length) {
      setMessage({ text: `Couldn't load ${failedSets.join(', ')} — the list was made without them.`, openId: res.id });
      return;
    }
    onCreated(res.id);
  };

  const group = (title, list) => list.length > 0 && (
    <fieldset className="space-y-1">
      <legend className="text-xs uppercase tracking-wide text-gray-500">{title}</legend>
      {list.map((s) => (
        <label key={s.code} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={picked.includes(s.code)} onChange={() => toggle(s.code)} aria-label={s.name} />
          {s.name} <span className="text-gray-500">{s.code}</span>
        </label>
      ))}
    </fieldset>
  );

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4">
      <div role="dialog" aria-label="Fill gaps in my collection" className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-gray-900 border border-gray-700 p-4 space-y-3 text-gray-100">
        <h3 className="text-lg font-bold">Fill gaps in my collection</h3>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="gap-mode" checked={mode === 'missing'} onChange={() => changeMode('missing')} /> Missing titles
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="gap-mode" checked={mode === 'playset'} onChange={() => changeMode('playset')} /> Up to a playset
          </label>
        </div>
        <input aria-label="List name" value={name} onChange={(e) => setName(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5" />
        {group('Sets', sets.filter((s) => s.isBaseSet))}
        {group('Other sets', sets.filter((s) => !s.isBaseSet))}
        {message?.text && <p role="status" className="text-sm text-yellow-300">{message.text}</p>}
        {message?.error && <p role="alert" className="text-sm text-red-400">{message.error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-800">Cancel</button>
          {message?.openId ? (
            <button type="button" onClick={() => onCreated(message.openId)} className="px-4 py-2 rounded-lg bg-yellow-500 text-black font-semibold">Open list</button>
          ) : (
            <button type="button" onClick={create} disabled={picked.length === 0 || busy}
              className="px-4 py-2 rounded-lg bg-yellow-500 text-black font-semibold disabled:opacity-40">Create list</button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
