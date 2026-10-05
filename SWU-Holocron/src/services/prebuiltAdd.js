import { collection, doc, getDocs, increment, setDoc } from 'firebase/firestore';
import { db, APP_ID } from '../firebase';
import { ScanService } from './ScanService';
import { PricingService } from './PricingService';
import { BatchService } from './BatchService';
import { getCardQuantities, getCollectionId } from '../utils/collectionHelpers';
import { splitCardId } from '../utils/prebuiltDecks';

/**
 * One tap: a prebuilt deck (or every deck in a product) into the collection.
 * The standard printing of each card is added -- increments, like the scanner,
 * never a replace -- and recorded as a finished batch with a report. Cards the
 * deck's review flagged as missing from our database are skipped and named.
 *
 * @environment:firebase
 */
const addsRef = (uid) => collection(db, 'artifacts', APP_ID, 'users', uid, 'prebuiltAdds');

export const PrebuiltAdds = {
  async list(uid) {
    try {
      const snap = await getDocs(addsRef(uid));
      return Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
    } catch {
      return {};
    }
  },
};

export async function addPrebuiltToCollection({
  uid, collectionRef, collectionData = {}, decks, name, pricePaid = null, now = Date.now,
  newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
}) {
  const skipped = new Set();
  const qty = new Map();
  for (const deck of decks) {
    const missing = new Set((deck.issues ?? []).map((i) => i.id));
    for (const c of deck.cards) {
      if (missing.has(c.id)) { skipped.add(c.id); continue; }
      qty.set(c.id, (qty.get(c.id) ?? 0) + c.qty);
    }
  }
  const cards = [...qty].map(([id, n]) => ({ ...splitCardId(id), qty: n })).filter((c) => c.set);
  const details = await Promise.all(cards.map((c) => ScanService.cardDetails(c.set, c.number)));

  const draft = {
    rows: cards.map((c, i) => ({
      id: newId(), status: 'matched', set: c.set, number: c.number,
      name: details[i]?.name ?? `${c.set} ${c.number}`, type: details[i]?.type ?? null, isFoil: false, qty: c.qty,
    })),
  };
  try {
    await ScanService.commitDraft(draft, collectionRef);
  } catch (err) {
    return { error: err?.message ?? 'unknown' };
  }

  const prices = await PricingService.getBulkPrices(cards.map((c) => ({
    cardId: getCollectionId(c.set, c.number, false), set: c.set, number: c.number, isFoil: false,
  }))).catch(() => ({}));
  const lines = cards.map((c, i) => {
    const id = getCollectionId(c.set, c.number, false);
    return {
      id, set: c.set, number: c.number, name: draft.rows[i].name,
      type: details[i]?.type ?? null, rarity: details[i]?.rarity ?? null, aspects: details[i]?.aspects ?? [],
      variant: details[i]?.variant ?? null, isFoil: false, qty: c.qty,
      isNew: getCardQuantities(collectionData, c.set, c.number).total === 0,
      priceAtAdd: typeof prices?.[id]?.market === 'number' ? prices[id].market : null,
      priceIsFallback: Boolean(prices?.[id]?.isFallback),
    };
  });

  const batch = { id: newId(), name, pricePaid, createdAt: now() };
  await Promise.all(decks.map((d) => setDoc(doc(db, 'artifacts', APP_ID, 'users', uid, 'prebuiltAdds', String(d.sourceId ?? d.id)), { addedAt: now(), count: increment(1) }, { merge: true }).catch(() => {})));
  const appended = await BatchService.appendToBatch(uid, batch, lines);
  if (appended?.error) return { error: 'report', batchId: batch.id, skipped: [...skipped] };
  await BatchService.closeBatch(uid, batch.id);
  return { ok: true, batchId: batch.id, skipped: [...skipped] };
}
