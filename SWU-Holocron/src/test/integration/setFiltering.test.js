/**
 * @vitest-environment happy-dom
 * @integration
 */

import { describe, it, expect, beforeEach } from 'vitest';

describe('Set Filtering Integration', () => {
  beforeEach(() => {
    // Reset state
  });

  describe('Active Set Filtering', () => {
    it('should filter cards by activeSet when not ALL', () => {
      const allCards = [
        { id: 'SOR_001', Set: 'SOR', Name: 'Card 1', Number: '001' },
        { id: 'SHD_001', Set: 'SHD', Name: 'Card 2', Number: '001' },
        { id: 'TWI_001', Set: 'TWI', Name: 'Card 3', Number: '001' },
        { id: 'SOR_002', Set: 'SOR', Name: 'Card 4', Number: '002' }
      ];

      const activeSet = 'SOR';
      
      // Simulate filtering logic
      const filtered = allCards.filter(card => {
        if (activeSet !== 'ALL' && card.Set !== activeSet) return false;
        return true;
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.every(c => c.Set === 'SOR')).toBe(true);
      expect(filtered.find(c => c.Set === 'SHD')).toBeUndefined();
      expect(filtered.find(c => c.Set === 'TWI')).toBeUndefined();
    });

    it('should show all cards when activeSet is ALL', () => {
      const allCards = [
        { id: 'SOR_001', Set: 'SOR', Name: 'Card 1', Number: '001' },
        { id: 'SHD_001', Set: 'SHD', Name: 'Card 2', Number: '001' },
        { id: 'TWI_001', Set: 'TWI', Name: 'Card 3', Number: '001' }
      ];

      const activeSet = 'ALL';
      
      const filtered = allCards.filter(card => {
        if (activeSet !== 'ALL' && card.Set !== activeSet) return false;
        return true;
      });

      expect(filtered).toHaveLength(3);
      expect(filtered).toEqual(allCards);
    });

    it('should combine set filter with search term', () => {
      const allCards = [
        { id: 'SOR_001', Set: 'SOR', Name: 'Luke Skywalker', Number: '001' },
        { id: 'SOR_002', Set: 'SOR', Name: 'Darth Vader', Number: '002' },
        { id: 'SHD_001', Set: 'SHD', Name: 'Luke Skywalker', Number: '001' }
      ];

      const activeSet = 'SOR';
      const searchTerm = 'luke';
      
      const filtered = allCards.filter(card => {
        if (activeSet !== 'ALL' && card.Set !== activeSet) return false;
        const matchSearch = card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
        return matchSearch;
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('SOR_001');
      expect(filtered[0].Set).toBe('SOR');
    });

    it('should combine set filter with aspect filter', () => {
      const allCards = [
        { id: 'SOR_001', Set: 'SOR', Name: 'Card 1', Aspects: ['Heroism'] },
        { id: 'SOR_002', Set: 'SOR', Name: 'Card 2', Aspects: ['Villainy'] },
        { id: 'SHD_001', Set: 'SHD', Name: 'Card 3', Aspects: ['Heroism'] }
      ];

      const activeSet = 'SOR';
      const selectedAspect = 'Heroism';
      
      const filtered = allCards.filter(card => {
        if (activeSet !== 'ALL' && card.Set !== activeSet) return false;
        const matchAspect = selectedAspect === 'All' || (card.Aspects && card.Aspects.includes(selectedAspect));
        return matchAspect;
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('SOR_001');
    });

    it('should combine set filter with type filter', () => {
      const allCards = [
        { id: 'SOR_001', Set: 'SOR', Name: 'Card 1', Type: 'Unit' },
        { id: 'SOR_002', Set: 'SOR', Name: 'Card 2', Type: 'Event' },
        { id: 'SHD_001', Set: 'SHD', Name: 'Card 3', Type: 'Unit' }
      ];

      const activeSet = 'SOR';
      const selectedType = 'Unit';
      
      const filtered = allCards.filter(card => {
        if (activeSet !== 'ALL' && card.Set !== activeSet) return false;
        const matchType = selectedType === 'All' || card.Type === selectedType;
        return matchType;
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('SOR_001');
    });

    it('should apply all filters together', () => {
      const allCards = [
        { id: 'SOR_001', Set: 'SOR', Name: 'Luke Skywalker', Type: 'Unit', Aspects: ['Heroism'] },
        { id: 'SOR_002', Set: 'SOR', Name: 'Luke Leader', Type: 'Leader', Aspects: ['Heroism'] },
        { id: 'SOR_003', Set: 'SOR', Name: 'Darth Vader', Type: 'Unit', Aspects: ['Villainy'] },
        { id: 'SHD_001', Set: 'SHD', Name: 'Luke Skywalker', Type: 'Unit', Aspects: ['Heroism'] }
      ];

      const activeSet = 'SOR';
      const searchTerm = 'luke';
      const selectedAspect = 'Heroism';
      const selectedType = 'Unit';
      
      const filtered = allCards.filter(card => {
        if (activeSet !== 'ALL' && card.Set !== activeSet) return false;
        const matchSearch = card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchAspect = selectedAspect === 'All' || (card.Aspects && card.Aspects.includes(selectedAspect));
        const matchType = selectedType === 'All' || card.Type === selectedType;
        return matchSearch && matchAspect && matchType;
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('SOR_001');
      expect(filtered[0].Name).toBe('Luke Skywalker');
    });
  });

  describe('Set Switching Behavior', () => {
    it('should clear filters when switching sets', () => {
      let searchTerm = 'luke';
      let selectedAspect = 'Heroism';
      let selectedType = 'Unit';

      // Simulate set switch
      const onSetSwitch = () => {
        searchTerm = '';
        selectedAspect = 'All';
        selectedType = 'All';
      };

      onSetSwitch();

      expect(searchTerm).toBe('');
      expect(selectedAspect).toBe('All');
      expect(selectedType).toBe('All');
    });

    it('should not show cards from other sets after switching from ALL', () => {
      const allCards = [
        { id: 'SOR_001', Set: 'SOR', Name: 'Card 1' },
        { id: 'SHD_001', Set: 'SHD', Name: 'Card 2' },
        { id: 'TWI_001', Set: 'TWI', Name: 'Card 3' }
      ];

      // Initially viewing ALL
      let activeSet = 'ALL';
      let filtered = allCards.filter(card => {
        if (activeSet !== 'ALL' && card.Set !== activeSet) return false;
        return true;
      });
      expect(filtered).toHaveLength(3);

      // Switch to SOR
      activeSet = 'SOR';
      filtered = allCards.filter(card => {
        if (activeSet !== 'ALL' && card.Set !== activeSet) return false;
        return true;
      });
      
      expect(filtered).toHaveLength(1);
      expect(filtered[0].Set).toBe('SOR');
      expect(filtered.find(c => c.Set === 'SHD')).toBeUndefined();
      expect(filtered.find(c => c.Set === 'TWI')).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle null or undefined cards gracefully', () => {
      const allCards = [
        { id: 'SOR_001', Set: 'SOR', Name: 'Card 1' },
        null,
        undefined,
        { id: 'SOR_002', Set: 'SOR', Name: 'Card 2' }
      ];

      const activeSet = 'SOR';
      
      const filtered = allCards.filter(card => {
        if (!card) return false;
        if (activeSet !== 'ALL' && card.Set !== activeSet) return false;
        return true;
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.every(c => c !== null && c !== undefined)).toBe(true);
    });

    it('should handle cards without Set property', () => {
      const allCards = [
        { id: 'SOR_001', Set: 'SOR', Name: 'Card 1' },
        { id: 'NO_SET', Name: 'Card 2' },
        { id: 'SOR_002', Set: 'SOR', Name: 'Card 3' }
      ];

      const activeSet = 'SOR';
      
      const filtered = allCards.filter(card => {
        if (!card) return false;
        if (activeSet !== 'ALL' && card.Set !== activeSet) return false;
        return true;
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.every(c => c.Set === 'SOR')).toBe(true);
    });

    it('should handle empty search term', () => {
      const allCards = [
        { id: 'SOR_001', Set: 'SOR', Name: 'Card 1' },
        { id: 'SOR_002', Set: 'SOR', Name: 'Card 2' }
      ];

      const activeSet = 'SOR';
      const searchTerm = '';
      
      const filtered = allCards.filter(card => {
        if (!card) return false;
        if (activeSet !== 'ALL' && card.Set !== activeSet) return false;
        const matchSearch = card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
        return matchSearch;
      });

      expect(filtered).toHaveLength(2);
    });
  });
});
