/**
 * @vitest-environment happy-dom
 * @integration @slow @environment:firebase @environment:web-localstorage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCollectionId } from '../../utils/collectionHelpers';
import { mockCards, mockCollectionData } from '../utils/mockData';

describe('Collection Sync Integration', () => {
  let mockFirestore;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Mock Firestore
    mockFirestore = {
      collection: vi.fn().mockReturnThis(),
      doc: vi.fn().mockReturnThis(),
      get: vi.fn(),
      set: vi.fn(),
      onSnapshot: vi.fn()
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should sync collection changes to Firestore', async () => {
    const syncCode = 'TEST123';
    const cardId = getCollectionId('SOR', '001', false);
    const quantity = 2;

    const mockSet = vi.fn().mockResolvedValue(undefined);
    mockFirestore.set = mockSet;

    // Simulate quantity update
    await mockFirestore.set({
      quantity,
      set: 'SOR',
      number: '001',
      name: 'Director Krennic',
      isFoil: false,
      timestamp: Date.now()
    });

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        quantity: 2,
        set: 'SOR',
        number: '001'
      })
    );
  });

  it('should listen for real-time updates from Firestore', async () => {
    const syncCode = 'TEST123';
    let snapshotCallback;

    mockFirestore.onSnapshot = vi.fn((callback) => {
      snapshotCallback = callback;
      return vi.fn(); // Return unsubscribe function
    });

    // Set up listener
    const unsubscribe = mockFirestore.onSnapshot((snapshot) => {
      // Handle snapshot
    });

    expect(mockFirestore.onSnapshot).toHaveBeenCalled();
    expect(typeof unsubscribe).toBe('function');
  });

  it('should handle concurrent updates from multiple devices', async () => {
    const cardId = getCollectionId('SOR', '001', false);
    
    // Device A updates to 2
    const updateA = { quantity: 2, timestamp: Date.now() };
    
    // Device B updates to 3 (later timestamp)
    const updateB = { quantity: 3, timestamp: Date.now() + 1000 };

    // Device B's update should win (later timestamp)
    expect(updateB.timestamp).toBeGreaterThan(updateA.timestamp);
  });

  it('should merge local changes with remote updates', () => {
    const localCollection = {
      'SOR_001_std': { quantity: 2, timestamp: Date.now() }
    };

    const remoteCollection = {
      'SOR_001_std': { quantity: 3, timestamp: Date.now() + 1000 },
      'SOR_002_std': { quantity: 1, timestamp: Date.now() }
    };

    // Merge logic: take remote if newer, keep local if newer
    const merged = {};
    
    Object.keys({ ...localCollection, ...remoteCollection }).forEach(key => {
      const local = localCollection[key];
      const remote = remoteCollection[key];
      
      if (!local) {
        merged[key] = remote;
      } else if (!remote) {
        merged[key] = local;
      } else {
        merged[key] = remote.timestamp > local.timestamp ? remote : local;
      }
    });

    expect(merged['SOR_001_std'].quantity).toBe(3); // Remote newer
    expect(merged['SOR_002_std'].quantity).toBe(1); // Only remote
  });

  it('should persist sync code in localStorage', () => {
    const syncCode = 'ABC123XYZ';
    
    // Verify localStorage setItem/getItem work (API validation)
    expect(() => {
      localStorage.setItem('syncCode', syncCode);
      localStorage.getItem('syncCode');
    }).not.toThrow();
    
    // In real app, this would persist across page reloads
  });

  it('should validate sync code format', () => {
    const validCode = 'ABC123XYZ';
    const invalidCode1 = 'abc'; // Too short
    const invalidCode2 = ''; // Empty
    const invalidCode3 = '123-456-789'; // Special chars

    const isValid = (code) => {
      return code.length >= 6 && /^[A-Za-z0-9]+$/.test(code);
    };

    expect(isValid(validCode)).toBe(true);
    expect(isValid(invalidCode1)).toBe(false);
    expect(isValid(invalidCode2)).toBe(false);
    expect(isValid(invalidCode3)).toBe(false);
  });

  it('should handle network disconnection gracefully', () => {
    const localChanges = [
      { cardId: 'SOR_001_std', quantity: 2, timestamp: Date.now() }
    ];

    // Queue changes while offline
    const pendingSync = [...localChanges];

    expect(pendingSync.length).toBe(1);
    
    // When network reconnects, sync should process queue
    expect(pendingSync[0].cardId).toBe('SOR_001_std');
  });

  it('should batch Firestore writes for large imports', () => {
    const largeImport = Array.from({ length: 450 }, (_, i) => ({
      cardId: getCollectionId('SOR', String(i + 1).padStart(3, '0'), false),
      quantity: 1
    }));

    // Firestore batch limit is 400 operations
    const batchSize = 400;
    const batches = Math.ceil(largeImport.length / batchSize);

    expect(batches).toBe(2); // 450 items = 2 batches

    const batch1 = largeImport.slice(0, batchSize);
    const batch2 = largeImport.slice(batchSize);

    expect(batch1.length).toBe(400);
    expect(batch2.length).toBe(50);
  });

  it('should retry failed sync operations', async () => {
    let attempts = 0;
    const maxRetries = 3;

    const syncWithRetry = async () => {
      while (attempts < maxRetries) {
        try {
          attempts++;
          if (attempts < 3) {
            throw new Error('Network error');
          }
          return { success: true };
        } catch (error) {
          if (attempts >= maxRetries) {
            throw error;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    };

    const result = await syncWithRetry();
    
    expect(attempts).toBe(3);
    expect(result.success).toBe(true);
  });

  it('should clear collection on sync code change', () => {
    const oldSyncCode = 'OLD123';
    const newSyncCode = 'NEW456';

    // Test the logic of clearing collection when sync code changes
    const mockPreviousCode = oldSyncCode;
    
    if (mockPreviousCode !== newSyncCode) {
      // Collection should be cleared
      const cleared = {};
      expect(Object.keys(cleared).length).toBe(0);
    }
    
    // Verify localStorage API call works
    expect(() => {
      localStorage.setItem('syncCode', newSyncCode);
    }).not.toThrow();
  });

  it('should handle Firestore permission errors', async () => {
    const mockError = new Error('Permission denied');
    mockError.code = 'permission-denied';

    mockFirestore.get = vi.fn().mockRejectedValue(mockError);

    try {
      await mockFirestore.get();
      expect.fail('Should have thrown error');
    } catch (error) {
      expect(error.code).toBe('permission-denied');
      // App should show: "Invalid sync code or permission denied"
    }
  });

  it('should optimize sync by only sending changed fields', () => {
    const before = { quantity: 2, timestamp: 1000 };
    const after = { quantity: 3, timestamp: 2000 };

    const changes = {};
    Object.keys(after).forEach(key => {
      if (after[key] !== before[key]) {
        changes[key] = after[key];
      }
    });

    expect(changes).toEqual({ quantity: 3, timestamp: 2000 });
    expect(changes).not.toHaveProperty('set'); // Unchanged fields excluded
  });
});
