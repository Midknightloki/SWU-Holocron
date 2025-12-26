/**
 * Utilities for handling official Star Wars Unlimited card codes
 *
 * Official codes come in two formats:
 * - Printed format (as shown on card): G25-3, SOR-042, I01-001
 * - Full format (for API/CDN): G25090003, 01010042, I01010001
 *
 * Structure of full official code:
 * - Digits 1-2 or letters: Set identifier (01-99, G25, I01, etc.)
 * - Digit 3: Product type (0=booster, 1=special)
 * - Digit 4: Card type (1=Leader, 0=Unit/Event/Upgrade)
 * - Digits 5-8: Sequential card number (0001-9999)
 */

/**
 * Set code mappings between internal format and official format
 */
const SET_CODE_MAP = {
  // Internal -> Official numeric
  'SOR': '01', // Spark of Rebellion
  'SHD': '02', // Shadows of the Galaxy
  'TWI': '03', // Twilight of the Republic
  'JTL': '04', // Jump to Lightspeed
  'LOF': '05', // Legends of the Force
  'SEC': '06', // Secrets of Power
  'ALT': '07', // A Lawless Time

  // Special sets
  'INTRO-HOTH': 'I01', // Intro Battle: Hoth
  'PROMO': 'G25', // Gift/Promo 2025

  // Reverse mapping
  '01': 'SOR',
  '02': 'SHD',
  '03': 'TWI',
  '04': 'JTL',
  '05': 'LOF',
  '06': 'SEC',
  '07': 'ALT',
  'I01': 'INTRO-HOTH',
  'G25': 'PROMO'
};

/**
 * Convert printed official code (G25-3) to full official code (G25090003)
 * @param {string} printedCode - Code as printed on card (e.g., "G25-3", "SOR-042")
 * @param {string} [cardType='Unit'] - Card type for determining middle digits
 * @returns {string} Full official code
 */
export function printedToFullCode(printedCode, cardType = 'Unit') {
  // Handle codes without hyphens
  if (!printedCode.includes('-')) {
    // Try to split based on pattern: letters/digits followed by more digits
    const match = printedCode.match(/^([A-Z0-9]+?)(\d{1,4})$/);
    if (match) {
      printedCode = `${match[1]}-${match[2]}`;
    }
  }

  const [setCode, cardNum] = printedCode.split('-');

  if (!setCode || !cardNum) {
    throw new Error(`Invalid printed code format: ${printedCode}`);
  }

  // Determine if this is already an official code (G25, I01, or numeric like 01)
  // or if it needs conversion from internal code (SOR, PROMO, etc.)
  let officialSet;
  if (/^\d{2}$/.test(setCode) || /^[A-Z]\d{2}$/.test(setCode)) {
    // Already official format (01, 02, G25, I01)
    officialSet = setCode;
  } else {
    // Internal format (SOR, SHD, PROMO, INTRO-HOTH) - convert to official
    officialSet = SET_CODE_MAP[setCode] || setCode;
  }

  // Middle 2 digits: '09' for G25 promos, '01' for everything else
  const middleDigits = (officialSet === 'G25') ? '09' : '01';

  // Card number: Leaders and Bases start with '1', others start with '0'
  const cardNumPrefix = (cardType === 'Leader' || cardType === 'Base') ? '1' : '0';
  const paddedNum = cardNumPrefix + cardNum.padStart(3, '0');

  return `${officialSet}${middleDigits}${paddedNum}`;
}

/**
 * Convert full official code (01010042) to printed format (SOR-042)
 * @param {string} fullCode - Full official code
 * @returns {string} Printed code format
 */
export function fullToPrintedCode(fullCode) {
  const parsed = parseOfficialCode(fullCode);
  if (!parsed) return fullCode;

  // For special sets (G25, I01), use the official code; for standard sets, use internal name
  const isSpecial = /^[A-Z]\d/.test(parsed.setCode);
  const displaySetCode = isSpecial ? parsed.setCode : parsed.internalSet;

  // Use the actual card number (without the leader/type prefix)
  // and remove leading zeros for display
  const displayNum = parsed.actualNumber.replace(/^0+/, '') || '0';

  // Keep 3-digit padding for display
  const paddedNum = displayNum.padStart(3, '0');

  return `${displaySetCode}-${paddedNum}`;
}

/**
 * Parse full official code into components
 * @param {string} fullCode - Full official code
 * @returns {Object} Parsed components
 */
export function parseOfficialCode(fullCode) {
  if (!fullCode) return null;

  // Handle printed format - convert to full first
  if (isPrintedFormat(fullCode)) {
    try {
      fullCode = printedToFullCode(fullCode);
    } catch (e) {
      return null;
    }
  }

  // Validate format
  if (!isFullFormat(fullCode)) {
    return null;
  }

  // Handle special codes (G25, I01, etc.) - start with letter then digit
  const isSpecial = /^[A-Z]\d/.test(fullCode);

  let setCode, middleDigits, cardNumber;

  if (isSpecial) {
    // Format: G25 09 0003 (3 chars + 2 middle digits + 4 digit card number)
    setCode = fullCode.substring(0, 3);
    middleDigits = fullCode.substring(3, 5);
    cardNumber = fullCode.substring(5);
  } else {
    // Format: 01 01 0042 (2 chars + 2 middle digits + 4 digit card number)
    setCode = fullCode.substring(0, 2);
    middleDigits = fullCode.substring(2, 4);
    cardNumber = fullCode.substring(4);
  }

  const internalSet = SET_CODE_MAP[setCode] || setCode;

  // Card number first digit indicates leader ('1') vs non-leader ('0')
  const isLeader = cardNumber[0] === '1';

  // Remove the leader/type prefix and get the actual card number
  const actualNumber = cardNumber.substring(1);
  const paddedNumber = parseInt(actualNumber, 10).toString().padStart(3, '0');

  return {
    setCode,           // Official set code (01, G25, I01)
    internalSet,       // Internal set code (SOR, PROMO, INTRO-HOTH)
    middleDigits,      // '01' or '09'
    cardNumber,        // Full 4-digit number including prefix (0042, 1001)
    actualNumber,      // 3-digit card number without prefix (042, 001)
    paddedNumber,      // Internal 3-digit format (001, 042)
    isLeader,          // true if first digit is '1'
    isSpecial: middleDigits === '09'
  };
}

/**
 * Build full official code from internal components
 * @param {string} internalSet - Internal set code
 * @param {string} number - Card number
 * @param {string} cardType - Card type
 * @returns {string} Full official code
 */
export function buildFullOfficialCode(internalSet, number, cardType = 'Unit') {
  return internalToOfficialCode(internalSet, number, cardType);
}

/**
 * Convert internal Set + Number to official full code
 * @param {string} internalSet - Internal set code (SOR, PROMO, etc.)
 * @param {string} number - Internal card number (001, 042)
 * @param {string} [cardType='Unit'] - Card type
 * @returns {string} Full official code
 */
export function internalToOfficialCode(internalSet, number, cardType = 'Unit') {
  // Check if this is already an official code or needs conversion
  let officialSet;
  if (/^\d{2}$/.test(internalSet) || /^[A-Z]\d{2}$/.test(internalSet)) {
    // Already official format (01, 02, G25, I01)
    officialSet = internalSet;
  } else {
    // Internal format (SOR, SHD, PROMO, INTRO-HOTH) - convert to official
    officialSet = SET_CODE_MAP[internalSet] || '99';
  }

  // Middle 2 digits: '09' for G25 promos, '01' for everything else
  const middleDigits = (officialSet === 'G25') ? '09' : '01';

  // Card number: Leaders and Bases start with '1', others start with '0'
  const cardNumPrefix = (cardType === 'Leader' || cardType === 'Base') ? '1' : '0';
  // Remove any leading zeros from input number, then pad to 3 digits
  const cleanNum = number.replace(/^0+/, '') || '0';
  const paddedNum = cardNumPrefix + cleanNum.padStart(3, '0');

  return `${officialSet}${middleDigits}${paddedNum}`;
}

/**
 * Convert official code to internal Set + Number format
 * @param {string} code - Official code (printed or full)
 * @returns {Object} Internal format {set, number}
 */
export function officialToInternal(code) {
  // Handle printed format
  if (isPrintedFormat(code)) {
    code = printedToFullCode(code);
  }

  const parsed = parseOfficialCode(code);
  if (!parsed) return null;

  return {
    set: parsed.internalSet,
    number: parsed.paddedNumber
  };
}

/**
 * Convert internal Set + Number to official printed format
 * @param {string} internalSet - Internal set code (SOR, PROMO, etc.)
 * @param {string} number - Internal card number (001, 042)
 * @returns {string} Printed code format (SOR-042, G25-003)
 */
export function internalToOfficial(internalSet, number) {
  // For special internal sets, convert to official code
  // Otherwise use the internal set code as-is (SOR, SHD, etc.)
  let displaySet;
  if (internalSet === 'PROMO') {
    displaySet = 'G25';
  } else if (internalSet === 'INTRO-HOTH') {
    displaySet = 'I01';
  } else {
    displaySet = internalSet;
  }

  // Pad to 3 digits for display
  const paddedNum = number.toString().padStart(3, '0');

  return `${displaySet}-${paddedNum}`;
}

/**
 * Check if a code is in printed format (has hyphen)
 * @param {string} code - Code to check
 * @returns {boolean}
 */
export function isPrintedFormat(code) {
  return /^[A-Z0-9]+-\d+$/.test(code);
}

/**
 * Check if a code is in full format
 * @param {string} code - Code to check
 * @returns {boolean}
 */
export function isFullFormat(code) {
  // Standard codes: 01010042 (8 digits)
  // Special codes: G25090003 (3 letters/digits + 6 digits)
  return /^\d{8}$/.test(code) || /^[A-Z]\d{2}\d{6}$/.test(code);
}

/**
 * Normalize any official code format to full format
 * @param {string} code - Code in any format
 * @param {string} [cardType='Unit'] - Card type if needed for conversion
 * @returns {string} Full official code
 */
export function normalizeOfficialCode(code, cardType = 'Unit') {
  if (!code) return null;

  if (isPrintedFormat(code)) {
    try {
      return printedToFullCode(code, cardType);
    } catch (e) {
      return null;
    }
  }
  if (isFullFormat(code)) {
    return code;
  }
  return null;
}

// Counter for unique ID generation
let idCounter = 0;

/**
 * Generate collection ID with official code as primary key
 * @param {string} officialCode - Official code (printed or full)
 * @param {boolean} [isFoil=false] - Whether card is foil
 * @returns {string} Collection ID
 */
export function generateCollectionId(officialCode, cardType = 'Unit') {
  const full = isPrintedFormat(officialCode)
    ? printedToFullCode(officialCode, cardType)
    : officialCode;

  // Add timestamp and counter for uniqueness
  const timestamp = Date.now();
  const uniqueId = `${full}_${timestamp}_${idCounter++}`;
  return uniqueId;
}

/**
 * Check if set code is a special/promo set
 * @param {string} setCode - Set code (internal or official)
 * @returns {boolean}
 */
export function isSpecialSet(setCode) {
  const specialSets = ['PROMO', 'INTRO-HOTH', 'G25', 'I01'];
  // Only consider sets starting with letter+digit as special (G25, I01)
  return specialSets.includes(setCode) || /^[A-Z]\d/.test(setCode);
}

/**
 * Get display name for special sets
 * @param {string} setCode - Internal or official set code
 * @returns {string} Display name
 */
export function getSpecialSetDisplayName(setCode) {
  const displayNames = {
    'PROMO': 'Promotional Cards',
    'G25': 'Promotional Cards (2025)',
    'INTRO-HOTH': 'Intro Battle: Hoth',
    'I01': 'Intro Battle: Hoth'
  };
  return displayNames[setCode] || 'Special Edition';
}
