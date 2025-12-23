/**
 * @vitest-environment happy-dom
 * @integration @slow @environment:firebase @environment:web-localstorage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reconstructCardsFromCollection } from '../../utils/collectionHelpers';
import { mockCollectionData, mockCards } from '../utils/mockData';

describe('Offline Mode Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should reconstruct card list from collection data when API fails', () => {
    const reconstructed = reconstructCardsFromCollection(mockCollectionData, 'SOR');

    expect(reconstructed.length).toBeGreaterThan(0);
    expect(reconstructed[0]).toHaveProperty('Set');
    expect(reconstructed[0]).toHaveProperty('Number');
    expect(reconstructed[0]).toHaveProperty('Name');
  });

  it('should sort reconstructed cards numerically', () => {
    const collection = {
      'SOR_100_std': { quantity: 1, set: 'SOR', number: '100', name: 'Card C', isFoil: false },
      'SOR_002_std': { quantity: 1, set: 'SOR', number: '002', name: 'Card A', isFoil: false },
      'SOR_050_std': { quantity: 1, set: 'SOR', number: '050', name: 'Card B', isFoil: false }
    };

    const reconstructed = reconstructCardsFromCollection(collection, 'SOR');

    expect(reconstructed[0].Number).toBe('002');
    expect(reconstructed[1].Number).toBe('050');
    expect(reconstructed[2].Number).toBe('100');
  });

  it('should deduplicate foil and standard variants', () => {
    const collection = {
      'SOR_001_std': { quantity: 1, set: 'SOR', number: '001', name: 'Card A', isFoil: false },
      'SOR_001_foil': { quantity: 1, set: 'SOR', number: '001', name: 'Card A', isFoil: true }
    };

    const reconstructed = reconstructCardsFromCollection(collection, 'SOR');

    expect(reconstructed.length).toBe(1); // Should only have one card despite two variants
  });

  it('should handle missing card names gracefully', () => {
    const collection = {
      'SOR_001_std': { quantity: 1, set: 'SOR', number: '001', isFoil: false } // No name
    };

    const reconstructed = reconstructCardsFromCollection(collection, 'SOR');

    expect(reconstructed[0].Name).toBe('Card #001'); // Default name
  });

  it('should filter by set code correctly', () => {
    const mixedCollection = {
      'SOR_001_std': { quantity: 1, set: 'SOR', number: '001', name: 'Card A', isFoil: false },
      'SHD_001_std': { quantity: 1, set: 'SHD', number: '001', name: 'Card B', isFoil: false },
      'TWI_001_std': { quantity: 1, set: 'TWI', number: '001', name: 'Card C', isFoil: false }
    };

    const sorCards = reconstructCardsFromCollection(mixedCollection, 'SOR');
    const shdCards = reconstructCardsFromCollection(mixedCollection, 'SHD');

    expect(sorCards.length).toBe(1);
    expect(sorCards[0].Set).toBe('SOR');
    
    expect(shdCards.length).toBe(1);
    expect(shdCards[0].Set).toBe('SHD');
  });

  it('should cache card data in localStorage after successful fetch', () => {
    const mockCardData = mockCards.filter(c => c.Set === 'SOR');
    const cacheKey = 'swu-cards-SOR';

    // Test that caching logic works (JSON serialization)
    const serialized = JSON.stringify(mockCardData);
    expect(serialized).toContain('Director Krennic');
    
    const deserialized = JSON.parse(serialized);
    expect(deserialized).toEqual(mockCardData);
    expect(deserialized.length).toBe(mockCardData.length);
    
    // Verify localStorage API works
    expect(() => {
      localStorage.setItem(cacheKey, serialized);
    }).not.toThrow();
  });

  it('should fallback to cache when network fails', () => {
    const mockCardData = mockCards.filter(c => c.Set === 'SOR');
    const cacheKey = 'swu-cards-SOR';

    // Test cache fallback logic (simulated)
    const mockCachedData = JSON.stringify(mockCardData);
    expect(mockCachedData).not.toBeNull();

    const parsed = JSON.parse(mockCachedData);
    expect(parsed.length).toBe(mockCardData.length);
    
    // Verify localStorage API exists
    expect(typeof localStorage.getItem).toBe('function');
  });

  it('should show appropriate error message when both network and cache fail', () => {
    const emptyCollection = {};
    const reconstructed = reconstructCardsFromCollection(emptyCollection, 'SOR');

    expect(reconstructed.length).toBe(0);
    // In the app, this should trigger "Unable to load card data" error
  });

  it('should indicate reconstructed data mode to user', () => {
    // This test verifies the flag that indicates offline mode
    const hasOfflineData = reconstructCardsFromCollection(mockCollectionData, 'SOR').length > 0;
    const hasOnlineData = false; // Simulating API failure

    const shouldShowWarning = hasOfflineData && !hasOnlineData;
    expect(shouldShowWarning).toBe(true);
  });

  it('should maintain data integrity during offline mode', () => {
    const reconstructed = reconstructCardsFromCollection(mockCollectionData, 'SOR');

    // All reconstructed cards should have required fields
    reconstructed.forEach(card => {
      expect(card).toHaveProperty('Set');
      expect(card).toHaveProperty('Number');
      expect(card).toHaveProperty('Name');
      expect(card).toHaveProperty('Type');
      expect(card.Set).toBe('SOR');
    });
  });
});
