import React, { useEffect, useMemo, useState } from 'react';
import CardPickerModal from './CardPickerModal';
import { PrebuiltDeckService } from '../services/PrebuiltDeckService';
import { CardService } from '../services/CardService';
import { loadSet } from '../services/setLoader';
import {
  buildPrebuiltDeck, deckCounts, earlierBaseSets, isOfficialImageUrl, resolveDecklistLine, setFromImageUrl, titleCase,
} from '../utils/decklistImage';

const REASON = { 'not-found': 'Not found in this set or earlier ones', 'name-mismatch': "Number found, but the name doesn't match" };
const btn = 'px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-40';

// @environment:web-file-api
const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

/** Precons from an official decklist image: read, resolve, fix, save for review. */
export default function DecklistImageImport({
  onSaved, service = PrebuiltDeckService, loadSetImpl = loadSet, getRegistry = () => CardService.getSetRegistry(),
}) {
  const [url, setUrl] = useState('');
  const [registry, setRegistry] = useState([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState(null);
  const [source, setSource] = useState(null); // { url } of what was read
  const [decks, setDecks] = useState([]); // [{ title, lines }]
  const [setCode, setSetCode] = useState('');
  const [cardsBySet, setCardsBySet] = useState({});
  const [titles, setTitles] = useState({});
  const [overrides, setOverrides] = useState({}); // "d:i" -> card | 'removed'
  const [picking, setPicking] = useState(null); // { key, name }
  const [saved, setSaved] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getRegistry().then((r) => setRegistry(r ?? [])).catch(() => setRegistry([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- load once

  const earlier = useMemo(() => (setCode ? earlierBaseSets(setCode, registry) : []), [setCode, registry]);

  // The set list may arrive after the image was read: guess the set then too.
  useEffect(() => {
    if (!source?.url || setCode || registry.length === 0) return;
    const guess = setFromImageUrl(source.url, registry);
    if (guess) setSetCode(guess);
  }, [registry, source]); // eslint-disable-line react-hooks/exhaustive-deps -- only when either arrives

  // Card data for the deck's set and the earlier ones (IndexedDB cache).
  useEffect(() => {
    if (!setCode || decks.length === 0) return undefined;
    let cancelled = false;
    const codes = [setCode, ...earlier].filter((code) => !(code in cardsBySet));
    Promise.all(codes.map((code) => Promise.resolve().then(() => loadSetImpl(code)).then((r) => [code, r?.cards ?? []]).catch(() => [code, []])))
      .then((pairs) => { if (!cancelled && pairs.length) setCardsBySet((prev) => ({ ...prev, ...Object.fromEntries(pairs) })); });
    return () => { cancelled = true; };
  }, [setCode, earlier, decks]); // eslint-disable-line react-hooks/exhaustive-deps -- cardsBySet only grows

  const resolved = useMemo(() => decks.map((deck, d) => deck.lines.map((line, i) => {
    const key = `${d}:${i}`;
    const override = overrides[key];
    if (override === 'removed') return { key, line, removed: true };
    if (override) return { key, line, card: override };
    if (!setCode || !(setCode in cardsBySet)) return { key, line, pending: true };
    return { key, line, ...resolveDecklistLine(line, { setCode, cardsBySet, earlierSets: earlier }) };
  })), [decks, overrides, setCode, cardsBySet, earlier]);

  const allResolved = resolved.length > 0 && resolved.every((rows) => rows.every((r) => r.removed || r.card));

  const start = async (input, linkUrl) => {
    setError(null);
    setSaved([]);
    setReading(true);
    const res = await service.readDecklistImage(input);
    setReading(false);
    if (res.error) { setError(res.error); return; }
    if (!res.decks?.length) { setError("Couldn't find a decklist in this image."); return; }
    setDecks(res.decks);
    setOverrides({});
    setTitles({});
    setSource({ url: linkUrl });
    setSetCode(setFromImageUrl(linkUrl, registry) ?? '');
  };

  const readLink = () => {
    if (!isOfficialImageUrl(url.trim())) { setError('Only official starwarsunlimited.com images can be read.'); return; }
    start({ imageUrl: url.trim() }, url.trim());
  };
  const readFile = async (file) => {
    if (!file) return;
    try {
      start({ image: await fileToBase64(file), mimeType: file.type }, null);
    } catch {
      setError("Couldn't read that file.");
    }
  };

  const save = async () => {
    setSaving(true);
    const out = [];
    for (let d = 0; d < decks.length; d++) {
      const title = titles[d] ?? decks[d].title;
      const entries = resolved[d].filter((r) => r.card).map((r) => ({ card: r.card, qty: r.line.qty }));
      const removed = resolved[d].filter((r) => r.removed).map((r) => r.line);
      const deck = buildPrebuiltDeck({ title, entries, setCode, removed });
      const res = await service.addFromImage(deck, { url: source?.url ?? null, setCode });
      out.push(res.ok ? `Saved ${deck.sourceName}` : res.error === 'exists' ? `${deck.sourceName} is already in Prebuilt Decks` : `Couldn't save ${deck.sourceName}`);
    }
    setSaving(false);
    setSaved(out);
    onSaved?.();
  };

  return (
    <section aria-label="Add from decklist image" className="rounded-xl bg-gray-800 border border-gray-700 p-3 space-y-3">
      <p className="text-sm text-gray-300">
        Official decklist images (starwarsunlimited.com articles) list two decks each. Paste the image link or upload it.
      </p>
      <div className="flex flex-wrap gap-2">
        <input aria-label="Decklist image link" value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://cdn.starwarsunlimited.com/…Decklist….png"
          className="flex-1 min-w-0 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm" />
        <button type="button" disabled={reading} onClick={readLink} className={`${btn} bg-blue-600 hover:bg-blue-500 text-white`}>
          {reading ? 'Reading…' : 'Read image'}
        </button>
        <label className={`${btn} bg-gray-700 hover:bg-gray-600 cursor-pointer`}>
          Upload image
          <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Decklist image file" className="hidden"
            onChange={(e) => readFile(e.target.files?.[0])} />
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}

      {decks.length > 0 && (
        <>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            Set
            <select aria-label="Deck set" value={setCode} onChange={(e) => setSetCode(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1">
              <option value="">Choose…</option>
              {registry.map((s) => <option key={s.code} value={s.code}>{s.code}{s.name ? ` — ${s.name}` : ''}</option>)}
            </select>
          </label>

          {decks.map((deck, d) => {
            const title = titleCase(titles[d] ?? deck.title);
            const counts = deckCounts(resolved[d].filter((r) => r.card).map((r) => ({ card: r.card, qty: r.line.qty })));
            return (
              <section key={d} aria-label={title} className="rounded-lg border border-gray-700 p-2 space-y-2">
                <input aria-label="Deck name" value={titles[d] ?? deck.title} onChange={(e) => setTitles((t) => ({ ...t, [d]: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-sm font-semibold" />
                <p data-testid="deck-counts" className="text-xs text-gray-400">
                  Leader {counts.leaders} · Base {counts.bases} · Main deck {counts.main}
                </p>
                {counts.main !== 50 && <p className="text-xs text-yellow-300">Main deck has {counts.main} cards (usually 50)</p>}
                <ul className="divide-y divide-gray-700">
                  {resolved[d].map((r) => (
                    <li key={r.key} data-testid="decklist-row" className={`py-1 flex flex-wrap items-center gap-2 text-sm ${r.removed ? 'opacity-40 line-through' : ''}`}>
                      <span className="w-48 shrink-0 text-gray-400">{r.line.number}{r.line.fromPreviousSet ? '*' : ''} {r.line.name} ×{r.line.qty}</span>
                      {r.card && <span className="text-gray-100">{`${r.card.Set} ${String(r.card.Number).padStart(3, '0')} ${r.card.Name}`}</span>}
                      {r.pending && <span className="text-gray-500">Loading cards…</span>}
                      {r.error && !r.removed && (
                        <>
                          <span className="text-red-300">{REASON[r.error]}</span>
                          {r.candidate && (
                            <button type="button" onClick={() => setOverrides((o) => ({ ...o, [r.key]: r.candidate }))} className="text-yellow-300 underline">
                              {`Use ${r.candidate.Set} ${String(r.candidate.Number).padStart(3, '0')} ${r.candidate.Name}`}
                            </button>
                          )}
                          <button type="button" onClick={() => setPicking({ key: r.key, name: r.line.name })} className="text-blue-300 underline">Pick card for {r.line.name}</button>
                          <button type="button" onClick={() => setOverrides((o) => ({ ...o, [r.key]: 'removed' }))} className="text-gray-300 underline">Remove {r.line.name}</button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          <button type="button" disabled={!allResolved || !setCode || saving} onClick={save} className={`${btn} bg-yellow-500 text-black`}>
            Save as review
          </button>
          {saved.map((msg) => <p key={msg} role="status" className="text-sm text-green-300">{msg}</p>)}
        </>
      )}

      {picking && (
        <CardPickerModal collectionData={{}} initialSearch={picking.name}
          onSelect={(card) => { setOverrides((o) => ({ ...o, [picking.key]: card })); setPicking(null); }}
          onClose={() => setPicking(null)} />
      )}
    </section>
  );
}
