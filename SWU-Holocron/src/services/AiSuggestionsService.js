import { getFunctions, httpsCallable } from 'firebase/functions';
import { isConfigured } from '../firebase';

/**
 * Calls the getCardSuggestions Cloud Function and returns AI suggestions.
 *
 * @param {object} params
 * @param {string} params.leaderName
 * @param {string} params.baseName
 * @param {string[]} params.aspects
 * @param {{count: number, name: string, type: string}[]} params.deckCards
 * @param {{id: string, name: string, type: string, cost: number|null, aspects: string[], traits: string[]}[]} params.availableCards
 * @returns {Promise<{id: string, name: string, reason: string}[]>}
 */
export async function getCardSuggestions({ leaderName, baseName, aspects, deckCards, availableCards }) {
  if (!isConfigured) {
    throw new Error('Firebase is not configured. Check src/firebase.js.');
  }

  const functions = getFunctions();
  const suggestCards = httpsCallable(functions, 'getCardSuggestions');
  const result = await suggestCards({ leaderName, baseName, aspects, deckCards, availableCards });
  return result.data.suggestions;
}
