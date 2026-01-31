/**
 * @vitest-environment happy-dom
 * @unit @service
 *
 * CardService Tests - Comprehensive coverage to prevent regressions
 *
 * KEY REGRESSION TEST: Commit ec3f749 "Fix image URLs and disable broken getAvailableSets"
 * Someone disabled getAvailableSets() when they encountered Firestore errors, instead of
 * fixing the root cause (Firestore rules not deployed). These tests catch that issue.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CardService } from '../../services/CardService';

// Mock Firebase
vi.mock('../../firebase', () => ({
  db: {
    _type: 'firestore',
    app: { name: 'test-app' }
  },
  APP_ID: 'test-app-id'
}));

// Mock Firestore functions with proper segment validation
vi.mock('firebase/firestore', () => {
  const validateDocSegments = (segments) => {
    // doc() should receive odd number of path segments (excluding db)
    if (segments.length % 2 === 0) {
      throw new Error(
        `Invalid doc() call: Expected odd number of segments, got ${segments.length}. ` +
        `Path segments must alternate: doc, collection, doc, collection...`
      );
    }
  };

  const validateCollectionSegments = (segments) => {
    // collection() should receive odd number of path segments
    if (segments.length % 2 === 0) {
      throw new Error(
        `Invalid collection() call: Expected odd number of segments, got ${segments.length}. ` +
        `Path segments must alternate: collection, doc, collection, doc...`
      );
    }
  };

  return {
    doc: vi.fn((...args) => {
      const segments = args.slice(1); // Skip db parameter
      validateDocSegments(segments);
      return {
        _path: args.join('/'),
        _type: 'DocumentReference',
        _segments: segments
      };
    }),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    collection: vi.fn((...args) => {
      const segments = args.slice(1); // Skip db/ref parameter
      validateCollectionSegments(segments);
      return {
        _path: args.join('/'),
        _type: 'CollectionReference',
        _segments: segments
      };
    }),
    getDocs: vi.fn()
  };
});

describe('CardService', () => {
    localStorage.clear();
  describe('Function Existence - Regression Tests', () => {
    it('should have getAvailableSets method', () => {
      expect(CardService.getAvailableSets).toBeDefined();
      expect(typeof CardService.getAvailableSets).toBe('function');
    });

    it('should have fetchSetData method', () => {
      expect(CardService.fetchSetData).toBeDefined();
      expect(typeof CardService.fetchSetData).toBe('function');
    });

    it('should have getCollectionId method', () => {
      expect(CardService.getCollectionId).toBeDefined();
      expect(typeof CardService.getCollectionId).toBe('function');
    });

    it('should have getCardImage method', () => {
      expect(CardService.getCardImage).toBeDefined();
      expect(typeof CardService.getCardImage).toBe('function');
    });

    it('should have getBackImage method', () => {
      expect(CardService.getBackImage).toBeDefined();
      expect(typeof CardService.getBackImage).toBe('function');
    });

    it('should have fetchWithTimeout method', () => {
      expect(CardService.fetchWithTimeout).toBeDefined();
      expect(typeof CardService.fetchWithTimeout).toBe('function');
    });
  });

  describe('Regression: Disabled Features (Issue from commit ec3f749)', () => {




    it('getAvailableSets should not have unresolved TODO about path structure', () => {
      const source = CardService.getAvailableSets.toString();

      // If this fails, someone disabled the function again
      expect(source).not.toMatch(/return\s*\[\s*\]\s*;?\s*\/\/.*disabled/i);
      expect(source).not.toMatch(/TODO.*Fix collection path/i);
      expect(source).not.toMatch(/DISABLED.*path structure/i);
    });

    it('getAvailableSets should not have large commented-out code blocks', () => {
      const source = CardService.getAvailableSets.toString();
      const lines = source.split('\n');

      let inComment = false;
      let commentedLines = 0;

      for (const line of lines) {
        if (line.includes('/*')) inComment = true;
        if (inComment) commentedLines++;
        if (line.includes('*/')) inComment = false;
      }

      // Commented code shouldn't be >50% of function
      const ratio = commentedLines / lines.length;
      expect(ratio).toBeLessThan(0.5);
    });
  });

  describe('Firestore Path Structure Validation', () => {
    it('should construct valid Firestore paths for doc references', async () => {
      const { doc } = await import('firebase/firestore');

      // Valid call: doc(db, 'a', 'b', 'c') - odd segments
      expect(() => {
        doc({_type: 'firestore'}, 'a', 'b', 'c');
      }).not.toThrow();

      // Invalid call: doc(db, 'a', 'b', 'c', 'd') - even segments
      expect(() => {
        doc({_type: 'firestore'}, 'a', 'b', 'c', 'd');
      }).toThrow();
    });

    it('should construct valid Firestore paths for collection references', async () => {
      const { collection } = await import('firebase/firestore');

      // Valid call: collection(db, 'a', 'b', 'c') - odd segments
      expect(() => {
        collection({_type: 'firestore'}, 'a', 'b', 'c');
      }).not.toThrow();

      // Invalid call: collection(db, 'a', 'b', 'c', 'd') - even segments
      expect(() => {
        collection({_type: 'firestore'}, 'a', 'b', 'c', 'd');
      }).toThrow();
    });

    it('should use doc() + collection() pattern for nested paths, not concatenated strings', async () => {
      // This catches the bug where 'public/data/cardDatabase' was passed as one string
      const { doc, collection } = await import('firebase/firestore');

      const source = CardService.getAvailableSets.toString();

      // Should use separate arguments, not concatenated strings
      expect(source).toContain("'public'");
      expect(source).toContain("'data'");
      expect(source).toContain("'cardDatabase'");

      // Should NOT concatenate them
      expect(source).not.toContain("'public/data/cardDatabase'");
    });
  });

  describe('getAvailableSets - Integration', () => {
















  });

  describe('fetchSetData - Firestore Integration', () => {






  });

  describe('Utility Methods', () => {
    describe('getCollectionId', () => {
      it('should generate correct ID for standard cards', () => {
        const id = CardService.getCollectionId('SOR', '001', false);
        expect(id).toBe('SOR_001_std');
      });

      it('should generate correct ID for foil cards', () => {
        const id = CardService.getCollectionId('SOR', '001', true);
        expect(id).toBe('SOR_001_foil');
      });
    });

    describe('getCardImage', () => {
      it('should generate correct image URL', () => {
        const url = CardService.getCardImage('SOR', '001');
        expect(url).toContain('/cards/SOR/001');
        expect(url).toContain('format=image');
      });
    });

    describe('getBackImage', () => {
      it('should generate correct back image URL', () => {
        const url = CardService.getBackImage('SOR', '001');
        expect(url).toContain('/cards/SOR/001');
        expect(url).toContain('face=back');
        expect(url).toContain('format=image');
      });
    });

    describe('fetchWithTimeout', () => {
      it('should have timeout parameter', async () => {
        global.fetch = vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => ({})
        }));

        const result = await CardService.fetchWithTimeout(
          'https://example.com',
          {},
          5000
        );

        expect(result.ok).toBe(true);
      });
    });
  });

  describe('Documentation and Comments', () => {
    it('should have documentation explaining Firestore path structure', () => {
      const source = CardService.getAvailableSets.toString();

      // Should have comments and code referencing path structure
      expect(source).toContain('artifacts');
      expect(source).toContain('cardDatabase');
    });

    it('should document fallback strategies', () => {
      const source = CardService.fetchSetData.toString();

      // Should document multiple data sources
      expect(source).toContain('Firestore');
    });

    it('should not have unresolved issues in function source', () => {
      const source = CardService.getAvailableSets.toString();

      // Should not have "FIXME" or unresolved issues
      expect(source).not.toMatch(/FIXME.*path/i);
      expect(source).not.toMatch(/BUG.*path/i);
    });
  });
});

