/**
 * @vitest-environment happy-dom
 * @unit @critical @environment:firebase
 */

import { describe, it, expect } from 'vitest';
import {
  getCollectionId,
  parseCollectionId,
  reconstructCardsFromCollection,
  getCardQuantities,
  isHorizontalCard,
  getPlaysetQuantity
} from '../../utils/collectionHelpers';

describe('collectionHelpers', () => {
  describe('getCollectionId', () => {
    it('should generate standard collection ID', () => {
      expect(getCollectionId('SOR', '001', false)).toBe('SOR_001_std');
    });

    it('should generate foil collection ID', () => {
      expect(getCollectionId('SOR', '001', true)).toBe('SOR_001_foil');
    });

    it('should handle different set codes', () => {
      expect(getCollectionId('SHD', '123', false)).toBe('SHD_123_std');
      expect(getCollectionId('TWI', '456', true)).toBe('TWI_456_foil');
    });

    it('should throw error for missing set', () => {
      expect(() => getCollectionId('', '001', false)).toThrow('Set and number are required');
      expect(() => getCollectionId(null, '001', false)).toThrow('Set and number are required');
    });

    it('should throw error for missing number', () => {
      expect(() => getCollectionId('SOR', '', false)).toThrow('Set and number are required');
      expect(() => getCollectionId('SOR', null, false)).toThrow('Set and number are required');
    });
  });

  describe('parseCollectionId', () => {
    it('should parse standard collection ID', () => {
      const result = parseCollectionId('SOR_001_std');
      expect(result).toEqual({ set: 'SOR', number: '001', isFoil: false });
    });

    it('should parse foil collection ID', () => {
      const result = parseCollectionId('SOR_001_foil');
      expect(result).toEqual({ set: 'SOR', number: '001', isFoil: true });
    });

    it('should throw error for invalid format', () => {
      expect(() => parseCollectionId('SOR_001')).toThrow('Invalid collection ID format');
      expect(() => parseCollectionId('INVALID')).toThrow('Invalid collection ID format');
      expect(() => parseCollectionId('SOR_001_std_extra')).toThrow('Invalid collection ID format');
    });
  });

  describe('reconstructCardsFromCollection', () => {
    it('should reconstruct cards from collection data', () => {
      const collectionData = {
        'SOR_001_std': { quantity: 1, set: 'SOR', number: '001', name: 'Director Krennic', isFoil: false },
        'SOR_001_foil': { quantity: 1, set: 'SOR', number: '001', name: 'Director Krennic', isFoil: true },
        'SOR_003_std': { quantity: 3, set: 'SOR', number: '003', name: 'Chewbacca', isFoil: false }
      };

      const result = reconstructCardsFromCollection(collectionData, 'SOR');
      
      expect(result).toHaveLength(2); // Two unique cards (001 and 003)
      expect(result[0]).toMatchObject({
        Set: 'SOR',
        Number: '001',
        Name: 'Director Krennic'
      });
      expect(result[1]).toMatchObject({
        Set: 'SOR',
        Number: '003',
        Name: 'Chewbacca'
      });
    });

    it('should filter by set code', () => {
      const collectionData = {
        'SOR_001_std': { quantity: 1, set: 'SOR', number: '001', name: 'Card A', isFoil: false },
        'SHD_002_std': { quantity: 1, set: 'SHD', number: '002', name: 'Card B', isFoil: false }
      };

      const result = reconstructCardsFromCollection(collectionData, 'SOR');
      expect(result).toHaveLength(1);
      expect(result[0].Set).toBe('SOR');
    });

    it('should sort cards by number', () => {
      const collectionData = {
        'SOR_100_std': { quantity: 1, set: 'SOR', number: '100', name: 'Card C', isFoil: false },
        'SOR_002_std': { quantity: 1, set: 'SOR', number: '002', name: 'Card A', isFoil: false },
        'SOR_050_std': { quantity: 1, set: 'SOR', number: '050', name: 'Card B', isFoil: false }
      };

      const result = reconstructCardsFromCollection(collectionData, 'SOR');
      expect(result[0].Number).toBe('002');
      expect(result[1].Number).toBe('050');
      expect(result[2].Number).toBe('100');
    });

    it('should return empty array for empty collection', () => {
      expect(reconstructCardsFromCollection({}, 'SOR')).toEqual([]);
    });

    it('should return empty array for missing parameters', () => {
      expect(reconstructCardsFromCollection(null, 'SOR')).toEqual([]);
      expect(reconstructCardsFromCollection({}, null)).toEqual([]);
    });

    it('should handle missing card names', () => {
      const collectionData = {
        'SOR_001_std': { quantity: 1, set: 'SOR', number: '001', isFoil: false }
      };

      const result = reconstructCardsFromCollection(collectionData, 'SOR');
      expect(result[0].Name).toBe('Card #001');
    });
  });

  describe('getCardQuantities', () => {
    const collectionData = {
      'SOR_001_std': { quantity: 2, set: 'SOR', number: '001', name: 'Card A', isFoil: false },
      'SOR_001_foil': { quantity: 1, set: 'SOR', number: '001', name: 'Card A', isFoil: true },
      'SOR_002_std': { quantity: 3, set: 'SOR', number: '002', name: 'Card B', isFoil: false }
    };

    it('should return both standard and foil quantities', () => {
      const result = getCardQuantities(collectionData, 'SOR', '001');
      expect(result).toEqual({
        standard: 2,
        foil: 1,
        total: 3
      });
    });

    it('should return zero for non-existent cards', () => {
      const result = getCardQuantities(collectionData, 'SOR', '999');
      expect(result).toEqual({
        standard: 0,
        foil: 0,
        total: 0
      });
    });

    it('should handle cards with only standard variant', () => {
      const result = getCardQuantities(collectionData, 'SOR', '002');
      expect(result).toEqual({
        standard: 3,
        foil: 0,
        total: 3
      });
    });
  });

  describe('isHorizontalCard', () => {
    it('should return true for Leader cards', () => {
      expect(isHorizontalCard('Leader')).toBe(true);
    });

    it('should return true for Base cards', () => {
      expect(isHorizontalCard('Base')).toBe(true);
    });

    it('should return false for Unit cards', () => {
      expect(isHorizontalCard('Unit')).toBe(false);
    });

    it('should return false for Event cards', () => {
      expect(isHorizontalCard('Event')).toBe(false);
    });

    it('should return false for Upgrade cards', () => {
      expect(isHorizontalCard('Upgrade')).toBe(false);
    });
  });

  describe('getPlaysetQuantity', () => {
    it('should return 1 for Leader cards', () => {
      expect(getPlaysetQuantity('Leader')).toBe(1);
    });

    it('should return 1 for Base cards', () => {
      expect(getPlaysetQuantity('Base')).toBe(1);
    });

    it('should return 3 for Unit cards', () => {
      expect(getPlaysetQuantity('Unit')).toBe(3);
    });

    it('should return 3 for Event cards', () => {
      expect(getPlaysetQuantity('Event')).toBe(3);
    });

    it('should return 3 for Upgrade cards', () => {
      expect(getPlaysetQuantity('Upgrade')).toBe(3);
    });
  });
});
