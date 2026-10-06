/**
 * Firestore security-rules tests.
 *
 * Requires the Firestore emulator: `npm run test:rules`.
 *
 * WHY THESE EXIST
 *
 * Rules were deployed by hand and drifted for eight months. The live ruleset
 * (deployed 2026-01-24) carried three match blocks while firestore.rules in git
 * carried seven, so six features were denied in production while the repo
 * looked correct:
 *
 *   public/decks       public deck sharing      rule in repo, never deployed
 *   shells             contributor content      rule in repo, never deployed
 *   packets            contributor content      rule in repo, never deployed
 *   contributorInvites contributor promotion    rule in repo, never deployed
 *   submissions        card submission          missing from BOTH
 *   admin/sync/logs    admin sync log view      missing from BOTH
 *
 * These tests are written against intended behaviour, so the broken paths fail
 * until the rules are fixed. They then run in CI, which is what stops the file
 * and reality diverging again.
 */

import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, updateDoc, collection, getDocs } from 'firebase/firestore';

const APP_ID = 'swu-holocron-v1';
const p = (...segments) => ['artifacts', APP_ID, ...segments].join('/');

let testEnv;

/** Seed a profile document, bypassing rules, so isAdmin/isContributor resolve. */
async function seedProfile(uid, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), p('users', uid)), data);
  });
}

async function seedDoc(path, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'swu-holocron-rules-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      // 8085 rather than the 8080 default: that port is commonly occupied
      // on a dev machine. Must match the emulators block in firebase.json.
      port: 8085,
    },
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedProfile('admin-uid', { isAdmin: true });
  await seedProfile('contributor-uid', { isContributor: true });
  await seedProfile('plain-uid', {});
});

const asUser = (uid) => testEnv.authenticatedContext(uid).firestore();
const asGuest = () => testEnv.unauthenticatedContext().firestore();

describe('user-scoped collection', () => {
  it('lets a user read and write their own collection', async () => {
    const db = asUser('plain-uid');
    await assertSucceeds(setDoc(doc(db, p('users', 'plain-uid', 'collection', 'SOR_001_std')), { quantity: 3 }));
    await assertSucceeds(getDoc(doc(db, p('users', 'plain-uid', 'collection', 'SOR_001_std'))));
  });

  it('denies access to another user’s collection', async () => {
    const db = asUser('plain-uid');
    await assertFails(getDoc(doc(db, p('users', 'other-uid', 'collection', 'SOR_001_std'))));
    await assertFails(setDoc(doc(db, p('users', 'other-uid', 'collection', 'SOR_001_std')), { quantity: 3 }));
  });

  it('denies an unauthenticated visitor', async () => {
    await assertFails(getDoc(doc(asGuest(), p('users', 'plain-uid', 'collection', 'SOR_001_std'))));
  });
});

describe('card database', () => {
  beforeEach(async () => {
    await seedDoc(p('public', 'data', 'cardDatabase', 'sets'), { sets: [{ code: 'SOR' }] });
  });

  it('is readable by any authenticated user', async () => {
    await assertSucceeds(getDoc(doc(asUser('plain-uid'), p('public', 'data', 'cardDatabase', 'sets'))));
  });

  it('is never writable from a client, even by an admin', async () => {
    // The seeder writes via the Admin SDK, which bypasses rules entirely.
    await assertFails(setDoc(doc(asUser('admin-uid'), p('public', 'data', 'cardDatabase', 'sets')), { sets: [] }));
  });
});

describe('prebuilt decks', () => {
  beforeEach(async () => {
    await seedDoc(p('public', 'data', 'prebuiltDecks', '151901'), { status: 'published', name: 'X' });
  });

  it('is readable by any signed-in user, not by a signed-out visitor', async () => {
    await assertSucceeds(getDoc(doc(asUser('plain-uid'), p('public', 'data', 'prebuiltDecks', '151901'))));
    await assertFails(getDoc(doc(asGuest(), p('public', 'data', 'prebuiltDecks', '151901'))));
  });

  it('is writable by an admin only', async () => {
    await assertSucceeds(setDoc(doc(asUser('admin-uid'), p('public', 'data', 'prebuiltDecks', '1')), { status: 'review' }));
    await assertFails(setDoc(doc(asUser('plain-uid'), p('public', 'data', 'prebuiltDecks', '1')), { status: 'review' }));
  });
});

describe('public decks', () => {
  it('lets the owner publish their own deck', async () => {
    const db = asUser('plain-uid');
    await assertSucceeds(setDoc(doc(db, p('publicDecks', 'abc12345')), { uid: 'plain-uid', name: 'My Deck' }));
  });

  it('lets anyone read a shared deck, including a signed-out visitor', async () => {
    await seedDoc(p('publicDecks', 'abc12345'), { uid: 'plain-uid', name: 'My Deck' });
    await assertSucceeds(getDoc(doc(asGuest(), p('publicDecks', 'abc12345'))));
  });

  it('stops a user publishing a deck under someone else’s uid', async () => {
    const db = asUser('plain-uid');
    await assertFails(setDoc(doc(db, p('publicDecks', 'abc12345')), { uid: 'other-uid', name: 'Not Mine' }));
  });

  it('stops a user deleting someone else’s deck', async () => {
    await seedDoc(p('publicDecks', 'abc12345'), { uid: 'other-uid', name: 'Theirs' });
    await assertFails(deleteDoc(doc(asUser('plain-uid'), p('publicDecks', 'abc12345'))));
  });

  it('stops a user taking over someone else’s shared deck', async () => {
    await seedDoc(p('publicDecks', 'abc12345'), { uid: 'other-uid', name: 'Theirs' });
    await assertFails(setDoc(doc(asUser('plain-uid'), p('publicDecks', 'abc12345')), { uid: 'plain-uid', name: 'Mine now' }));
  });

  it('still lets the owner update their shared deck', async () => {
    await seedDoc(p('publicDecks', 'abc12345'), { uid: 'plain-uid', name: 'Mine' });
    await assertSucceeds(setDoc(doc(asUser('plain-uid'), p('publicDecks', 'abc12345')), { uid: 'plain-uid', name: 'Renamed' }));
  });
});

describe('public lists', () => {
  const L = (uid) => ({ uid, kind: 'trade', name: 'Dupes', showPrices: false, lines: [], cards: 0, updatedAt: 1 });

  it('lets anyone read a shared list, including a signed-out visitor', async () => {
    await seedDoc(p('publicLists', 'abcd2345'), L('plain-uid'));
    await assertSucceeds(getDoc(doc(asGuest(), p('publicLists', 'abcd2345'))));
  });

  it('lets the owner share, update and stop sharing', async () => {
    const db = asUser('plain-uid');
    await assertSucceeds(setDoc(doc(db, p('publicLists', 'abcd2345')), L('plain-uid')));
    await assertSucceeds(setDoc(doc(db, p('publicLists', 'abcd2345')), { ...L('plain-uid'), name: 'New' }));
    await assertSucceeds(deleteDoc(doc(db, p('publicLists', 'abcd2345'))));
  });

  it('stops sharing under someone else’s uid', async () => {
    await assertFails(setDoc(doc(asUser('plain-uid'), p('publicLists', 'abcd2345')), L('other-uid')));
  });

  it('stops a user taking over someone else’s shared list', async () => {
    await seedDoc(p('publicLists', 'abcd2345'), L('other-uid'));
    await assertFails(setDoc(doc(asUser('plain-uid'), p('publicLists', 'abcd2345')), L('plain-uid')));
  });

  it('stops a user deleting someone else’s shared list', async () => {
    await seedDoc(p('publicLists', 'abcd2345'), L('other-uid'));
    await assertFails(deleteDoc(doc(asUser('plain-uid'), p('publicLists', 'abcd2345'))));
  });

  it('stops a signed-out visitor sharing', async () => {
    await assertFails(setDoc(doc(asGuest(), p('publicLists', 'abcd2345')), L('plain-uid')));
  });

  it('lets the owner delete a list whose shared copy is already gone', async () => {
    await assertSucceeds(deleteDoc(doc(asUser('plain-uid'), p('publicLists', 'gone2345'))));
  });

  it('never recreates a stopped copy through an update', async () => {
    await assertFails(updateDoc(doc(asUser('plain-uid'), p('publicLists', 'gone2345')), { name: 'Back' }));
  });

  it('refuses to list every shared list or deck', async () => {
    await seedDoc(p('publicLists', 'abcd2345'), L('plain-uid'));
    await assertFails(getDocs(collection(asGuest(), p('publicLists'))));
    await assertFails(getDocs(collection(asUser('plain-uid'), p('publicLists'))));
    await assertFails(getDocs(collection(asGuest(), p('publicDecks'))));
  });

  it('refuses vanity codes and unexpected content', async () => {
    const db = asUser('plain-uid');
    await assertFails(setDoc(doc(db, p('publicLists', 'free-packs-giveaway')), L('plain-uid')));
    await assertFails(setDoc(doc(db, p('publicLists', 'abcd2345')), { ...L('plain-uid'), link: 'https://evil.example' }));
    await assertFails(setDoc(doc(db, p('publicLists', 'abcd2345')), { ...L('plain-uid'), kind: 'scam' }));
    await assertFails(setDoc(doc(db, p('publicLists', 'abcd2345')), { ...L('plain-uid'), name: 'x'.repeat(201) }));
    await assertFails(setDoc(doc(db, p('publicLists', 'abcd2345')), { ...L('plain-uid'), lines: 'nope' }));
  });

  it('accepts a full public copy with prices', async () => {
    const full = { ...L('plain-uid'), showPrices: true, value: 3, pricesAsOf: 9, lines: [{ set: 'SOR', number: '010', name: 'V', subtitle: null, finish: 'any', qty: 2, unitPrice: 1.5 }] };
    await assertSucceeds(setDoc(doc(asUser('plain-uid'), p('publicLists', 'abcd2345')), full));
  });
});

describe('card submissions', () => {
  // CardSubmissionForm.jsx:371 writes here. No rule exists in the live ruleset
  // or in firestore.rules, so every submission is denied today.

  it('lets an authenticated user submit a card', async () => {
    const db = asUser('plain-uid');
    await assertSucceeds(setDoc(doc(db, p('submissions', 'sub-1')), {
      uid: 'plain-uid',
      cardName: 'Director Krennic',
      status: 'pending',
    }));
  });

  it('denies a submission that claims another user’s uid', async () => {
    const db = asUser('plain-uid');
    await assertFails(setDoc(doc(db, p('submissions', 'sub-2')), { uid: 'other-uid', cardName: 'X' }));
  });

  it('denies an unauthenticated submission', async () => {
    await assertFails(setDoc(doc(asGuest(), p('submissions', 'sub-3')), { uid: 'nobody', cardName: 'X' }));
  });

  it('lets a contributor read submissions for review', async () => {
    await seedDoc(p('submissions', 'sub-4'), { uid: 'plain-uid', cardName: 'X' });
    await assertSucceeds(getDoc(doc(asUser('contributor-uid'), p('submissions', 'sub-4'))));
  });

  it('stops an ordinary user reading someone else’s submission', async () => {
    await seedDoc(p('submissions', 'sub-5'), { uid: 'other-uid', cardName: 'X' });
    await assertFails(getDoc(doc(asUser('plain-uid'), p('submissions', 'sub-5'))));
  });
});

describe('admin sync logs', () => {
  // AdminPanel.jsx:415 reads here. No rule exists, so the admin log view is
  // dead -- which is why its test is skipped in the component suite.

  beforeEach(async () => {
    await seedDoc(p('admin', 'sync', 'logs', 'log-1'), { status: 'healthy', at: 1 });
  });

  it('lets an admin read sync logs', async () => {
    await assertSucceeds(getDocs(collection(asUser('admin-uid'), p('admin', 'sync', 'logs'))));
  });

  it('denies a non-admin', async () => {
    await assertFails(getDocs(collection(asUser('plain-uid'), p('admin', 'sync', 'logs'))));
  });

  it('is never client-writable', async () => {
    await assertFails(setDoc(doc(asUser('admin-uid'), p('admin', 'sync', 'logs', 'log-2')), { status: 'forged' }));
  });
});

describe('role-change audit log', () => {
  beforeEach(async () => {
    await seedDoc(p('admin', 'audit', 'roleChanges', 'a1'), { uid: 'plain-uid', role: 'isPro' });
  });

  it('is readable by admins only', async () => {
    await assertSucceeds(getDoc(doc(asUser('admin-uid'), p('admin', 'audit', 'roleChanges', 'a1'))));
    await assertFails(getDoc(doc(asUser('plain-uid'), p('admin', 'audit', 'roleChanges', 'a1'))));
  });

  it('is never writable from a client, even by an admin', async () => {
    await assertFails(setDoc(doc(asUser('admin-uid'), p('admin', 'audit', 'roleChanges', 'a2')), { uid: 'x' }));
  });
});

describe('contributor invites', () => {
  // Redemption happens in a callable Cloud Function using the Admin SDK, so the
  // invitee never reads this collection: they present a code and the server
  // grants the role. That keeps the collection admin-only, which is tighter
  // than letting invitees query it.

  beforeEach(async () => {
    await seedDoc(p('contributorInvites', 'CODE-1234'), { code: 'CODE-1234', claimed: false });
  });

  it('lets an admin create and read invites', async () => {
    await assertSucceeds(getDoc(doc(asUser('admin-uid'), p('contributorInvites', 'CODE-1234'))));
    await assertSucceeds(setDoc(doc(asUser('admin-uid'), p('contributorInvites', 'CODE-5678')), { code: 'CODE-5678' }));
  });

  it('denies an ordinary user reading an invite', async () => {
    await assertFails(getDoc(doc(asUser('plain-uid'), p('contributorInvites', 'CODE-1234'))));
  });

  it('denies an ordinary user enumerating invites', async () => {
    await assertFails(getDocs(collection(asUser('plain-uid'), p('contributorInvites'))));
  });

  it('stops a non-admin creating an invite for themselves', async () => {
    await assertFails(setDoc(doc(asUser('plain-uid'), p('contributorInvites', 'self')), { code: 'self' }));
  });
});

describe('role fields cannot be self-granted', () => {
  // Roles live on the user's own profile document, which the user may write.
  // Without an explicit guard, any authenticated account -- including an
  // anonymous guest -- can set isAdmin on itself. Roles are granted only by the
  // Admin SDK (the invite-redemption function), never by a client.

  it('denies a user granting themselves isContributor', async () => {
    await assertFails(setDoc(doc(asUser('plain-uid'), p('users', 'plain-uid')), { isContributor: true }, { merge: true }));
  });

  it('denies a user granting themselves isAdmin', async () => {
    await assertFails(setDoc(doc(asUser('plain-uid'), p('users', 'plain-uid')), { isAdmin: true }, { merge: true }));
  });

  it('denies an anonymous guest granting themselves a role', async () => {
    await assertFails(setDoc(doc(asUser('guest-uid'), p('users', 'guest-uid')), { isAdmin: true }));
  });

  it('denies a user stripping a role from themselves to dodge the guard', async () => {
    await assertFails(setDoc(doc(asUser('admin-uid'), p('users', 'admin-uid')), { isAdmin: false }, { merge: true }));
  });

  it('still lets a user write their own non-role profile fields', async () => {
    await assertSucceeds(setDoc(doc(asUser('plain-uid'), p('users', 'plain-uid')), { displayName: 'Loki' }, { merge: true }));
  });

  it('still lets a user write their own collection subcollection', async () => {
    await assertSucceeds(setDoc(doc(asUser('plain-uid'), p('users', 'plain-uid', 'collection', 'SOR_001_std')), { quantity: 2 }));
  });
});

describe('shells and packets', () => {
  beforeEach(async () => {
    await seedDoc(p('shells', 'shell-1'), { name: 'Aggro Shell' });
    await seedDoc(p('packets', 'packet-1'), { name: 'Starter' });
  });

  it('are readable by any authenticated user', async () => {
    await assertSucceeds(getDoc(doc(asUser('plain-uid'), p('shells', 'shell-1'))));
    await assertSucceeds(getDoc(doc(asUser('plain-uid'), p('packets', 'packet-1'))));
  });

  it('are writable by a contributor', async () => {
    await assertSucceeds(setDoc(doc(asUser('contributor-uid'), p('shells', 'shell-2')), { name: 'New' }));
  });

  it('are not writable by an ordinary user', async () => {
    await assertFails(setDoc(doc(asUser('plain-uid'), p('shells', 'shell-3')), { name: 'Nope' }));
  });
});

describe('legacy sync collections', () => {
  // Retired by decision: the read window expired 2025-02-01 and those users are
  // already locked out. The rule is removed rather than extended, and the
  // App.jsx legacy path goes with it.

  it('denies legacy sync reads now that the migration window has closed', async () => {
    await seedDoc(p('public', 'data', 'sync_abc123', 'SOR_001_std'), { quantity: 1 });
    await assertFails(getDoc(doc(asUser('plain-uid'), p('public', 'data', 'sync_abc123', 'SOR_001_std'))));
  });
});

describe('scanner entitlement and usage', () => {
  // isPro gates the card scanner, which costs real money per call. It is
  // granted by hand (or later by a Patreon webhook) through the Admin SDK,
  // never by the user themselves.

  it('denies a user granting themselves isPro', async () => {
    await assertFails(setDoc(doc(asUser('plain-uid'), p('users', 'plain-uid')), { isPro: true }, { merge: true }));
  });

  it('denies creating a profile that already declares isPro', async () => {
    await assertFails(setDoc(doc(asUser('fresh-uid'), p('users', 'fresh-uid')), { isPro: true }));
  });

  it('denies any client reading the scanner config, even an admin', async () => {
    await seedDoc(p('config', 'scanner'), { dailyLimit: 1000 });
    await assertFails(getDoc(doc(asUser('admin-uid'), p('config', 'scanner'))));
  });

  it('denies any client writing the scanner config, even an admin', async () => {
    await assertFails(setDoc(doc(asUser('admin-uid'), p('config', 'scanner')), { dailyLimit: 999999 }));
  });

  it('denies a user reading their own scan usage', async () => {
    await seedDoc(p('scanUsage', 'plain-uid'), { date: '2026-09-29', count: 5 });
    await assertFails(getDoc(doc(asUser('plain-uid'), p('scanUsage', 'plain-uid'))));
  });

  it('denies a user resetting their own scan usage', async () => {
    await assertFails(setDoc(doc(asUser('plain-uid'), p('scanUsage', 'plain-uid')), { date: '2026-09-29', count: 0 }));
  });
});
