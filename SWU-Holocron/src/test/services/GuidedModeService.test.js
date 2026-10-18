/**
 * @vitest-environment happy-dom
 * @unit @service
 *
 * GuidedModeService Tests — Shells, Packets, and Contributor Invites.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GuidedModeService } from '../../services/GuidedModeService';

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
  setDoc: vi.fn(async (docRef, data) => {
    mockDocsStore.set(docRef._path, data);
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

  describe('Shells CRUD', () => {
    it('creates, retrieves, updates and deletes a shell', async () => {
      const shellId = await GuidedModeService.createShell('admin-1', {
        name: 'Vader Aggro',
        leaderId: 'L_VADER',
        baseId: 'B_CATINA',
      });

      expect(shellId).toBeTruthy();

      const shell = await GuidedModeService.getShell(shellId);
      expect(shell.name).toBe('Vader Aggro');
      expect(shell.createdBy).toBe('admin-1');

      await GuidedModeService.updateShell(shellId, { name: 'Vader Midrange' });
      const updated = await GuidedModeService.getShell(shellId);
      expect(updated.name).toBe('Vader Midrange');

      const shellsList = await GuidedModeService.getShells();
      expect(shellsList).toHaveLength(1);

      await GuidedModeService.deleteShell(shellId);
      const afterDelete = await GuidedModeService.getShells();
      expect(afterDelete).toHaveLength(0);
    });

    it('throws when getting non-existent shell', async () => {
      await expect(GuidedModeService.getShell('non-existent')).rejects.toThrow('Shell not found');
    });
  });

  describe('Packets CRUD', () => {
    it('creates, retrieves, updates and deletes a packet', async () => {
      const packetId = await GuidedModeService.createPacket('contributor-1', {
        name: 'Imperial Trooper Package',
        cards: [{ cardId: 'C_TROOPER', count: 3 }],
      });

      expect(packetId).toBeTruthy();

      let packets = await GuidedModeService.getPackets();
      expect(packets).toHaveLength(1);
      expect(packets[0].name).toBe('Imperial Trooper Package');

      await GuidedModeService.updatePacket(packetId, { name: 'Updated Package' });
      packets = await GuidedModeService.getPackets();
      expect(packets[0].name).toBe('Updated Package');

      await GuidedModeService.deletePacket(packetId);
      packets = await GuidedModeService.getPackets();
      expect(packets).toHaveLength(0);
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
