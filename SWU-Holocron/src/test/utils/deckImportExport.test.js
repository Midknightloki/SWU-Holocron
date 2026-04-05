/**
 * @vitest-environment happy-dom
 * @unit @critical
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  exportToForcetableJSON,
  importFromForcetableJSON,
  exportToSWUDBText,
  importFromSWUDBText,
  copyToClipboard,
  validateDeckImport
} from '../../utils/deckImportExport';

const sampleDeck = {
  name: 'Hera Spectre Control',
  description: '',
  leaderId: 'SOR_008',
  baseId: 'SOR_021',
  cards: { 'SOR_050': 3, 'SOR_200': 1, 'JTL_045': 2 },
  format: 'Premier',
  tags: []
};

const sampleCardDatabase = {
  'SOR_008': { Name: 'Hera Syndulla' },
  'SOR_021': { Name: 'Chopper Base' },
  'SOR_050': { Name: 'Consular Security Force' },
  'SOR_200': { Name: 'The Force Is With Me' },
  'JTL_045': { Name: 'R2-D2' }
};

describe('deckImportExport', () => {
  describe('exportToForcetableJSON', () => {
    it('should export basic deck to Forcetable JSON', () => {
      const json = exportToForcetableJSON(sampleDeck, 'L0ki');
      const parsed = JSON.parse(json);

      expect(parsed.metadata.name).toBe('Hera Spectre Control');
      expect(parsed.metadata.author).toBe('L0ki');
      expect(parsed.leader.id).toBe('SOR_008');
      expect(parsed.leader.count).toBe(1);
      expect(parsed.base.id).toBe('SOR_021');
      expect(parsed.base.count).toBe(1);
    });

    it('should include all cards in deck array', () => {
      const json = exportToForcetableJSON(sampleDeck);
      const parsed = JSON.parse(json);

      expect(parsed.deck).toHaveLength(3);
      expect(parsed.deck).toContainEqual({ id: 'SOR_050', count: 3 });
      expect(parsed.deck).toContainEqual({ id: 'SOR_200', count: 1 });
      expect(parsed.deck).toContainEqual({ id: 'JTL_045', count: 2 });
    });

    it('should return valid JSON string', () => {
      const json = exportToForcetableJSON(sampleDeck);
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should use empty author when not provided', () => {
      const json = exportToForcetableJSON(sampleDeck);
      const parsed = JSON.parse(json);
      expect(parsed.metadata.author).toBe('');
    });

    it('should throw error for invalid deck object', () => {
      expect(() => exportToForcetableJSON(null)).toThrow('Invalid deck object');
      expect(() => exportToForcetableJSON('not an object')).toThrow('Invalid deck object');
    });

    it('should handle empty cards object', () => {
      const emptyDeck = { ...sampleDeck, cards: {} };
      const json = exportToForcetableJSON(emptyDeck);
      const parsed = JSON.parse(json);
      expect(parsed.deck).toHaveLength(0);
    });
  });

  describe('importFromForcetableJSON', () => {
    it('should parse valid Forcetable JSON', () => {
      const json = exportToForcetableJSON(sampleDeck, 'L0ki');
      const { deck, errors } = importFromForcetableJSON(json);

      expect(errors).toHaveLength(0);
      expect(deck.leaderId).toBe('SOR_008');
      expect(deck.baseId).toBe('SOR_021');
      expect(deck.name).toBe('Hera Spectre Control');
    });

    it('should preserve card counts and IDs', () => {
      const json = exportToForcetableJSON(sampleDeck);
      const { deck } = importFromForcetableJSON(json);

      expect(deck.cards['SOR_050']).toBe(3);
      expect(deck.cards['SOR_200']).toBe(1);
      expect(deck.cards['JTL_045']).toBe(2);
    });

    it('should return errors for missing leader', () => {
      const invalidJson = JSON.stringify({
        metadata: { name: 'Test' },
        base: { id: 'SOR_021', count: 1 },
        deck: [],
        sideboard: []
      });

      const { errors } = importFromForcetableJSON(invalidJson);
      expect(errors).toContain('Missing leader ID');
    });

    it('should return errors for missing base', () => {
      const invalidJson = JSON.stringify({
        metadata: { name: 'Test' },
        leader: { id: 'SOR_008', count: 1 },
        deck: [],
        sideboard: []
      });

      const { errors } = importFromForcetableJSON(invalidJson);
      expect(errors).toContain('Missing base ID');
    });

    it('should handle malformed JSON', () => {
      const { deck, errors } = importFromForcetableJSON('{ invalid json }');
      expect(deck).toBeNull();
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('JSON parse error');
    });

    it('should handle invalid input', () => {
      const { deck, errors } = importFromForcetableJSON(null);
      expect(deck).toBeNull();
      expect(errors).toContain('Invalid JSON input');
    });

    it('should return empty deck object on parse failure', () => {
      const { deck } = importFromForcetableJSON('');
      expect(deck).toBeNull();
    });
  });

  describe('exportToSWUDBText', () => {
    it('should export deck to plain text format', () => {
      const text = exportToSWUDBText(sampleDeck, sampleCardDatabase);

      expect(text).toContain('Leader: Hera Syndulla (SOR_008)');
      expect(text).toContain('Base: Chopper Base (SOR_021)');
    });

    it('should include all cards with correct format', () => {
      const text = exportToSWUDBText(sampleDeck, sampleCardDatabase);

      expect(text).toContain('3 Consular Security Force (SOR_050)');
      expect(text).toContain('2 R2-D2 (JTL_045)');
      expect(text).toContain('1 The Force Is With Me (SOR_200)');
    });

    it('should use card IDs when database is null', () => {
      const text = exportToSWUDBText(sampleDeck, null);

      expect(text).toContain('Leader: Unknown (SOR_008)');
      expect(text).toContain('Base: Unknown (SOR_021)');
      expect(text).toContain('3 SOR_050 (SOR_050)');
    });

    it('should handle missing card in database', () => {
      const partialDatabase = { 'SOR_008': { Name: 'Hera Syndulla' } };
      const text = exportToSWUDBText(sampleDeck, partialDatabase);

      expect(text).toContain('Leader: Hera Syndulla (SOR_008)');
      expect(text).toContain('Base: Unknown (SOR_021)');
    });

    it('should throw error for invalid deck', () => {
      expect(() => exportToSWUDBText(null)).toThrow('Invalid deck object');
    });

    it('should have leader and base before cards', () => {
      const text = exportToSWUDBText(sampleDeck, sampleCardDatabase);
      const lines = text.split('\n');

      expect(lines[0]).toContain('Leader:');
      expect(lines[1]).toContain('Base:');
    });
  });

  describe('importFromSWUDBText', () => {
    it('should parse valid SWU-DB text', () => {
      const text = `Leader: Hera Syndulla (SOR_008)
Base: Chopper Base (SOR_021)
3 Consular Security Force (SOR_050)
1 The Force Is With Me (SOR_200)
2 R2-D2 (JTL_045)`;

      const { deck, errors } = importFromSWUDBText(text);

      expect(errors).toHaveLength(0);
      expect(deck.leaderId).toBe('SOR_008');
      expect(deck.baseId).toBe('SOR_021');
      expect(deck.cards['SOR_050']).toBe(3);
      expect(deck.cards['SOR_200']).toBe(1);
      expect(deck.cards['JTL_045']).toBe(2);
    });

    it('should handle count with x suffix', () => {
      const text = `Leader: Hera Syndulla (SOR_008)
Base: Chopper Base (SOR_021)
3x Consular Security Force (SOR_050)
2x R2-D2 (JTL_045)`;

      const { deck, errors } = importFromSWUDBText(text);

      expect(errors).toHaveLength(0);
      expect(deck.cards['SOR_050']).toBe(3);
      expect(deck.cards['JTL_045']).toBe(2);
    });

    it('should ignore empty lines', () => {
      const text = `Leader: Hera Syndulla (SOR_008)

Base: Chopper Base (SOR_021)

3 Consular Security Force (SOR_050)`;

      const { deck, errors } = importFromSWUDBText(text);

      expect(errors).toHaveLength(0);
      expect(deck.leaderId).toBe('SOR_008');
      expect(deck.baseId).toBe('SOR_021');
    });

    it('should ignore comment lines', () => {
      const text = `# This is a comment
Leader: Hera Syndulla (SOR_008)
# Another comment
Base: Chopper Base (SOR_021)
3 Consular Security Force (SOR_050)`;

      const { deck, errors } = importFromSWUDBText(text);

      expect(errors).toHaveLength(0);
      expect(deck.leaderId).toBe('SOR_008');
    });

    it('should return errors for malformed card lines', () => {
      const text = `Leader: Hera Syndulla (SOR_008)
Base: Chopper Base (SOR_021)
This is not a valid card line
3 Consular Security Force (SOR_050)`;

      const { errors } = importFromSWUDBText(text);

      expect(errors.some(e => e.includes('Could not parse card line'))).toBe(true);
    });

    it('should return error for invalid leader format', () => {
      const text = `Leader: Missing ID format
Base: Chopper Base (SOR_021)`;

      const { errors } = importFromSWUDBText(text);

      expect(errors.some(e => e.includes('Invalid leader format'))).toBe(true);
    });

    it('should return error for invalid base format', () => {
      const text = `Leader: Hera Syndulla (SOR_008)
Base: Missing ID format`;

      const { errors } = importFromSWUDBText(text);

      expect(errors.some(e => e.includes('Invalid base format'))).toBe(true);
    });

    it('should handle invalid text input', () => {
      const { deck, errors } = importFromSWUDBText(null);
      expect(deck).toBeNull();
      expect(errors).toContain('Invalid text input');
    });

    it('should handle text with only whitespace', () => {
      const { deck, errors } = importFromSWUDBText('   \n   \n   ');

      expect(errors).toHaveLength(0);
      expect(deck.leaderId).toBe('');
      expect(deck.baseId).toBe('');
    });
  });

  describe('validateDeckImport', () => {
    it('should validate a complete valid deck', () => {
      const result = validateDeckImport(sampleDeck);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should report missing leader', () => {
      const invalidDeck = { ...sampleDeck, leaderId: '' };
      const result = validateDeckImport(invalidDeck);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Deck must have a valid leader ID');
    });

    it('should report missing base', () => {
      const invalidDeck = { ...sampleDeck, baseId: '' };
      const result = validateDeckImport(invalidDeck);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Deck must have a valid base ID');
    });

    it('should report card count exceeding limit', () => {
      const invalidDeck = { ...sampleDeck, cards: { 'SOR_050': 4 } };
      const result = validateDeckImport(invalidDeck);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('max 3 allowed'))).toBe(true);
    });

    it('should report invalid card count', () => {
      const invalidDeck = { ...sampleDeck, cards: { 'SOR_050': 0 } };
      const result = validateDeckImport(invalidDeck);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid count'))).toBe(true);
    });

    it('should report invalid card ID', () => {
      const invalidDeck = { ...sampleDeck, cards: { 'invalid-id': 1 } };
      const result = validateDeckImport(invalidDeck);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid card ID'))).toBe(true);
    });

    it('should warn about small deck size', () => {
      const smallDeck = { ...sampleDeck, cards: { 'SOR_050': 1 } };
      const result = validateDeckImport(smallDeck);

      expect(result.warnings.some(w => w.includes('only'))).toBe(true);
    });

    it('should warn about large deck size', () => {
      const largeDeck = { ...sampleDeck, cards: {} };
      for (let i = 0; i < 35; i++) {
        largeDeck.cards[`SOR_${String(i).padStart(3, '0')}`] = 3;
      }
      const result = validateDeckImport(largeDeck);

      expect(result.warnings.some(w => w.includes('maximum'))).toBe(true);
    });

    it('should reject invalid deck object', () => {
      const result = validateDeckImport(null);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid deck object');
    });

    it('should reject deck with missing cards object', () => {
      const result = validateDeckImport({ leaderId: 'SOR_008', baseId: 'SOR_021' });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('valid cards object'))).toBe(true);
    });
  });

  describe('copyToClipboard', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      const mockWriteText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: mockWriteText
        },
        writable: true,
        configurable: true
      });
    });

    it('should copy deck to clipboard', async () => {
      const result = await copyToClipboard(sampleDeck, 'L0ki');

      expect(result).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });

    it('should copy as Forcetable JSON format', async () => {
      await copyToClipboard(sampleDeck, 'L0ki');

      const copied = navigator.clipboard.writeText.mock.calls[0][0];
      const parsed = JSON.parse(copied);

      expect(parsed.metadata.author).toBe('L0ki');
      expect(parsed.leader.id).toBe('SOR_008');
    });

    it('should handle clipboard write failure', async () => {
      const mockWriteText = vi.fn(() => Promise.reject(new Error('Clipboard error')));
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: mockWriteText
        },
        writable: true,
        configurable: true
      });

      const result = await copyToClipboard(sampleDeck);

      expect(result).toBe(false);
    });
  });

  describe('Round-trip conversions', () => {
    it('should preserve deck data through Forcetable JSON round trip', () => {
      const json = exportToForcetableJSON(sampleDeck, 'L0ki');
      const { deck: importedDeck } = importFromForcetableJSON(json);

      expect(importedDeck.leaderId).toBe(sampleDeck.leaderId);
      expect(importedDeck.baseId).toBe(sampleDeck.baseId);
      expect(importedDeck.cards).toEqual(sampleDeck.cards);
    });

    it('should preserve deck data through SWU-DB text round trip', () => {
      const text = exportToSWUDBText(sampleDeck, sampleCardDatabase);
      const { deck: importedDeck } = importFromSWUDBText(text);

      expect(importedDeck.leaderId).toBe(sampleDeck.leaderId);
      expect(importedDeck.baseId).toBe(sampleDeck.baseId);
      expect(importedDeck.cards).toEqual(sampleDeck.cards);
    });

    it('should validate imported deck', () => {
      const json = exportToForcetableJSON(sampleDeck);
      const { deck } = importFromForcetableJSON(json);
      const validation = validateDeckImport(deck);

      expect(validation.valid).toBe(true);
    });
  });
});
