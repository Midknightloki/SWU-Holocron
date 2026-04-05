/**
 * DeckService — Firestore CRUD for user decks, version history, and game logs.
 *
 * Path structure:
 *   /artifacts/{APP_ID}/users/{uid}/decks/{deckId}
 *   /artifacts/{APP_ID}/users/{uid}/decks/{deckId}/versions/{versionId}
 *   /artifacts/{APP_ID}/users/{uid}/decks/{deckId}/gamelogs/{logId}
 *
 * All methods require a valid authenticated uid.
 * @environment:firebase
 */

import { db, APP_ID } from '../firebase';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
  increment,
} from 'firebase/firestore';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const decksRef = (uid) =>
  collection(db, 'artifacts', APP_ID, 'users', uid, 'decks');

const deckRef = (uid, deckId) =>
  doc(db, 'artifacts', APP_ID, 'users', uid, 'decks', deckId);

const versionsRef = (uid, deckId) =>
  collection(db, 'artifacts', APP_ID, 'users', uid, 'decks', deckId, 'versions');

const gamelogsRef = (uid, deckId) =>
  collection(db, 'artifacts', APP_ID, 'users', uid, 'decks', deckId, 'gamelogs');

// ---------------------------------------------------------------------------
// DeckService
// ---------------------------------------------------------------------------

export const DeckService = {

  // -------------------------------------------------------------------------
  // Deck CRUD
  // -------------------------------------------------------------------------

  /**
   * Create a new deck for a user.
   * @param {string} uid
   * @param {{ name, description, leaderId, baseId, cards, aspects, format, tags }} deckData
   * @returns {Promise<string>} The new deck's Firestore document ID
   */
  createDeck: async (uid, deckData) => {
    const {
      name,
      description = '',
      leaderId = null,
      baseId = null,
      cards = {},
      aspects = [],
      format = 'Premier',
      tags = [],
    } = deckData;

    const totalCards = Object.values(cards).reduce((sum, count) => sum + count, 0);

    const docRef = await addDoc(decksRef(uid), {
      name,
      description,
      leaderId,
      baseId,
      cards,
      aspects,
      format,
      tags,
      totalCards,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return docRef.id;
  },

  /**
   * Update an existing deck. Automatically saves a version snapshot of the
   * previous state before applying updates.
   * @param {string} uid
   * @param {string} deckId
   * @param {Partial<DeckData>} updates
   * @param {string} [versionNote] - Optional note for the version snapshot
   */
  updateDeck: async (uid, deckId, updates, versionNote = '') => {
    const ref = deckRef(uid, deckId);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      throw new Error(`Deck ${deckId} not found`);
    }

    const current = snap.data();

    // Save version snapshot of current state before overwriting
    const versionSnap = await getDocs(query(versionsRef(uid, deckId), orderBy('savedAt', 'asc')));
    const nextVersionNumber = versionSnap.size + 1;

    const batch = writeBatch(db);

    // Write version snapshot
    const vRef = doc(versionsRef(uid, deckId));
    batch.set(vRef, {
      leaderId: current.leaderId,
      baseId: current.baseId,
      cards: current.cards,
      totalCards: current.totalCards,
      savedAt: serverTimestamp(),
      note: versionNote,
      versionNumber: nextVersionNumber,
    });

    // Recalculate totalCards if cards map is being updated
    const mergedUpdates = { ...updates };
    if (updates.cards !== undefined) {
      mergedUpdates.totalCards = Object.values(updates.cards).reduce(
        (sum, count) => sum + count,
        0
      );
    }

    // Apply update to deck document
    batch.update(ref, {
      ...mergedUpdates,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  },

  /**
   * Delete a deck and all its subcollections (versions + gamelogs).
   * Firestore does not auto-delete subcollections, so we batch-delete them.
   * @param {string} uid
   * @param {string} deckId
   */
  deleteDeck: async (uid, deckId) => {
    const batch = writeBatch(db);

    // Delete all versions
    const vSnap = await getDocs(versionsRef(uid, deckId));
    vSnap.docs.forEach((d) => batch.delete(d.ref));

    // Delete all game logs
    const gSnap = await getDocs(gamelogsRef(uid, deckId));
    gSnap.docs.forEach((d) => batch.delete(d.ref));

    // Delete the deck document itself
    batch.delete(deckRef(uid, deckId));

    await batch.commit();
  },

  /**
   * List all decks for a user, ordered by most recently updated.
   * @param {string} uid
   * @returns {Promise<Array<{ id: string, ...deckData }>>}
   */
  listDecks: async (uid) => {
    const q = query(decksRef(uid), orderBy('updatedAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  /**
   * Get a single deck by ID.
   * @param {string} uid
   * @param {string} deckId
   * @returns {Promise<{ id: string, ...deckData } | null>}
   */
  getDeck: async (uid, deckId) => {
    const snap = await getDoc(deckRef(uid, deckId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  },

  /**
   * Duplicate a deck under a new name.
   * @param {string} uid
   * @param {string} deckId
   * @param {string} newName
   * @returns {Promise<string>} New deck ID
   */
  duplicateDeck: async (uid, deckId, newName) => {
    const existing = await DeckService.getDeck(uid, deckId);
    if (!existing) throw new Error(`Deck ${deckId} not found`);

    const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } = existing;
    return DeckService.createDeck(uid, { ...rest, name: newName });
  },

  // -------------------------------------------------------------------------
  // Version History
  // -------------------------------------------------------------------------

  /**
   * List all saved versions of a deck, ordered chronologically (oldest first).
   * @param {string} uid
   * @param {string} deckId
   * @returns {Promise<Array<{ id: string, ...versionData }>>}
   */
  listVersions: async (uid, deckId) => {
    const q = query(versionsRef(uid, deckId), orderBy('savedAt', 'asc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  /**
   * Restore a deck to a saved version.
   * This creates a new version snapshot of the current state, then overwrites
   * the deck with the restored version's data.
   * @param {string} uid
   * @param {string} deckId
   * @param {string} versionId
   * @param {string} [note]
   */
  restoreVersion: async (uid, deckId, versionId, note = '') => {
    const vSnap = await getDoc(doc(versionsRef(uid, deckId), versionId));
    if (!vSnap.exists()) throw new Error(`Version ${versionId} not found`);

    const versionData = vSnap.data();
    await DeckService.updateDeck(
      uid,
      deckId,
      {
        leaderId: versionData.leaderId,
        baseId: versionData.baseId,
        cards: versionData.cards,
      },
      note || `Restored from version ${versionData.versionNumber}`
    );
  },

  // -------------------------------------------------------------------------
  // Game Logs
  // -------------------------------------------------------------------------

  /**
   * Log a game result for a deck.
   * @param {string} uid
   * @param {string} deckId
   * @param {{ result, opponentLeaderId, opponentBaseId, notes, format }} gameData
   * @returns {Promise<string>} New log document ID
   */
  logGame: async (uid, deckId, gameData) => {
    const {
      result,                   // 'win' | 'loss' | 'draw'
      opponentLeaderId = null,
      opponentBaseId = null,
      notes = '',
      format = '',
    } = gameData;

    if (!['win', 'loss', 'draw'].includes(result)) {
      throw new Error(`Invalid result "${result}". Must be win, loss, or draw.`);
    }

    const docRef = await addDoc(gamelogsRef(uid, deckId), {
      result,
      opponentLeaderId,
      opponentBaseId,
      notes,
      format,
      playedAt: serverTimestamp(),
    });

    return docRef.id;
  },

  /**
   * List all game logs for a deck, most recent first.
   * @param {string} uid
   * @param {string} deckId
   * @returns {Promise<Array<{ id: string, ...logData }>>}
   */
  listGameLogs: async (uid, deckId) => {
    const q = query(gamelogsRef(uid, deckId), orderBy('playedAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  /**
   * Delete a single game log entry.
   * @param {string} uid
   * @param {string} deckId
   * @param {string} logId
   */
  deleteGameLog: async (uid, deckId, logId) => {
    await deleteDoc(doc(gamelogsRef(uid, deckId), logId));
  },

  /**
   * Compute win/loss/draw totals from a list of game logs.
   * @param {Array<{ result: string }>} logs
   * @returns {{ wins: number, losses: number, draws: number, total: number, winRate: number }}
   */
  computeRecord: (logs) => {
    const wins = logs.filter((l) => l.result === 'win').length;
    const losses = logs.filter((l) => l.result === 'loss').length;
    const draws = logs.filter((l) => l.result === 'draw').length;
    const total = wins + losses + draws;
    const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
    return { wins, losses, draws, total, winRate };
  },
};
