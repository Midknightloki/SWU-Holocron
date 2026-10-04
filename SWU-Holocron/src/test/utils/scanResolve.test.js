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

// The common failure in practice: Gemini reads the set code wrong (usually as
// SOR) but the number and name right. A set picked in the scanner is a hint
// the resolver falls back to; the name check still guards every candidate.
describe('set hints from the scanner picker', () => {
  const CODES = ['SOR', 'SHD', 'SHDOP'];
  const DATA = {
    SOR: [{ Set: 'SOR', Number: '010', Name: 'Darth Vader', Type: 'Leader' }],
    SHD: [{ Set: 'SHD', Number: '010', Name: 'Cad Bane', Type: 'Leader' }],
    SHDOP: [{ Set: 'SHDOP', Number: '10', Name: 'Calculated Lethality', Type: 'Event' }],
  };
  const ctx2 = (hintSets = []) => ({ setCodes: CODES, getCards: (c) => DATA[c] ?? null, hintSets });

  it('rejects a misread set code without a hint, as before', () => {
    const read = { readable: true, set: 'SOR', number: '10', name: 'Cad Bane' };
    expect(resolveScan(read, ctx2())).toMatchObject({ status: 'unidentified', reason: 'name-mismatch' });
  });

  it('matches in a hinted set when the printed set was misread', () => {
    const read = { readable: true, set: 'SOR', number: '10', name: 'Cad Bane' };
    expect(resolveScan(read, ctx2(['SHD']))).toEqual({ status: 'matched', set: 'SHD', number: '010', name: 'Cad Bane', type: 'Leader' });
  });

  it('matches in a hinted set when no set code could be read at all', () => {
    const read = { readable: true, set: '', number: '10', name: 'Cad Bane' };
    expect(resolveScan(read, ctx2())).toMatchObject({ status: 'unidentified', reason: 'unknown-set' });
    expect(resolveScan(read, ctx2(['SHD']))).toMatchObject({ status: 'matched', set: 'SHD' });
  });

  it("includes the hinted set's promo sets", () => {
    const read = { readable: true, set: 'SOR', number: '10', name: 'Calculated Lethality' };
    expect(resolveScan(read, ctx2(['SHD']))).toMatchObject({ status: 'matched', set: 'SHDOP' });
  });

  it('never overrides a valid match in the printed set', () => {
    const read = { readable: true, set: 'SOR', number: '10', name: 'Darth Vader' };
    expect(resolveScan(read, ctx2(['SHD']))).toMatchObject({ status: 'matched', set: 'SOR' });
  });

  it('keeps the original reason when the hints do not match either', () => {
    const read = { readable: true, set: 'SOR', number: '10', name: 'Nobody' };
    expect(resolveScan(read, ctx2(['SHD']))).toMatchObject({ status: 'unidentified', reason: 'name-mismatch' });
  });

  it('still needs a readable number (unless it is a face-up leader)', () => {
    const read = { readable: true, set: '', number: '', name: 'Cad Bane' };
    expect(resolveScan(read, ctx2(['SHD']))).toMatchObject({ status: 'unidentified', reason: 'no-number' });
  });
});

// A leader scanned face up shows no collector line. Leaders aren't reprinted,
// so name + subtitle identifies one; the subtitle is required because several
// leaders share a name (there are many Han Solos).
describe('face-up leaders with no collector number', () => {
  const CODES = ['SOR', 'SHD', 'LAW'];
  const DATA = {
    SOR: [
      { Set: 'SOR', Number: '200', Name: 'Han Solo', Subtitle: 'Audacious Smuggler', Type: 'Leader' }, // hyperspace variant
      { Set: 'SOR', Number: '017', Name: 'Han Solo', Subtitle: 'Audacious Smuggler', Type: 'Leader' },
    ],
    SHD: [
      { Set: 'SHD', Number: '012', Name: 'Han Solo', Subtitle: 'Worth the Risk', Type: 'Leader' },
      { Set: 'SHD', Number: '100', Name: 'Han Solo', Subtitle: 'Never Tell Me the Odds', Type: 'Unit' },
    ],
    LAW: [{ Set: 'LAW', Number: '005', Name: 'Han Solo', Subtitle: 'Worth the Risk', Type: 'Leader' }],
  };
  const leaderCtx = (hintSets = []) => ({ setCodes: CODES, getCards: (c) => DATA[c] ?? null, hintSets, baseSets: ['SOR', 'SHD'] });
  const faceUp = (subtitle) => ({ readable: true, set: '', number: '', name: 'Han Solo', subtitle });

  it('matches a leader by name and subtitle when there is no number', () => {
    expect(resolveScan(faceUp('Worth the Risk'), leaderCtx())).toEqual({
      status: 'matched', set: 'SHD', number: '012', name: 'Han Solo', type: 'Leader',
    });
  });

  it('prefers the standard printing over a later-numbered variant', () => {
    expect(resolveScan(faceUp('Audacious Smuggler'), leaderCtx())).toMatchObject({ set: 'SOR', number: '017' });
  });

  it('searches the picked sets before the base sets', () => {
    expect(resolveScan(faceUp('Worth the Risk'), leaderCtx(['LAW']))).toMatchObject({ set: 'LAW', number: '005' });
  });

  it('only matches leaders, and needs the subtitle to agree', () => {
    expect(resolveScan(faceUp('Never Tell Me the Odds'), leaderCtx())).toMatchObject({ status: 'unidentified', reason: 'no-number' });
    expect(resolveScan(faceUp('Wrong Subtitle'), leaderCtx())).toMatchObject({ status: 'unidentified', reason: 'no-number' });
    expect(resolveScan(faceUp(''), leaderCtx())).toMatchObject({ status: 'unidentified', reason: 'no-number' });
  });

  it('is unreadable when there is neither a number nor a name', () => {
    expect(resolveScan({ readable: true, set: '', number: '', name: '', subtitle: '' }, leaderCtx()))
      .toMatchObject({ status: 'unidentified', reason: 'unreadable' });
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

  it('treats readable-but-empty number as no-number (the name was read)', () => {
    const read = { readable: true, set: 'SOR', number: '', name: 'Luke Skywalker' };
    expect(resolveScan(read, ctx)).toMatchObject({ status: 'unidentified', reason: 'no-number' });
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
