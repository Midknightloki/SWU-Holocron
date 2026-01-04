/**
 * @vitest-environment happy-dom
 * @unit
 */

import { describe, it, expect } from 'vitest';
import { ASPECTS } from '../../constants';

describe('Aspect Filtering - Neutral Support', () => {
  describe('ASPECTS constant', () => {
    it('should include Neutral aspect', () => {
      const neutralAspect = ASPECTS.find(a => a.name === 'Neutral');
      expect(neutralAspect).toBeDefined();
      expect(neutralAspect.name).toBe('Neutral');
    });

    it('should have icon for Neutral aspect', () => {
      const neutralAspect = ASPECTS.find(a => a.name === 'Neutral');
      expect(neutralAspect.icon).toBeDefined();
      expect(typeof neutralAspect.icon).toBe('object'); // Lucide React icon
    });

    it('should have color styling for Neutral aspect', () => {
      const neutralAspect = ASPECTS.find(a => a.name === 'Neutral');
      expect(neutralAspect.color).toBeDefined();
      expect(neutralAspect.bg).toBeDefined();
      expect(neutralAspect.border).toBeDefined();
      expect(neutralAspect.color).toContain('gray'); // Gray color scheme
    });

    it('should have all 7 aspects (6 standard + neutral)', () => {
      expect(ASPECTS).toHaveLength(7);
      const aspectNames = ASPECTS.map(a => a.name);
      expect(aspectNames).toContain('Aggression');
      expect(aspectNames).toContain('Vigilance');
      expect(aspectNames).toContain('Command');
      expect(aspectNames).toContain('Cunning');
      expect(aspectNames).toContain('Heroism');
      expect(aspectNames).toContain('Villainy');
      expect(aspectNames).toContain('Neutral');
    });
  });

  describe('Neutral card detection logic', () => {
    it('should identify cards with no aspects as neutral', () => {
      const cardWithEmptyArray = { Name: 'Base', Aspects: [] };
      const cardWithNull = { Name: 'Token', Aspects: null };
      const cardWithUndefined = { Name: 'Special' };

      // Test the logic pattern used in App.jsx and AdvancedSearch.jsx
      const isNeutral = (card) => !card.Aspects || card.Aspects.length === 0;

      expect(isNeutral(cardWithEmptyArray)).toBe(true);
      expect(isNeutral(cardWithNull)).toBe(true);
      expect(isNeutral(cardWithUndefined)).toBe(true);
    });

    it('should identify cards with aspects as non-neutral', () => {
      const cardWithAspects = { Name: 'Luke Skywalker', Aspects: ['Heroism', 'Vigilance'] };
      const isNeutral = (card) => !card.Aspects || card.Aspects.length === 0;

      expect(isNeutral(cardWithAspects)).toBe(false);
    });

    it('should filter neutral cards correctly in aspect filter', () => {
      const cards = [
        { Name: 'Luke', Aspects: ['Heroism'] },
        { Name: 'Base', Aspects: [] },
        { Name: 'Vader', Aspects: ['Villainy'] },
        { Name: 'Token', Aspects: null },
        { Name: 'Han', Aspects: ['Heroism', 'Command'] }
      ];

      // Simulate aspect filter logic from App.jsx
      const filterByAspect = (cards, selectedAspect) => {
        return cards.filter(card => {
          const isNeutral = !card.Aspects || card.Aspects.length === 0;
          if (selectedAspect === 'All') return true;
          if (selectedAspect === 'Neutral') return isNeutral;
          return card.Aspects && card.Aspects.includes(selectedAspect);
        });
      };

      const neutralCards = filterByAspect(cards, 'Neutral');
      expect(neutralCards).toHaveLength(2);
      expect(neutralCards.map(c => c.Name)).toEqual(['Base', 'Token']);

      const heroismCards = filterByAspect(cards, 'Heroism');
      expect(heroismCards).toHaveLength(2);
      expect(heroismCards.map(c => c.Name)).toEqual(['Luke', 'Han']);

      const allCards = filterByAspect(cards, 'All');
      expect(allCards).toHaveLength(5);
    });

    it('should filter neutral cards in multi-aspect selection (AdvancedSearch pattern)', () => {
      const cards = [
        { Name: 'Luke', Aspects: ['Heroism'] },
        { Name: 'Base', Aspects: [] },
        { Name: 'Vader', Aspects: ['Villainy'] },
        { Name: 'Token' }, // No Aspects property
        { Name: 'Han', Aspects: ['Heroism', 'Command'] }
      ];

      // Simulate AdvancedSearch multi-aspect filter logic
      const filterByMultipleAspects = (cards, selectedAspects) => {
        if (selectedAspects.length === 0) return cards;

        return cards.filter(card => {
          const isNeutral = !card.Aspects || card.Aspects.length === 0;
          const hasSelectedAspect = selectedAspects.some(a => {
            if (a === 'Neutral') return isNeutral;
            return card.Aspects && card.Aspects.includes(a);
          });
          return hasSelectedAspect;
        });
      };

      // Select Neutral only
      const neutralOnly = filterByMultipleAspects(cards, ['Neutral']);
      expect(neutralOnly).toHaveLength(2);
      expect(neutralOnly.map(c => c.Name).sort()).toEqual(['Base', 'Token']);

      // Select Heroism and Neutral
      const heroismAndNeutral = filterByMultipleAspects(cards, ['Heroism', 'Neutral']);
      expect(heroismAndNeutral).toHaveLength(4); // Luke, Base, Token, Han
      expect(heroismAndNeutral.map(c => c.Name).sort()).toEqual(['Base', 'Han', 'Luke', 'Token']);

      // Select Heroism and Villainy (no neutral)
      const heroismAndVillainy = filterByMultipleAspects(cards, ['Heroism', 'Villainy']);
      expect(heroismAndVillainy).toHaveLength(3); // Luke, Vader, Han
      expect(heroismAndVillainy.map(c => c.Name).sort()).toEqual(['Han', 'Luke', 'Vader']);
    });
  });

  describe('Edge cases', () => {
    it('should handle card with aspects property set to empty string', () => {
      const card = { Name: 'Weird', Aspects: '' };
      const isNeutral = (card) => !card.Aspects || card.Aspects.length === 0;
      expect(isNeutral(card)).toBe(true); // Empty string is falsy
    });

    it('should handle card with aspects as non-array value', () => {
      const card = { Name: 'Invalid', Aspects: 'string' };
      const isNeutral = (card) => !card.Aspects || card.Aspects.length === 0;

      // String 'string' has length > 0, so not neutral
      expect(isNeutral(card)).toBe(false);

      // But it won't match specific aspects either
      const matchesAspect = card.Aspects && card.Aspects.includes && card.Aspects.includes('Heroism');
      expect(matchesAspect).toBe(false);
    });
  });
});
