import { doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { ScanService, COMMIT_CHUNK_SIZE } from './ScanService';
import { PricingService } from './PricingService';
import { BatchService } from './BatchService';
import { getCardQuantities, getCollectionId } from '../utils/collectionHelpers';

/**
 * A CSV import, recorded as a batch with a report like a scanned box.
 * 'add' adds quantities (like scanning); 'replace' sets each card to the
 * file's number, and its batch holds only what went up -- what went down is
 * listed as reductions. Never throws.
 *
 * @environment:firebase
 */

// Today's import write: set each card's quantity, 400 to a batch.
async function writeQuantities(collectionRef, writes, { onChunk = () => {} } = {}) {
  for (let i = 0; i < writes.length; i += COMMIT_CHUNK_SIZE) {
    const chunk = writes.slice(i, i + COMMIT_CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const w of chunk) {
      batch.set(doc(collectionRef, w.id), {
        quantity: w.quantity, set: w.set, number: w.number, name: w.name, isFoil: w.isFoil, timestamp: Date.now(),
      }, { merge: true });
    }
    await batch.commit();
    onChunk(chunk.reduce((s, w) => s + w.quantity, 0));
  }
}

const defaultId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export async function importToCollection({
  uid, collectionRef, collectionData = {}, items, mode, name, pricePaid = null, file = null, source = null, deps = {},
}) {
  const {
    commit = (d, r, o) => ScanService.commitDraft(d, r, o), writeQuantities: write = writeQuantities,
    cardDetails = (s, n) => ScanService.cardDetails(s, n), pricing = PricingService, batches = BatchService,
    now = Date.now, newId = defaultId,
  } = deps;

  const batchId = newId();

  // One entry per card and finish; a card on two rows is summed.
  const byId = new Map();
  for (const it of items ?? []) {
    const id = getCollectionId(it.set, it.number, it.isFoil);
    const prev = byId.get(id);
    byId.set(id, prev ? { ...prev, quantity: prev.quantity + it.quantity } : { ...it, id, number: String(it.number) });
  }
  const entries = [...byId.values()];
  const owned = (id) => Number(collectionData?.[id]?.quantity) || 0;

  const increases = [];
  const reductions = [];
  for (const e of entries) {
    const delta = mode === 'replace' ? e.quantity - owned(e.id) : e.quantity;
    if (delta > 0) increases.push({ ...e, delta });
    if (mode === 'replace' && delta < 0) {
      reductions.push({ id: e.id, set: e.set, number: e.number, name: e.name, isFoil: e.isFoil, from: owned(e.id), to: e.quantity });
    }
  }
  if (mode === 'replace' && increases.length === 0 && reductions.length === 0) return { nothing: true };

  // Write.
  let written = 0;
  try {
    if (mode === 'replace') {
      const changed = entries.filter((e) => e.quantity !== owned(e.id));
      await write(collectionRef, changed, { onChunk: (n) => { written += n; } });
    } else {
      const draft = {
        rows: increases.map((e) => ({ id: newId(), status: 'matched', set: e.set, number: e.number, name: e.name, type: null, isFoil: e.isFoil, qty: e.delta })),
      };
      const total = increases.reduce((s, e) => s + e.delta, 0);
      await commit(draft, collectionRef, {
        onProgress: (remaining) => { written = total - remaining.rows.reduce((s, r) => s + r.qty, 0); },
      });
    }
  } catch (err) {
    return { error: err?.message ?? 'unknown', written };
  }

  const cards = increases.reduce((s, e) => s + e.delta, 0);
  if (!uid) return { ok: true, cards, lowered: reductions.length };

  // The report: details, today's price and whether each card is new.
  const details = await Promise.all(increases.map((e) => cardDetails(e.set, e.number)));
  const prices = await pricing.getBulkPrices(increases.map((e) => ({ cardId: e.id, set: e.set, number: e.number, isFoil: e.isFoil })))
    .catch(() => ({}));
  const lines = increases.map((e, i) => ({
    id: e.id, set: e.set, number: e.number, name: details[i]?.name ?? e.name,
    type: details[i]?.type ?? null, rarity: details[i]?.rarity ?? null, aspects: details[i]?.aspects ?? [],
    variant: details[i]?.variant ?? null, isFoil: e.isFoil, qty: e.delta,
    isNew: getCardQuantities(collectionData, e.set, e.number).total === 0,
    priceAtAdd: typeof prices?.[e.id]?.market === 'number' ? prices[e.id].market : null,
    priceIsFallback: Boolean(prices?.[e.id]?.isFallback),
  }));

  const batch = { id: batchId, name, pricePaid, createdAt: now() };
  const appended = await batches.appendToBatch(uid, batch, lines);
  if (appended?.error) return { error: 'report', cards, batchId: batch.id };
  await batches.closeBatch(uid, batch.id, { source: source ?? { type: 'import', mode, file }, reductions });
  return { ok: true, cards, lowered: reductions.length, batchId: batch.id };
}
