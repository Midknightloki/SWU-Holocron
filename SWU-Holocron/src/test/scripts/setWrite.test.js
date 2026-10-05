import { describe, it, expect, vi } from 'vitest';
import { writeSetData } from '../../../scripts/setWrite.js';

function fakeRef(existing) {
  let doc = existing;
  return {
    get doc() { return doc; },
    get: vi.fn(async () => ({ exists: doc !== undefined, data: () => doc })),
    set: vi.fn(async (data) => { doc = data; }),
    update: vi.fn(async (patch) => { doc = { ...doc, ...patch }; }),
  };
}

const CARDS = [{ Set: 'SOR', Number: '001' }];
const args = (o = {}) => ({ setCode: 'SOR', setName: 'Spark of Rebellion', cards: CARDS, dataHash: 'h1', forceUpdate: false, now: () => 5000, ...o });

describe('writeSetData', () => {
  it('writes a new set', async () => {
    const ref = fakeRef(undefined);
    expect(await writeSetData(ref, args())).toEqual({ updated: true, cardCount: 1 });
    expect(ref.doc).toMatchObject({ code: 'SOR', name: 'Spark of Rebellion', totalCards: 1, lastSync: 5000, dataHash: 'h1', cards: CARDS });
  });

  it('records the check on an unchanged set, without rewriting its cards', async () => {
    // Unchanged upstream data used to leave lastSync frozen, so after a week
    // verify flagged every set "older than 7 days" and the weekly sync failed.
    const ref = fakeRef({ code: 'SOR', dataHash: 'h1', lastSync: 1, cards: CARDS });
    expect(await writeSetData(ref, args())).toEqual({ updated: false, cardCount: 1 });
    expect(ref.set).not.toHaveBeenCalled();
    expect(ref.update).toHaveBeenCalledWith({ lastSync: 5000 });
    expect(ref.doc.lastSync).toBe(5000);
  });

  it('rewrites an unchanged set when forced', async () => {
    const ref = fakeRef({ code: 'SOR', dataHash: 'h1', lastSync: 1, cards: [] });
    expect(await writeSetData(ref, args({ forceUpdate: true }))).toEqual({ updated: true, cardCount: 1 });
    expect(ref.set).toHaveBeenCalled();
  });

  it('rewrites a changed set', async () => {
    const ref = fakeRef({ code: 'SOR', dataHash: 'old', lastSync: 1, cards: [] });
    await writeSetData(ref, args());
    expect(ref.doc).toMatchObject({ dataHash: 'h1', lastSync: 5000, cards: CARDS });
  });
});
