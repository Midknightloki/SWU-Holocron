/**
 * @vitest-environment happy-dom
 * @unit
 */

import { describe, it, expect } from 'vitest';
import { SETS } from '../../constants';
import { isSpecialSet, SET_CODE_MAP } from '../../utils/officialCodeUtils';

describe('Dynamic Set Discovery', () => {
  describe('SETS constant - PROMO support', () => {
    it('should include PROMO set', () => {
      const promoSet = SETS.find(s => s.code === 'PROMO');
      expect(promoSet).toBeDefined();
      expect(promoSet.name).toBe('Promotional Cards');
    });

    it('should include all mainline sets', () => {
      const mainlineCodes = ['SOR', 'SHD', 'TWI', 'JTL', 'LOF', 'SEC', 'ALT'];
      mainlineCodes.forEach(code => {
        const set = SETS.find(s => s.code === code);
        expect(set).toBeDefined();
      });
    });

    it('should have proper structure for each set', () => {
      SETS.forEach(set => {
        expect(set).toHaveProperty('code');
        expect(set).toHaveProperty('name');
        expect(typeof set.code).toBe('string');
        expect(typeof set.name).toBe('string');
        expect(set.code.length).toBeGreaterThan(0);
        expect(set.name.length).toBeGreaterThan(0);
      });
    });
  });

  describe('SET_CODE_MAP export', () => {
    it('should be exported and accessible', () => {
      expect(SET_CODE_MAP).toBeDefined();
      expect(typeof SET_CODE_MAP).toBe('object');
    });

    it('should contain mainline set mappings', () => {
      expect(SET_CODE_MAP['SOR']).toBe('01');
      expect(SET_CODE_MAP['SHD']).toBe('02');
      expect(SET_CODE_MAP['TWI']).toBe('03');
      expect(SET_CODE_MAP['JTL']).toBe('04');
      expect(SET_CODE_MAP['LOF']).toBe('05');
      expect(SET_CODE_MAP['SEC']).toBe('06');
      expect(SET_CODE_MAP['ALT']).toBe('07');
    });

    it('should contain special set mappings', () => {
      expect(SET_CODE_MAP['PROMO']).toBe('G25');
      expect(SET_CODE_MAP['INTRO-HOTH']).toBe('I01');
    });

    it('should contain reverse mappings', () => {
      expect(SET_CODE_MAP['01']).toBe('SOR');
      expect(SET_CODE_MAP['02']).toBe('SHD');
      expect(SET_CODE_MAP['G25']).toBe('PROMO');
      expect(SET_CODE_MAP['I01']).toBe('INTRO-HOTH');
    });
  });

  describe('isSpecialSet function', () => {
    it('should identify special sets by code', () => {
      expect(isSpecialSet('PROMO')).toBe(true);
      expect(isSpecialSet('INTRO-HOTH')).toBe(true);
      expect(isSpecialSet('G25')).toBe(true);
      expect(isSpecialSet('I01')).toBe(true);
    });

    it('should identify mainline sets as non-special', () => {
      expect(isSpecialSet('SOR')).toBe(false);
      expect(isSpecialSet('SHD')).toBe(false);
      expect(isSpecialSet('TWI')).toBe(false);
      expect(isSpecialSet('ALT')).toBe(false);
    });

    it('should identify numeric codes as non-special', () => {
      expect(isSpecialSet('01')).toBe(false);
      expect(isSpecialSet('02')).toBe(false);
      expect(isSpecialSet('07')).toBe(false);
    });

    it('should detect special set pattern (letter+digit)', () => {
      // Pattern: starts with letter followed by digit
      expect(isSpecialSet('G25')).toBe(true);
      expect(isSpecialSet('I01')).toBe(true);
      expect(isSpecialSet('H99')).toBe(true); // Hypothetical future special set
    });
  });

  describe('Dynamic visibleSets logic', () => {
    it('should build dynamic sets from discovered set codes', () => {
      const availableSets = ['SOR', 'SHD', 'PROMO'];

      // Simulate visibleSets logic from App.jsx
      const buildVisibleSets = (availableSets) => {
        if (availableSets.length === 0) return SETS;

        return availableSets.map(code => {
          const knownSet = SETS.find(s => s.code === code);
          return knownSet || { code, name: code };
        });
      };

      const visibleSets = buildVisibleSets(availableSets);
      expect(visibleSets).toHaveLength(3);
      expect(visibleSets.map(s => s.code)).toEqual(['SOR', 'SHD', 'PROMO']);
    });

    it('should fallback to set code as name for unknown sets', () => {
      const availableSets = ['SOR', 'UNKNOWN_SET'];

      const buildVisibleSets = (availableSets) => {
        if (availableSets.length === 0) return SETS;

        return availableSets.map(code => {
          const knownSet = SETS.find(s => s.code === code);
          return knownSet || { code, name: code };
        });
      };

      const visibleSets = buildVisibleSets(availableSets);
      expect(visibleSets).toHaveLength(2);
      expect(visibleSets[0].name).toBe('Spark of Rebellion'); // Known set
      expect(visibleSets[1].name).toBe('UNKNOWN_SET'); // Fallback to code
    });

    it('should return SETS constant when no discovery data', () => {
      const availableSets = [];

      const buildVisibleSets = (availableSets) => {
        if (availableSets.length === 0) return SETS;

        return availableSets.map(code => {
          const knownSet = SETS.find(s => s.code === code);
          return knownSet || { code, name: code };
        });
      };

      const visibleSets = buildVisibleSets(availableSets);
      expect(visibleSets).toBe(SETS); // Should be same reference
    });
  });

  describe('Mainline/Special set separation and ordering', () => {
    it('should separate mainline from special sets', () => {
      const mixedSets = [
        { code: 'SOR', name: 'Spark of Rebellion' },
        { code: 'PROMO', name: 'Promotional Cards' },
        { code: 'SHD', name: 'Shadows of the Galaxy' },
        { code: 'INTRO-HOTH', name: 'Intro Battle: Hoth' },
        { code: 'TWI', name: 'Twilight of the Republic' }
      ];

      const mainlineSets = mixedSets.filter(s => !isSpecialSet(s.code));
      const specialSets = mixedSets.filter(s => isSpecialSet(s.code));

      expect(mainlineSets).toHaveLength(3);
      expect(specialSets).toHaveLength(2);
      expect(mainlineSets.map(s => s.code)).toEqual(['SOR', 'SHD', 'TWI']);
      expect(specialSets.map(s => s.code)).toEqual(['PROMO', 'INTRO-HOTH']);
    });

    it('should sort mainline sets by numeric code', () => {
      const unsortedMainline = [
        { code: 'TWI', name: 'Twilight of the Republic' },
        { code: 'SOR', name: 'Spark of Rebellion' },
        { code: 'ALT', name: 'A Lawless Time' },
        { code: 'SHD', name: 'Shadows of the Galaxy' }
      ];

      const sorted = unsortedMainline.sort((a, b) => {
        const numA = parseInt(SET_CODE_MAP[a.code] || '99');
        const numB = parseInt(SET_CODE_MAP[b.code] || '99');
        return numA - numB;
      });

      expect(sorted.map(s => s.code)).toEqual(['SOR', 'SHD', 'TWI', 'ALT']);
      expect(sorted.map(s => parseInt(SET_CODE_MAP[s.code]))).toEqual([1, 2, 3, 7]);
    });

    it('should sort special sets alphabetically', () => {
      const unsortedSpecial = [
        { code: 'PROMO', name: 'Promotional Cards' },
        { code: 'INTRO-HOTH', name: 'Intro Battle: Hoth' },
        { code: 'G25', name: 'Gift Box 2025' }
      ];

      const sorted = unsortedSpecial.sort((a, b) => a.code.localeCompare(b.code));

      expect(sorted.map(s => s.code)).toEqual(['G25', 'INTRO-HOTH', 'PROMO']);
    });

    it('should combine mainline and special with proper ordering', () => {
      const dynamicSets = [
        { code: 'PROMO', name: 'Promotional Cards' },
        { code: 'TWI', name: 'Twilight of the Republic' },
        { code: 'SOR', name: 'Spark of Rebellion' },
        { code: 'INTRO-HOTH', name: 'Intro Battle: Hoth' },
        { code: 'SHD', name: 'Shadows of the Galaxy' }
      ];

      // Simulate full sorting logic from App.jsx
      const mainlineSets = dynamicSets
        .filter(s => !isSpecialSet(s.code))
        .sort((a, b) => {
          const numA = parseInt(SET_CODE_MAP[a.code] || '99');
          const numB = parseInt(SET_CODE_MAP[b.code] || '99');
          return numA - numB;
        });

      const specialSets = dynamicSets
        .filter(s => isSpecialSet(s.code))
        .sort((a, b) => a.code.localeCompare(b.code));

      const orderedSets = [...mainlineSets, ...specialSets];

      expect(orderedSets.map(s => s.code)).toEqual([
        'SOR', 'SHD', 'TWI', // Mainline in numeric order
        'INTRO-HOTH', 'PROMO' // Special in alphabetical order
      ]);
    });

    it('should handle unknown sets with fallback ordering', () => {
      const setsWithUnknown = [
        { code: 'SOR', name: 'Spark of Rebellion' },
        { code: 'FUTURE_SET', name: 'Future Set' }, // Unknown, no mapping
        { code: 'SHD', name: 'Shadows of the Galaxy' }
      ];

      const sorted = setsWithUnknown.sort((a, b) => {
        const numA = parseInt(SET_CODE_MAP[a.code] || '99');
        const numB = parseInt(SET_CODE_MAP[b.code] || '99');
        return numA - numB;
      });

      // SOR (1), SHD (2), FUTURE_SET (99 fallback)
      expect(sorted.map(s => s.code)).toEqual(['SOR', 'SHD', 'FUTURE_SET']);
    });
  });

  describe('Future set discovery scenarios', () => {
    it('should automatically display new mainline set when discovered', () => {
      // Simulate discovering a future set "HYP" (Hyperspace) with code "08"
      const availableSets = ['SOR', 'SHD', 'TWI', 'ALT', 'HYP'];
      const futureSetCodeMap = { ...SET_CODE_MAP, 'HYP': '08', '08': 'HYP' };

      const buildVisibleSets = (availableSets, codeMap) => {
        if (availableSets.length === 0) return SETS;

        const dynamicSets = availableSets.map(code => {
          const knownSet = SETS.find(s => s.code === code);
          return knownSet || { code, name: code };
        });

        const mainlineSets = dynamicSets
          .filter(s => !isSpecialSet(s.code))
          .sort((a, b) => {
            const numA = parseInt(codeMap[a.code] || '99');
            const numB = parseInt(codeMap[b.code] || '99');
            return numA - numB;
          });

        const specialSets = dynamicSets
          .filter(s => isSpecialSet(s.code))
          .sort((a, b) => a.code.localeCompare(b.code));

        return [...mainlineSets, ...specialSets];
      };

      const visibleSets = buildVisibleSets(availableSets, futureSetCodeMap);

      expect(visibleSets.map(s => s.code)).toEqual(['SOR', 'SHD', 'TWI', 'ALT', 'HYP']);
      expect(visibleSets[4].name).toBe('HYP'); // Fallback to code as name
    });

    it('should hide unreleased sets when not in availableSets', () => {
      // ALT is in SETS constant but not yet released (not in availableSets)
      const availableSets = ['SOR', 'SHD', 'TWI', 'JTL', 'LOF', 'SEC'];

      const buildVisibleSets = (availableSets) => {
        if (availableSets.length === 0) return SETS;

        return availableSets.map(code => {
          const knownSet = SETS.find(s => s.code === code);
          return knownSet || { code, name: code };
        });
      };

      const visibleSets = buildVisibleSets(availableSets);

      expect(visibleSets.map(s => s.code)).not.toContain('ALT');
      expect(visibleSets).toHaveLength(6);
    });

    it('should show PROMO when data exists', () => {
      const availableSets = ['SOR', 'SHD', 'PROMO'];

      const buildVisibleSets = (availableSets) => {
        if (availableSets.length === 0) return SETS;

        const dynamicSets = availableSets.map(code => {
          const knownSet = SETS.find(s => s.code === code);
          return knownSet || { code, name: code };
        });

        const mainlineSets = dynamicSets
          .filter(s => !isSpecialSet(s.code))
          .sort((a, b) => {
            const numA = parseInt(SET_CODE_MAP[a.code] || '99');
            const numB = parseInt(SET_CODE_MAP[b.code] || '99');
            return numA - numB;
          });

        const specialSets = dynamicSets
          .filter(s => isSpecialSet(s.code))
          .sort((a, b) => a.code.localeCompare(b.code));

        return [...mainlineSets, ...specialSets];
      };

      const visibleSets = buildVisibleSets(availableSets);

      expect(visibleSets.map(s => s.code)).toEqual(['SOR', 'SHD', 'PROMO']);
      expect(visibleSets[2].name).toBe('Promotional Cards');
    });
  });
});
