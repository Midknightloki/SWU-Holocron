import { GoogleAuthProvider, linkWithPopup, signInWithCredential } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import { db, APP_ID } from '../firebase';
import { importToCollection } from './importBatch';
import { generateCSV } from '../utils/csvParser';

/**
 * A guest signing in with Google. Linking keeps the guest's uid, so
 * everything stays. When that Google account already exists, the guest's
 * cards are read first (the guest's data is unreadable once signed out of
 * it), then added into the Google account's collection as a batch.
 *
 * @environment:firebase
 */
const collectionRefFor = (uid) => collection(db, 'artifacts', APP_ID, 'users', uid, 'collection');
const readCollection = async (uid) => {
  const snap = await getDocs(collectionRefFor(uid));
  return Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
};

export async function upgradeGuest({ auth, provider, deps = {} }) {
  const d = {
    linkWithPopup, signInWithCredential, credentialFromError: (e) => GoogleAuthProvider.credentialFromError(e),
    readCollection, collectionRefFor, importToCollection, ...deps,
  };
  const guest = auth.currentUser;
  try {
    const res = await d.linkWithPopup(guest, provider);
    return { kind: 'linked', user: res.user };
  } catch (err) {
    if (err?.code !== 'auth/credential-already-in-use') throw err;
    const credential = d.credentialFromError(err);
    if (!credential) throw err;

    const guestCards = await d.readCollection(guest.uid).catch(() => ({}));
    const { user } = await d.signInWithCredential(auth, credential);
    const items = Object.values(guestCards)
      .filter((c) => (Number(c?.quantity) || 0) > 0 && c.set && c.number)
      .map((c) => ({ set: c.set, number: String(c.number), name: c.name ?? '', quantity: Number(c.quantity), isFoil: Boolean(c.isFoil) }));
    if (items.length === 0) return { kind: 'merged', user, cards: 0 };

    const target = await d.readCollection(user.uid).catch(() => ({}));
    const res = await d.importToCollection({
      uid: user.uid, collectionRef: d.collectionRefFor(user.uid), collectionData: target, items,
      mode: 'add', name: 'Guest collection', source: { type: 'guest' },
    });
    if (res?.ok || res?.error === 'report') return { kind: 'merged', user, cards: res.cards ?? items.reduce((s, i) => s + i.quantity, 0) };
    return { kind: 'copy-failed', user, csv: generateCSV(guestCards) };
  }
}
