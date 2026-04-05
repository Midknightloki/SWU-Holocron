/**
 * Deck Import/Export Utilities
 * Pure functions for converting deck data between formats:
 * - Forcetable JSON (primary format)
 * - SWU-DB Plain Text (community standard)
 * - Clipboard export helper
 * @unit @critical
 */

/**
 * Export deck to Forcetable JSON format
 * @param {Object} deck - Internal deck object
 * @param {string} authorName - Optional author name for metadata
 * @returns {string} Pretty-printed JSON string
 */
export const exportToForcetableJSON = (deck, authorName = '') => {
  if (!deck || typeof deck !== 'object') {
    throw new Error('Invalid deck object');
  }

  const forcetableDeck = {
    metadata: {
      name: deck.name || 'Untitled Deck',
      author: authorName || ''
    },
    leader: {
      id: deck.leaderId || '',
      count: 1
    },
    base: {
      id: deck.baseId || '',
      count: 1
    },
    deck: Object.entries(deck.cards || {}).map(([cardId, count]) => ({
      id: cardId,
      count
    })),
    sideboard: []
  };

  return JSON.stringify(forcetableDeck, null, 2);
};

/**
 * Import deck from Forcetable JSON format
 * @param {string} jsonString - JSON string in Forcetable format
 * @returns {Object} { deck: DeckData, errors: string[] }
 */
export const importFromForcetableJSON = (jsonString) => {
  const errors = [];

  if (!jsonString || typeof jsonString !== 'string') {
    return {
      deck: null,
      errors: ['Invalid JSON input']
    };
  }

  let forcetableDeck;
  try {
    forcetableDeck = JSON.parse(jsonString);
  } catch (err) {
    return {
      deck: null,
      errors: [`JSON parse error: ${err.message}`]
    };
  }

  // Extract metadata
  const name = forcetableDeck?.metadata?.name || '';
  const author = forcetableDeck?.metadata?.author || '';

  // Extract leader
  const leaderId = forcetableDeck?.leader?.id;
  if (!leaderId) {
    errors.push('Missing leader ID');
  }

  // Extract base
  const baseId = forcetableDeck?.base?.id;
  if (!baseId) {
    errors.push('Missing base ID');
  }

  // Build cards object from deck array
  const cards = {};
  if (Array.isArray(forcetableDeck?.deck)) {
    for (const cardEntry of forcetableDeck.deck) {
      if (cardEntry && cardEntry.id) {
        cards[cardEntry.id] = cardEntry.count || 1;
      }
    }
  }

  const deck = {
    name,
    description: '',
    leaderId: leaderId || '',
    baseId: baseId || '',
    cards,
    format: 'Premier',
    tags: []
  };

  return { deck, errors };
};

/**
 * Export deck to SWU-DB plain text format
 * @param {Object} deck - Internal deck object
 * @param {Object|null} cardDatabase - Optional map of cardId -> { Name } for card names
 * @returns {string} Plain text string
 */
export const exportToSWUDBText = (deck, cardDatabase = null) => {
  if (!deck || typeof deck !== 'object') {
    throw new Error('Invalid deck object');
  }

  const lines = [];

  // Add leader line
  if (deck.leaderId) {
    const leaderName = cardDatabase?.[deck.leaderId]?.Name || 'Unknown';
    lines.push(`Leader: ${leaderName} (${deck.leaderId})`);
  }

  // Add base line
  if (deck.baseId) {
    const baseName = cardDatabase?.[deck.baseId]?.Name || 'Unknown';
    lines.push(`Base: ${baseName} (${deck.baseId})`);
  }

  // Add deck cards in sorted order
  const sortedCards = Object.entries(deck.cards || {})
    .sort(([, countA], [, countB]) => countB - countA) // Descending by count
    .sort(([idA], [idB]) => idA.localeCompare(idB)); // Then ascending by ID

  for (const [cardId, count] of sortedCards) {
    const cardName = cardDatabase?.[cardId]?.Name || cardId;
    lines.push(`${count} ${cardName} (${cardId})`);
  }

  return lines.join('\n');
};

/**
 * Import deck from SWU-DB plain text format
 * @param {string} text - Plain text string in SWU-DB format
 * @returns {Object} { deck: DeckData, errors: string[] }
 */
export const importFromSWUDBText = (text) => {
  const errors = [];

  if (!text || typeof text !== 'string') {
    return {
      deck: null,
      errors: ['Invalid text input']
    };
  }

  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));

  let leaderId = '';
  let baseId = '';
  const cards = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Parse leader line
    if (line.startsWith('Leader:')) {
      const match = line.match(/Leader:\s+.*\(([A-Z0-9_]+)\)/);
      if (match) {
        leaderId = match[1];
      } else {
        errors.push(`Line ${i + 1}: Invalid leader format`);
      }
      continue;
    }

    // Parse base line
    if (line.startsWith('Base:')) {
      const match = line.match(/Base:\s+.*\(([A-Z0-9_]+)\)/);
      if (match) {
        baseId = match[1];
      } else {
        errors.push(`Line ${i + 1}: Invalid base format`);
      }
      continue;
    }

    // Parse card line: {count} {name} ({cardId}) or {count}x {name} ({cardId})
    const cardMatch = line.match(/^(\d+)x?\s+(.+)\s+\(([A-Z0-9_]+)\)$/);
    if (cardMatch) {
      const count = parseInt(cardMatch[1], 10);
      const cardId = cardMatch[3];
      cards[cardId] = count;
    } else if (line.length > 0) {
      errors.push(`Line ${i + 1}: Could not parse card line`);
    }
  }

  const deck = {
    name: '',
    description: '',
    leaderId,
    baseId,
    cards,
    format: 'Premier',
    tags: []
  };

  return { deck, errors };
};

/**
 * Copy deck to clipboard as Forcetable JSON
 * @param {Object} deck - Internal deck object
 * @param {string} authorName - Optional author name
 * @returns {Promise<boolean>} True if copy succeeded
 */
export const copyToClipboard = async (deck, authorName = '') => {
  try {
    const jsonString = exportToForcetableJSON(deck, authorName);
    await navigator.clipboard.writeText(jsonString);
    return true;
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
    return false;
  }
};

/**
 * Validate deck structure and card counts
 * @param {Object} deck - Internal deck object to validate
 * @returns {Object} { valid: boolean, errors: string[], warnings: string[] }
 */
export const validateDeckImport = (deck) => {
  const errors = [];
  const warnings = [];

  if (!deck || typeof deck !== 'object') {
    return {
      valid: false,
      errors: ['Invalid deck object'],
      warnings: []
    };
  }

  // Check leader
  if (!deck.leaderId || typeof deck.leaderId !== 'string') {
    errors.push('Deck must have a valid leader ID');
  }

  // Check base
  if (!deck.baseId || typeof deck.baseId !== 'string') {
    errors.push('Deck must have a valid base ID');
  }

  // Check cards object
  if (!deck.cards || typeof deck.cards !== 'object') {
    errors.push('Deck must have a valid cards object');
  } else {
    // Validate individual card counts
    for (const [cardId, count] of Object.entries(deck.cards)) {
      if (!cardId || !cardId.match(/^[A-Z0-9_]+$/)) {
        errors.push(`Invalid card ID: ${cardId}`);
      }

      if (!Number.isInteger(count) || count < 1) {
        errors.push(`Invalid count for card ${cardId}: ${count}`);
      }

      if (count > 3) {
        errors.push(`Card ${cardId} has count ${count} (max 3 allowed)`);
      }
    }
  }

  // Calculate and store total card count
  const totalCards = Object.values(deck.cards || {}).reduce((sum, count) => sum + count, 0);

  // Warnings for unusual deck sizes
  if (totalCards < 20) {
    warnings.push(`Deck has only ${totalCards} cards (typical decks have 50+)`);
  }

  if (totalCards > 100) {
    warnings.push(`Deck has ${totalCards} cards (typical maximum is 60)`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
};
