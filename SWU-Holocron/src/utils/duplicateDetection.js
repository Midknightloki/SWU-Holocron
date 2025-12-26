/**
 * Duplicate detection utilities for card submissions
 *
 * Searches existing card database to find potential duplicates
 * before submitting new cards.
 */

import { db, APP_ID } from '../firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import {
  parseOfficialCode,
  officialToInternal,
  normalizeOfficialCode,
  isPrintedFormat
} from './officialCodeUtils';

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy name matching
 * @param {string} str1
 * @param {string} str2
 * @returns {number} Edit distance
 */
export function levenshteinDistance(str1, str2) {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  const matrix = Array(s2.length + 1).fill(null).map(() =>
    Array(s1.length + 1).fill(null)
  );

  for (let i = 0; i <= s1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= s2.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= s2.length; j++) {
    for (let i = 1; i <= s1.length; i++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }

  return matrix[s2.length][s1.length];
}

/**
 * Calculate similarity score between two strings (0.0 to 1.0)
 * @param {string} str1
 * @param {string} str2
 * @returns {number} Similarity score
 * @param {Object} card1 - First card to compare
 * @param {Object} card2 - Second card to compare
 * @returns {number} Match score from 0.0 to 1.0
 */
export function calculateMatchScore(card1, card2) {
  let score = 0;
  let checks = 0;

  // Exact code match = 100%
  if (card1.OfficialCode && card2.OfficialCode && card1.OfficialCode === card2.OfficialCode) {
    return 1.0;
  }

  // Set + Number match = 100% (same card, different print/version)
  if (card1.Set && card2.Set && card1.Set === card2.Set &&
      card1.Number && card2.Number && card1.Number === card2.Number) {
    return 1.0;
  }

  // Name similarity
  if (card1.Name && card2.Name) {
    const nameSimilarity = calculateSimilarity(card1.Name, card2.Name);
    score += nameSimilarity * 0.6; // 60% weight
    checks += 0.6;
  }

  // Subtitle similarity (if present)
  if (card1.Subtitle && card2.Subtitle) {
    const subtitleSimilarity = calculateSimilarity(card1.Subtitle, card2.Subtitle);
    score += subtitleSimilarity * 0.2; // 20% weight
    checks += 0.2;
  }

  // Type match
  if (card1.Type && card2.Type) {
    if (card1.Type === card2.Type) {
      score += 0.1;
    }
    checks += 0.1;
  }

  // Aspects match
  if (card1.Aspects && card2.Aspects && Array.isArray(card1.Aspects) && Array.isArray(card2.Aspects)) {
    const matchingAspects = card1.Aspects.filter(a => card2.Aspects.includes(a)).length;
    const totalAspects = Math.max(card1.Aspects.length, card2.Aspects.length);
    if (totalAspects > 0) {
      score += (matchingAspects / totalAspects) * 0.1;
    }
    checks += 0.1;
  }

  return checks > 0 ? score / checks : 0;
}

/**
 * Calculate similarity score between two strings (0.0 to 1.0)
 * @param {string} str1
 * @param {string} str2
 * @returns {number} Similarity score
 */
export function calculateSimilarity(str1, str2) {
  const maxLength = Math.max(str1.length, str2.length);
  if (maxLength === 0) return 1.0;

  const distance = levenshteinDistance(str1, str2);
  return 1.0 - (distance / maxLength);
}

/**
 * Search by official code
 * @param {string} officialCode
 * @returns {Promise<Array>}
 */
export async function searchByOfficialCode(officialCode) {
  return [await findExactByOfficialCode(officialCode)].filter(Boolean);
}

/**
 * Search by set and number
 * @param {string} set
 * @param {string} number
 * @returns {Promise<Array>}
 */
export async function searchBySetAndNumber(set, number) {
  return [await findExactBySetNumber(set, number)].filter(Boolean);
}

/**
 * Fuzzy search by name
 * @param {string} name
 * @param {string} subtitle
 * @param {number} threshold
 * @returns {Promise<Array>}
 */
export async function fuzzySearchByName(name, subtitle = '', threshold = 0.8) {
  return await findFuzzyByName(name, subtitle, threshold);
}

/**
 * Find potential duplicates
 * @param {Object} cardData
 * @returns {Promise<Array>}
 */
export async function findPotentialDuplicates(cardData) {
  return await checkForDuplicates(cardData);
}

/**
 * Search for exact match by official code
 * @param {string} officialCode - Official code (printed or full format)
 * @returns {Promise<Object|null>} Matching card or null
 */
export async function findExactByOfficialCode(officialCode) {
  try {
    const normalizedCode = isPrintedFormat(officialCode)
      ? normalizeOfficialCode(officialCode)
      : officialCode;

    // Search all sets for cards with matching official code
    const setsRef = collection(db, `artifacts/${APP_ID}/public/data/cardDatabase/sets`);
    const setsSnap = await getDocs(setsRef);

    for (const setDoc of setsSnap.docs) {
      const setData = setDoc.data();
      const cards = setData.cards || [];

      const match = cards.find(card => {
        return card.OfficialCodeFull === normalizedCode ||
               card.OfficialCode === officialCode;
      });

      if (match) {
        return {
          ...match,
          setCode: setDoc.id,
          matchType: 'exact-code'
        };
      }
    }

    return null;
  } catch (error) {
    console.error('Error searching by official code:', error);
    return null;
  }
}

/**
 * Search for exact match by internal Set + Number
 * @param {string} set - Internal set code (e.g., "SOR", "PROMO")
 * @param {string} number - Card number (e.g., "001", "042")
 * @returns {Promise<Object|null>} Matching card or null
 */
export async function findExactBySetNumber(set, number) {
  try {
    const setRef = collection(db, `artifacts/${APP_ID}/public/data/cardDatabase/sets/${set}/data`);
    const setSnap = await getDocs(setRef);

    if (setSnap.empty) return null;

    const setData = setSnap.docs[0].data();
    const cards = setData.cards || [];

    const match = cards.find(card => card.Number === number);

    if (match) {
      return {
        ...match,
        setCode: set,
        matchType: 'exact-set-number'
      };
    }

    return null;
  } catch (error) {
    console.error('Error searching by set+number:', error);
    return null;
  }
}

/**
 * Search for fuzzy matches by card name
 * @param {string} cardName - Card name to search for
 * @param {string} [subtitle] - Optional subtitle
 * @param {number} [threshold=0.8] - Similarity threshold (0.0 to 1.0)
 * @returns {Promise<Array>} Array of potential matches with scores
 */
export async function findFuzzyByName(cardName, subtitle = '', threshold = 0.8) {
  try {
    const searchName = `${cardName}${subtitle ? ` ${subtitle}` : ''}`.toLowerCase();
    const matches = [];

    // Search all sets
    const setsRef = collection(db, `artifacts/${APP_ID}/public/data/cardDatabase/sets`);
    const setsSnap = await getDocs(setsRef);

    for (const setDoc of setsSnap.docs) {
      const setData = setDoc.data();
      const cards = setData.cards || [];

      for (const card of cards) {
        const cardFullName = `${card.Name}${card.Subtitle ? ` ${card.Subtitle}` : ''}`.toLowerCase();
        const similarity = calculateSimilarity(searchName, cardFullName);

        if (similarity >= threshold) {
          matches.push({
            ...card,
            setCode: setDoc.id,
            matchScore: similarity,
            matchReason: `Name similarity: ${(similarity * 100).toFixed(0)}%`,
            matchType: 'fuzzy-name'
          });
        }
      }
    }

    // Sort by match score descending
    return matches.sort((a, b) => b.matchScore - a.matchScore);
  } catch (error) {
    console.error('Error fuzzy searching by name:', error);
    return [];
  }
}

/**
 * Comprehensive duplicate check for a card submission
 * Checks official code, set+number, and fuzzy name matching
 * @param {Object} cardData - Card data to check
 * @param {string} cardData.OfficialCode - Official code (printed format)
 * @param {string} cardData.Set - Internal set code
 * @param {string} cardData.Number - Card number
 * @param {string} cardData.Name - Card name
 * @param {string} [cardData.Subtitle] - Card subtitle
 * @returns {Promise<Array>} Array of possible duplicates
 */
export async function checkForDuplicates(cardData) {
  const duplicates = [];

  try {
    // 1. Exact match by official code (highest priority)
    if (cardData.OfficialCode) {
      const exactCodeMatch = await findExactByOfficialCode(cardData.OfficialCode);
      if (exactCodeMatch) {
        duplicates.push({
          id: `${exactCodeMatch.Set}_${exactCodeMatch.Number}`,
          officialCode: exactCodeMatch.OfficialCode || exactCodeMatch.OfficialCodeFull,
          set: exactCodeMatch.Set,
          number: exactCodeMatch.Number,
          name: exactCodeMatch.Name,
          matchScore: 1.0,
          matchReason: 'Exact official code match',
          matchType: 'exact-code'
        });
      }
    }

    // 2. Exact match by Set + Number
    if (cardData.Set && cardData.Number) {
      const exactSetMatch = await findExactBySetNumber(cardData.Set, cardData.Number);
      if (exactSetMatch && !duplicates.find(d => d.id === `${exactSetMatch.Set}_${exactSetMatch.Number}`)) {
        duplicates.push({
          id: `${exactSetMatch.Set}_${exactSetMatch.Number}`,
          officialCode: exactSetMatch.OfficialCode || exactSetMatch.OfficialCodeFull,
          set: exactSetMatch.Set,
          number: exactSetMatch.Number,
          name: exactSetMatch.Name,
          matchScore: 1.0,
          matchReason: 'Exact set + number match',
          matchType: 'exact-set-number'
        });
      }
    }

    // 3. Fuzzy name matching (lower priority)
    if (cardData.Name) {
      const fuzzyMatches = await findFuzzyByName(
        cardData.Name,
        cardData.Subtitle,
        0.85 // 85% similarity threshold
      );

      for (const match of fuzzyMatches.slice(0, 3)) { // Top 3 fuzzy matches
        const matchId = `${match.Set}_${match.Number}`;
        if (!duplicates.find(d => d.id === matchId)) {
          duplicates.push({
            id: matchId,
            officialCode: match.OfficialCode || match.OfficialCodeFull,
            set: match.Set,
            number: match.Number,
            name: match.Name,
            matchScore: match.matchScore,
            matchReason: match.matchReason,
            matchType: 'fuzzy-name'
          });
        }
      }
    }

    return duplicates;
  } catch (error) {
    console.error('Error checking for duplicates:', error);
    return [];
  }
}

/**
 * Check if a card is an exact duplicate (100% match)
 * @param {Object} cardData - Card data to check
 * @returns {Promise<boolean>}
 */
export async function isExactDuplicate(cardData) {
  const duplicates = await checkForDuplicates(cardData);
  return duplicates.some(d => d.matchScore === 1.0 && d.matchType.startsWith('exact'));
}

/**
 * Get user-friendly duplicate warning message
 * @param {Array} duplicates - Array of duplicate matches
 * @returns {string} Warning message
 */
export function getDuplicateWarningMessage(duplicates) {
  if (duplicates.length === 0) {
    return 'No duplicates found. This appears to be a new card.';
  }

  const exactMatches = duplicates.filter(d => d.matchScore === 1.0);

  if (exactMatches.length > 0) {
    const match = exactMatches[0];
    return `⚠️ This card already exists in the database: ${match.name} (${match.set} ${match.number})`;
  }

  return `⚠️ Found ${duplicates.length} similar card(s). Please review before submitting.`;
}
