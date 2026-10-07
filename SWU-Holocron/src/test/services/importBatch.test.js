import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../firebase', () => ({ db: {}, APP_ID: 'app' }));
import { importToCollection, makeCardDetails } from '../../services/importBatch';

const item = (o) => ({ set: 'SOR', number: '010', name: 'Vader', quantity: 1, isFoil: false, ...o });
let deps;
let ids;
beforeEach(() => {
  ids = 0;
  deps = {
    commit: vi.fn(async () => ({ rows: [] })),
    writeQuantities: vi.fn(async () => {}),
    cardDetails: vi.fn(async (set, number) => ({ name: `Card ${number}`, type: 'Unit', rarity: 'Rare', aspects: ['Villainy'], variant: 'Normal' })),
    pricing: { getBulkPrices: vi.fn(async () => ({ SOR_010_std: { market: 2 } })) },
    batches: { appendToBatch: vi.fn(async () => ({ ok: true })), closeBatch: vi.fn(async () => ({ ok: true })) },
    now: () => 100,
    newId: () => `id${++ids}`,
  };
});
const run = (o) => importToCollection({ uid: 'u1', collectionRef: { id: 'ref' }, collectionData: {}, name: 'Import box', file: 'box.csv', deps, ...o });

describe('importToCollection — add', () => {
  it('adds every card, summing rows for the same card, and files a closed batch', async () => {
    const res = await run({ mode: 'add', items: [item({ quantity: 2 }), item({ quantity: 1 }), item({ number: '020', isFoil: true })] });
    expect(res).toEqual({ ok: true, cards: 4, lowered: 0, batchId: 'id1' });
    const draft = deps.commit.mock.calls[0][0];
    expect(draft.rows.map((r) => [r.set, r.number, r.isFoil, r.qty])).toEqual([['SOR', '010', false, 3], ['SOR', '020', true, 1]]);
    const [uid, batch, lines] = deps.batches.appendToBatch.mock.calls[0];
    expect(uid).toBe('u1');
    expect(batch).toEqual({ id: 'id1', name: 'Import box', pricePaid: null, createdAt: 100 });
    expect(lines[0]).toMatchObject({ id: 'SOR_010_std', qty: 3, isNew: true, priceAtAdd: 2, type: 'Unit', rarity: 'Rare' });
    expect(lines[1]).toMatchObject({ id: 'SOR_020_foil', qty: 1, priceAtAdd: null });
    expect(deps.batches.closeBatch).toHaveBeenCalledWith('u1', 'id1', { source: { type: 'import', mode: 'add', file: 'box.csv' }, reductions: [] });
  });

  it('marks cards already owned (any finish) as not new', async () => {
    await run({ mode: 'add', items: [item()], collectionData: { SOR_010_foil: { quantity: 1 } } });
    expect(deps.batches.appendToBatch.mock.calls[0][2][0].isNew).toBe(false);
  });

  it('reports how many cards landed when the commit fails part-way, and files no batch', async () => {
    deps.commit.mockImplementation(async (draft, ref, { onProgress }) => {
      onProgress({ rows: draft.rows.slice(1) });
      throw new Error('offline');
    });
    const res = await run({ mode: 'add', items: [item({ quantity: 2 }), item({ number: '020', quantity: 5 })] });
    expect(res).toEqual({ error: 'offline', written: 2 });
    expect(deps.batches.appendToBatch).not.toHaveBeenCalled();
  });
});

describe('importToCollection — replace', () => {
  const owned = { SOR_010_std: { quantity: 1 }, SOR_020_std: { quantity: 4 }, SOR_030_std: { quantity: 2 } };

  it('records increases as the batch and decreases as reductions', async () => {
    const res = await run({
      mode: 'replace', collectionData: owned,
      items: [item({ quantity: 3 }), item({ number: '020', name: 'Luke', quantity: 1 }), item({ number: '030', quantity: 2 })],
    });
    expect(res).toEqual({ ok: true, cards: 2, lowered: 1, batchId: 'id1' });
    expect(deps.writeQuantities.mock.calls[0][1].map((w) => [w.id, w.quantity])).toEqual([['SOR_010_std', 3], ['SOR_020_std', 1]]);
    const lines = deps.batches.appendToBatch.mock.calls[0][2];
    expect(lines.map((l) => [l.id, l.qty, l.isNew])).toEqual([['SOR_010_std', 2, false]]);
    expect(deps.batches.closeBatch.mock.calls[0][2].reductions).toEqual([
      { id: 'SOR_020_std', set: 'SOR', number: '020', name: 'Luke', isFoil: false, from: 4, to: 1 },
    ]);
  });

  it('changes nothing and files nothing when the collection already matches', async () => {
    const res = await run({ mode: 'replace', collectionData: owned, items: [item({ quantity: 1 })] });
    expect(res).toEqual({ nothing: true });
    expect(deps.writeQuantities).not.toHaveBeenCalled();
    expect(deps.batches.appendToBatch).not.toHaveBeenCalled();
  });

  it('reports cards written before a failure', async () => {
    deps.writeQuantities.mockImplementation(async (ref, writes, { onChunk }) => { onChunk(1); throw new Error('offline'); });
    expect(await run({ mode: 'replace', items: [item({ quantity: 2 })] })).toEqual({ error: 'offline', written: 1 });
  });
});

describe('importToCollection — other', () => {
  it('imports without a report when there is no uid (legacy sync path)', async () => {
    const res = await run({ uid: undefined, mode: 'add', items: [item()] });
    expect(res).toEqual({ ok: true, cards: 1, lowered: 0 });
    expect(deps.batches.appendToBatch).not.toHaveBeenCalled();
  });

  it('keeps the cards when only the report fails', async () => {
    deps.batches.appendToBatch.mockResolvedValue({ error: 'offline' });
    expect(await run({ mode: 'add', items: [item()] })).toEqual({ error: 'report', cards: 1, batchId: 'id1' });
  });

  it('uses a given source (guest merge)', async () => {
    await run({ mode: 'add', items: [item()], source: { type: 'guest' } });
    expect(deps.batches.closeBatch.mock.calls[0][2].source).toEqual({ type: 'guest' });
  });
});

describe('makeCardDetails', () => {
  it('reads each set once through the set cache, and skips legacy buckets', async () => {
    const loadSetImpl = vi.fn(async () => ({ cards: [{ Number: 10, Name: 'Vader', Type: 'Leader', Rarity: 'Rare', Aspects: ['Villainy'], VariantType: 'Normal' }] }));
    const details = makeCardDetails(loadSetImpl);
    expect(await details('SOR', '010')).toEqual({ name: 'Vader', type: 'Leader', rarity: 'Rare', aspects: ['Villainy'], variant: 'Normal' });
    expect(await details('SOR', '999')).toBeNull();
    expect(await details('PROMO', '001')).toBeNull();
    expect(loadSetImpl).toHaveBeenCalledTimes(1);
    expect(loadSetImpl).toHaveBeenCalledWith('SOR');
  });

  it('never throws when a set will not load', async () => {
    const details = makeCardDetails(async () => { throw new Error('offline'); });
    expect(await details('SHD', '001')).toBeNull();
  });
});
