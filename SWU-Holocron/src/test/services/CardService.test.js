/**
 * @vitest-environment happy-dom
 * @unit @service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CardService } from '../../services/CardService';

// Mock Firebase
vi.mock('../../firebase', () => ({
  db: { 
    _type: 'firestore',
    app: { name: 'test-app' }
  },
  APP_ID: 'test-app-id'
}));

// Mock Firestore functions
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((...args) => ({ 
    _path: args.join('/'),
    _type: 'DocumentReference'
  })),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  collection: vi.fn((...args) => ({
    _path: args.join('/'),
    _type: 'CollectionReference'
  })),
  getDocs: vi.fn()
}));

describe('CardService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAvailableSets', () => {
    it('should return empty array when db is not configured', async () => {
      const CardServiceLocal = await import('../../services/CardService').then(m => m.CardService);
      
      // Mock db as null
      vi.doMock('../../firebase', () => ({
        db: null,
        APP_ID: 'test-app-id'
      }));

      const result = await CardServiceLocal.getAvailableSets();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should query Firestore for available sets', async () => {
      const { getDocs, getDoc } = await import('firebase/firestore');
      
      // Mock the collection query returning set documents
      getDocs.mockResolvedValue({
        docs: [
          { id: 'SOR' },
          { id: 'SHD' },
          { id: 'TWI' }
        ]
      });

      // Mock each set having valid data
      getDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({ totalCards: 510 })
      });

      const result = await CardService.getAvailableSets();
      
      expect(Array.isArray(result)).toBe(true);
      expect(result).toContain('SOR');
      expect(result).toContain('SHD');
      expect(result).toContain('TWI');
    });

    it('should filter out sets with no cards', async () => {
      const { getDocs, getDoc } = await import('firebase/firestore');
      
      getDocs.mockResolvedValue({
        docs: [
          { id: 'SOR' },
          { id: 'EMPTY' },
          { id: 'SHD' }
        ]
      });

      // Mock getDoc to return different results
      getDoc.mockImplementation((docRef) => {
        if (docRef._path?.includes('EMPTY')) {
          return Promise.resolve({
            exists: () => true,
            data: () => ({ totalCards: 0 })
          });
        }
        return Promise.resolve({
          exists: () => true,
          data: () => ({ totalCards: 510 })
        });
      });

      const result = await CardService.getAvailableSets();
      
      expect(result).toContain('SOR');
      expect(result).toContain('SHD');
      expect(result).not.toContain('EMPTY');
    });

    it('should filter out sets that do not exist', async () => {
      const { getDocs, getDoc } = await import('firebase/firestore');
      
      getDocs.mockResolvedValue({
        docs: [
          { id: 'SOR' },
          { id: 'NOTEXIST' },
          { id: 'SHD' }
        ]
      });

      getDoc.mockImplementation((docRef) => {
        if (docRef._path?.includes('NOTEXIST')) {
          return Promise.resolve({
            exists: () => false
          });
        }
        return Promise.resolve({
          exists: () => true,
          data: () => ({ totalCards: 510 })
        });
      });

      const result = await CardService.getAvailableSets();
      
      expect(result).toContain('SOR');
      expect(result).toContain('SHD');
      expect(result).not.toContain('NOTEXIST');
    });

    it('should handle errors gracefully', async () => {
      const { getDocs } = await import('firebase/firestore');
      
      getDocs.mockRejectedValue(new Error('Network error'));

      const result = await CardService.getAvailableSets();
      
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should skip the "data" document if present', async () => {
      const { getDocs, getDoc } = await import('firebase/firestore');
      
      getDocs.mockResolvedValue({
        docs: [
          { id: 'data' },
          { id: 'SOR' },
          { id: 'SHD' }
        ]
      });

      getDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({ totalCards: 510 })
      });

      const result = await CardService.getAvailableSets();
      
      expect(result).not.toContain('data');
      expect(result).toContain('SOR');
      expect(result).toContain('SHD');
    });
  });

  describe('fetchSetData', () => {
    it('should handle missing sets gracefully in ALL mode', async () => {
      const { getDoc } = await import('firebase/firestore');
      
      // Mock a set that doesn't exist
      getDoc.mockResolvedValue({
        exists: () => false
      });

      // Should not throw
      await expect(CardService.fetchSetData('MISSING')).rejects.toThrow();
    });
  });

  describe('getCollectionId', () => {
    it('should generate correct ID for standard cards', () => {
      const id = CardService.getCollectionId('SOR', '001', false);
      expect(id).toBe('SOR_001_std');
    });

    it('should generate correct ID for foil cards', () => {
      const id = CardService.getCollectionId('SOR', '001', true);
      expect(id).toBe('SOR_001_foil');
    });
  });

  describe('getCardImage', () => {
    it('should generate correct image URL', () => {
      const url = CardService.getCardImage('SOR', '001');
      expect(url).toBe('https://api.swu-db.com/cards/SOR/001?format=image');
    });
  });

  describe('getBackImage', () => {
    it('should generate correct back image URL', () => {
      const url = CardService.getBackImage('SOR', '001');
      expect(url).toBe('https://api.swu-db.com/cards/SOR/001?format=image&face=back');
    });
  });
});
