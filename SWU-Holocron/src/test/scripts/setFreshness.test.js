import { describe, it, expect } from 'vitest';
import { staleIssue, MAX_AGE_MS } from '../../../scripts/setFreshness.js';

const NOW = 100 * MAX_AGE_MS;

describe('staleIssue', () => {
  it('flags a set not confirmed against its source for over 7 days', () => {
    expect(staleIssue('SOR', { lastSync: NOW - MAX_AGE_MS - 1, syncSource: 'swu-db.com' }, NOW)).toBe('SOR: data older than 7 days');
    expect(staleIssue('SOR', { lastSync: NOW - 1000, syncSource: 'swu-db.com' }, NOW)).toBeNull();
    expect(staleIssue('SOR', {}, NOW)).toBe('SOR: data older than 7 days');
  });

  it('never flags a placeholder-only set: no source can refresh it', () => {
    expect(staleIssue('SOROPJ', { lastSync: 0, syncSource: 'placeholder' }, NOW)).toBeNull();
  });
});
