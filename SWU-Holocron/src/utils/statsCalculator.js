/**
 * Statistics Calculator for Collection Dashboard
 * Pure functions for calculating collection stats
 * @critical
 */

import { getCollectionId, getPlaysetQuantity } from './collectionHelpers';

/**
 * Calculate comprehensive collection statistics
 * @param {Array} cards - Array of card objects for a set
 * @param {Object} collectionData - Collection data object
 * @param {string} setCode - Set code being analyzed
 * @returns {Object} Statistics including owned counts, percentages, missing list
 */
export const calculateStats = (cards, collectionData, setCode) => {
  if (!cards || !Array.isArray(cards) || cards.length === 0) {
    return null;
  }

  const totalCards = cards.length;
  let ownedTotal = 0;
  const missingList = [];
  const uniqueMap = new Map();

  // Build unique card map with ownership tracking
  cards.forEach(card => {
    const key = `${card.Name}${card.Subtitle ? ` ${card.Subtitle}` : ''}`;
    
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, {
        representative: card,
        totalOwned: 0
      });
    }

    // Sum quantities across standard and foil variants
    const stdKey = getCollectionId(setCode, card.Number, false);
    const foilKey = getCollectionId(setCode, card.Number, true);
    const qty = (collectionData[stdKey]?.quantity || 0) + (collectionData[foilKey]?.quantity || 0);
    
    const entry = uniqueMap.get(key);
    entry.totalOwned += qty;
    ownedTotal += qty;
  });

  // Calculate unique ownership and playsets
  const uniqueEntries = Array.from(uniqueMap.values());
  const totalUniqueCards = uniqueEntries.length;
  let ownedUniqueCount = 0;
  let playsetsCount = 0;

  uniqueEntries.forEach(entry => {
    if (entry.totalOwned > 0) {
      ownedUniqueCount++;
    } else {
      missingList.push(entry.representative);
    }

    const required = getPlaysetQuantity(entry.representative.Type);
    if (entry.totalOwned >= required) {
      playsetsCount++;
    }
  });

  // Sort missing cards by number
  missingList.sort((a, b) => 
    a.Number.localeCompare(b.Number, undefined, { numeric: true })
  );

  const percentComplete = totalUniqueCards > 0 
    ? Math.round((ownedUniqueCount / totalUniqueCards) * 100) 
    : 0;

  return {
    totalCards,
    totalUniqueCards,
    ownedUniqueCount,
    ownedTotal,
    playsetsCount,
    percentComplete,
    missingList
  };
};

/**
 * Calculate global summary across all sets
 * @param {Object} collectionData - Collection data object
 * @returns {Object} Summary with counts per set
 */
export const calculateGlobalSummary = (collectionData) => {
  const summary = {};
  
  Object.values(collectionData).forEach(item => {
    if (item.set) {
      if (!summary[item.set]) {
        summary[item.set] = 0;
      }
      summary[item.set] += item.quantity;
    }
  });

  return summary;
};

/**
 * Calculate completion percentage for a specific set
 * @param {Array} cards - Array of card objects for a set
 * @param {Object} collectionData - Collection data object
 * @param {string} setCode - Set code
 * @returns {number} Percentage (0-100)
 */
export const calculateSetCompletion = (cards, collectionData, setCode) => {
  const stats = calculateStats(cards, collectionData, setCode);
  return stats ? stats.percentComplete : 0;
};

/**
 * Get top rarity breakdown (how many of each rarity owned)
 * @param {Array} cards - Array of card objects
 * @param {Object} collectionData - Collection data object
 * @param {string} setCode - Set code
 * @returns {Object} Rarity counts { Common: 10, Rare: 5, ... }
 */
export const calculateRarityBreakdown = (cards, collectionData, setCode) => {
  const breakdown = {};

  cards.forEach(card => {
    const stdKey = getCollectionId(setCode, card.Number, false);
    const foilKey = getCollectionId(setCode, card.Number, true);
    const owned = (collectionData[stdKey]?.quantity || 0) + (collectionData[foilKey]?.quantity || 0);

    if (owned > 0) {
      const rarity = card.Rarity || 'Common';
      breakdown[rarity] = (breakdown[rarity] || 0) + 1;
    }
  });

  return breakdown;
};
