import { getFunctions, httpsCallable } from 'firebase/functions';
import { db, APP_ID } from '../firebase';
import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  serverTimestamp, query, orderBy, setDoc
} from 'firebase/firestore';

const shellsCol = () => collection(db, 'artifacts', APP_ID, 'shells');
const packetsCol = () => collection(db, 'artifacts', APP_ID, 'packets');
const invitesCol = () => collection(db, 'artifacts', APP_ID, 'contributorInvites');

export const GuidedModeService = {
  // ─── Shells ───────────────────────────────────────────────────────────────

  async getShells() {
    const q = query(shellsCol(), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getShell(shellId) {
    const snap = await getDoc(doc(shellsCol(), shellId));
    if (!snap.exists()) throw new Error('Shell not found');
    return { id: snap.id, ...snap.data() };
  },

  async createShell(uid, shellData) {
    const ref = await addDoc(shellsCol(), {
      ...shellData,
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  },

  async updateShell(shellId, shellData) {
    await updateDoc(doc(shellsCol(), shellId), {
      ...shellData,
      updatedAt: serverTimestamp(),
    });
  },

  async deleteShell(shellId) {
    await deleteDoc(doc(shellsCol(), shellId));
  },

  // ─── Packets ─────────────────────────────────────────────────────────────

  async getPackets() {
    const q = query(packetsCol(), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async createPacket(uid, packetData) {
    const ref = await addDoc(packetsCol(), {
      ...packetData,
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  },

  async updatePacket(packetId, packetData) {
    await updateDoc(doc(packetsCol(), packetId), {
      ...packetData,
      updatedAt: serverTimestamp(),
    });
  },

  async deletePacket(packetId) {
    await deleteDoc(doc(packetsCol(), packetId));
  },

  // ─── Contributor Invites ─────────────────────────────────────────────────

  async getInvites() {
    const snap = await getDocs(invitesCol());
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async createInvite(adminUid, email) {
    const normalized = email.toLowerCase().trim();
    await addDoc(invitesCol(), {
      email: normalized,
      createdBy: adminUid,
      createdAt: serverTimestamp(),
    });
  },

  async deleteInvite(inviteId) {
    await deleteDoc(doc(invitesCol(), inviteId));
  },

  // Called on login: if user's email matches a pending invite, promote to contributor.
  /**
   * Redeem a contributor invite code.
   *
   * The grant happens server-side in the redeemInviteCode Cloud Function, which
   * uses the Admin SDK. It cannot happen here: firestore.rules forbids a client
   * from writing the isAdmin/isContributor fields, because when the client did
   * write them any account could simply grant itself administrator.
   *
   * Errors are deliberately propagated -- the previous flow swallowed them, so a
   * failed invite looked identical to no invite.
   *
   * @param {string} code invite code from the invitation link
   * @returns {Promise<boolean>} true when the role was granted
   */
  async redeemInviteCode(code) {
    const trimmed = typeof code === 'string' ? code.trim() : '';
    if (!trimmed) throw new Error('Enter your invite code.');

    const redeem = httpsCallable(getFunctions(), 'redeemInviteCode');
    const result = await redeem({ code: trimmed });
    return result?.data?.granted === true;
  },
};
