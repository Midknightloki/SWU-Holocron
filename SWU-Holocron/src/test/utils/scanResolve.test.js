import { describe, it, expect } from 'vitest';
import {
  normalizeSetCode,
  normalizeNumber,
  normalizeName,
  namesMatch,
  resolveScan,
  relatedSetCodes,
} from '../../utils/scanResolve';

const SET_CODES = ['SOR', 'SHD', 'JTL', 'PROMO'];

const CARDS = {
  SOR: [
    { Set: 'SOR', Number: '012', Name: 'Luke Skywalker', Subtitle: 'Faithful Friend', Type: 'Leader' },
    { Set: 'SOR', Number: 45, Name: 'Admiral Ackbar', Subtitle: "It's a Trap!", Type: 'Unit' },
    { Set: 'SOR', Number: '100', Name: 'Padmé Amidala', Subtitle: null, Type: 'Unit' },
  ],
};
const getCards = (set) => CARDS[set] ?? null;
const ctx = { setCodes: SET_CODES, getCards };

describe('normalizeSetCode', () => {
  it('uppercases and trims', () => {
    expect(normalizeSetCode(' sor ', SET_CODES)).toBe('SOR');
  });
  it('strips separator glyphs printed around the code', () => {
    expect(normalizeSetCode('SOR •', SET_CODES)).toBe('SOR');
  });
  it('maps an official numeric code to the internal code', () => {
    expect(normalizeSetCode('01', SET_CODES)).toBe('SOR');
  });
  it('maps a printed promo code when the internal code is registered', () => {
    expect(normalizeSetCode('G25', SET_CODES)).toBe('PROMO');
  });
  it('rejects a set code that is not in the registry', () => {
    expect(normalizeSetCode('S0R', SET_CODES)).toBeNull();
    expect(normalizeSetCode('TWI', SET_CODES)).toBeNull();
  });
  it('rejects empty and non-string input', () => {
    expect(normalizeSetCode('', SET_CODES)).toBeNull();
    expect(normalizeSetCode(undefined, SET_CODES)).toBeNull();
    expect(normalizeSetCode(12, SET_CODES)).toBeNull();
  });
});

describe('normalizeNumber', () => {
  it('pads to three digits', () => {
    expect(normalizeNumber('12')).toBe('012');
    expect(normalizeNumber(12)).toBe('012');
  });
  it('drops a printed /total suffix', () => {
    expect(normalizeNumber('012/252')).toBe('012');
  });
  it('leaves four-digit numbers alone', () => {
    expect(normalizeNumber('1122')).toBe('1122');
  });
  it('returns null for empty, zero or digit-free input', () => {
    expect(normalizeNumber('')).toBeNull();
    expect(normalizeNumber('—')).toBeNull();
    expect(normalizeNumber('0')).toBeNull();
    expect(normalizeNumber(null)).toBeNull();
  });
});

describe('namesMatch', () => {
  const luke = CARDS.SOR[0];
  it('matches the title alone', () => {
    expect(namesMatch('Luke Skywalker', luke)).toBe(true);
  });
  it('matches title plus subtitle with any punctuation between', () => {
    expect(namesMatch('Luke Skywalker - Faithful Friend', luke)).toBe(true);
    expect(namesMatch('Luke Skywalker, Faithful Friend', luke)).toBe(true);
  });
  it('ignores case and accents', () => {
    expect(namesMatch('LUKE SKYWALKER', luke)).toBe(true);
    expect(namesMatch('Padme Amidala', CARDS.SOR[2])).toBe(true);
  });
  it('rejects a different card', () => {
    expect(namesMatch('Darth Vader', luke)).toBe(false);
  });
  it('rejects an empty read', () => {
    expect(namesMatch('', luke)).toBe(false);
    expect(normalizeName(undefined)).toBe('');
  });
});

// Promo sets print their parent set's code: an SHDOP card says "SHD" and
// carries its own promo number, which in SHD is a different card.
describe('promo sets printed with the parent code', () => {
  const PROMO_CODES = ['SOR', 'SHD', 'SHDOP', 'SHDPQ', 'SHDPQJ'];
  const PROMO_CARDS = {
    SHD: [
      { Set: 'SHD', Number: '010', Name: 'Cad Bane', Type: 'Leader' },
    ],
    SHDOP: [
      { Set: 'SHDOP', Number: '10', Name: 'Calculated Lethality', Type: 'Event' },
      { Set: 'SHDOP', Number: '14', Name: 'Cloud-Rider', Type: 'Unit' },
    ],
    SHDPQ: [],
  };
  const promoCtx = { setCodes: PROMO_CODES, getCards: (code) => PROMO_CARDS[code] ?? null };

  it('lists registered sets that extend a printed code', () => {
    expect(relatedSetCodes('SHD', PROMO_CODES)).toEqual(['SHDOP', 'SHDPQ', 'SHDPQJ']);
    expect(relatedSetCodes('SOR', PROMO_CODES)).toEqual([]);
  });

  it('finds the promo when the number is a different card in the parent set', () => {
    const read = { readable: true, set: 'SHD', number: '10', name: 'Calculated Lethality' };
    expect(resolveScan(read, promoCtx)).toEqual({
      status: 'matched', set: 'SHDOP', number: '010', name: 'Calculated Lethality', type: 'Event',
    });
  });

  it('finds the promo when the number does not exist in the parent set', () => {
    const read = { readable: true, set: 'SHD', number: '14', name: 'Cloud-Rider' };
    expect(resolveScan(read, promoCtx)).toMatchObject({ status: 'matched', set: 'SHDOP', number: '014' });
  });

  it('still prefers the parent set when the name matches there', () => {
    const read = { readable: true, set: 'SHD', number: '10', name: 'Cad Bane' };
    expect(resolveScan(read, promoCtx)).toMatchObject({ status: 'matched', set: 'SHD' });
  });

  it('keeps the original reason when no related set has the card either', () => {
    const read = { readable: true, set: 'SHD', number: '10', name: 'Nobody' };
    expect(resolveScan(read, promoCtx)).toMatchObject({ status: 'unidentified', reason: 'name-mismatch' });
  });

  it('skips related sets whose data is not loaded', () => {
    const read = { readable: true, set: 'SHD', number: '10', name: 'Calculated Lethality' };
    const onlyParent = { setCodes: PROMO_CODES, getCards: (code) => (code === 'SHD' ? PROMO_CARDS.SHD : null) };
    expect(resolveScan(read, onlyParent)).toMatchObject({ status: 'unidentified', reason: 'name-mismatch' });
  });
});

describe('resolveScan', () => {
  it('matches a clean read', () => {
    const read = { readable: true, set: 'SOR', number: '012/252', name: 'Luke Skywalker' };
    expect(resolveScan(read, ctx)).toEqual({ status: 'matched', set: 'SOR', number: '012', name: 'Luke Skywalker', type: 'Leader' });
  });

  it('carries the card type, so leaders and bases can be shown landscape', () => {
    const read = { readable: true, set: 'SOR', number: '45', name: 'Admiral Ackbar' };
    expect(resolveScan(read, ctx)).toMatchObject({ status: 'matched', type: 'Unit' });
  });

  it('matches when card data stores the number as an integer', () => {
    const read = { readable: true, set: 'SOR', number: '45', name: 'Admiral Ackbar' };
    expect(resolveScan(read, ctx)).toMatchObject({ status: 'matched', number: '045' });
  });

  it('is unreadable when Gemini says so', () => {
    const read = { readable: false, set: '', number: '', name: '' };
    expect(resolveScan(read, ctx)).toEqual({ status: 'unidentified', reason: 'unreadable', read });
  });

  it('treats readable-but-empty number as unreadable', () => {
    const read = { readable: true, set: 'SOR', number: '', name: 'Luke Skywalker' };
    expect(resolveScan(read, ctx)).toMatchObject({ status: 'unidentified', reason: 'unreadable' });
  });

  it('treats a missing read as unreadable', () => {
    expect(resolveScan(null, ctx)).toEqual({ status: 'unidentified', reason: 'unreadable', read: null });
  });

  it('reports an unknown set', () => {
    const read = { readable: true, set: 'XYZ', number: '1', name: 'Anyone' };
    expect(resolveScan(read, ctx)).toMatchObject({ status: 'unidentified', reason: 'unknown-set' });
  });

  it('reports a number with no card', () => {
    const read = { readable: true, set: 'SOR', number: '999', name: 'Nobody' };
    expect(resolveScan(read, ctx)).toMatchObject({ status: 'unidentified', reason: 'no-such-card' });
  });

  it('reports no-such-card when the set data is not loaded', () => {
    const read = { readable: true, set: 'SHD', number: '1', name: 'Anyone' };
    expect(resolveScan(read, ctx)).toMatchObject({ status: 'unidentified', reason: 'no-such-card' });
  });

  it('refuses a misread number that lands on a different card', () => {
    const read = { readable: true, set: 'SOR', number: '45', name: 'Luke Skywalker' };
    expect(resolveScan(read, ctx)).toMatchObject({ status: 'unidentified', reason: 'name-mismatch', read });
  });
});
