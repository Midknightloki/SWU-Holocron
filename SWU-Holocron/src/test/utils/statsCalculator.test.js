/**
 * @vitest-environment happy-dom
 * @unit @critical
 */

import { describe, it, expect } from 'vitest';
import {
  calculateStats,
  calculateGlobalSummary,
  calculateSetCompletion,
  calculateRarityBreakdown
} from '../../utils/statsCalculator';
import { mockCards, mockCollectionData } from '../utils/mockData';

describe('statsCalculator', () => {
  describe('calculateStats', () => {
    it('should calculate basic stats for a set', () => {
      const cards = mockCards.filter(c => c.Set === 'SOR');
      const result = calculateStats(cards, mockCollectionData, 'SOR');
      
      expect(result).toBeDefined();
      expect(result.totalCards).toBe(5);
      expect(result.totalUniqueCards).toBe(5);
      expect(result.ownedUniqueCount).toBe(4); // Director, Chewbacca, Luke, Vader
      expect(result.ownedTotal).toBe(8); // 2 + 3 + 2 + 1
    });

    it('should calculate percentage complete', () => {
      const cards = mockCards.filter(c => c.Set === 'SOR');
      const result = calculateStats(cards, mockCollectionData, 'SOR');
      
      expect(result.percentComplete).toBe(80); // 4/5 = 80%
    });

    it('should identify missing cards', () => {
      const cards = mockCards.filter(c => c.Set === 'SOR');
      const result = calculateStats(cards, mockCollectionData, 'SOR');
      
      expect(result.missingList).toHaveLength(1);
      expect(result.missingList[0].Name).toBe('Iden Versio');
    });

    it('should sort missing cards by number', () => {
      const cards = [
        { Set: 'SOR', Number: '100', Name: 'Card C', Type: 'Unit', Aspects: [] },
        { Set: 'SOR', Number: '010', Name: 'Card B', Type: 'Unit', Aspects: [] },
        { Set: 'SOR', Number: '003', Name: 'Card A', Type: 'Unit', Aspects: [] }
      ];
      const result = calculateStats(cards, {}, 'SOR');
      
      expect(result.missingList[0].Number).toBe('003');
      expect(result.missingList[1].Number).toBe('010');
      expect(result.missingList[2].Number).toBe('100');
    });

    it('should count playsets correctly', () => {
      const cards = [
        { Set: 'SOR', Number: '001', Name: 'Leader', Type: 'Leader', Aspects: [] },
        { Set: 'SOR', Number: '002', Name: 'Base', Type: 'Base', Aspects: [] },
        { Set: 'SOR', Number: '003', Name: 'Unit', Type: 'Unit', Aspects: [] }
      ];
      const collection = {
        'SOR_001_std': { quantity: 1, set: 'SOR', number: '001', name: 'Leader', isFoil: false },
        'SOR_002_std': { quantity: 1, set: 'SOR', number: '002', name: 'Base', isFoil: false },
        'SOR_003_std': { quantity: 3, set: 'SOR', number: '003', name: 'Unit', isFoil: false }
      };
      
      const result = calculateStats(cards, collection, 'SOR');
      expect(result.playsetsCount).toBe(3); // All have required quantities
    });

    it('should not count incomplete playsets', () => {
      const cards = [
        { Set: 'SOR', Number: '001', Name: 'Leader', Type: 'Leader', Aspects: [] },
        { Set: 'SOR', Number: '002', Name: 'Unit', Type: 'Unit', Aspects: [] }
      ];
      const collection = {
        'SOR_001_std': { quantity: 1, set: 'SOR', number: '001', name: 'Leader', isFoil: false },
        'SOR_002_std': { quantity: 2, set: 'SOR', number: '002', name: 'Unit', isFoil: false } // Need 3
      };
      
      const result = calculateStats(cards, collection, 'SOR');
      expect(result.playsetsCount).toBe(1); // Only leader is complete
    });

    it('should sum foil and standard quantities', () => {
      const cards = [
        { Set: 'SOR', Number: '001', Name: 'Card', Type: 'Unit', Aspects: [] }
      ];
      const collection = {
        'SOR_001_std': { quantity: 2, set: 'SOR', number: '001', name: 'Card', isFoil: false },
        'SOR_001_foil': { quantity: 1, set: 'SOR', number: '001', name: 'Card', isFoil: true }
      };
      
      const result = calculateStats(cards, collection, 'SOR');
      expect(result.ownedTotal).toBe(3);
      expect(result.playsetsCount).toBe(1); // 2+1 = 3, which is a playset
    });

    it('should handle cards with same name but different numbers', () => {
      const cards = [
        { Set: 'SOR', Number: '001', Name: 'Card', Subtitle: 'Version A', Type: 'Unit', Aspects: [] },
        { Set: 'SOR', Number: '002', Name: 'Card', Subtitle: 'Version B', Type: 'Unit', Aspects: [] }
      ];
      const collection = {
        'SOR_001_std': { quantity: 3, set: 'SOR', number: '001', name: 'Card', isFoil: false }
      };
      
      const result = calculateStats(cards, collection, 'SOR');
      expect(result.totalUniqueCards).toBe(2); // Two different cards
      expect(result.ownedUniqueCount).toBe(1); // Only own one version
    });

    it('should return null for empty card array', () => {
      expect(calculateStats([], {}, 'SOR')).toBeNull();
      expect(calculateStats(null, {}, 'SOR')).toBeNull();
    });

    it('should handle empty collection data', () => {
      const cards = mockCards.filter(c => c.Set === 'SOR');
      const result = calculateStats(cards, {}, 'SOR');
      
      expect(result.ownedUniqueCount).toBe(0);
      expect(result.ownedTotal).toBe(0);
      expect(result.playsetsCount).toBe(0);
      expect(result.percentComplete).toBe(0);
      expect(result.missingList).toHaveLength(5);
    });
  });

  describe('calculateGlobalSummary', () => {
    it('should sum quantities by set', () => {
      const collection = {
        'SOR_001_std': { quantity: 2, set: 'SOR', number: '001', name: 'Card A', isFoil: false },
        'SOR_002_std': { quantity: 3, set: 'SOR', number: '002', name: 'Card B', isFoil: false },
        'SHD_001_std': { quantity: 1, set: 'SHD', number: '001', name: 'Card C', isFoil: false },
        'TWI_001_std': { quantity: 5, set: 'TWI', number: '001', name: 'Card D', isFoil: false }
      };
      
      const result = calculateGlobalSummary(collection);
      
      expect(result).toEqual({
        SOR: 5,
        SHD: 1,
        TWI: 5
      });
    });

    it('should handle empty collection', () => {
      const result = calculateGlobalSummary({});
      expect(result).toEqual({});
    });

    it('should handle collection without set property', () => {
      const collection = {
        'invalid_key': { quantity: 1, number: '001', name: 'Card', isFoil: false }
      };
      
      const result = calculateGlobalSummary(collection);
      expect(result).toEqual({});
    });
  });

  describe('calculateSetCompletion', () => {
    it('should return completion percentage', () => {
      const cards = mockCards.filter(c => c.Set === 'SOR');
      const result = calculateSetCompletion(cards, mockCollectionData, 'SOR');
      
      expect(result).toBe(80); // 4/5 cards owned
    });

    it('should return 0 for empty card list', () => {
      const result = calculateSetCompletion([], {}, 'SOR');
      expect(result).toBe(0);
    });

    it('should return 100 for complete set', () => {
      const cards = [
        { Set: 'SOR', Number: '001', Name: 'Card A', Type: 'Unit', Aspects: [] }
      ];
      const collection = {
        'SOR_001_std': { quantity: 1, set: 'SOR', number: '001', name: 'Card A', isFoil: false }
      };
      
      const result = calculateSetCompletion(cards, collection, 'SOR');
      expect(result).toBe(100);
    });
  });

  describe('calculateRarityBreakdown', () => {
    it('should count owned cards by rarity', () => {
      const cards = mockCards.filter(c => c.Set === 'SOR');
      const result = calculateRarityBreakdown(cards, mockCollectionData, 'SOR');
      
      expect(result).toHaveProperty('Rare');
      expect(result).toHaveProperty('Uncommon');
      expect(result).toHaveProperty('Legendary');
      expect(result.Rare).toBeGreaterThan(0);
    });

    it('should only count owned cards', () => {
      const cards = [
        { Set: 'SOR', Number: '001', Name: 'Card A', Type: 'Unit', Aspects: [], Rarity: 'Common' },
        { Set: 'SOR', Number: '002', Name: 'Card B', Type: 'Unit', Aspects: [], Rarity: 'Rare' }
      ];
      const collection = {
        'SOR_001_std': { quantity: 1, set: 'SOR', number: '001', name: 'Card A', isFoil: false }
      };
      
      const result = calculateRarityBreakdown(cards, collection, 'SOR');
      
      expect(result.Common).toBe(1);
      expect(result.Rare).toBeUndefined();
    });

    it('should sum foil and standard for rarity count', () => {
      const cards = [
        { Set: 'SOR', Number: '001', Name: 'Card', Type: 'Unit', Aspects: [], Rarity: 'Rare' }
      ];
      const collection = {
        'SOR_001_std': { quantity: 1, set: 'SOR', number: '001', name: 'Card', isFoil: false },
        'SOR_001_foil': { quantity: 1, set: 'SOR', number: '001', name: 'Card', isFoil: true }
      };
      
      const result = calculateRarityBreakdown(cards, collection, 'SOR');
      expect(result.Rare).toBe(1); // Count unique card once
    });

    it('should handle cards without rarity', () => {
      const cards = [
        { Set: 'SOR', Number: '001', Name: 'Card', Type: 'Unit', Aspects: [] }
      ];
      const collection = {
        'SOR_001_std': { quantity: 1, set: 'SOR', number: '001', name: 'Card', isFoil: false }
      };
      
      const result = calculateRarityBreakdown(cards, collection, 'SOR');
      expect(result.Common).toBe(1); // Defaults to Common
    });

    it('should return empty object for no owned cards', () => {
      const cards = mockCards.filter(c => c.Set === 'SOR');
      const result = calculateRarityBreakdown(cards, {}, 'SOR');
      
      expect(result).toEqual({});
    });
  });
});
