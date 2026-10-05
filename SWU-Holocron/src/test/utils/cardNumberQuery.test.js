import { describe, it, expect } from 'vitest';
import { parseNumberQuery, matchesNumberQuery, matchesNameOrNumber } from '../../utils/cardNumberQuery';

const card = (Set, Number) => ({ Set, Number, Name: 'X' });

describe('parseNumberQuery', () => {
  it('reads a bare number, with or without # and zero padding', () => {
    expect(parseNumberQuery('12')).toEqual({ set: null, number: 12 });
    expect(parseNumberQuery('012')).toEqual({ set: null, number: 12 });
    expect(parseNumberQuery(' #12 ')).toEqual({ set: null, number: 12 });
  });

  it('reads a set code and number', () => {
    expect(parseNumberQuery('SOR 12')).toEqual({ set: 'SOR', number: 12 });
    expect(parseNumberQuery('sor-012')).toEqual({ set: 'SOR', number: 12 });
    expect(parseNumberQuery('shd #5')).toEqual({ set: 'SHD', number: 5 });
    expect(parseNumberQuery('TS26 3')).toEqual({ set: 'TS26', number: 3 });
  });

  it('is null for anything that is not a number query', () => {
    expect(parseNumberQuery('luke')).toBeNull();
    expect(parseNumberQuery('R2-D2')).toBeNull();
    expect(parseNumberQuery('')).toBeNull();
    expect(parseNumberQuery('12345')).toBeNull();
  });
});

describe('matchesNumberQuery', () => {
  it('matches the exact number, however the card stores it', () => {
    expect(matchesNumberQuery(card('SOR', 12), '12')).toBe(true);
    expect(matchesNumberQuery(card('SOR', '012'), '12')).toBe(true);
    expect(matchesNumberQuery(card('SOR', '112'), '12')).toBe(false);
  });

  it('checks the set when one is given', () => {
    expect(matchesNumberQuery(card('SOR', '012'), 'sor 12')).toBe(true);
    expect(matchesNumberQuery(card('SHD', '012'), 'sor 12')).toBe(false);
  });

  it('never matches a name query', () => {
    expect(matchesNumberQuery(card('SOR', 12), 'luke')).toBe(false);
  });
});

describe('matchesNameOrNumber (binder search)', () => {
  const luke = { Set: 'SOR', Number: '005', Name: 'Luke Skywalker' };
  it('matches by name, by number, and everything for an empty search', () => {
    expect(matchesNameOrNumber(luke, 'sky')).toBe(true);
    expect(matchesNameOrNumber(luke, '5')).toBe(true);
    expect(matchesNameOrNumber(luke, 'SOR 005')).toBe(true);
    expect(matchesNameOrNumber(luke, '6')).toBe(false);
    expect(matchesNameOrNumber(luke, '')).toBe(true);
  });
});
