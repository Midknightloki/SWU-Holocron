import React, { useCallback, useEffect, useState } from 'react';
import { PrebuiltDeckService } from '../services/PrebuiltDeckService';
import { loadSet } from '../services/setLoader';
import { knownIdsFrom } from '../utils/prebuiltDecks';
import DecklistImageImport from './DecklistImageImport';

/**
 * Admin review of prebuilt (precon) decks. The weekly sync brings in the
 * sw-unlimited-db owner's new decks as "review"; an admin links each to its
 * product and publishes it, or marks it "not a precon". Older products are
 * backfilled by pasting a deck link.
 */
const LINK_ERRORS = {
  'bad-link': "That isn't a sw-unlimited-db deck link.",
  exists: 'That deck is already here.',
  'not-found': 'No published deck at that link.',
};

// The card ids of just the sets a deck uses (through the app's IndexedDB
// cache), so its unknown cards can be flagged. A set that won't load is left
// unchecked rather than having all its cards flagged missing.
async function defaultLoadKnownIds(setCodes) {
  const known = new Set();
  const checkedSets = new Set();
  await Promise.all(setCodes.map(async (code) => {
    try {
      const { cards } = await loadSet(code);
      for (const id of knownIdsFrom(cards)) known.add(id);
      checkedSets.add(code);
    } catch {
      // Unchecked: the weekly sync rechecks every deck anyway.
    }
  }));
  return { known, checkedSets };
}

const countCards = (cards) => (cards ?? []).reduce((s, c) => s + c.qty, 0);

export default function AdminPrebuiltDecks({ uid, loadKnownIds = defaultLoadKnownIds }) {
  const [decks, setDecks] = useState([]);
  const [products, setProducts] = useState([]);
  const [names, setNames] = useState({});
  const [chosen, setChosen] = useState({});
  const [link, setLink] = useState('');
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  // The deck whose Publish is waiting on "publish anyway" (it has missing cards).
  const [confirming, setConfirming] = useState(null);

  const load = useCallback(async () => {
    const [list, prods] = await Promise.all([PrebuiltDeckService.listDecks(), PrebuiltDeckService.listProducts()]);
    setDecks(Array.isArray(list) ? list : []);
    setProducts(prods ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const productFor = (deck) => {
    const id = chosen[deck.id] ?? String(deck.product?.tcgplayerProductId ?? deck.suggestedProduct?.tcgplayerProductId ?? '');
    return products.find((p) => String(p.tcgplayerProductId) === id) ?? null;
  };

  const run = async (action) => {
    setBusy(true);
    setMessage(null);
    const res = await action();
    if (res?.error) setMessage(`That didn't save: ${res.error}`);
    await load();
    setBusy(false);
  };

  const fetchDeck = async () => {
    setBusy(true);
    setMessage(null);
    const res = await PrebuiltDeckService.addFromLink(link, { loadKnownIds });
    if (res?.error) setMessage(LINK_ERRORS[res.error] ?? `Couldn't add that deck: ${res.error}`);
    else setLink('');
    await load();
    setBusy(false);
  };

  const card = (deck) => {
    const label = deck.sourceName;
    const product = productFor(deck);
    // A changed deck is judged by what accepting it would bring in.
    const issues = deck.status === 'changed' ? deck.pending?.issues ?? [] : deck.issues ?? [];
    const publish = () => run(() => PrebuiltDeckService.publish(deck.id, { product, name: names[deck.id] ?? deck.name ?? label }, uid));
    return (
      <li key={deck.id} className="rounded-xl bg-gray-800 border border-gray-700 p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-white">{label}</span>
          {deck.status === 'changed' && <span className="text-xs px-2 py-0.5 rounded bg-yellow-600/30 text-yellow-300">Changed at source</span>}
          <span className="text-xs text-gray-400">{countCards(deck.cards)} cards</span>
          {deck.status === 'changed' && deck.pending && (
            <span className="text-xs text-gray-400">→ {countCards(deck.pending.cards)} cards after the change</span>
          )}
        </div>
        {issues.length > 0 && (
          <p className="text-xs text-red-300">Not in our database: {issues.map((i) => i.id).join(', ')}</p>
        )}
        {/* Only a deck under review has anything to save: Publish sends these. */}
        {deck.status === 'review' && (
          <div className="flex flex-wrap gap-2">
            <input
              aria-label={`Display name for ${label}`}
              value={names[deck.id] ?? deck.name ?? label}
              onChange={(e) => setNames((n) => ({ ...n, [deck.id]: e.target.value }))}
              className="flex-1 min-w-[12rem] bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm"
            />
            <select
              aria-label={`Product for ${label}`}
              value={product ? String(product.tcgplayerProductId) : ''}
              onChange={(e) => setChosen((c) => ({ ...c, [deck.id]: e.target.value }))}
              className="flex-1 min-w-[12rem] bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm"
            >
              <option value="">No product</option>
              {products.map((p) => (
                <option key={p.tcgplayerProductId} value={String(p.tcgplayerProductId)}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-wrap gap-2 text-sm">
          {deck.status === 'review' && (
            confirming === deck.id ? (
              <>
                <span className="text-yellow-300">
                  {issues.length} {issues.length === 1 ? "card isn't" : "cards aren't"} in our database and will be skipped when added.
                </span>
                <button type="button" disabled={busy} aria-label={`Publish anyway: ${label}`}
                  onClick={() => { setConfirming(null); publish(); }}
                  className="px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white font-semibold">Publish anyway</button>
                <button type="button" onClick={() => setConfirming(null)} className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600">Cancel</button>
              </>
            ) : (
              <button type="button" disabled={busy} aria-label={`Publish ${label}`}
                onClick={() => (issues.length ? setConfirming(deck.id) : publish())}
                className="px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white font-semibold">Publish</button>
            )
          )}
          {deck.status === 'changed' && (
            <button type="button" disabled={busy} aria-label={`Accept changes to ${label}`}
              onClick={() => run(() => PrebuiltDeckService.acceptChanges(deck.id))}
              className="px-3 py-1.5 rounded-lg bg-yellow-600 hover:bg-yellow-500 text-white font-semibold">Accept changes</button>
          )}
          {(deck.status === 'review' || deck.status === 'changed') && (
            <button type="button" disabled={busy} aria-label={`Not a precon: ${label}`}
              onClick={() => run(() => PrebuiltDeckService.ignore(deck.id))}
              className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600">Not a precon</button>
          )}
          {(deck.status === 'published' || deck.status === 'changed') && (
            <button type="button" disabled={busy} aria-label={`Unpublish ${label}`}
              onClick={() => run(() => PrebuiltDeckService.unpublish(deck.id))}
              className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600">Unpublish</button>
          )}
          {deck.status === 'ignored' && (
            <button type="button" disabled={busy} aria-label={`Restore ${label} to review`}
              onClick={() => run(() => PrebuiltDeckService.unpublish(deck.id))}
              className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600">Restore to review</button>
          )}
        </div>
      </li>
    );
  };

  const review = decks.filter((d) => d.status === 'review' || d.status === 'changed');
  const published = decks.filter((d) => d.status === 'published');
  const ignored = decks.filter((d) => d.status === 'ignored');

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-gray-800 border border-gray-700 p-3 space-y-2">
        <p className="text-sm text-gray-300">
          New precons arrive with the weekly card sync. For an older product, paste its sw-unlimited-db deck link.
        </p>
        <div className="flex gap-2">
          <input
            aria-label="sw-unlimited-db deck link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://sw-unlimited-db.com/decks/151901"
            className="flex-1 min-w-0 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm"
          />
          <button type="button" disabled={busy} onClick={fetchDeck} className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold">
            Fetch deck
          </button>
        </div>
        {message && <p className="text-sm text-red-300">{message}</p>}
      </div>

      <DecklistImageImport onSaved={load} />

      <section aria-labelledby="prebuilt-review" className="space-y-2">
        <h3 id="prebuilt-review" className="text-lg font-bold text-white">Needs review</h3>
        {review.length === 0 ? <p className="text-sm text-gray-500">Nothing to review.</p> : <ul className="space-y-2">{review.map(card)}</ul>}
      </section>

      <section aria-labelledby="prebuilt-published" className="space-y-2">
        <h3 id="prebuilt-published" className="text-lg font-bold text-white">Published</h3>
        {published.length === 0 ? <p className="text-sm text-gray-500">None yet.</p> : <ul className="space-y-2">{published.map(card)}</ul>}
      </section>

      {ignored.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-gray-400">Not precons ({ignored.length})</summary>
          <ul className="space-y-2 mt-2">{ignored.map(card)}</ul>
        </details>
      )}
    </div>
  );
}
