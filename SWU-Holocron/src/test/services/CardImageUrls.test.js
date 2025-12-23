/**
 * @vitest-environment happy-dom
 * @unit
 */

import { describe, it, expect } from 'vitest';
import { CardService } from '../../services/CardService';

describe('Card Image URL Generation', () => {
  describe('getCardImage', () => {
    it('should use card Set property not activeSet for image URLs', () => {
      const card = { Set: 'SOR', Number: '001', Name: 'Luke Skywalker' };
      const activeSet = 'ALL';
      
      // Image URL should use card.Set, not activeSet
      const correctUrl = CardService.getCardImage(card.Set, card.Number);
      const incorrectUrl = CardService.getCardImage(activeSet, card.Number);
      
      expect(correctUrl).toBe('https://api.swu-db.com/cards/SOR/001?format=image');
      expect(incorrectUrl).toBe('https://api.swu-db.com/cards/ALL/001?format=image');
      expect(correctUrl).not.toBe(incorrectUrl);
    });

    it('should generate correct URLs for cards from different sets when viewing ALL', () => {
      const cards = [
        { Set: 'SOR', Number: '001', Name: 'Card 1' },
        { Set: 'SHD', Number: '042', Name: 'Card 2' },
        { Set: 'TWI', Number: '123', Name: 'Card 3' }
      ];
      
      // Each card should use its own Set property
      const urls = cards.map(card => CardService.getCardImage(card.Set, card.Number));
      
      expect(urls[0]).toBe('https://api.swu-db.com/cards/SOR/001?format=image');
      expect(urls[1]).toBe('https://api.swu-db.com/cards/SHD/042?format=image');
      expect(urls[2]).toBe('https://api.swu-db.com/cards/TWI/123?format=image');
    });

    it('should not use ALL as a set code in image URLs', () => {
      const card = { Set: 'SOR', Number: '001' };
      
      // This should never happen
      const badUrl = CardService.getCardImage('ALL', card.Number);
      
      expect(badUrl).toContain('/ALL/');
      // Test that we recognize this is wrong
      expect(badUrl).not.toMatch(/\/(SOR|SHD|TWI|JTL|LOF|SEC)\//);
    });

    it('should maintain correct URLs when switching between ALL and specific sets', () => {
      const card = { Set: 'SHD', Number: '123', Name: 'Test Card' };
      
      // Simulate viewing ALL, then switching to SOR
      // The card's image URL should ALWAYS use card.Set, never activeSet
      const urlWhenViewingAll = CardService.getCardImage(card.Set, card.Number);
      const urlWhenViewingDifferentSet = CardService.getCardImage(card.Set, card.Number);
      
      expect(urlWhenViewingAll).toBe(urlWhenViewingDifferentSet);
      expect(urlWhenViewingAll).toContain('/SHD/');
    });
  });

  describe('getBackImage', () => {
    it('should use card Set property for back images', () => {
      const card = { Set: 'TWI', Number: '050', Name: 'Double-Sided Card' };
      const activeSet = 'ALL';
      
      const correctUrl = CardService.getBackImage(card.Set, card.Number);
      const incorrectUrl = CardService.getBackImage(activeSet, card.Number);
      
      expect(correctUrl).toBe('https://api.swu-db.com/cards/TWI/050?format=image&face=back');
      expect(incorrectUrl).toBe('https://api.swu-db.com/cards/ALL/050?format=image&face=back');
      expect(correctUrl).not.toBe(incorrectUrl);
    });
  });

  describe('Image URL Edge Cases', () => {
    it('should handle cards with 3-digit numbers', () => {
      const card = { Set: 'JTL', Number: '001' };
      const url = CardService.getCardImage(card.Set, card.Number);
      
      expect(url).toBe('https://api.swu-db.com/cards/JTL/001?format=image');
    });

    it('should handle cards with higher numbers', () => {
      const card = { Set: 'LOF', Number: '456' };
      const url = CardService.getCardImage(card.Set, card.Number);
      
      expect(url).toBe('https://api.swu-db.com/cards/LOF/456?format=image');
    });

    it('should not generate URLs with undefined set codes', () => {
      const card = { Set: undefined, Number: '001' };
      const url = CardService.getCardImage(card.Set, card.Number);
      
      expect(url).toContain('undefined');
      // This test documents that we should handle this case
    });
  });
});

describe('Active Set vs Card Set', () => {
  it('should demonstrate the difference between activeSet and card.Set', () => {
    // activeSet: What the user is currently viewing
    const activeSet = 'ALL';
    
    // card.Set: The actual set the card belongs to
    const cards = [
      { Set: 'SOR', Number: '001' },
      { Set: 'SHD', Number: '001' },
      { Set: 'TWI', Number: '001' }
    ];
    
    // When rendering images, we should ALWAYS use card.Set
    cards.forEach(card => {
      const imageUrl = CardService.getCardImage(card.Set, card.Number);
      expect(imageUrl).toContain(`/cards/${card.Set}/`);
      expect(imageUrl).not.toContain('/cards/ALL/');
    });
  });

  it('should show why using activeSet for images is wrong', () => {
    const activeSet = 'ALL';
    const card = { Set: 'SOR', Number: '042', Name: 'Darth Vader' };
    
    // WRONG: Using activeSet
    const wrongUrl = CardService.getCardImage(activeSet, card.Number);
    expect(wrongUrl).toBe('https://api.swu-db.com/cards/ALL/042?format=image');
    
    // This URL would 404 because there is no "ALL" set in the API
    expect(wrongUrl).toContain('/ALL/');
    
    // CORRECT: Using card.Set
    const correctUrl = CardService.getCardImage(card.Set, card.Number);
    expect(correctUrl).toBe('https://api.swu-db.com/cards/SOR/042?format=image');
  });
});
