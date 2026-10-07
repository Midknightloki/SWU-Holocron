import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../firebase', () => ({ db: {}, APP_ID: 'app' }));
import { upgradeGuest } from '../../services/guestUpgrade';

const guest = { uid: 'guest1', isAnonymous: true };
const auth = { currentUser: guest };
const inUse = Object.assign(new Error('in use'), { code: 'auth/credential-already-in-use' });
let deps;
beforeEach(() => {
  deps = {
    linkWithPopup: vi.fn(async () => ({ user: { ...guest, isAnonymous: false } })),
    credentialFromError: vi.fn(() => ({ token: 't' })),
    signInWithCredential: vi.fn(async () => ({ user: { uid: 'google1', isAnonymous: false } })),
    readCollection: vi.fn(async (uid) => (uid === 'guest1'
      ? { SOR_010_std: { quantity: 2, set: 'SOR', number: '010', name: 'Vader', isFoil: false } }
      : { SOR_010_std: { quantity: 1, set: 'SOR', number: '010', name: 'Vader', isFoil: false } })),
    collectionRefFor: vi.fn((uid) => ({ uid })),
    importToCollection: vi.fn(async () => ({ ok: true, cards: 2, lowered: 0, batchId: 'b1' })),
  };
});

describe('upgradeGuest', () => {
  it('links Google to the guest: same uid, nothing to copy', async () => {
    const res = await upgradeGuest({ auth, provider: {}, deps });
    expect(res.kind).toBe('linked');
    expect(deps.linkWithPopup).toHaveBeenCalledWith(guest, {});
    expect(deps.importToCollection).not.toHaveBeenCalled();
  });

  it('merges the guest cards into an existing Google account, read before switching', async () => {
    deps.linkWithPopup.mockRejectedValue(inUse);
    const order = [];
    deps.readCollection.mockImplementation(async (uid) => { order.push(`read:${uid}`); return uid === 'guest1' ? { SOR_010_std: { quantity: 2, set: 'SOR', number: '010', name: 'Vader', isFoil: false } } : {}; });
    deps.signInWithCredential.mockImplementation(async () => { order.push('signin'); return { user: { uid: 'google1', isAnonymous: false } }; });
    const res = await upgradeGuest({ auth, provider: {}, deps });
    expect(order).toEqual(['read:guest1', 'signin', 'read:google1']);
    expect(res).toMatchObject({ kind: 'merged', cards: 2 });
    expect(deps.importToCollection).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'google1', collectionRef: { uid: 'google1' }, mode: 'add', name: 'Guest collection', source: { type: 'guest' },
      items: [{ set: 'SOR', number: '010', name: 'Vader', quantity: 2, isFoil: false }],
    }));
  });

  it('offers the guest cards as a CSV when copying fails', async () => {
    deps.linkWithPopup.mockRejectedValue(inUse);
    deps.importToCollection.mockResolvedValue({ error: 'offline', written: 0 });
    const res = await upgradeGuest({ auth, provider: {}, deps });
    expect(res.kind).toBe('copy-failed');
    expect(res.csv).toContain('SOR,010,"Vader",2,');
  });

  it('passes other errors (popup closed) through untouched', async () => {
    const closed = Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' });
    deps.linkWithPopup.mockRejectedValue(closed);
    await expect(upgradeGuest({ auth, provider: {}, deps })).rejects.toBe(closed);
    expect(deps.signInWithCredential).not.toHaveBeenCalled();
  });

  it('merges nothing for a guest with an empty collection', async () => {
    deps.linkWithPopup.mockRejectedValue(inUse);
    deps.readCollection.mockResolvedValue({});
    const res = await upgradeGuest({ auth, provider: {}, deps });
    expect(res).toMatchObject({ kind: 'merged', cards: 0 });
    expect(deps.importToCollection).not.toHaveBeenCalled();
  });

  it('stays signed in as the guest when the guest cards cannot be read', async () => {
    deps.linkWithPopup.mockRejectedValue(inUse);
    deps.readCollection.mockRejectedValue(Object.assign(new Error('unavailable'), { code: 'unavailable' }));
    await expect(upgradeGuest({ auth, provider: {}, deps })).rejects.toMatchObject({ code: 'guest-read-failed' });
    expect(deps.signInWithCredential).not.toHaveBeenCalled();
    expect(deps.importToCollection).not.toHaveBeenCalled();
  });
});
