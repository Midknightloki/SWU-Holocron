import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  commitDraft: vi.fn(), cardDetails: vi.fn(), getBulkPrices: vi.fn(),
  appendToBatch: vi.fn(), closeBatch: vi.fn(), setDoc: vi.fn(), getDocs: vi.fn(),
}));
vi.mock('../../firebase', () => ({ db: {}, APP_ID: 'app' }));
vi.mock('firebase/firestore', () => ({
  doc: (db, ...s) => ({ path: s.join('/') }), collection: (db, ...s) => ({ path: s.join('/') }),
  setDoc: m.setDoc, getDocs: m.getDocs, increment: (n) => ({ inc: n }),
}));
vi.mock('../../services/ScanService', () => ({ ScanService: { commitDraft: m.commitDraft, cardDetails: m.cardDetails } }));
vi.mock('../../services/PricingService', () => ({ PricingService: { getBulkPrices: m.getBulkPrices } }));
vi.mock('../../services/BatchService', () => ({ BatchService: { appendToBatch: m.appendToBatch, closeBatch: m.closeBatch } }));

import { addPrebuiltToCollection, PrebuiltAdds } from '../../services/prebuiltAdd';

const PALP = { id: '151901', sourceId: 151901, cards: [{ id: 'ASH_015', qty: 1 }, { id: 'ASH_118', qty: 3 }, { id: 'XYZ_001', qty: 1 }], issues: [{ id: 'XYZ_001', problem: 'unknown-card' }] };
const LUKE = { id: '151902', sourceId: 151902, cards: [{ id: 'ASH_118', qty: 1 }], issues: [] };
let n = 0;
const args = (o = {}) => ({ uid: 'u1', collectionRef: { id: 'ref' }, collectionData: { ASH_015_std: { quantity: 1 } }, decks: [PALP], name: 'Emperor Palpatine Spotlight', pricePaid: 25, now: () => 1000, newId: () => `id${++n}`, ...o });

beforeEach(() => {
  vi.clearAllMocks();
  m.commitDraft.mockImplementation(async () => ({ rows: [] }));
  m.cardDetails.mockImplementation(async (set, number) => ({ name: `${set}-${number}`, type: 'Unit', rarity: 'Common', aspects: [], variant: 'Normal' }));
  m.getBulkPrices.mockResolvedValue({ ASH_118_std: { market: 0.5 } });
  m.appendToBatch.mockResolvedValue({ ok: true });
  m.closeBatch.mockResolvedValue({ ok: true });
  m.setDoc.mockResolvedValue();
});

describe('addPrebuiltToCollection', () => {
  it('adds every standard printing additively and records a finished batch', async () => {
    const res = await addPrebuiltToCollection(args());
    const [draft, ref] = m.commitDraft.mock.calls[0];
    expect(ref).toEqual({ id: 'ref' });
    expect(draft.rows.map(({ set, number, qty, isFoil, status }) => ({ set, number, qty, isFoil, status }))).toEqual([
      { set: 'ASH', number: '015', qty: 1, isFoil: false, status: 'matched' },
      { set: 'ASH', number: '118', qty: 3, isFoil: false, status: 'matched' },
    ]);
    expect(draft.rows[0].name).toBe('ASH-015');
    const [uid, batch, lines] = m.appendToBatch.mock.calls[0];
    expect(uid).toBe('u1');
    expect(batch).toMatchObject({ name: 'Emperor Palpatine Spotlight', pricePaid: 25, createdAt: 1000 });
    expect(lines.find((l) => l.id === 'ASH_015_std')).toMatchObject({ isNew: false, qty: 1, priceAtAdd: null });
    expect(lines.find((l) => l.id === 'ASH_118_std')).toMatchObject({ isNew: true, qty: 3, priceAtAdd: 0.5 });
    expect(m.closeBatch).toHaveBeenCalledWith('u1', batch.id);
    expect(res).toEqual({ ok: true, batchId: batch.id, skipped: ['XYZ_001'] });
  });

  it('skips cards flagged missing and says which', async () => {
    const res = await addPrebuiltToCollection(args());
    expect(m.commitDraft.mock.calls[0][0].rows.some((r) => r.set === 'XYZ')).toBe(false);
    expect(res.skipped).toEqual(['XYZ_001']);
  });

  it('adds several decks as one batch, summing shared cards', async () => {
    await addPrebuiltToCollection(args({ decks: [PALP, LUKE], name: 'Pair' }));
    expect(m.commitDraft.mock.calls[0][0].rows.find((r) => r.number === '118').qty).toBe(4);
    expect(m.setDoc).toHaveBeenCalledTimes(2);
    expect(m.setDoc).toHaveBeenCalledWith({ path: 'artifacts/app/users/u1/prebuiltAdds/151902' }, { addedAt: 1000, count: { inc: 1 } }, { merge: true });
  });

  it('reports a failed collection write without recording a batch', async () => {
    m.commitDraft.mockRejectedValue(new Error('offline'));
    expect(await addPrebuiltToCollection(args())).toEqual({ error: 'offline' });
    expect(m.appendToBatch).not.toHaveBeenCalled();
  });

  it('keeps the cards added when the report cannot be saved', async () => {
    m.appendToBatch.mockResolvedValue({ error: 'offline' });
    const res = await addPrebuiltToCollection(args());
    expect(res).toMatchObject({ error: 'report', batchId: expect.any(String) });
    expect(m.commitDraft).toHaveBeenCalled();
  });
});

describe('PrebuiltAdds.list', () => {
  it('maps deck ids to when they were added', async () => {
    m.getDocs.mockResolvedValue({ docs: [{ id: '151901', data: () => ({ addedAt: 5, count: 2 }) }] });
    expect(await PrebuiltAdds.list('u1')).toEqual({ 151901: { addedAt: 5, count: 2 } });
  });
});
