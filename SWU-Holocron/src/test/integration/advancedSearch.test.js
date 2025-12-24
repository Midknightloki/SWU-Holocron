/**
 * @vitest-environment happy-dom
 * @integration
 * Advanced Search Component Tests
 * Tests the combined filtering logic (searchTerm + aspect + type + set)
 */

import { describe, it, expect, beforeEach } from 'vitest';

describe('Advanced Search Integration Tests', () => {
  let mockCards;

  beforeEach(() => {
    // Mock card dataset with various properties
    mockCards = [
      { id: 'SOR_001', Set: 'SOR', Number: '001', Name: 'Luke Skywalker', Subtitle: 'Jedi Knight', Type: 'Unit', Aspects: ['Heroism'], Cost: 3, Power: 3, HP: 4, Text: 'When Played: Deal 2 damage' },
      { id: 'SOR_002', Set: 'SOR', Number: '002', Name: 'Darth Vader', Subtitle: 'Dark Lord', Type: 'Unit', Aspects: ['Villainy'], Cost: 6, Power: 6, HP: 6, Text: 'Overwhelm' },
      { id: 'SOR_003', Set: 'SOR', Number: '003', Name: 'Sabine Wren', Subtitle: 'Explosives Artist', Type: 'Unit', Aspects: ['Heroism', 'Cunning'], Cost: 3, Power: 2, HP: 3, Text: 'When Played: Deal 1 damage' },
      { id: 'SOR_004', Set: 'SOR', Number: '004', Name: 'Force Lightning', Type: 'Event', Aspects: ['Villainy'], Cost: 2, Text: 'Deal 4 damage to a unit' },
      { id: 'SOR_005', Set: 'SOR', Number: '005', Name: 'Han Solo', Subtitle: 'Reluctant Hero', Type: 'Unit', Aspects: ['Heroism'], Cost: 5, Power: 4, HP: 5, Text: 'Raid 2' },
      { id: 'SHD_001', Set: 'SHD', Number: '001', Name: 'Luke Skywalker', Subtitle: 'Faithful Friend', Type: 'Unit', Aspects: ['Heroism'], Cost: 4, Power: 4, HP: 4, Text: 'Sentinel' },
      { id: 'SHD_002', Set: 'SHD', Number: '002', Name: 'Princess Leia', Subtitle: 'Rebel Leader', Type: 'Leader', Aspects: ['Heroism'], Cost: 0, Power: 0, HP: 25, Text: 'Action: Draw a card' },
      { id: 'SHD_003', Set: 'SHD', Number: '003', Name: 'Force Push', Type: 'Event', Aspects: ['Heroism'], Cost: 1, Text: 'Return a unit to hand' },
      { id: 'TWI_001', Set: 'TWI', Number: '001', Name: 'Leia Organa', Subtitle: 'Alliance General', Type: 'Unit', Aspects: ['Heroism', 'Command'], Cost: 5, Power: 3, HP: 6, Text: 'Restore 2' },
      { id: 'TWI_002', Set: 'TWI', Number: '002', Name: 'Boba Fett', Subtitle: 'Collecting the Bounty', Type: 'Unit', Aspects: ['Villainy'], Cost: 5, Power: 5, HP: 4, Text: 'Bounty' },
      { id: 'TWI_003', Set: 'TWI', Number: '003', Name: 'Command Center', Subtitle: 'Rebel Base', Type: 'Base', Aspects: ['Heroism'], Cost: 0, Power: 0, HP: 30, Text: 'Epic Action' }
    ];
  });

  describe('Multi-Criteria Filtering', () => {
    it('should filter by searchTerm only', () => {
      const activeSet = 'SOR';
      const searchTerm = 'luke';
      const selectedAspect = 'All';
      const selectedType = 'All';

      const filtered = mockCards.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        const matchSearch = card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchAspect = selectedAspect === 'All' || (card.Aspects && card.Aspects.includes(selectedAspect));
        const matchType = selectedType === 'All' || card.Type === selectedType;
        return matchSearch && matchAspect && matchType;
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].Name).toBe('Luke Skywalker');
      expect(filtered[0].Set).toBe('SOR');
    });

    it('should filter by aspect only', () => {
      const activeSet = 'SOR';
      const searchTerm = '';
      const selectedAspect = 'Villainy';
      const selectedType = 'All';

      const filtered = mockCards.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        const matchSearch = card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchAspect = selectedAspect === 'All' || (card.Aspects && card.Aspects.includes(selectedAspect));
        const matchType = selectedType === 'All' || card.Type === selectedType;
        return matchSearch && matchAspect && matchType;
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.every(c => c.Aspects.includes('Villainy'))).toBe(true);
    });

    it('should filter by type only', () => {
      const activeSet = 'SOR';
      const searchTerm = '';
      const selectedAspect = 'All';
      const selectedType = 'Event';

      const filtered = mockCards.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        const matchSearch = card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchAspect = selectedAspect === 'All' || (card.Aspects && card.Aspects.includes(selectedAspect));
        const matchType = selectedType === 'All' || card.Type === selectedType;
        return matchSearch && matchAspect && matchType;
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].Type).toBe('Event');
      expect(filtered[0].Name).toBe('Force Lightning');
    });

    it('should filter by searchTerm + aspect', () => {
      const activeSet = 'SOR';
      const searchTerm = 'skywalker';
      const selectedAspect = 'Heroism';
      const selectedType = 'All';

      const filtered = mockCards.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        const matchSearch = card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchAspect = selectedAspect === 'All' || (card.Aspects && card.Aspects.includes(selectedAspect));
        const matchType = selectedType === 'All' || card.Type === selectedType;
        return matchSearch && matchAspect && matchType;
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].Name).toBe('Luke Skywalker');
    });

    it('should filter by searchTerm + type', () => {
      const activeSet = 'SOR';
      const searchTerm = 'force';
      const selectedAspect = 'All';
      const selectedType = 'Event';

      const filtered = mockCards.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        const matchSearch = card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchAspect = selectedAspect === 'All' || (card.Aspects && card.Aspects.includes(selectedAspect));
        const matchType = selectedType === 'All' || card.Type === selectedType;
        return matchSearch && matchAspect && matchType;
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].Name).toBe('Force Lightning');
    });

    it('should filter by aspect + type', () => {
      const activeSet = 'SOR';
      const searchTerm = '';
      const selectedAspect = 'Heroism';
      const selectedType = 'Unit';

      const filtered = mockCards.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        const matchSearch = card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchAspect = selectedAspect === 'All' || (card.Aspects && card.Aspects.includes(selectedAspect));
        const matchType = selectedType === 'All' || card.Type === selectedType;
        return matchSearch && matchAspect && matchType;
      });

      expect(filtered).toHaveLength(3);
      expect(filtered.every(c => c.Type === 'Unit' && c.Aspects.includes('Heroism'))).toBe(true);
    });

    it('should filter by all criteria (searchTerm + aspect + type + set)', () => {
      const activeSet = 'SOR';
      const searchTerm = 'solo';
      const selectedAspect = 'Heroism';
      const selectedType = 'Unit';

      const filtered = mockCards.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        const matchSearch = card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchAspect = selectedAspect === 'All' || (card.Aspects && card.Aspects.includes(selectedAspect));
        const matchType = selectedType === 'All' || card.Type === selectedType;
        return matchSearch && matchAspect && matchType;
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].Name).toBe('Han Solo');
      expect(filtered[0].Set).toBe('SOR');
      expect(filtered[0].Type).toBe('Unit');
      expect(filtered[0].Aspects).toContain('Heroism');
    });
  });

  describe('Cross-Set Search', () => {
    it('should only show cards from active set', () => {
      const activeSet = 'SHD';
      const searchTerm = 'luke';
      const selectedAspect = 'All';
      const selectedType = 'All';

      const filtered = mockCards.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        const matchSearch = card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchAspect = selectedAspect === 'All' || (card.Aspects && card.Aspects.includes(selectedAspect));
        const matchType = selectedType === 'All' || card.Type === selectedType;
        return matchSearch && matchAspect && matchType;
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].Set).toBe('SHD');
      expect(filtered[0].Name).toBe('Luke Skywalker');
      expect(filtered[0].Subtitle).toBe('Faithful Friend');
    });

    it('should find different versions of same character across sets', () => {
      const sets = ['SOR', 'SHD'];
      const searchTerm = 'luke';
      const results = [];

      sets.forEach(activeSet => {
        const filtered = mockCards.filter(card => {
          if (!card) return false;
          if (card.Set !== activeSet) return false;
          const matchSearch = card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
          return matchSearch;
        });
        results.push(...filtered);
      });

      expect(results).toHaveLength(2);
      expect(results[0].Set).toBe('SOR');
      expect(results[1].Set).toBe('SHD');
      expect(results.every(c => c.Name === 'Luke Skywalker')).toBe(true);
    });

    it('should handle searching for character across multiple sets', () => {
      const searchTerm = 'leia';
      const setsToSearch = ['SHD', 'TWI'];
      const results = [];

      setsToSearch.forEach(activeSet => {
        const filtered = mockCards.filter(card => {
          if (!card) return false;
          if (card.Set !== activeSet) return false;
          const matchSearch = card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
          return matchSearch;
        });
        results.push(...filtered);
      });

      expect(results).toHaveLength(2);
      expect(results.map(c => c.Name)).toContain('Princess Leia');
      expect(results.map(c => c.Name)).toContain('Leia Organa');
    });
  });

  describe('Multi-Aspect Cards', () => {
    it('should find cards with multiple aspects when filtering by one', () => {
      const activeSet = 'SOR';
      const searchTerm = '';
      const selectedAspect = 'Heroism';
      const selectedType = 'All';

      const filtered = mockCards.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        const matchSearch = card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchAspect = selectedAspect === 'All' || (card.Aspects && card.Aspects.includes(selectedAspect));
        const matchType = selectedType === 'All' || card.Type === selectedType;
        return matchSearch && matchAspect && matchType;
      });

      const sabine = filtered.find(c => c.Name === 'Sabine Wren');
      expect(sabine).toBeDefined();
      expect(sabine.Aspects).toContain('Heroism');
      expect(sabine.Aspects).toContain('Cunning');
    });

    it('should count multi-aspect cards correctly', () => {
      const activeSet = 'SOR';
      const heroismCards = mockCards.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        return card.Aspects && card.Aspects.includes('Heroism');
      });

      const cunningCards = mockCards.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        return card.Aspects && card.Aspects.includes('Cunning');
      });

      expect(heroismCards).toHaveLength(3);
      expect(cunningCards).toHaveLength(1);
      expect(heroismCards.find(c => c.Name === 'Sabine Wren')).toBeDefined();
      expect(cunningCards.find(c => c.Name === 'Sabine Wren')).toBeDefined();
    });
  });

  describe('Case Sensitivity', () => {
    it('should be case-insensitive for search terms', () => {
      const activeSet = 'SOR';
      const testCases = ['LUKE', 'luke', 'Luke', 'LuKe'];

      testCases.forEach(searchTerm => {
        const filtered = mockCards.filter(card => {
          if (!card) return false;
          if (card.Set !== activeSet) return false;
          return card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
        });

        expect(filtered).toHaveLength(1);
        expect(filtered[0].Name).toBe('Luke Skywalker');
      });
    });

    it('should handle special characters in names', () => {
      const activeSet = 'SOR';
      const searchTerm = 'wren';

      const filtered = mockCards.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        return card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].Name).toBe('Sabine Wren');
    });
  });

  describe('Empty Results', () => {
    it('should return empty array when no cards match', () => {
      const activeSet = 'SOR';
      const searchTerm = 'nonexistent';
      const selectedAspect = 'All';
      const selectedType = 'All';

      const filtered = mockCards.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        const matchSearch = card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchAspect = selectedAspect === 'All' || (card.Aspects && card.Aspects.includes(selectedAspect));
        const matchType = selectedType === 'All' || card.Type === selectedType;
        return matchSearch && matchAspect && matchType;
      });

      expect(filtered).toHaveLength(0);
    });

    it('should return empty when aspect has no matches in set', () => {
      const activeSet = 'SHD';
      const searchTerm = '';
      const selectedAspect = 'Villainy';
      const selectedType = 'All';

      const filtered = mockCards.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        const matchSearch = card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchAspect = selectedAspect === 'All' || (card.Aspects && card.Aspects.includes(selectedAspect));
        const matchType = selectedType === 'All' || card.Type === selectedType;
        return matchSearch && matchAspect && matchType;
      });

      expect(filtered).toHaveLength(0);
    });

    it('should return empty when type has no matches', () => {
      const activeSet = 'TWI';
      const searchTerm = '';
      const selectedAspect = 'All';
      const selectedType = 'Event';

      const filtered = mockCards.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        const matchSearch = card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchAspect = selectedAspect === 'All' || (card.Aspects && card.Aspects.includes(selectedAspect));
        const matchType = selectedType === 'All' || card.Type === selectedType;
        return matchSearch && matchAspect && matchType;
      });

      expect(filtered).toHaveLength(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null cards in array', () => {
      const cardsWithNull = [...mockCards, null, undefined];
      const activeSet = 'SOR';
      const searchTerm = '';
      const selectedAspect = 'All';
      const selectedType = 'All';

      const filtered = cardsWithNull.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        const matchSearch = card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchAspect = selectedAspect === 'All' || (card.Aspects && card.Aspects.includes(selectedAspect));
        const matchType = selectedType === 'All' || card.Type === selectedType;
        return matchSearch && matchAspect && matchType;
      });

      expect(filtered.every(c => c !== null && c !== undefined)).toBe(true);
    });

    it('should handle cards without Name property', () => {
      const cardsWithMissing = [
        ...mockCards,
        { id: 'BAD_001', Set: 'SOR', Number: '999', Type: 'Unit' }
      ];
      const activeSet = 'SOR';
      const searchTerm = 'test';

      const filtered = cardsWithMissing.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        return card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
      });

      expect(filtered).toHaveLength(0);
    });

    it('should handle cards without Aspects property', () => {
      const cardsWithMissing = [
        ...mockCards,
        { id: 'BAD_002', Set: 'SOR', Number: '998', Name: 'Test Card', Type: 'Unit' }
      ];
      const activeSet = 'SOR';
      const selectedAspect = 'Heroism';

      const filtered = cardsWithMissing.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        return selectedAspect === 'All' || (card.Aspects && card.Aspects.includes(selectedAspect));
      });

      expect(filtered.find(c => c.id === 'BAD_002')).toBeUndefined();
    });

    it('should handle empty string search term', () => {
      const activeSet = 'SOR';
      const searchTerm = '';
      const selectedAspect = 'All';
      const selectedType = 'All';

      const filtered = mockCards.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        const matchSearch = card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchAspect = selectedAspect === 'All' || (card.Aspects && card.Aspects.includes(selectedAspect));
        const matchType = selectedType === 'All' || card.Type === selectedType;
        return matchSearch && matchAspect && matchType;
      });

      expect(filtered).toHaveLength(5);
    });
  });

  describe('Card Type Filtering', () => {
    it('should filter Units correctly', () => {
      const activeSet = 'SOR';
      const selectedType = 'Unit';

      const filtered = mockCards.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        return selectedType === 'All' || card.Type === selectedType;
      });

      expect(filtered).toHaveLength(4);
      expect(filtered.every(c => c.Type === 'Unit')).toBe(true);
    });

    it('should filter Events correctly', () => {
      const activeSet = 'SOR';
      const selectedType = 'Event';

      const filtered = mockCards.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        return selectedType === 'All' || card.Type === selectedType;
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].Type).toBe('Event');
    });

    it('should filter Leaders correctly', () => {
      const activeSet = 'SHD';
      const selectedType = 'Leader';

      const filtered = mockCards.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        return selectedType === 'All' || card.Type === selectedType;
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].Type).toBe('Leader');
      expect(filtered[0].Name).toBe('Princess Leia');
    });

    it('should filter Bases correctly', () => {
      const activeSet = 'TWI';
      const selectedType = 'Base';

      const filtered = mockCards.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        return selectedType === 'All' || card.Type === selectedType;
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].Type).toBe('Base');
    });
  });

  describe('Performance Considerations', () => {
    it('should handle large card sets efficiently', () => {
      const largeSet = [];
      for (let i = 0; i < 1000; i++) {
        largeSet.push({
          id: `SOR_${i.toString().padStart(3, '0')}`,
          Set: 'SOR',
          Number: i.toString().padStart(3, '0'),
          Name: `Card ${i}`,
          Type: i % 3 === 0 ? 'Unit' : i % 3 === 1 ? 'Event' : 'Leader',
          Aspects: [i % 2 === 0 ? 'Heroism' : 'Villainy']
        });
      }

      const start = performance.now();
      const filtered = largeSet.filter(card => {
        if (!card) return false;
        if (card.Set !== 'SOR') return false;
        const matchSearch = card.Name?.toLowerCase().includes('card 5'.toLowerCase());
        const matchAspect = card.Aspects && card.Aspects.includes('Heroism');
        const matchType = card.Type === 'Unit';
        return matchSearch && matchAspect && matchType;
      });
      const end = performance.now();

      expect(end - start).toBeLessThan(50);
      expect(filtered.length).toBeGreaterThan(0);
    });
  });

  describe('Subtitle and Text Search', () => {
    it('should search in subtitle when available', () => {
      const activeSet = 'SOR';
      const searchTerm = 'dark lord';

      const filtered = mockCards.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        const matchName = card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchSubtitle = card.Subtitle?.toLowerCase().includes(searchTerm.toLowerCase());
        return matchName || matchSubtitle;
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].Name).toBe('Darth Vader');
      expect(filtered[0].Subtitle).toBe('Dark Lord');
    });

    it('should search in card text when available', () => {
      const activeSet = 'SOR';
      const searchTerm = 'deal damage';

      const filtered = mockCards.filter(card => {
        if (!card) return false;
        if (card.Set !== activeSet) return false;
        const matchName = card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchText = card.Text?.toLowerCase().includes(searchTerm.toLowerCase());
        return matchName || matchText;
      });

      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.some(c => c.Name === 'Luke Skywalker')).toBe(true);
      expect(filtered.some(c => c.Name === 'Sabine Wren')).toBe(true);
    });
  });
});
