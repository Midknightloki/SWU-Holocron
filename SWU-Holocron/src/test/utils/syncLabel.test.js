import { describe, it, expect } from 'vitest';
import { dbSyncLabel } from '../../utils/syncLabel';

const NOW = Date.UTC(2026, 9, 5, 20, 0);

describe('dbSyncLabel', () => {
  it('says how long ago the card database was synced', () => {
    expect(dbSyncLabel(NOW - 30e3, NOW)).toBe('just now');
    expect(dbSyncLabel(NOW - 5 * 60e3, NOW)).toBe('5 min ago');
    expect(dbSyncLabel(NOW - 3 * 3600e3, NOW)).toBe('3 h ago');
    expect(dbSyncLabel(NOW - 2 * 86400e3, NOW)).toBe('2 d ago');
  });

  it('says Never without a sync time, and Checking while it loads', () => {
    expect(dbSyncLabel(null, NOW)).toBe('Never');
    expect(dbSyncLabel(undefined, NOW)).toBe('Checking…');
  });
});
