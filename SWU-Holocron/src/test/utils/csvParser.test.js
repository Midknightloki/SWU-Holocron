/**
 * @vitest-environment happy-dom
 * @unit @critical @environment:web-file-api
 */

import { describe, it, expect } from 'vitest';
import {
  detectColumns,
  parseCSVRow,
  parseCSV,
  generateCSV,
  generateMissingCardsCSV
} from '../../utils/csvParser';

describe('csvParser', () => {
  describe('detectColumns', () => {
    it('should detect standard column format', () => {
      const headers = ['Name', 'Set', 'Number', 'Quantity', 'Foil'];
      const result = detectColumns(headers);
      
      expect(result.nameCol).toBe(0);
      expect(result.setCol).toBe(1);
      expect(result.numberCol).toBe(2);
      expect(result.quantityCol).toBe(3);
      expect(result.foilCol).toBe(4);
    });

    it('should detect Moxfield format', () => {
      const headers = ['Count', 'Card Name', 'Set', 'Collector Number', 'Foil'];
      const result = detectColumns(headers);
      
      expect(result.nameCol).toBe(1);
      expect(result.setCol).toBe(2);
      expect(result.numberCol).toBe(3);
      expect(result.quantityCol).toBe(0);
      expect(result.foilCol).toBe(4);
    });

    it('should detect Archidekt format', () => {
      const headers = ['Qty', 'Card', 'Expansion', '#', 'Finish'];
      const result = detectColumns(headers);
      
      expect(result.nameCol).toBe(1);
      expect(result.setCol).toBe(2);
      expect(result.numberCol).toBe(3);
      expect(result.quantityCol).toBe(0);
      expect(result.foilCol).toBe(4);
    });

    it('should handle case insensitive headers', () => {
      const headers = ['NAME', 'SET', 'NUMBER'];
      const result = detectColumns(headers);
      
      expect(result.nameCol).toBe(0);
      expect(result.setCol).toBe(1);
      expect(result.numberCol).toBe(2);
    });

    it('should handle headers with extra whitespace', () => {
      const headers = ['  Name  ', ' Set ', ' Number '];
      const result = detectColumns(headers);
      
      expect(result.nameCol).toBe(0);
      expect(result.setCol).toBe(1);
      expect(result.numberCol).toBe(2);
    });

    it('should return -1 for missing optional columns', () => {
      const headers = ['Name', 'Set', 'Number'];
      const result = detectColumns(headers);
      
      expect(result.quantityCol).toBe(-1);
      expect(result.foilCol).toBe(-1);
    });

    it('should throw error for missing required columns', () => {
      expect(() => detectColumns(['Name', 'Set'])).toThrow('CSV must contain Name, Set, and Number columns');
      expect(() => detectColumns(['Name', 'Number'])).toThrow('CSV must contain Name, Set, and Number columns');
      expect(() => detectColumns(['Set', 'Number'])).toThrow('CSV must contain Name, Set, and Number columns');
    });
  });

  describe('parseCSVRow', () => {
    const standardColumns = { nameCol: 0, setCol: 1, numberCol: 2, quantityCol: 3, foilCol: 4 };

    it('should parse standard row', () => {
      const row = ['Director Krennic', 'SOR', '001', '1', ''];
      const result = parseCSVRow(row, standardColumns);
      
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'Director Krennic',
        set: 'SOR',
        number: '001',
        quantity: 1,
        isFoil: false
      });
    });

    it('should parse foil card', () => {
      const row = ['Chewbacca', 'SOR', '003', '1', 'Foil'];
      const result = parseCSVRow(row, standardColumns);
      
      expect(result[0].isFoil).toBe(true);
    });

    it('should detect various foil indicators', () => {
      const testCases = ['Foil', 'foil', 'F', 'f', '1', 'yes', 'Yes', 'true', 'True'];
      
      testCases.forEach(foilValue => {
        const row = ['Card', 'SOR', '001', '1', foilValue];
        const result = parseCSVRow(row, standardColumns);
        expect(result[0].isFoil).toBe(true);
      });
    });

    it('should default to quantity 1 if column missing', () => {
      const columnsNoQty = { nameCol: 0, setCol: 1, numberCol: 2, quantityCol: -1, foilCol: -1 };
      const row = ['Card', 'SOR', '001'];
      const result = parseCSVRow(row, columnsNoQty);
      
      expect(result[0].quantity).toBe(1);
    });

    it('should uppercase set codes', () => {
      const row = ['Card', 'sor', '001', '1', ''];
      const result = parseCSVRow(row, standardColumns);
      
      expect(result[0].set).toBe('SOR');
    });

    it('should trim whitespace', () => {
      const row = ['  Card Name  ', ' sor ', ' 001 ', ' 2 ', ' '];
      const result = parseCSVRow(row, standardColumns);
      
      expect(result[0].name).toBe('Card Name');
      expect(result[0].set).toBe('SOR');
      expect(result[0].number).toBe('001');
    });

    it('should skip rows with missing required fields', () => {
      expect(parseCSVRow(['', 'SOR', '001', '1', ''], standardColumns)).toEqual([]);
      expect(parseCSVRow(['Card', '', '001', '1', ''], standardColumns)).toEqual([]);
      expect(parseCSVRow(['Card', 'SOR', '', '1', ''], standardColumns)).toEqual([]);
    });

    it('should skip rows with invalid quantity', () => {
      expect(parseCSVRow(['Card', 'SOR', '001', 'invalid', ''], standardColumns)).toEqual([]);
      expect(parseCSVRow(['Card', 'SOR', '001', '0', ''], standardColumns)).toEqual([]);
      expect(parseCSVRow(['Card', 'SOR', '001', '-1', ''], standardColumns)).toEqual([]);
    });
  });

  describe('parseCSV', () => {
    it('should parse valid CSV content', () => {
      const csv = `Name,Set,Number,Quantity
Director Krennic,SOR,001,1
Chewbacca,SOR,003,3
Luke Skywalker,SOR,004,2`;

      const result = parseCSV(csv);
      
      expect(result.items).toHaveLength(3);
      expect(result.errors).toHaveLength(0);
      expect(result.items[0].name).toBe('Director Krennic');
      expect(result.items[1].quantity).toBe(3);
    });

    it('should handle CSV with quotes', () => {
      const csv = `Name,Set,Number,Quantity
"Han Solo, Scoundrel",SOR,010,1
"Leia ""Princess"" Organa",SOR,011,2`;

      const result = parseCSV(csv);
      
      expect(result.items).toHaveLength(2);
      expect(result.items[0].name).toBe('Han Solo, Scoundrel');
      expect(result.items[1].name).toBe('Leia "Princess" Organa');
    });

    it('should handle CSV with foil column', () => {
      const csv = `Card Name,Set,Number,Count,Foil
Darth Vader,SOR,005,1,
Darth Vader,SOR,005,1,Foil`;

      const result = parseCSV(csv);
      
      expect(result.items).toHaveLength(2);
      expect(result.items[0].isFoil).toBe(false);
      expect(result.items[1].isFoil).toBe(true);
    });

    it('should handle various line endings', () => {
      const csvCRLF = "Name,Set,Number\r\nCard,SOR,001";
      const csvLF = "Name,Set,Number\nCard,SOR,001";
      
      expect(parseCSV(csvCRLF).items).toHaveLength(1);
      expect(parseCSV(csvLF).items).toHaveLength(1);
    });

    it('should skip empty lines', () => {
      const csv = `Name,Set,Number

Card A,SOR,001

Card B,SOR,002

`;

      const result = parseCSV(csv);
      expect(result.items).toHaveLength(2);
    });

    it('should collect errors for invalid rows', () => {
      const csv = `Name,Set,Number,Quantity
Valid Card,SOR,001,1
,SOR,002,1
Card,SOR,,1
Card,SOR,003,invalid`;

      const result = parseCSV(csv);
      
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe('Valid Card');
    });

    it('should throw error for invalid CSV content', () => {
      expect(() => parseCSV('')).toThrow('Invalid CSV content');
      expect(() => parseCSV('Header only')).toThrow();
      expect(() => parseCSV(null)).toThrow('Invalid CSV content');
    });

    it('should throw error for missing required columns', () => {
      const csv = `Name,Set
Card,SOR`;
      
      expect(() => parseCSV(csv)).toThrow('CSV must contain Name, Set, and Number columns');
    });
  });

  describe('generateCSV', () => {
    it('should generate CSV from collection data', () => {
      const collectionData = {
        'SOR_001_std': { quantity: 1, set: 'SOR', number: '001', name: 'Director Krennic', isFoil: false },
        'SOR_003_std': { quantity: 3, set: 'SOR', number: '003', name: 'Chewbacca', isFoil: false }
      };

      const result = generateCSV(collectionData);
      const lines = result.split('\n');
      
      expect(lines[0]).toBe('Set,Number,Name,Quantity,Foil');
      expect(lines).toHaveLength(3); // Header + 2 rows
      expect(result).toContain('SOR,001,"Director Krennic",1,');
      expect(result).toContain('SOR,003,"Chewbacca",3,');
    });

    it('should mark foil cards', () => {
      const collectionData = {
        'SOR_001_foil': { quantity: 1, set: 'SOR', number: '001', name: 'Card', isFoil: true }
      };

      const result = generateCSV(collectionData);
      expect(result).toContain(',Foil');
    });

    it('should escape quotes in names', () => {
      const collectionData = {
        'SOR_001_std': { quantity: 1, set: 'SOR', number: '001', name: 'Han "Scoundrel" Solo', isFoil: false }
      };

      const result = generateCSV(collectionData);
      expect(result).toContain('"Han ""Scoundrel"" Solo"');
    });

    it('should skip items with zero quantity', () => {
      const collectionData = {
        'SOR_001_std': { quantity: 1, set: 'SOR', number: '001', name: 'Card A', isFoil: false },
        'SOR_002_std': { quantity: 0, set: 'SOR', number: '002', name: 'Card B', isFoil: false }
      };

      const result = generateCSV(collectionData);
      expect(result).toContain('Card A');
      expect(result).not.toContain('Card B');
    });

    it('should sort rows alphabetically', () => {
      const collectionData = {
        'SOR_003_std': { quantity: 1, set: 'SOR', number: '003', name: 'Card C', isFoil: false },
        'SOR_001_std': { quantity: 1, set: 'SOR', number: '001', name: 'Card A', isFoil: false },
        'SOR_002_std': { quantity: 1, set: 'SOR', number: '002', name: 'Card B', isFoil: false }
      };

      const result = generateCSV(collectionData);
      const lines = result.split('\n');
      
      expect(lines[1]).toContain('001');
      expect(lines[2]).toContain('002');
      expect(lines[3]).toContain('003');
    });
  });

  describe('generateMissingCardsCSV', () => {
    it('should generate CSV for missing cards', () => {
      const missingCards = [
        { Number: '001', Name: 'Director Krennic', Subtitle: 'Aspiring to Authority', Rarity: 'Rare', Type: 'Leader' },
        { Number: '002', Name: 'Iden Versio', Subtitle: 'Inferno Squad Commander', Rarity: 'Common', Type: 'Leader' }
      ];

      const result = generateMissingCardsCSV(missingCards, 'SOR');
      const lines = result.split('\n');
      
      expect(lines[0]).toBe('Set,Number,Name,Subtitle,Rarity,Type');
      expect(lines).toHaveLength(3); // Header + 2 rows
      expect(result).toContain('SOR,001,"Director Krennic","Aspiring to Authority",Rare,Leader');
    });

    it('should handle cards without subtitles', () => {
      const missingCards = [
        { Number: '003', Name: 'Chewbacca', Subtitle: undefined, Rarity: 'Uncommon', Type: 'Unit' }
      ];

      const result = generateMissingCardsCSV(missingCards, 'SOR');
      expect(result).toContain('SOR,003,"Chewbacca",,Uncommon,Unit');
    });

    it('should escape quotes in names and subtitles', () => {
      const missingCards = [
        { Number: '010', Name: 'Han "The Scoundrel" Solo', Subtitle: '"Best" Pilot', Rarity: 'Rare', Type: 'Unit' }
      ];

      const result = generateMissingCardsCSV(missingCards, 'SOR');
      expect(result).toContain('"Han ""The Scoundrel"" Solo"');
      expect(result).toContain('"""Best"" Pilot"');
    });
  });
});
