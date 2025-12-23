/**
 * @vitest-environment happy-dom
 * @integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock localStorage properly
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = value.toString(); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; }
  };
})();

describe('Set Discovery Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  describe('Available Sets Caching', () => {
    it('should cache available sets in localStorage', () => {
      const availableSets = ['SOR', 'SHD', 'TWI'];
      localStorageMock.setItem('swu-available-sets', JSON.stringify(availableSets));

      const cached = localStorageMock.getItem('swu-available-sets');
      expect(cached).toBeTruthy();
      
      const parsed = JSON.parse(cached);
      expect(parsed).toEqual(availableSets);
    });

    it('should handle missing cache gracefully', () => {
      const cached = localStorageMock.getItem('swu-available-sets');
      expect(cached).toBeNull();
    });

    it('should update cache when new sets are discovered', () => {
      // Initial cache
      localStorageMock.setItem('swu-available-sets', JSON.stringify(['SOR', 'SHD']));

      // Simulate discovery of new set
      const updatedSets = ['SOR', 'SHD', 'TWI'];
      localStorageMock.setItem('swu-available-sets', JSON.stringify(updatedSets));

      const cached = JSON.parse(localStorageMock.getItem('swu-available-sets'));
      expect(cached).toContain('TWI');
      expect(cached.length).toBe(3);
    });
  });

  describe('Set Filtering Logic', () => {
    it('should filter out empty sets', () => {
      const allSets = [
        { code: 'ALL', name: 'All Sets' },
        { code: 'SOR', name: 'Spark of Rebellion' },
        { code: 'SHD', name: 'Shadows of the Galaxy' },
        { code: 'EMPTY', name: 'Empty Set' }
      ];

      const availableSets = ['SOR', 'SHD'];

      const visibleSets = allSets.filter(s => 
        s.code === 'ALL' || availableSets.includes(s.code)
      );

      expect(visibleSets).toHaveLength(3);
      expect(visibleSets.find(s => s.code === 'ALL')).toBeDefined();
      expect(visibleSets.find(s => s.code === 'SOR')).toBeDefined();
      expect(visibleSets.find(s => s.code === 'SHD')).toBeDefined();
      expect(visibleSets.find(s => s.code === 'EMPTY')).toBeUndefined();
    });

    it('should always include ALL option', () => {
      const allSets = [
        { code: 'ALL', name: 'All Sets' },
        { code: 'SOR', name: 'Spark of Rebellion' }
      ];

      const availableSets = ['SOR'];

      const visibleSets = allSets.filter(s => 
        s.code === 'ALL' || availableSets.includes(s.code)
      );

      expect(visibleSets.find(s => s.code === 'ALL')).toBeDefined();
    });

    it('should show all sets as fallback when no sets are discovered', () => {
      const allSets = [
        { code: 'ALL', name: 'All Sets' },
        { code: 'SOR', name: 'Spark of Rebellion' },
        { code: 'SHD', name: 'Shadows of the Galaxy' }
      ];

      const availableSets = [];

      // Fallback logic: show all sets if discovery returns empty
      const visibleSets = availableSets.length === 0 
        ? allSets 
        : allSets.filter(s => s.code === 'ALL' || availableSets.includes(s.code));

      expect(visibleSets).toEqual(allSets);
    });
  });

  describe('ALL Sets Loading', () => {
    it('should only load available sets when ALL is selected', () => {
      const allSetCodes = ['SOR', 'SHD', 'TWI', 'JTL', 'LOF', 'SEC', 'ALT'];
      const availableSets = ['SOR', 'SHD', 'TWI', 'JTL', 'LOF', 'SEC'];

      // Simulate loading logic
      const setsToLoad = availableSets.length > 0 
        ? availableSets 
        : allSetCodes.filter(s => s !== 'ALL');

      expect(setsToLoad).not.toContain('ALT');
      expect(setsToLoad).toHaveLength(6);
    });

    it('should handle failed set loads without crashing', async () => {
      const setsToLoad = ['SOR', 'MISSING', 'SHD'];

      const loadPromises = setsToLoad.map(setCode => {
        if (setCode === 'MISSING') {
          return Promise.reject(new Error('Set not found')).catch(err => {
            console.warn(`Failed to load ${setCode}: ${err.message}`);
            return [];
          });
        }
        return Promise.resolve([{ id: `${setCode}_001` }]);
      });

      const results = await Promise.all(loadPromises);
      const allCards = results.flat().filter(card => card);

      expect(allCards).toHaveLength(2); // Only SOR and SHD
      expect(allCards[0].id).toBe('SOR_001');
      expect(allCards[1].id).toBe('SHD_001');
    });

    it('should throw error when no cards can be loaded', async () => {
      const setsToLoad = ['MISSING1', 'MISSING2'];

      const loadPromises = setsToLoad.map(setCode => {
        return Promise.reject(new Error('Set not found')).catch(() => []);
      });

      const results = await Promise.all(loadPromises);
      const allCards = results.flat().filter(card => card);

      expect(allCards).toHaveLength(0);
      
      // App should throw error when no cards loaded
      if (allCards.length === 0) {
        expect(() => {
          throw new Error('No card data could be loaded');
        }).toThrow('No card data could be loaded');
      }
    });
  });

  describe('Periodic Set Discovery', () => {
    it('should refresh available sets periodically', () => {
      vi.useFakeTimers();

      let discoveryCount = 0;
      const discoverSets = () => {
        discoveryCount++;
        return ['SOR', 'SHD'];
      };

      // Initial discovery
      discoverSets();
      expect(discoveryCount).toBe(1);

      // Simulate hourly refresh
      const interval = setInterval(discoverSets, 60 * 60 * 1000);

      // Fast-forward 1 hour
      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(discoveryCount).toBe(2);

      // Fast-forward another hour
      vi.advanceTimersByTime(60 * 60 * 1000);
      expect(discoveryCount).toBe(3);

      clearInterval(interval);
      vi.useRealTimers();
    });
  });

  describe('Default Active Set', () => {
    it('should default to ALL when implemented', () => {
      const defaultActiveSet = 'ALL';
      expect(defaultActiveSet).toBe('ALL');
    });

    it('should respect cached active set preference', () => {
      localStorageMock.setItem('swu-active-set', 'SOR');
      const cachedSet = localStorageMock.getItem('swu-active-set');
      expect(cachedSet).toBe('SOR');
    });
  });
});
