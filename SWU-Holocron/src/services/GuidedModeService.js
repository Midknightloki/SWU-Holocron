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
  async checkAndApplyInvite(uid, email) {
    if (!email) return false;
    const normalized = email.toLowerCase().trim();
    const snap = await getDocs(invitesCol());
    const invite = snap.docs.find(d => d.data().email === normalized);
    if (!invite) return false;

    const userRef = doc(db, 'artifacts', APP_ID, 'users', uid);
    await setDoc(userRef, { isContributor: true }, { merge: true });
    await deleteDoc(doc(invitesCol(), invite.id));
    return true;
  },
};
