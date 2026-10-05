/**
 * Whether a set's stored data is stale: not confirmed against its source for
 * over a week (the sync runs weekly; the seeder records every check in
 * lastSync, changed or not -- see setWrite.js).
 *
 * A placeholder-only set (syncSource 'placeholder', e.g. SOROPJ: the catalogue
 * lists cards that no source returns) has no source to confirm against, so its
 * age means nothing and is never an issue -- the placeholder report covers it.
 */
export const MAX_AGE_MS = 7 * 24 * 3600000;

export function staleIssue(code, data, now = Date.now()) {
  if (data?.syncSource === 'placeholder') return null;
  return now - (data?.lastSync || 0) > MAX_AGE_MS ? `${code}: data older than 7 days` : null;
}
