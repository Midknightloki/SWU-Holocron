/**
 * Collection Helper Utilities
 * Pure functions for collection ID generation and data operations
 * @critical @environment:firebase
 */

/**
 * Generate a unique collection ID for a card variant
 * @param {string} set - Set code (e.g., 'SOR')
 * @param {string} number - Card number (e.g., '001')
 * @param {boolean} isFoil - Whether the card is foil
 * @returns {string} Collection ID (e.g., 'SOR_001_std' or 'SOR_001_foil')
 */
export const getCollectionId = (set, number, isFoil) => {
  if (!set || !number) {
    throw new Error('Set and number are required');
  }
  return `${set}_${number}_${isFoil ? 'foil' : 'std'}`;
};

/**
 * Parse a collection ID back into its components
 * @param {string} collectionId - Collection ID (e.g., 'SOR_001_std')
 * @returns {{ set: string, number: string, isFoil: boolean }} Parsed components
 */
export const parseCollectionId = (collectionId) => {
  const parts = collectionId.split('_');
  if (parts.length !== 3) {
    throw new Error('Invalid collection ID format');
  }
  return {
    set: parts[0],
    number: parts[1],
    isFoil: parts[2] === 'foil'
  };
};

/**
 * Reconstruct card list from collection data (offline mode)
 * @param {Object} collectionData - Collection data object
 * @param {string} setCode - Set code to filter by
 * @returns {Array} Reconstructed card array
 */
export const reconstructCardsFromCollection = (collectionData, setCode) => {
  if (!collectionData || !setCode) return [];
  
  const relevantKeys = Object.keys(collectionData).filter(k => k.startsWith(`${setCode}_`));
  const cardMap = new Map();

  relevantKeys.forEach(key => {
    const item = collectionData[key];
    const { set, number } = parseCollectionId(key);
    
    // Use base key without foil suffix for deduplication
    const baseKey = `${set}_${number}`;
    
    if (!cardMap.has(baseKey)) {
      cardMap.set(baseKey, {
        Set: set,
        Number: number,
        Name: item.name || `Card #${number}`,
        Subtitle: '',
        Type: 'Unit', // Default, cannot determine from collection data
        Aspects: [],
        Cost: null,
        HP: null,
        Power: null,
        Rarity: 'Common',
        FrontText: 'Details unavailable offline'
      });
    }
  });

  return Array.from(cardMap.values()).sort((a, b) => 
    a.Number.localeCompare(b.Number, undefined, { numeric: true })
  );
};

/**
 * Calculate total quantity for a card across all variants
 * @param {Object} collectionData - Collection data object
 * @param {string} set - Set code
 * @param {string} number - Card number
 * @returns {{ standard: number, foil: number, total: number }}
 */
export const getCardQuantities = (collectionData, set, number) => {
  const stdKey = getCollectionId(set, number, false);
  const foilKey = getCollectionId(set, number, true);
  
  const standard = collectionData[stdKey]?.quantity || 0;
  const foil = collectionData[foilKey]?.quantity || 0;
  
  return {
    standard,
    foil,
    total: standard + foil
  };
};

/**
 * Check if a card type is horizontal (Leader or Base)
 * @param {string} type - Card type
 * @returns {boolean}
 */
export const isHorizontalCard = (type) => {
  return type === 'Leader' || type === 'Base';
};

/**
 * Get required playset quantity for a card type
 * @param {string} type - Card type
 * @returns {number} Required quantity (1 for Leader/Base, 3 for others)
 */
export const getPlaysetQuantity = (type) => {
  return (type === 'Leader' || type === 'Base') ? 1 : 3;
};
