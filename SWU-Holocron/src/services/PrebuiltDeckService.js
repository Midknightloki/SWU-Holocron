import { collection, deleteField, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db, APP_ID } from '../firebase';
import { deckApiUrl, findMissingCards, parseDeckApi, parseDeckLink, splitCardId } from '../utils/prebuiltDecks';

/**
 * Prebuilt (precon) decks: admin review and publishing, and the published
 * list collectors add from. Decks arrive from the weekly sync, or from a
 * pasted sw-unlimited-db link (its deck API allows browser requests).
 * Never throws.
 *
 * @environment:firebase
 */
const decksRef = () => collection(db, 'artifacts', APP_ID, 'public', 'data', 'prebuiltDecks');
const deckRef = (id) => doc(db, 'artifacts', APP_ID, 'public', 'data', 'prebuiltDecks', String(id));
const fail = (err) => ({ error: err?.message ?? 'unknown' });
const rows = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

// `loadKnownIds(setCodes)` resolves to the card ids of those sets: a Set (every
// set checked), `{ known, checkedSets }` (some sets failed to load), or null
// (nothing could be checked). Only cards from a checked set can be flagged --
// a set that failed to load must not mark its cards missing.
function issuesFor(cards, loaded, setCodes) {
  if (!loaded) return [];
  const known = loaded instanceof Set ? loaded : loaded.known;
  const checked = loaded instanceof Set ? new Set(setCodes) : loaded.checkedSets;
  return findMissingCards(cards.filter((c) => checked.has(splitCardId(c.id)?.set)), known);
}

export const PrebuiltDeckService = {
  /** An official decklist image, read by the readDecklist function (admins). */
  async readDecklistImage(input, { callable } = {}) {
    try {
      const call = callable ?? httpsCallable(getFunctions(), 'readDecklist');
      const res = await call(input);
      return { decks: res?.data?.decks ?? [] };
    } catch (err) {
      return { error: err?.message || "Couldn't read the decklist." };
    }
  },

  /** A deck resolved from a decklist image, saved for review. Never overwrites. */
  async addFromImage(deck, { url = null, setCode }) {
    try {
      if ((await getDoc(deckRef(deck.sourceId))).exists()) return { error: 'exists' };
      await setDoc(deckRef(deck.sourceId), {
        ...deck, issues: [], sourceUpdatedAt: null, typeId: null, suggestedProduct: null, product: null,
        name: deck.sourceName, status: 'review', fetchedAt: new Date().toISOString(),
        source: { type: 'image', url, setCode },
      });
      return { ok: true, id: deck.sourceId };
    } catch (err) {
      return fail(err);
    }
  },

  async listDecks() {
    try { return rows(await getDocs(decksRef())); } catch (err) { return fail(err); }
  },

  async listPublished() {
    try { return rows(await getDocs(query(decksRef(), where('status', 'in', ['published', 'changed'])))); } catch (err) { return fail(err); }
  },

  async listProducts() {
    try {
      const snap = await getDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'cardDatabase', 'preconProducts'));
      return snap.exists() ? snap.data().products ?? [] : [];
    } catch {
      return [];
    }
  },

  async addFromLink(text, { fetchImpl = fetch, loadKnownIds }) {
    const id = parseDeckLink(text);
    if (!id) return { error: 'bad-link' };
    try {
      if ((await getDoc(deckRef(id))).exists()) return { error: 'exists' };
      const res = await fetchImpl(deckApiUrl(id));
      const deck = res.ok ? parseDeckApi(await res.json(), id) : null;
      if (!deck) return { error: 'not-found' };
      const setCodes = [...new Set(deck.cards.map((c) => splitCardId(c.id)?.set).filter(Boolean))];
      const loaded = await loadKnownIds(setCodes).catch(() => null);
      await setDoc(deckRef(id), {
        ...deck, sourceUpdatedAt: null, typeId: null, issues: issuesFor(deck.cards, loaded, setCodes),
        suggestedProduct: null, product: null, name: deck.sourceName, status: 'review', fetchedAt: new Date().toISOString(),
      });
      return { ok: true, id };
    } catch (err) {
      return fail(err);
    }
  },

  async publish(id, { product = null, name }, uid) {
    try {
      await updateDoc(deckRef(id), { status: 'published', product, ...(name ? { name } : {}), publishedAt: Date.now(), publishedBy: uid });
      return { ok: true };
    } catch (err) { return fail(err); }
  },

  async ignore(id) {
    try { await updateDoc(deckRef(id), { status: 'ignored' }); return { ok: true }; } catch (err) { return fail(err); }
  },

  // Back to review. A changed deck takes its newer source list with it: a
  // deck under review always shows the latest contents.
  async unpublish(id) {
    try {
      const snap = await getDoc(deckRef(id));
      const pending = snap.exists() ? snap.data().pending : null;
      await updateDoc(deckRef(id), pending ? { ...pending, pending: deleteField(), status: 'review' } : { status: 'review' });
      return { ok: true };
    } catch (err) { return fail(err); }
  },

  async acceptChanges(id) {
    try {
      const snap = await getDoc(deckRef(id));
      const pending = snap.exists() ? snap.data().pending : null;
      if (!pending) return { error: 'nothing-pending' };
      await updateDoc(deckRef(id), { ...pending, pending: deleteField(), status: 'published' });
      return { ok: true };
    } catch (err) { return fail(err); }
  },
};
