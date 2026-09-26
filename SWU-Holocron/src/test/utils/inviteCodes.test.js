import { describe, it, expect } from 'vitest';
import {
  INVITE_ALPHABET,
  INVITE_CODE_LENGTH,
  formatInviteCode,
  generateInviteCode,
  normalizeInviteCode,
  inviteStatus,
} from '../../utils/inviteCodes.js';

describe('INVITE_ALPHABET', () => {
  it('excludes the characters people mistype when reading a code', () => {
    // 0/O and 1/I/L are the usual casualties of reading a code off a screen.
    expect(INVITE_ALPHABET).not.toContain('0');
    expect(INVITE_ALPHABET).not.toContain('O');
    expect(INVITE_ALPHABET).not.toContain('1');
    expect(INVITE_ALPHABET).not.toContain('I');
    expect(INVITE_ALPHABET).not.toContain('L');
  });

  it('has no duplicate characters', () => {
    expect(new Set(INVITE_ALPHABET).size).toBe(INVITE_ALPHABET.length);
  });
});

describe('formatInviteCode', () => {
  it('groups characters in fours', () => {
    expect(formatInviteCode('ABCDEFGHJKMN')).toBe('ABCD-EFGH-JKMN');
  });

  it('leaves a short final group alone', () => {
    expect(formatInviteCode('ABCDEF')).toBe('ABCD-EF');
  });

  it('returns an empty string unchanged', () => {
    expect(formatInviteCode('')).toBe('');
  });
});

describe('generateInviteCode', () => {
  it('produces a grouped code of the documented length', () => {
    expect(generateInviteCode()).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it('only ever uses the safe alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      const bare = generateInviteCode().replace(/-/g, '');
      expect(bare).toHaveLength(INVITE_CODE_LENGTH);
      for (const char of bare) {
        expect(INVITE_ALPHABET).toContain(char);
      }
    }
  });

  it('does not repeat itself', () => {
    const codes = new Set();
    for (let i = 0; i < 500; i += 1) codes.add(generateInviteCode());
    expect(codes.size).toBe(500);
  });
});

describe('normalizeInviteCode', () => {
  const canonical = 'H7QK-3MRT-XB29';

  it('accepts a code exactly as issued', () => {
    expect(normalizeInviteCode(canonical)).toBe(canonical);
  });

  it('forgives lower case', () => {
    expect(normalizeInviteCode('h7qk-3mrt-xb29')).toBe(canonical);
  });

  it('forgives missing hyphens', () => {
    expect(normalizeInviteCode('H7QK3MRTXB29')).toBe(canonical);
  });

  it('forgives spaces instead of hyphens', () => {
    expect(normalizeInviteCode('h7qk 3mrt xb29')).toBe(canonical);
  });

  it('forgives surrounding whitespace and stray punctuation', () => {
    expect(normalizeInviteCode('  H7QK.3MRT_XB29  ')).toBe(canonical);
  });

  // Invites issued before this format carry a mixed-case auto-generated
  // Firestore id. Uppercasing one would stop it resolving.
  it('leaves a legacy auto-generated id untouched', () => {
    const legacy = 'aB3xY9zQ1mN7pR2sT4uV';
    expect(normalizeInviteCode(legacy)).toBe(legacy);
  });

  it('trims a legacy id but does not otherwise alter it', () => {
    expect(normalizeInviteCode('  aB3xY9zQ1mN7pR2sT4uV ')).toBe('aB3xY9zQ1mN7pR2sT4uV');
  });

  it('does not treat a 12-character string with excluded characters as ours', () => {
    // Contains O and 0, which are not in the alphabet, so it is not one of ours.
    expect(normalizeInviteCode('O0QK3MRTXB29')).toBe('O0QK3MRTXB29');
  });

  it('handles nothing at all', () => {
    expect(normalizeInviteCode('')).toBe('');
    expect(normalizeInviteCode(null)).toBe('');
    expect(normalizeInviteCode(undefined)).toBe('');
  });

  it('round-trips a freshly generated code', () => {
    const code = generateInviteCode();
    expect(normalizeInviteCode(code.toLowerCase().replace(/-/g, ''))).toBe(code);
  });
});

describe('inviteStatus', () => {
  const now = 1_700_000_000_000;

  it('reports a claimed invite as claimed even if it also expired', () => {
    expect(inviteStatus({ claimed: true, expiresAt: now - 1 }, now)).toBe('claimed');
  });

  it('reports a past expiry as expired', () => {
    expect(inviteStatus({ claimed: false, expiresAt: now - 1 }, now)).toBe('expired');
  });

  it('reports a future expiry as pending', () => {
    expect(inviteStatus({ claimed: false, expiresAt: now + 1 }, now)).toBe('pending');
  });

  it('treats no expiry as pending, matching the function', () => {
    expect(inviteStatus({ claimed: false }, now)).toBe('pending');
    expect(inviteStatus({ claimed: false, expiresAt: null }, now)).toBe('pending');
  });

  it('treats a missing claimed field as unclaimed', () => {
    expect(inviteStatus({}, now)).toBe('pending');
  });

  // The function does `expiresAt < Date.now()`, so a Timestamp object would
  // compare as NaN and never expire. Matching that rather than diverging.
  it('ignores a non-numeric expiry, as the function does', () => {
    expect(inviteStatus({ expiresAt: { seconds: 1 } }, now)).toBe('pending');
  });

  it('survives a missing invite', () => {
    expect(inviteStatus(null, now)).toBe('pending');
    expect(inviteStatus(undefined, now)).toBe('pending');
  });
});
