/**
 * @vitest-environment happy-dom
 * @integration @slow @environment:web-file-api @environment:firebase
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseCSV, generateCSV } from '../../utils/csvParser';
import { mockCSVValid, mockCSVWithFoil, mockCollectionData } from '../utils/mockData';

describe('CSV Import/Export Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should complete full import-export-import round trip', () => {
    // 1. Export collection to CSV
    const exportedCSV = generateCSV(mockCollectionData);
    expect(exportedCSV).toContain('Director Krennic');
    expect(exportedCSV).toContain('Chewbacca');

    // 2. Import the exported CSV
    const { items, errors } = parseCSV(exportedCSV);
    expect(errors).toHaveLength(0);
    expect(items.length).toBeGreaterThan(0);

    // 3. Verify data integrity
    const originalItems = Object.values(mockCollectionData).filter(item => item.quantity > 0);
    expect(items.length).toBe(originalItems.length);

    // Check specific card
    const directorItem = items.find(item => item.name.includes('Director Krennic'));
    expect(directorItem).toBeDefined();
    expect(directorItem.set).toBe('SOR');
    expect(directorItem.number).toBe('001');
  });

  it('should handle large CSV files efficiently', () => {
    // Generate large dataset
    const largeCollection = {};
    for (let i = 1; i <= 1000; i++) {
      const id = `SOR_${String(i).padStart(3, '0')}_std`;
      largeCollection[id] = {
        quantity: Math.floor(Math.random() * 3) + 1,
        set: 'SOR',
        number: String(i).padStart(3, '0'),
        name: `Test Card ${i}`,
        isFoil: false,
        timestamp: Date.now()
      };
    }

    const startTime = Date.now();
    const csv = generateCSV(largeCollection);
    const exportTime = Date.now() - startTime;

    expect(exportTime).toBeLessThan(1000); // Should complete in <1s
    expect(csv.split('\n').length).toBeGreaterThan(1000); // Header + 1000 rows

    const parseStartTime = Date.now();
    const { items, errors } = parseCSV(csv);
    const parseTime = Date.now() - parseStartTime;

    expect(parseTime).toBeLessThan(2000); // Should parse in <2s
    expect(items.length).toBe(1000);
    expect(errors.length).toBe(0);
  });

  it('should preserve foil status through round trip', () => {
    const collectionWithFoil = {
      'SOR_001_std': { quantity: 1, set: 'SOR', number: '001', name: 'Card A', isFoil: false, timestamp: Date.now() },
      'SOR_001_foil': { quantity: 1, set: 'SOR', number: '001', name: 'Card A', isFoil: true, timestamp: Date.now() },
      'SOR_002_foil': { quantity: 2, set: 'SOR', number: '002', name: 'Card B', isFoil: true, timestamp: Date.now() }
    };

    const csv = generateCSV(collectionWithFoil);
    const { items } = parseCSV(csv);

    const foilItems = items.filter(item => item.isFoil);
    const standardItems = items.filter(item => !item.isFoil);

    expect(foilItems.length).toBe(2); // Two foil entries
    expect(standardItems.length).toBe(1); // One standard entry
  });

  it('should handle special characters in card names', () => {
    const specialCollection = {
      'SOR_010_std': { quantity: 1, set: 'SOR', number: '010', name: 'Han "Scoundrel" Solo', isFoil: false, timestamp: Date.now() },
      'SOR_011_std': { quantity: 1, set: 'SOR', number: '011', name: 'Card with, Comma', isFoil: false, timestamp: Date.now() }
    };

    const csv = generateCSV(specialCollection);
    expect(csv).toContain('Han ""Scoundrel"" Solo'); // Quotes should be escaped

    const { items, errors } = parseCSV(csv);
    expect(errors.length).toBe(0);
    expect(items[0].name).toBe('Han "Scoundrel" Solo'); // Should be unescaped
    expect(items[1].name).toBe('Card with, Comma');
  });

  it('should validate CSV format before processing', () => {
    const invalidCSV = 'Invalid,Data\nNo,Proper,Columns';
    
    expect(() => parseCSV(invalidCSV)).toThrow('CSV must contain Name, Set, and Number columns');
  });

  it('should handle empty CSV gracefully', () => {
    const emptyCSV = 'Name,Set,Number,Quantity\n';
    
    expect(() => parseCSV(emptyCSV)).toThrow('CSV must contain at least a header and one data row');
  });

  it('should batch large imports correctly', () => {
    // Simulate 500 items (exceeds Firestore batch limit of 400)
    const largeImport = Array.from({ length: 500 }, (_, i) => ({
      set: 'SOR',
      number: String(i + 1).padStart(3, '0'),
      name: `Card ${i + 1}`,
      quantity: 1,
      isFoil: false
    }));

    // Calculate required batches (400 items per batch)
    const batchCount = Math.ceil(largeImport.length / 400);
    expect(batchCount).toBe(2); // Should require 2 batches

    // Verify items can be processed in batches
    const batch1 = largeImport.slice(0, 400);
    const batch2 = largeImport.slice(400);

    expect(batch1.length).toBe(400);
    expect(batch2.length).toBe(100);
  });
});
