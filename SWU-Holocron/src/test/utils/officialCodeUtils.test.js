/**
 * @vitest-environment happy-dom
 * @unit @critical
 */

import { describe, it, expect } from 'vitest';
import {
  printedToFullCode,
  fullToPrintedCode,
  parseOfficialCode,
  officialToInternal,
  internalToOfficial,
  normalizeOfficialCode,
  isPrintedFormat,
  isFullFormat,
  isSpecialSet,
  buildFullOfficialCode,
  generateCollectionId
} from '../../utils/officialCodeUtils';

describe('officialCodeUtils', () => {
  describe('printedToFullCode', () => {
    it('should convert standard printed code to full code', () => {
      expect(printedToFullCode('SOR-042')).toBe('01010042');
      expect(printedToFullCode('SHD-123')).toBe('02010123');
      expect(printedToFullCode('TWI-001')).toBe('03010001');
    });

    it('should handle promo codes', () => {
      expect(printedToFullCode('G25-3')).toBe('G25090003');
      expect(printedToFullCode('G25-012')).toBe('G25090012');
    });

    it('should handle intro set codes', () => {
      expect(printedToFullCode('I01-001')).toBe('I01010001');
      expect(printedToFullCode('I01-042')).toBe('I01010042');
    });

    it('should handle leader cards with card type', () => {
      expect(printedToFullCode('SOR-001', 'Leader')).toBe('01011001');
      expect(printedToFullCode('SHD-002', 'Leader')).toBe('02011002');
    });

    it('should pad card numbers correctly', () => {
      expect(printedToFullCode('SOR-1')).toBe('01010001');
      expect(printedToFullCode('SOR-42')).toBe('01010042');
      expect(printedToFullCode('SOR-999')).toBe('01010999');
    });

    it('should handle missing hyphen', () => {
      expect(printedToFullCode('SOR042')).toBe('01010042');
      expect(printedToFullCode('G253')).toBe('G25090003');
    });
  });

  describe('fullToPrintedCode', () => {
    it('should convert full code to printed code', () => {
      expect(fullToPrintedCode('01010042')).toBe('SOR-042');
      expect(fullToPrintedCode('02010123')).toBe('SHD-123');
      expect(fullToPrintedCode('03010001')).toBe('TWI-001');
    });

    it('should handle promo codes', () => {
      expect(fullToPrintedCode('G25090003')).toBe('G25-003');
      expect(fullToPrintedCode('G25090012')).toBe('G25-012');
    });

    it('should handle intro set codes', () => {
      expect(fullToPrintedCode('I01010001')).toBe('I01-001');
      expect(fullToPrintedCode('I01010042')).toBe('I01-042');
    });

    it('should handle leader cards', () => {
      expect(fullToPrintedCode('01011001')).toBe('SOR-001');
      expect(fullToPrintedCode('02011002')).toBe('SHD-002');
    });

    it('should preserve card number padding', () => {
      expect(fullToPrintedCode('01010001')).toBe('SOR-001');
      expect(fullToPrintedCode('01010042')).toBe('SOR-042');
      expect(fullToPrintedCode('01010999')).toBe('SOR-999');
    });
  });

  describe('parseOfficialCode', () => {
    it('should parse printed codes into internal components', () => {
      const result = parseOfficialCode('SOR-042');
      expect(result).toEqual({
        setCode: '01',
        internalSet: 'SOR',
        middleDigits: '01',
        cardNumber: '0042',
        actualNumber: '042',
        paddedNumber: '042',
        isLeader: false,
        isSpecial: false
      });
    });

    it('should parse full codes and detect leaders', () => {
      const result = parseOfficialCode('01011001');
      expect(result).toEqual({
        setCode: '01',
        internalSet: 'SOR',
        middleDigits: '01',
        cardNumber: '1001',
        actualNumber: '001',
        paddedNumber: '001',
        isLeader: true,
        isSpecial: false
      });
    });

    it('should parse promo codes and identify special set formatting', () => {
      const result = parseOfficialCode('G25-3');
      expect(result.setCode).toBe('G25');
      expect(result.internalSet).toBe('PROMO');
      expect(result.cardNumber).toBe('0003');
      expect(result.actualNumber).toBe('003');
      expect(result.isSpecial).toBe(true);
    });

    it('should parse intro set codes', () => {
      const result = parseOfficialCode('I01-001');
      expect(result.setCode).toBe('I01');
      expect(result.internalSet).toBe('INTRO-HOTH');
      expect(result.cardNumber).toBe('0001');
    });

    it('should handle promo codes without hyphen', () => {
      const result = parseOfficialCode('G253');
      expect(result.setCode).toBe('G25');
      expect(result.cardNumber).toBe('0003');
    });

    it('should return null for invalid codes', () => {
      expect(parseOfficialCode('INVALID')).toBeNull();
      expect(parseOfficialCode('')).toBeNull();
      expect(parseOfficialCode('123')).toBeNull();
    });
  });

  describe('officialToInternal', () => {
    it('should convert official codes to internal format', () => {
      expect(officialToInternal('SOR-042')).toEqual({
        set: 'SOR',
        number: '042'
      });
      expect(officialToInternal('01010042')).toEqual({
        set: 'SOR',
        number: '042'
      });
    });

    it('should handle promo codes', () => {
      expect(officialToInternal('G25-3')).toEqual({
        set: 'PROMO',
        number: '003'
      });
      expect(officialToInternal('G25090003')).toEqual({
        set: 'PROMO',
        number: '003'
      });
    });

    it('should handle intro set codes', () => {
      expect(officialToInternal('I01-001')).toEqual({
        set: 'INTRO-HOTH',
        number: '001'
      });
    });

    it('should return null for invalid codes', () => {
      expect(officialToInternal('INVALID')).toBeNull();
    });
  });

  describe('internalToOfficial', () => {
    it('should convert internal format to official printed code', () => {
      expect(internalToOfficial('SOR', '042')).toBe('SOR-042');
      expect(internalToOfficial('SHD', '123')).toBe('SHD-123');
    });

    it('should handle promo cards', () => {
      expect(internalToOfficial('PROMO', '003')).toBe('G25-003');
    });

    it('should handle intro set', () => {
      expect(internalToOfficial('INTRO-HOTH', '001')).toBe('I01-001');
    });

    it('should handle numeric set codes', () => {
      expect(internalToOfficial('01', '042')).toBe('SOR-042');
      expect(internalToOfficial('02', '123')).toBe('SHD-123');
    });

    it('should pad card numbers', () => {
      expect(internalToOfficial('SOR', '1')).toBe('SOR-001');
      expect(internalToOfficial('SOR', '42')).toBe('SOR-042');
    });
  });

  describe('normalizeOfficialCode', () => {
    it('should normalize printed codes to full codes', () => {
      expect(normalizeOfficialCode('SOR-042')).toBe('01010042');
      expect(normalizeOfficialCode('G25-3')).toBe('G25090003');
    });

    it('should preserve full codes', () => {
      expect(normalizeOfficialCode('01010042')).toBe('01010042');
      expect(normalizeOfficialCode('G25090003')).toBe('G25090003');
    });

    it('should return null for invalid codes', () => {
      expect(normalizeOfficialCode('INVALID')).toBeNull();
    });
  });

  describe('isPrintedFormat', () => {
    it('should identify printed format codes', () => {
      expect(isPrintedFormat('SOR-042')).toBe(true);
      expect(isPrintedFormat('G25-3')).toBe(true);
      expect(isPrintedFormat('I01-001')).toBe(true);
    });

    it('should identify full format codes', () => {
      expect(isPrintedFormat('01010042')).toBe(false);
      expect(isPrintedFormat('G25090003')).toBe(false);
      expect(isPrintedFormat('I01010001')).toBe(false);
    });

    it('should return false for invalid codes', () => {
      expect(isPrintedFormat('INVALID')).toBe(false);
      expect(isPrintedFormat('')).toBe(false);
    });
  });

  describe('isFullFormat', () => {
    it('should identify full format codes', () => {
      expect(isFullFormat('01010042')).toBe(true);
      expect(isFullFormat('G25090003')).toBe(true);
      expect(isFullFormat('I01010001')).toBe(true);
    });

    it('should identify printed format codes', () => {
      expect(isFullFormat('SOR-042')).toBe(false);
      expect(isFullFormat('G25-3')).toBe(false);
    });

    it('should return false for invalid codes', () => {
      expect(isFullFormat('INVALID')).toBe(false);
      expect(isFullFormat('')).toBe(false);
    });
  });

  describe('isSpecialSet', () => {
    it('should identify special sets', () => {
      expect(isSpecialSet('G25')).toBe(true);
      expect(isSpecialSet('I01')).toBe(true);
      expect(isSpecialSet('PROMO')).toBe(true);
      expect(isSpecialSet('INTRO-HOTH')).toBe(true);
    });

    it('should identify standard sets', () => {
      expect(isSpecialSet('SOR')).toBe(false);
      expect(isSpecialSet('SHD')).toBe(false);
      expect(isSpecialSet('01')).toBe(false);
      expect(isSpecialSet('02')).toBe(false);
    });
  });

  describe('buildFullOfficialCode', () => {
    it('should build full codes from internal format', () => {
      expect(buildFullOfficialCode('SOR', '042', 'Unit')).toBe('01010042');
      expect(buildFullOfficialCode('SHD', '123', 'Unit')).toBe('02010123');
    });

    it('should handle leader cards', () => {
      expect(buildFullOfficialCode('SOR', '001', 'Leader')).toBe('01011001');
      expect(buildFullOfficialCode('SHD', '002', 'Leader')).toBe('02011002');
    });

    it('should handle promo cards', () => {
      expect(buildFullOfficialCode('PROMO', '003', 'Unit')).toBe('G25090003');
      expect(buildFullOfficialCode('G25', '003', 'Unit')).toBe('G25090003');
    });

    it('should handle intro set', () => {
      expect(buildFullOfficialCode('INTRO-HOTH', '001', 'Unit')).toBe('I01010001');
      expect(buildFullOfficialCode('I01', '001', 'Unit')).toBe('I01010001');
    });

    it('should pad card numbers', () => {
      expect(buildFullOfficialCode('SOR', '1', 'Unit')).toBe('01010001');
      expect(buildFullOfficialCode('SOR', '42', 'Unit')).toBe('01010042');
    });
  });

  describe('generateCollectionId', () => {
    it('should generate IDs using official codes', () => {
      const id1 = generateCollectionId('SOR-042', 'Unit');
      expect(id1).toContain('01010042');

      const id2 = generateCollectionId('G25-3', 'Unit');
      expect(id2).toContain('G25090003');
    });

    it('should generate unique IDs with timestamp', () => {
      const id1 = generateCollectionId('SOR-042', 'Unit');
      const id2 = generateCollectionId('SOR-042', 'Unit');
      expect(id1).not.toBe(id2);
    });

    it('should include card type in ID', () => {
      const leaderId = generateCollectionId('SOR-001', 'Leader');
      expect(leaderId).toContain('01011001');

      const unitId = generateCollectionId('SOR-042', 'Unit');
      expect(unitId).toContain('01010042');
    });
  });

  describe('round-trip conversions', () => {
    it('should maintain data through round-trip conversions', () => {
      const codes = ['SOR-042', 'G25-3', 'I01-001', 'SHD-123'];

      codes.forEach(code => {
        const full = printedToFullCode(code);
        const back = fullToPrintedCode(full);
        expect(normalizeOfficialCode(back)).toBe(full);
      });
    });

    it('should handle internal to official round trips', () => {
      const internal = [
        { set: 'SOR', number: '042' },
        { set: 'PROMO', number: '003' },
        { set: 'INTRO-HOTH', number: '001' }
      ];

      internal.forEach(({ set, number }) => {
        const official = internalToOfficial(set, number);
        const backToInternal = officialToInternal(official);
        expect(backToInternal.set).toBe(set);
        expect(backToInternal.number.padStart(3, '0')).toBe(number.padStart(3, '0'));
      });
    });
  });
});
