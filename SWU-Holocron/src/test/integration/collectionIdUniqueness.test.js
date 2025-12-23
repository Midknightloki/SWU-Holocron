/**
 * @vitest-environment happy-dom
 * @integration
 */

import { describe, it, expect } from 'vitest';
import { CardService } from '../../services/CardService';

describe('Collection ID Uniqueness', () => {
  describe('Same Card Number Across Different Sets', () => {
    it('should generate unique IDs for same card number in different sets', () => {
      // Example: Card 17 exists in both SHD (Lando) and JTL (Han)
      const shdCard17 = { Set: 'SHD', Number: '017', Name: 'Lando Calrissian' };
      const jtlCard17 = { Set: 'JTL', Number: '017', Name: 'Han Solo' };
      
      const shdId = CardService.getCollectionId(shdCard17.Set, shdCard17.Number, false);
      const jtlId = CardService.getCollectionId(jtlCard17.Set, jtlCard17.Number, false);
      
      // These MUST be different
      expect(shdId).not.toBe(jtlId);
      expect(shdId).toBe('SHD_017_std');
      expect(jtlId).toBe('JTL_017_std');
    });

    it('should include set code in collection ID to prevent collisions', () => {
      const testCases = [
        { Set: 'SOR', Number: '001', expected: 'SOR_001_std' },
        { Set: 'SHD', Number: '001', expected: 'SHD_001_std' },
        { Set: 'TWI', Number: '001', expected: 'TWI_001_std' },
        { Set: 'JTL', Number: '042', expected: 'JTL_042_std' },
        { Set: 'LOF', Number: '100', expected: 'LOF_100_std' }
      ];

      testCases.forEach(({ Set, Number, expected }) => {
        const id = CardService.getCollectionId(Set, Number, false);
        expect(id).toBe(expected);
        expect(id).toContain(Set); // MUST include set code
      });
    });

    it('should prevent card 17 from SHD showing JTL data', () => {
      // Simulating the bug: Looking up SHD card 17 but getting JTL data
      const shdCard17 = { Set: 'SHD', Number: '017', Name: 'Lando Calrissian' };
      
      // WRONG: Using just number without set
      const wrongId = `017_std`; // This would collide!
      
      // CORRECT: Using set + number
      const correctId = CardService.getCollectionId(shdCard17.Set, shdCard17.Number, false);
      
      expect(correctId).not.toBe(wrongId);
      expect(correctId).toContain('SHD');
    });
  });

  describe('Collection Data Lookup', () => {
    it('should look up collection data using set-specific ID', () => {
      const card = { Set: 'SHD', Number: '017', Name: 'Lando Calrissian' };
      
      // Collection data structure
      const collectionData = {
        'SHD_017_std': { quantity: 3, isFoil: false },
        'JTL_017_std': { quantity: 1, isFoil: false }
      };
      
      // Looking up SHD card should NOT get JTL data
      const collectionId = CardService.getCollectionId(card.Set, card.Number, false);
      const cardData = collectionData[collectionId];
      
      expect(cardData).toBeDefined();
      expect(cardData.quantity).toBe(3);
      expect(collectionId).toBe('SHD_017_std');
    });

    it('should demonstrate the collision bug scenario', () => {
      // This test documents the actual bug reported
      const shdLando = { Set: 'SHD', Number: '017', Name: 'Lando Calrissian' };
      const jtlHan = { Set: 'JTL', Number: '017', Name: 'Han Solo' };
      
      const collectionData = {
        'SHD_017_std': { quantity: 2 },
        'JTL_017_std': { quantity: 5 }
      };
      
      // When viewing SHD in binder, we should get Lando's data
      const shdId = CardService.getCollectionId(shdLando.Set, shdLando.Number, false);
      expect(collectionData[shdId].quantity).toBe(2);
      
      // NOT JTL's Han Solo data
      const jtlId = CardService.getCollectionId(jtlHan.Set, jtlHan.Number, false);
      expect(collectionData[jtlId].quantity).toBe(5);
      expect(shdId).not.toBe(jtlId);
    });

    it('should handle ALL view with cards from multiple sets having same number', () => {
      const cards = [
        { Set: 'SOR', Number: '001', Name: 'Card A' },
        { Set: 'SHD', Number: '001', Name: 'Card B' },
        { Set: 'TWI', Number: '001', Name: 'Card C' }
      ];
      
      const collectionData = {
        'SOR_001_std': { quantity: 1 },
        'SHD_001_std': { quantity: 2 },
        'TWI_001_std': { quantity: 3 }
      };
      
      // Each card should get its own collection data
      cards.forEach(card => {
        const id = CardService.getCollectionId(card.Set, card.Number, false);
        const data = collectionData[id];
        expect(data).toBeDefined();
        expect(id).toContain(card.Set);
      });
    });
  });

  describe('Foil vs Standard Uniqueness', () => {
    it('should create separate IDs for foil and standard versions', () => {
      const card = { Set: 'SHD', Number: '017' };
      
      const stdId = CardService.getCollectionId(card.Set, card.Number, false);
      const foilId = CardService.getCollectionId(card.Set, card.Number, true);
      
      expect(stdId).toBe('SHD_017_std');
      expect(foilId).toBe('SHD_017_foil');
      expect(stdId).not.toBe(foilId);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero-padded numbers correctly', () => {
      const testCases = [
        { Number: '001', expected: 'SOR_001_std' },
        { Number: '017', expected: 'SOR_017_std' },
        { Number: '100', expected: 'SOR_100_std' }
      ];

      testCases.forEach(({ Number, expected }) => {
        const id = CardService.getCollectionId('SOR', Number, false);
        expect(id).toBe(expected);
      });
    });

    it('should handle cards with same number in ALL view rendering', () => {
      // When activeSet is ALL, each card must use its own Set property
      const activeSet = 'ALL';
      const card = { Set: 'SHD', Number: '017', Name: 'Lando' };
      
      // WRONG: Would use activeSet
      // const wrongId = CardService.getCollectionId(activeSet, card.Number, false);
      // expect(wrongId).toBe('ALL_017_std'); // This would be wrong!
      
      // CORRECT: Must use card.Set
      const correctId = CardService.getCollectionId(card.Set, card.Number, false);
      expect(correctId).toBe('SHD_017_std');
      expect(correctId).not.toContain('ALL');
    });
  });
});
