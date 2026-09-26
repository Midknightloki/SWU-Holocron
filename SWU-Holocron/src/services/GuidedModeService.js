import { getFunctions, httpsCallable } from 'firebase/functions';
import { generateInviteCode, normalizeInviteCode } from '../utils/inviteCodes';
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
    const invites = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Newest first. A just-written createdAt is still a pending serverTimestamp
    // locally, so treat a missing value as newest rather than oldest.
    const issuedAt = (invite) => {
      const raw = invite.createdAt;
      if (!raw) return Infinity;
      return typeof raw.toMillis === 'function' ? raw.toMillis() : Number(raw) || 0;
    };
    return invites.sort((a, b) => issuedAt(b) - issuedAt(a));
  },

  /**
   * Issue a contributor invite.
   *
   * The generated code is the document id, because that is what the
   * redeemInviteCode function looks up. It used to be an addDoc auto-id, which
   * meant the code existed but was never shown to the admin and could not
   * realistically be typed by the recipient.
   *
   * `email` is a label for the admin's own benefit. Nothing matches on it: the
   * grant is earned by presenting the code, not by signing in with an address.
   *
   * @param {string} adminUid the issuing admin
   * @param {{email?: string, expiresInDays?: number}|string} options
   * @returns {Promise<string>} the code to hand to the recipient
   */
  async createInvite(adminUid, options = {}) {
    const { email = '', expiresInDays = 0 } =
      typeof options === 'string' ? { email: options } : (options || {});

    const code = generateInviteCode();
    await setDoc(doc(invitesCol(), code), {
      email: email.toLowerCase().trim() || null,
      claimed: false,
      createdBy: adminUid,
      createdAt: serverTimestamp(),
      // Milliseconds, not a Timestamp: the function compares this against
      // Date.now(), and a Timestamp would compare as NaN and never expire.
      expiresAt: expiresInDays > 0 ? Date.now() + expiresInDays * 86400000 : null,
    });

    return code;
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
    // Forgives case, spacing and hyphens. A code is read off a screen and typed
    // by hand, so `h7qk 3mrt xb29` has to reach the same document as the issued
    // `H7QK-3MRT-XB29`.
    const normalized = normalizeInviteCode(code);
    if (!normalized) throw new Error('Enter your invite code.');

    const redeem = httpsCallable(getFunctions(), 'redeemInviteCode');
    const result = await redeem({ code: normalized });
    return result?.data?.granted === true;
  },
};
