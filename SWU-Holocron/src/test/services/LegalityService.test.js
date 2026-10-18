/**
 * @vitest-environment happy-dom
 * @unit @service
 *
 * LegalityService Tests — deck validation across Premier, Eternal, Twin Suns, and Trilogy.
 */

import { describe, it, expect } from 'vitest';
import {
  checkDeckLegality,
  checkTrilogySet,
  getBanStatus,
  getMinDeckSize,
  getMaxCopies
} from '../../services/LegalityService';

describe('LegalityService', () => {
  const cardDataMap = {
    L_VADER: {
      Set: 'SHD',
      Number: '001',
      Name: 'Darth Vader',
      Subtitle: 'Commanding the First Legion',
      Type: 'Leader',
      Aspects: ['Villainy', 'Aggression']
    },
    L_LUKE: {
      Set: 'SHD',
      Number: '002',
      Name: 'Luke Skywalker',
      Subtitle: 'Faith in Friends',
      Type: 'Leader',
      Aspects: ['Heroism', 'Vigilance']
    },
    L_BOBA_LEADER: {
      Set: 'SHD',
      Number: '003',
      Name: 'Boba Fett',
      Subtitle: 'Daimyo',
      Type: 'Leader',
      Aspects: ['Villainy', 'Cunning']
    },
    B_CATINA: {
      Set: 'SHD',
      Number: '020',
      Name: 'Mos Eisley Cantina',
      Type: 'Base',
      Aspects: ['Cunning']
    },
    B_ADMIN: {
      Set: 'SHD',
      Number: '021',
      Name: 'Administrator Tower',
      Type: 'Base',
      Aspects: ['Command']
    },
    C_TROOPER: {
      Set: 'SHD',
      Number: '050',
      Name: 'Stormtrooper',
      Type: 'Unit',
      Aspects: ['Villainy'],
      Cost: 2
    },
    C_SCOUT: {
      Set: 'SHD',
      Number: '051',
      Name: 'Scout Bike',
      Type: 'Unit',
      Aspects: ['Villainy'],
      Cost: 3
    },
    C_BOBA_SUSPENDED: {
      Set: 'SHD',
      Number: '088',
      Name: 'Boba Fett',
      Subtitle: 'Collecting the Bounty',
      Type: 'Unit',
      Aspects: ['Villainy']
    },
    C_FORCE_THROW: {
      Set: 'SHD',
      Number: '099',
      Name: 'Force Throw',
      Type: 'Event',
      Aspects: ['Aggression']
    },
    C_ROTATED_SOR: {
      Set: 'SOR',
      Number: '100',
      Name: 'Old Spark Card',
      Type: 'Unit',
      Aspects: ['Command']
    }
  };

  describe('Format Configuration Helpers', () => {
    it('returns minimum deck size for formats', () => {
      expect(getMinDeckSize('Premier')).toBe(50);
      expect(getMinDeckSize('Eternal')).toBe(50);
      expect(getMinDeckSize('Twin Suns')).toBe(80);
      expect(getMinDeckSize('Trilogy')).toBe(50);
      expect(getMinDeckSize('UnknownFormat')).toBe(50);
    });

    it('returns maximum copies for formats', () => {
      expect(getMaxCopies('Premier')).toBe(3);
      expect(getMaxCopies('Eternal')).toBe(3);
      expect(getMaxCopies('Twin Suns')).toBe(1);
      expect(getMaxCopies('Trilogy')).toBe(3);
      expect(getMaxCopies('UnknownFormat')).toBe(3);
    });

    it('detects banned/suspended status correctly', () => {
      expect(getBanStatus(cardDataMap.C_BOBA_SUSPENDED, 'Premier')).toBe('suspended');
      expect(getBanStatus(cardDataMap.C_FORCE_THROW, 'Premier')).toBe('suspended');
      expect(getBanStatus(cardDataMap.C_TROOPER, 'Premier')).toBeNull();
      expect(getBanStatus(cardDataMap.C_BOBA_SUSPENDED, 'Eternal')).toBeNull();
    });
  });

  describe('Premier Legality', () => {
    it('fails when leader or base is missing', () => {
      const result = checkDeckLegality({
        format: 'Premier',
        leaderId: null,
        baseId: null,
        mainDeckCards: [],
        mainDeckTotal: 0
      }, cardDataMap);

      expect(result.isLegal).toBe(false);
      expect(result.violations.some(v => v.code === 'MISSING_LEADER')).toBe(true);
      expect(result.violations.some(v => v.code === 'MISSING_BASE')).toBe(true);
    });

    it('fails when main deck is under 50 cards', () => {
      const result = checkDeckLegality({
        format: 'Premier',
        leaderId: 'L_VADER',
        baseId: 'B_CATINA',
        mainDeckCards: [{ cardId: 'C_TROOPER', count: 3, card: cardDataMap.C_TROOPER }],
        mainDeckTotal: 3
      }, cardDataMap);

      expect(result.isLegal).toBe(false);
      expect(result.violations.some(v => v.code === 'DECK_TOO_SMALL')).toBe(true);
    });

    it('fails when card copies exceed 3 in main deck', () => {
      const result = checkDeckLegality({
        format: 'Premier',
        leaderId: 'L_VADER',
        baseId: 'B_CATINA',
        mainDeckCards: [{ cardId: 'C_TROOPER', count: 4, card: cardDataMap.C_TROOPER }],
        mainDeckTotal: 50
      }, cardDataMap);

      expect(result.isLegal).toBe(false);
      expect(result.violations.some(v => v.code === 'TOO_MANY_COPIES')).toBe(true);
      expect(result.cardViolations.has('C_TROOPER')).toBe(true);
    });

    it('fails when sideboard exceeds 10 cards', () => {
      const result = checkDeckLegality({
        format: 'Premier',
        leaderId: 'L_VADER',
        baseId: 'B_CATINA',
        mainDeckCards: [{ cardId: 'C_TROOPER', count: 3, card: cardDataMap.C_TROOPER }],
        mainDeckTotal: 50,
        sideboardCardsList: [{ cardId: 'C_SCOUT', count: 11, card: cardDataMap.C_SCOUT }]
      }, cardDataMap);

      expect(result.isLegal).toBe(false);
      expect(result.violations.some(v => v.code === 'SIDEBOARD_TOO_LARGE')).toBe(true);
    });

    it('flags suspended cards as errors', () => {
      const result = checkDeckLegality({
        format: 'Premier',
        leaderId: 'L_VADER',
        baseId: 'B_CATINA',
        mainDeckCards: [{ cardId: 'C_BOBA_SUSPENDED', count: 1, card: cardDataMap.C_BOBA_SUSPENDED }],
        mainDeckTotal: 50
      }, cardDataMap);

      expect(result.isLegal).toBe(false);
      expect(result.violations.some(v => v.code === 'SUSPENDED_CARD')).toBe(true);
      expect(result.cardViolations.has('C_BOBA_SUSPENDED')).toBe(true);
    });

    it('flags rotated sets in Premier', () => {
      const result = checkDeckLegality({
        format: 'Premier',
        leaderId: 'L_VADER',
        baseId: 'B_CATINA',
        mainDeckCards: [{ cardId: 'C_ROTATED_SOR', count: 3, card: cardDataMap.C_ROTATED_SOR }],
        mainDeckTotal: 50
      }, cardDataMap);

      expect(result.isLegal).toBe(false);
      expect(result.violations.some(v => v.code === 'ROTATED_SET')).toBe(true);
      expect(result.cardViolations.has('C_ROTATED_SOR')).toBe(true);
    });

    it('passes a fully valid Premier deck with sideboard', () => {
      const result = checkDeckLegality({
        format: 'Premier',
        leaderId: 'L_VADER',
        baseId: 'B_CATINA',
        mainDeckCards: [
          { cardId: 'C_TROOPER', count: 3, card: cardDataMap.C_TROOPER },
          { cardId: 'C_SCOUT', count: 3, card: cardDataMap.C_SCOUT }
        ],
        mainDeckTotal: 50,
        sideboardCardsList: [
          { cardId: 'C_TROOPER', count: 0, card: cardDataMap.C_TROOPER }
        ]
      }, cardDataMap);

      expect(result.isLegal).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe('Twin Suns Legality', () => {
    it('fails when fewer than 2 leaders are selected', () => {
      const result = checkDeckLegality({
        format: 'Twin Suns',
        leaderId: 'L_VADER',
        leaderId2: null,
        baseId: 'B_CATINA',
        mainDeckCards: [],
        mainDeckTotal: 80
      }, cardDataMap);

      expect(result.isLegal).toBe(false);
      expect(result.violations.some(v => v.code === 'MISSING_LEADER')).toBe(true);
    });

    it('fails when both leaders are the same card', () => {
      const result = checkDeckLegality({
        format: 'Twin Suns',
        leaderId: 'L_VADER',
        leaderId2: 'L_VADER',
        baseId: 'B_CATINA',
        mainDeckCards: [],
        mainDeckTotal: 80
      }, cardDataMap);

      expect(result.isLegal).toBe(false);
      expect(result.violations.some(v => v.code === 'DUPLICATE_LEADER')).toBe(true);
    });

    it('fails when leaders span both Heroism and Villainy', () => {
      const result = checkDeckLegality({
        format: 'Twin Suns',
        leaderId: 'L_VADER', // Villainy
        leaderId2: 'L_LUKE', // Heroism
        baseId: 'B_CATINA',
        mainDeckCards: [],
        mainDeckTotal: 80
      }, cardDataMap);

      expect(result.isLegal).toBe(false);
      expect(result.violations.some(v => v.code === 'TWIN_SUNS_ALIGNMENT')).toBe(true);
    });

    it('enforces singleton rule (max 1 copy per card in Twin Suns)', () => {
      const result = checkDeckLegality({
        format: 'Twin Suns',
        leaderId: 'L_VADER',
        leaderId2: 'L_BOBA_LEADER',
        baseId: 'B_CATINA',
        mainDeckCards: [{ cardId: 'C_TROOPER', count: 2, card: cardDataMap.C_TROOPER }],
        mainDeckTotal: 80
      }, cardDataMap);

      expect(result.isLegal).toBe(false);
      expect(result.violations.some(v => v.code === 'TOO_MANY_COPIES')).toBe(true);
    });

    it('warns when sideboard is included in Twin Suns', () => {
      const result = checkDeckLegality({
        format: 'Twin Suns',
        leaderId: 'L_VADER',
        leaderId2: 'L_BOBA_LEADER',
        baseId: 'B_CATINA',
        mainDeckCards: [{ cardId: 'C_TROOPER', count: 1, card: cardDataMap.C_TROOPER }],
        mainDeckTotal: 80,
        sideboardCardsList: [{ cardId: 'C_SCOUT', count: 1, card: cardDataMap.C_SCOUT }]
      }, cardDataMap);

      expect(result.violations.some(v => v.code === 'SIDEBOARD_NOT_ALLOWED')).toBe(true);
    });

    it('passes a legal Twin Suns deck with matching alignment', () => {
      const result = checkDeckLegality({
        format: 'Twin Suns',
        leaderId: 'L_VADER',
        leaderId2: 'L_BOBA_LEADER', // Both Villainy
        baseId: 'B_CATINA',
        mainDeckCards: [
          { cardId: 'C_TROOPER', count: 1, card: cardDataMap.C_TROOPER },
          { cardId: 'C_SCOUT', count: 1, card: cardDataMap.C_SCOUT }
        ],
        mainDeckTotal: 80,
        sideboardCardsList: []
      }, cardDataMap);

      expect(result.isLegal).toBe(true);
      expect(result.violations.filter(v => v.type === 'error')).toHaveLength(0);
    });
  });

  describe('Eternal Legality', () => {
    it('allows rotated sets in Eternal format', () => {
      const result = checkDeckLegality({
        format: 'Eternal',
        leaderId: 'L_VADER',
        baseId: 'B_CATINA',
        mainDeckCards: [{ cardId: 'C_ROTATED_SOR', count: 3, card: cardDataMap.C_ROTATED_SOR }],
        mainDeckTotal: 50
      }, cardDataMap);

      expect(result.isLegal).toBe(true);
      expect(result.violations.some(v => v.code === 'ROTATED_SET')).toBe(false);
    });
  });

  describe('Trilogy Multi-Deck Set (checkTrilogySet)', () => {
    it('fails if array does not contain exactly 3 decks', () => {
      expect(checkTrilogySet([]).isLegal).toBe(false);
      expect(checkTrilogySet([{}, {}]).isLegal).toBe(false);
    });

    it('fails if duplicate leaders exist across the 3 decks', () => {
      const decks = [
        { leaderId: 'L_VADER', baseId: 'B_CATINA', cards: {} },
        { leaderId: 'L_VADER', baseId: 'B_ADMIN', cards: {} },
        { leaderId: 'L_LUKE', baseId: 'B_CATINA', cards: {} }
      ];
      const result = checkTrilogySet(decks);
      expect(result.isLegal).toBe(false);
      expect(result.violations.some(v => v.code === 'TRILOGY_DUPLICATE_LEADER')).toBe(true);
    });

    it('fails if duplicate bases exist across the 3 decks', () => {
      const decks = [
        { leaderId: 'L_VADER', baseId: 'B_CATINA', cards: {} },
        { leaderId: 'L_BOBA_LEADER', baseId: 'B_CATINA', cards: {} },
        { leaderId: 'L_LUKE', baseId: 'B_ADMIN', cards: {} }
      ];
      const result = checkTrilogySet(decks);
      expect(result.isLegal).toBe(false);
      expect(result.violations.some(v => v.code === 'TRILOGY_DUPLICATE_BASE')).toBe(true);
    });

    it('fails if any card exceeds 3 copies across all 3 decks combined', () => {
      const decks = [
        { leaderId: 'L_VADER', baseId: 'B_CATINA', cards: { C_TROOPER: 2 } },
        { leaderId: 'L_BOBA_LEADER', baseId: 'B_ADMIN', cards: { C_TROOPER: 2 } },
        { leaderId: 'L_LUKE', baseId: 'B_OTHER', cards: {} }
      ];
      const result = checkTrilogySet(decks);
      expect(result.isLegal).toBe(false);
      expect(result.violations.some(v => v.code === 'TRILOGY_TOO_MANY_COPIES')).toBe(true);
    });

    it('passes a legal 3-deck Trilogy set with distinct leaders, bases, and <= 3 total copies', () => {
      const decks = [
        { leaderId: 'L_VADER', baseId: 'B_CATINA', cards: { C_TROOPER: 2, C_SCOUT: 1 } },
        { leaderId: 'L_BOBA_LEADER', baseId: 'B_ADMIN', cards: { C_TROOPER: 1, C_SCOUT: 2 } },
        { leaderId: 'L_LUKE', baseId: 'B_OTHER', cards: { C_OTHER: 3 } }
      ];
      const result = checkTrilogySet(decks);
      expect(result.isLegal).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });
});
