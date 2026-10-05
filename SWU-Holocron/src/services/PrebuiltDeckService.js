import { collection, deleteField, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { db, APP_ID } from '../firebase';
import { deckApiUrl, findMissingCards, parseDeckApi, parseDeckLink } from '../utils/prebuiltDecks';

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

export const PrebuiltDeckService = {
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

  async addFromLink(text, { fetchImpl = fetch, knownIds }) {
    const id = parseDeckLink(text);
    if (!id) return { error: 'bad-link' };
    try {
      if ((await getDoc(deckRef(id))).exists()) return { error: 'exists' };
      const res = await fetchImpl(deckApiUrl(id));
      const deck = res.ok ? parseDeckApi(await res.json(), id) : null;
      if (!deck) return { error: 'not-found' };
      await setDoc(deckRef(id), {
        ...deck, sourceUpdatedAt: null, typeId: null, issues: findMissingCards(deck.cards, knownIds),
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

  async unpublish(id) {
    try { await updateDoc(deckRef(id), { status: 'review' }); return { ok: true }; } catch (err) { return fail(err); }
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
