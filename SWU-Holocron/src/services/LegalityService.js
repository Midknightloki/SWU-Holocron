import bannedList from '../data/banned-list.json';

const FORMAT_RULES = {
  'Premier': {
    minDeckSize: 50,
    leaderCount: 1,
    baseCount: 1,
    maxCopies: 3,
    maxSideboard: 10,
    singleton: false,
    hasRotation: true,
    formatKey: 'premier'
  },
  'Eternal': {
    minDeckSize: 50,
    leaderCount: 1,
    baseCount: 1,
    maxCopies: 3,
    maxSideboard: 10,
    singleton: false,
    hasRotation: false,
    formatKey: 'eternal'
  },
  'Twin Suns': {
    minDeckSize: 80,
    leaderCount: 2,
    baseCount: 1,
    maxCopies: 1,
    maxSideboard: 0,
    singleton: true,
    hasRotation: false,
    formatKey: 'twinSuns'
  },
  'Trilogy': {
    minDeckSize: 50,
    leaderCount: 1,
    baseCount: 1,
    maxCopies: 3,
    maxSideboard: 10,
    singleton: false,
    hasRotation: false,
    formatKey: 'trilogy'
  }
};

function normalizeCardId(set, number) {
  return `${set}_${String(number).padStart(3, '0')}`;
}

function cardMatchesBanEntry(card, entry) {
  if (entry.cardId) {
    return normalizeCardId(card.Set, card.Number) === entry.cardId;
  }
  const nameMatch = card.Name?.toLowerCase() === entry.name?.toLowerCase();
  if (!nameMatch) return false;
  if (entry.subtitle) {
    return card.Subtitle?.toLowerCase() === entry.subtitle?.toLowerCase();
  }
  return !card.Subtitle;
}

function getCardBanStatus(card, formatKey) {
  const formatBanList = bannedList.formats[formatKey];
  if (!formatBanList) return null;

  if (formatBanList.banned?.some(e => cardMatchesBanEntry(card, e))) return 'banned';
  if (formatBanList.restricted?.some(e => cardMatchesBanEntry(card, e))) return 'restricted';
  if (formatBanList.suspended?.some(e => cardMatchesBanEntry(card, e))) return 'suspended';
  return null;
}

function isSetLegal(card, formatKey) {
  const formatBanList = bannedList.formats[formatKey];
  if (!formatBanList?.legalSets) return true;
  return formatBanList.legalSets.includes(card.Set);
}

/**
 * Check legality for a single deck.
 *
 * @param {Object} deckData
 * @param {string} deckData.format
 * @param {string|null} deckData.leaderId
 * @param {string|null} deckData.leaderId2 - Twin Suns second leader
 * @param {string|null} deckData.baseId
 * @param {Array} deckData.mainDeckCards - [{cardId, count, card}]
 * @param {number} deckData.mainDeckTotal
 * @param {Array} deckData.sideboardCardsList - [{cardId, count, card}]
 * @param {Object} cardDataMap - cardId -> card object
 * @returns {{ isLegal: boolean, violations: Array, cardViolations: Map<string, Array> }}
 */
export function checkDeckLegality(deckData, cardDataMap) {
  const { format, leaderId, leaderId2, baseId, mainDeckCards = [], mainDeckTotal = 0, sideboardCardsList = [] } = deckData;
  const rules = FORMAT_RULES[format] || FORMAT_RULES['Premier'];
  const { formatKey } = rules;

  const violations = [];
  const cardViolations = new Map();

  const addCardViolation = (cardId, type, message) => {
    if (!cardViolations.has(cardId)) cardViolations.set(cardId, []);
    cardViolations.get(cardId).push({ type, message });
  };

  const addViolation = (type, code, message, cardId = null) => {
    violations.push({ type, code, message });
    if (cardId) addCardViolation(cardId, type, message);
  };

  // Leader count
  if (format === 'Twin Suns') {
    const leaderCount = [leaderId, leaderId2].filter(Boolean).length;
    if (leaderCount < 2) {
      addViolation('error', 'MISSING_LEADER', `Twin Suns requires exactly 2 Leaders (have ${leaderCount}).`);
    }
    if (leaderId && leaderId2 && leaderId === leaderId2) {
      addViolation('error', 'DUPLICATE_LEADER', 'Twin Suns requires two different Leaders.', leaderId);
    }
    // Leaders cannot combine Heroism + Villainy
    if (leaderId && leaderId2) {
      const l1 = cardDataMap[leaderId];
      const l2 = cardDataMap[leaderId2];
      const allAspects = new Set([...(l1?.Aspects || []), ...(l2?.Aspects || [])]);
      if (allAspects.has('Heroism') && allAspects.has('Villainy')) {
        addViolation('error', 'TWIN_SUNS_ALIGNMENT',
          'Twin Suns leaders cannot cover both Heroism and Villainy aspects.',
          leaderId
        );
        addCardViolation(leaderId2, 'error', 'Alignment conflict: combined leaders span Heroism + Villainy');
      }
    }
  } else {
    if (!leaderId) {
      addViolation('error', 'MISSING_LEADER', 'Deck must have exactly 1 Leader.');
    }
  }

  // Base
  if (!baseId) {
    addViolation('error', 'MISSING_BASE', 'Deck must have exactly 1 Base.');
  }

  // Deck size
  if (mainDeckTotal < rules.minDeckSize) {
    addViolation('error', 'DECK_TOO_SMALL',
      `Deck needs ${rules.minDeckSize - mainDeckTotal} more cards (minimum ${rules.minDeckSize}).`
    );
  }

  // Max copies per card
  mainDeckCards.forEach(({ cardId, count, card }) => {
    if (!card) return;
    if (count > rules.maxCopies) {
      addViolation('error', 'TOO_MANY_COPIES',
        `${card.Name}: ${count} copies exceeds the max of ${rules.maxCopies} in ${format}.`,
        cardId
      );
    }
  });

  // Sideboard size
  if (rules.maxSideboard === 0 && sideboardCardsList.length > 0) {
    addViolation('warning', 'SIDEBOARD_NOT_ALLOWED', `${format} does not allow a sideboard.`);
  } else {
    const sideTotal = sideboardCardsList.reduce((s, { count }) => s + count, 0);
    if (sideTotal > rules.maxSideboard) {
      addViolation('error', 'SIDEBOARD_TOO_LARGE',
        `Sideboard has ${sideTotal} cards; maximum is ${rules.maxSideboard}.`
      );
    }
  }

  // Banlist checks (main deck + leader + base)
  const allEntries = [
    ...mainDeckCards,
    ...sideboardCardsList,
    ...[leaderId, leaderId2, baseId].filter(Boolean).map(id => ({
      cardId: id, count: 1, card: cardDataMap[id]
    }))
  ];

  const seenCardIds = new Set();
  allEntries.forEach(({ cardId, count, card }) => {
    if (!card || seenCardIds.has(cardId)) return;
    seenCardIds.add(cardId);

    const banStatus = getCardBanStatus(card, formatKey);
    const displayName = card.Subtitle ? `${card.Name} (${card.Subtitle})` : card.Name;

    if (banStatus === 'banned') {
      addViolation('error', 'BANNED_CARD', `${displayName} is banned in ${format}.`, cardId);
    } else if (banStatus === 'suspended') {
      addViolation('error', 'SUSPENDED_CARD', `${displayName} is suspended in ${format}.`, cardId);
    } else if (banStatus === 'restricted') {
      if (count > 1) {
        addViolation('error', 'RESTRICTED_CARD',
          `${displayName} is restricted to 1 copy in ${format} (have ${count}).`,
          cardId
        );
      }
    }

    // Set rotation (Premier only)
    if (rules.hasRotation && !isSetLegal(card, formatKey)) {
      addViolation('error', 'ROTATED_SET',
        `${card.Name} (Set: ${card.Set}) is from a set that has rotated out of ${format}.`,
        cardId
      );
    }
  });

  const isLegal = violations.filter(v => v.type === 'error').length === 0;
  return { isLegal, violations, cardViolations };
}

/**
 * Validate a Trilogy set of three decks against the shared copy limit rule.
 * Each card may appear at most 3 times across all three decks combined.
 * Each deck must have a different leader and base.
 *
 * @param {Array} decks - Array of deck snapshots [{leaderId, baseId, cards}]
 * @returns {{ isLegal: boolean, violations: Array }}
 */
export function checkTrilogySet(decks) {
  if (!Array.isArray(decks) || decks.length !== 3) {
    return { isLegal: false, violations: [{ type: 'error', code: 'TRILOGY_DECK_COUNT', message: 'Trilogy requires exactly 3 decks.' }] };
  }

  const violations = [];
  const combinedCounts = {};

  decks.forEach((deck, idx) => {
    const deckLabel = `Deck ${idx + 1}`;
    Object.entries(deck.cards || {}).forEach(([cardId, count]) => {
      combinedCounts[cardId] = (combinedCounts[cardId] || 0) + count;
    });
  });

  Object.entries(combinedCounts).forEach(([cardId, total]) => {
    if (total > 3) {
      violations.push({
        type: 'error',
        code: 'TRILOGY_TOO_MANY_COPIES',
        message: `${cardId} appears ${total} times across all three decks (max 3 combined).`
      });
    }
  });

  const leaderIds = decks.map(d => d.leaderId).filter(Boolean);
  if (new Set(leaderIds).size < leaderIds.length) {
    violations.push({ type: 'error', code: 'TRILOGY_DUPLICATE_LEADER', message: 'Each Trilogy deck must have a different Leader.' });
  }

  const baseIds = decks.map(d => d.baseId).filter(Boolean);
  if (new Set(baseIds).size < baseIds.length) {
    violations.push({ type: 'error', code: 'TRILOGY_DUPLICATE_BASE', message: 'Each Trilogy deck must have a different Base.' });
  }

  return { isLegal: violations.length === 0, violations };
}

/**
 * Returns the ban status for a card in a given format.
 * @param {Object} card
 * @param {string} format
 * @returns {'banned'|'suspended'|'restricted'|null}
 */
export function getBanStatus(card, format) {
  const rules = FORMAT_RULES[format] || FORMAT_RULES['Premier'];
  return getCardBanStatus(card, rules.formatKey);
}

/** Minimum deck size for each format. */
export function getMinDeckSize(format) {
  return FORMAT_RULES[format]?.minDeckSize ?? 50;
}

/** Max copies per card for a format. */
export function getMaxCopies(format) {
  return FORMAT_RULES[format]?.maxCopies ?? 3;
}

/** Number of required leaders for a format. */
export function getRequiredLeaderCount(format) {
  return FORMAT_RULES[format]?.leaderCount ?? 1;
}
