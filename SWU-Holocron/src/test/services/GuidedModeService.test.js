/**
 * @vitest-environment happy-dom
 * @unit @service
 *
 * GuidedModeService Tests — Shells, Packets, Seeding, and Contributor Invites.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GuidedModeService } from '../../services/GuidedModeService';
import { DEFAULT_SHELLS, DEFAULT_PACKETS } from '../../data/defaultGuidedContent';

vi.mock('../../firebase', () => ({
  db: { _type: 'firestore' },
  APP_ID: 'test-app-id',
}));

const mockDocsStore = new Map();
let autoIdCounter = 0;

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...args) => ({ _path: args.slice(1).join('/') })),
  doc: vi.fn((...args) => {
    if (args.length === 2 && args[0]._path) {
      return { _path: `${args[0]._path}/${args[1]}`, id: args[1] };
    }
    const path = args.slice(1).join('/');
    return { _path: path, id: path.split('/').pop() };
  }),
  query: vi.fn((col) => col),
  orderBy: vi.fn(),
  getDocs: vi.fn(async (colRef) => {
    const docs = [];
    for (const [p, data] of mockDocsStore.entries()) {
      if (p.startsWith(colRef._path + '/')) {
        const id = p.split('/').pop();
        docs.push({ id, data: () => data });
      }
    }
    return { docs };
  }),
  getDoc: vi.fn(async (docRef) => {
    const data = mockDocsStore.get(docRef._path);
    return {
      id: docRef.id,
      exists: () => !!data,
      data: () => data,
    };
  }),
  addDoc: vi.fn(async (colRef, data) => {
    const id = `auto-id-${++autoIdCounter}`;
    const path = `${colRef._path}/${id}`;
    mockDocsStore.set(path, data);
    return { id, _path: path };
  }),
  setDoc: vi.fn(async (docRef, data, options = {}) => {
    if (options.merge) {
      const existing = mockDocsStore.get(docRef._path) || {};
      mockDocsStore.set(docRef._path, { ...existing, ...data });
    } else {
      mockDocsStore.set(docRef._path, data);
    }
  }),
  updateDoc: vi.fn(async (docRef, data) => {
    const existing = mockDocsStore.get(docRef._path) || {};
    mockDocsStore.set(docRef._path, { ...existing, ...data });
  }),
  deleteDoc: vi.fn(async (docRef) => {
    mockDocsStore.delete(docRef._path);
  }),
  serverTimestamp: vi.fn(() => ({ _type: 'serverTimestamp' })),
}));

const mockHttpsCallable = vi.fn();
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({ _type: 'functions' })),
  httpsCallable: vi.fn(() => mockHttpsCallable),
}));

describe('GuidedModeService', () => {
  beforeEach(() => {
    mockDocsStore.clear();
    autoIdCounter = 0;
    vi.clearAllMocks();
  });

  describe('Curated Defaults & Fallback', () => {
    it('returns DEFAULT_SHELLS when Firestore has no shells', async () => {
      const shells = await GuidedModeService.getShells();
      expect(shells).toEqual(DEFAULT_SHELLS);
      expect(shells.length).toBeGreaterThanOrEqual(3);
    });

    it('returns DEFAULT_PACKETS when Firestore has no packets', async () => {
      const packets = await GuidedModeService.getPackets();
      expect(packets).toEqual(DEFAULT_PACKETS);
      expect(packets.length).toBeGreaterThanOrEqual(5);
    });

    it('resolves a default shell by ID when not stored in Firestore', async () => {
      const shell = await GuidedModeService.getShell('default-vader-command');
      expect(shell).toBeTruthy();
      expect(shell.name).toContain('Darth Vader');
      expect(shell.leaderId).toBe('SOR_010');
      expect(shell.baseId).toBe('SOR_023');
      const totalCards = Object.values(shell.cards).reduce((s, c) => s + c, 0);
      expect(totalCards).toBe(50);
    });

    it('throws when getting non-existent shell that is not in defaults', async () => {
      await expect(GuidedModeService.getShell('non-existent-shell')).rejects.toThrow('Shell not found');
    });

    it('seeds defaults to Firestore and does not duplicate on second seed', async () => {
      const firstSeed = await GuidedModeService.seedDefaults('admin-uid');
      expect(firstSeed.seededShells).toBe(DEFAULT_SHELLS.length);
      expect(firstSeed.seededPackets).toBe(DEFAULT_PACKETS.length);

      // Now Firestore has documents, so getShells returns them
      const shells = await GuidedModeService.getShells();
      expect(shells).toHaveLength(DEFAULT_SHELLS.length);

      // Second seed should find existing documents and seed 0
      const secondSeed = await GuidedModeService.seedDefaults('admin-uid');
      expect(secondSeed.seededShells).toBe(0);
      expect(secondSeed.seededPackets).toBe(0);
    });
  });

  describe('Shells CRUD', () => {
    it('creates, retrieves, updates and deletes custom shells', async () => {
      const shellId = await GuidedModeService.createShell('admin-1', {
        name: 'Custom Boba Deck',
        leaderId: 'SOR_015',
        baseId: 'SOR_022',
        cards: { SOR_179: 3 },
      });

      expect(shellId).toBeTruthy();

      const shell = await GuidedModeService.getShell(shellId);
      expect(shell.name).toBe('Custom Boba Deck');
      expect(shell.createdBy).toBe('admin-1');

      await GuidedModeService.updateShell(shellId, { name: 'Custom Boba Aggro' });
      const updated = await GuidedModeService.getShell(shellId);
      expect(updated.name).toBe('Custom Boba Aggro');

      const shellsList = await GuidedModeService.getShells();
      expect(shellsList).toHaveLength(1);
      expect(shellsList[0].name).toBe('Custom Boba Aggro');

      await GuidedModeService.deleteShell(shellId);
      // When Firestore is empty again, it falls back to DEFAULT_SHELLS
      const afterDelete = await GuidedModeService.getShells();
      expect(afterDelete).toEqual(DEFAULT_SHELLS);
    });
  });

  describe('Packets CRUD', () => {
    it('creates, retrieves, updates and deletes custom packets', async () => {
      const packetId = await GuidedModeService.createPacket('contributor-1', {
        name: 'Custom Swarm Packet',
        role: 'Aggression',
        cards: { SOR_229: 3 },
      });

      expect(packetId).toBeTruthy();

      let packets = await GuidedModeService.getPackets();
      expect(packets).toHaveLength(1);
      expect(packets[0].name).toBe('Custom Swarm Packet');

      await GuidedModeService.updatePacket(packetId, { name: 'Updated Swarm' });
      packets = await GuidedModeService.getPackets();
      expect(packets[0].name).toBe('Updated Swarm');

      await GuidedModeService.deletePacket(packetId);
      // When Firestore is empty again, it falls back to DEFAULT_PACKETS
      packets = await GuidedModeService.getPackets();
      expect(packets).toEqual(DEFAULT_PACKETS);
    });
  });

  describe('Contributor Invites', () => {
    it('creates an invite code, lists it, and deletes it', async () => {
      const code = await GuidedModeService.createInvite('admin-1', {
        email: 'contributor@example.com',
        expiresInDays: 7,
      });

      expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

      const invites = await GuidedModeService.getInvites();
      expect(invites).toHaveLength(1);
      expect(invites[0].id).toBe(code);
      expect(invites[0].email).toBe('contributor@example.com');
      expect(invites[0].claimed).toBe(false);

      await GuidedModeService.deleteInvite(code);
      const afterDelete = await GuidedModeService.getInvites();
      expect(afterDelete).toHaveLength(0);
    });

    it('redeems an invite code via callable function', async () => {
      mockHttpsCallable.mockResolvedValueOnce({ data: { granted: true } });

      const granted = await GuidedModeService.redeemInviteCode('H7QK-3MRT-XB29');
      expect(granted).toBe(true);
      expect(mockHttpsCallable).toHaveBeenCalledWith({ code: 'H7QK-3MRT-XB29' });
    });

    it('throws if code is empty on redemption', async () => {
      await expect(GuidedModeService.redeemInviteCode('')).rejects.toThrow('Enter your invite code.');
    });
  });
});
