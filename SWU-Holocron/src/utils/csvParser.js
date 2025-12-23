/**
 * CSV Parser for Collection Import/Export
 * Pure functions for parsing and generating CSV data
 * @critical @environment:web-file-api
 */

/**
 * Detect column indices from CSV header row
 * Supports multiple CSV formats (Moxfield, Archidekt, custom)
 * @param {string[]} headers - Array of header strings
 * @returns {{ nameCol: number, setCol: number, numberCol: number, quantityCol: number, foilCol: number }}
 */
export const detectColumns = (headers) => {
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());
  
  const findColumn = (patterns) => {
    for (const pattern of patterns) {
      const index = lowerHeaders.findIndex(h => h.includes(pattern));
      if (index !== -1) return index;
    }
    return -1;
  };

  const nameCol = findColumn(['name', 'card name', 'card', 'title']);
  const setCol = findColumn(['set', 'expansion', 'set code']);
  const numberCol = findColumn(['number', 'collector number', 'card number', '#']);
  const quantityCol = findColumn(['quantity', 'count', 'qty', 'amount']);
  const foilCol = findColumn(['foil', 'finish', 'printing', 'treatment']);

  if (nameCol === -1 || setCol === -1 || numberCol === -1) {
    throw new Error('CSV must contain Name, Set, and Number columns');
  }

  return { nameCol, setCol, numberCol, quantityCol, foilCol };
};

/**
 * Parse a single CSV row into collection item(s)
 * @param {string[]} row - Array of cell values
 * @param {Object} columns - Column indices from detectColumns
 * @returns {Array<{ set: string, number: string, name: string, quantity: number, isFoil: boolean }>}
 */
export const parseCSVRow = (row, columns) => {
  const { nameCol, setCol, numberCol, quantityCol, foilCol } = columns;
  
  // Extract values
  const name = row[nameCol]?.trim();
  const set = row[setCol]?.trim().toUpperCase();
  let number = row[numberCol]?.trim();
  const quantity = quantityCol !== -1 ? parseInt(row[quantityCol]) : 1;
  const foilValue = foilCol !== -1 ? row[foilCol]?.toLowerCase().trim() : '';
  
  // Normalize card number to 3-digit format (001, 002, etc.)
  // This matches the format used by swu-db.com API
  if (number && /^\d+$/.test(number)) {
    number = number.padStart(3, '0');
  }
  
  // Validation
  if (!name || !set || !number) {
    return []; // Skip invalid rows
  }
  
  if (isNaN(quantity) || quantity < 1) {
    return []; // Skip rows with invalid quantity
  }

  // Detect foil status
  const isFoil = foilValue === 'foil' || 
                 foilValue === 'f' || 
                 foilValue === '1' || 
                 foilValue === 'yes' || 
                 foilValue === 'true';

  return [{
    set,
    number,
    name,
    quantity,
    isFoil
  }];
};

/**
 * Parse complete CSV string into collection items
 * @param {string} csvContent - Raw CSV content
 * @returns {{ items: Array, errors: Array<string> }}
 */
export const parseCSV = (csvContent) => {
  if (!csvContent || typeof csvContent !== 'string') {
    throw new Error('Invalid CSV content');
  }

  const lines = csvContent
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (lines.length < 2) {
    throw new Error('CSV must contain at least a header and one data row');
  }

  // Parse CSV with proper quote handling
  const parseCSVLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];
      
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"';
          i++; // Skip next quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    
    return result;
  };

  const headers = parseCSVLine(lines[0]);
  const columns = detectColumns(headers);
  
  const items = [];
  const errors = [];

  for (let i = 1; i < lines.length; i++) {
    try {
      const row = parseCSVLine(lines[i]);
      const parsed = parseCSVRow(row, columns);
      items.push(...parsed);
    } catch (error) {
      errors.push(`Line ${i + 1}: ${error.message}`);
    }
  }

  return { items, errors };
};

/**
 * Generate CSV content from collection data
 * @param {Object} collectionData - Collection data object
 * @returns {string} CSV content
 */
export const generateCSV = (collectionData) => {
  const headers = ['Set', 'Number', 'Name', 'Quantity', 'Foil'];
  const rows = Object.entries(collectionData)
    .filter(([_, item]) => item.quantity > 0)
    .map(([id, item]) => {
      const name = `"${(item.name || '').replace(/"/g, '""')}"`;
      const foil = item.isFoil ? 'Foil' : '';
      return `${item.set},${item.number},${name},${item.quantity},${foil}`;
    })
    .sort();

  return [headers.join(','), ...rows].join('\n');
};

/**
 * Generate CSV for missing cards list
 * @param {Array} missingCards - Array of card objects
 * @param {string} setCode - Set code for the cards
 * @returns {string} CSV content
 */
export const generateMissingCardsCSV = (missingCards, setCode) => {
  const headers = ['Set', 'Number', 'Name', 'Subtitle', 'Rarity', 'Type'];
  const rows = missingCards.map(card => {
    const safeName = `"${card.Name.replace(/"/g, '""')}"`;
    const safeSubtitle = card.Subtitle ? `"${card.Subtitle.replace(/"/g, '""')}"` : '';
    return `${setCode},${card.Number},${safeName},${safeSubtitle},${card.Rarity},${card.Type}`;
  });

  return [headers.join(','), ...rows].join('\n');
};
