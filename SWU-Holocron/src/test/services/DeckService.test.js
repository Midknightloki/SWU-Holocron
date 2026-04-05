/**
 * @vitest-environment happy-dom
 * @unit @service
 *
 * DeckService Tests — CRUD for decks, version history, and game logs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeckService } from '../../services/DeckService';

// ---------------------------------------------------------------------------
// Firebase mocks
// ---------------------------------------------------------------------------

vi.mock('../../firebase', () => ({
  db: { _type: 'firestore', app: { name: 'test-app' } },
  APP_ID: 'test-app-id',
}));

const mockServerTimestamp = { _type: 'serverTimestamp' };

// Stored documents keyed by path string
let firestoreStore = {};
let autoIdCounter = 0;

const nextId = () => `auto-id-${++autoIdCounter}`;

const makeRef = (path) => ({
  _path: path,
  _type: 'DocumentReference',
  id: path.split('/').pop(),
});
const makeColRef = (path) => ({ _path: path, _type: 'CollectionReference' });

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...args) => {
    // args[0] is db or a DocumentReference; rest are path segments
    const base = args[0]?._path || '';
    const segments = args.slice(1);
    const path = base ? `${base}/${segments.join('/')}` : segments.join('/');
    return makeColRef(path);
  }),
  doc: vi.fn((...args) => {
    // Handles: doc(db, ...segments) or doc(colRef) for auto-ID
    const first = args[0];
    if (first?._type === 'CollectionReference') {
      // doc(colRef) — auto-generate ID
      return makeRef(`${first._path}/${nextId()}`);
    }
    // doc(db, seg1, seg2, ...) — absolute path
    const segments = args.slice(1);
    const path = segments.join('/');
    return makeRef(path);
  }),
  addDoc: vi.fn(async (colRef, data) => {
    const id = nextId();
    const path = `${colRef._path}/${id}`;
    firestoreStore[path] = { ...data };
    return makeRef(path);
  }),
  updateDoc: vi.fn(async (ref, data) => {
    firestoreStore[ref._path] = { ...(firestoreStore[ref._path] || {}), ...data };
  }),
  deleteDoc: vi.fn(async (ref) => {
    delete firestoreStore[ref._path];
  }),
  getDoc: vi.fn(async (ref) => {
    const data = firestoreStore[ref._path];
    return {
      exists: () => !!data,
      data: () => (data ? { ...data } : null),
      id: ref._path.split('/').pop(),
    };
  }),
  getDocs: vi.fn(async (q) => {
    const prefix = q._colPath || '';
    const prefixDepth = prefix.split('/').length;
    const docs = Object.entries(firestoreStore)
      .filter(([path]) => {
        return (
          path.startsWith(prefix + '/') &&
          path.split('/').length === prefixDepth + 1
        );
      })
      .map(([path, data]) => ({
        id: path.split('/').pop(),
        ref: makeRef(path),
        data: () => ({ ...data }),
      }));
    return { docs, size: docs.length };
  }),
  query: vi.fn((colRef, ...constraints) => ({
    _colPath: colRef._path,
    _constraints: constraints,
  })),
  orderBy: vi.fn((field, dir) => ({ _type: 'orderBy', field, dir })),
  serverTimestamp: vi.fn(() => mockServerTimestamp),
  writeBatch: vi.fn(() => {
    const ops = [];
    return {
      set: vi.fn((ref, data) => ops.push({ type: 'set', ref, data })),
      update: vi.fn((ref, data) => ops.push({ type: 'update', ref, data })),
      delete: vi.fn((ref) => ops.push({ type: 'delete', ref })),
      commit: vi.fn(async () => {
        ops.forEach((op) => {
          if (op.type === 'set') firestoreStore[op.ref._path] = { ...op.data };
          if (op.type === 'update') {
            firestoreStore[op.ref._path] = {
              ...(firestoreStore[op.ref._path] || {}),
              ...op.data,
            };
          }
          if (op.type === 'delete') delete firestoreStore[op.ref._path];
        });
      }),
    };
  }),
  increment: vi.fn((n) => ({ _type: 'increment', n })),
}));

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

const UID = 'user-123';

const sampleDeck = {
  name: 'Hera Spectre Control',
  description: 'Aggressive control deck',
  leaderId: 'SOR_008',
  baseId: 'SOR_021',
  cards: {
    'SOR_050': 3,
    'JTL_045': 2,
    'SOR_200': 1,
  },
  aspects: ['Heroism', 'Command'],
  format: 'Premier',
  tags: ['control'],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeckService', () => {
  beforeEach(() => {
    firestoreStore = {};
    autoIdCounter = 0;
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  describe('createDeck', () => {
    it('creates a deck and returns a document ID', async () => {
      const id = await DeckService.createDeck(UID, sampleDeck);
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('calculates totalCards from the cards map', async () => {
      await DeckService.createDeck(UID, sampleDeck);
      // sum of 3+2+1 = 6
      const stored = Object.values(firestoreStore).find((d) => d.name === 'Hera Spectre Control');
      expect(stored.totalCards).toBe(6);
    });

    it('applies defaults for optional fields', async () => {
      const id = await DeckService.createDeck(UID, { name: 'Minimal Deck' });
      const stored = Object.values(firestoreStore).find((d) => d.name === 'Minimal Deck');
      expect(stored.description).toBe('');
      expect(stored.format).toBe('Premier');
      expect(stored.tags).toEqual([]);
      expect(stored.totalCards).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('getDeck', () => {
    it('returns null for a nonexistent deck', async () => {
      const result = await DeckService.getDeck(UID, 'nonexistent-id');
      expect(result).toBeNull();
    });

    it('returns the deck with its id', async () => {
      const id = await DeckService.createDeck(UID, sampleDeck);
      const result = await DeckService.getDeck(UID, id);
      expect(result).not.toBeNull();
      expect(result.id).toBe(id);
      expect(result.name).toBe('Hera Spectre Control');
    });
  });

  // -------------------------------------------------------------------------
  describe('updateDeck', () => {
    it('updates deck fields', async () => {
      const id = await DeckService.createDeck(UID, sampleDeck);
      await DeckService.updateDeck(UID, id, { name: 'Renamed Deck' });

      // Find the updated deck in the store
      const deckPath = `artifacts/test-app-id/users/${UID}/decks/${id}`;
      expect(firestoreStore[deckPath].name).toBe('Renamed Deck');
    });

    it('recalculates totalCards when cards map is updated', async () => {
      const id = await DeckService.createDeck(UID, sampleDeck);
      const newCards = { 'SOR_050': 3, 'JTL_045': 3, 'SOR_200': 3, 'SOR_147': 3 };
      await DeckService.updateDeck(UID, id, { cards: newCards });

      const deckPath = `artifacts/test-app-id/users/${UID}/decks/${id}`;
      expect(firestoreStore[deckPath].totalCards).toBe(12);
    });

    it('throws for a nonexistent deck', async () => {
      await expect(
        DeckService.updateDeck(UID, 'bad-id', { name: 'x' })
      ).rejects.toThrow('not found');
    });
  });

  // -------------------------------------------------------------------------
  describe('duplicateDeck', () => {
    it('creates a copy with a new name', async () => {
      const id = await DeckService.createDeck(UID, sampleDeck);
      const newId = await DeckService.duplicateDeck(UID, id, 'Hera v2');
      expect(newId).not.toBe(id);

      const copy = await DeckService.getDeck(UID, newId);
      expect(copy.name).toBe('Hera v2');
      expect(copy.leaderId).toBe(sampleDeck.leaderId);
    });
  });

  // -------------------------------------------------------------------------
  describe('computeRecord', () => {
    it('computes correct totals and win rate', () => {
      const logs = [
        { result: 'win' },
        { result: 'win' },
        { result: 'loss' },
        { result: 'draw' },
      ];
      const record = DeckService.computeRecord(logs);
      expect(record.wins).toBe(2);
      expect(record.losses).toBe(1);
      expect(record.draws).toBe(1);
      expect(record.total).toBe(4);
      expect(record.winRate).toBe(50);
    });

    it('returns zero win rate for empty log', () => {
      const record = DeckService.computeRecord([]);
      expect(record.winRate).toBe(0);
      expect(record.total).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('logGame', () => {
    it('creates a game log and returns an id', async () => {
      const deckId = await DeckService.createDeck(UID, sampleDeck);
      const logId = await DeckService.logGame(UID, deckId, {
        result: 'win',
        opponentLeaderId: 'SOR_001',
        notes: 'Close game!',
      });
      expect(typeof logId).toBe('string');
    });

    it('rejects invalid result values', async () => {
      const deckId = await DeckService.createDeck(UID, sampleDeck);
      await expect(
        DeckService.logGame(UID, deckId, { result: 'forfeit' })
      ).rejects.toThrow('Invalid result');
    });

    it('accepts all valid result values', async () => {
      const deckId = await DeckService.createDeck(UID, sampleDeck);
      for (const result of ['win', 'loss', 'draw']) {
        await expect(
          DeckService.logGame(UID, deckId, { result })
        ).resolves.toBeDefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('restoreVersion', () => {
    it('throws if version does not exist', async () => {
      const deckId = await DeckService.createDeck(UID, sampleDeck);
      await expect(
        DeckService.restoreVersion(UID, deckId, 'bad-version')
      ).rejects.toThrow('not found');
    });
  });
});
