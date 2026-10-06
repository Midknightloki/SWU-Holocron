/**
 * The header's "DB: …" label: how long ago the card database last synced
 * (cardDatabase/metadata.lastFullSync, written by every sync run). `undefined`
 * means it hasn't been read yet; `null` means there is no sync time at all.
 */
export function dbSyncLabel(lastSync, now = Date.now()) {
  if (lastSync === undefined) return 'Checking…';
  if (!lastSync) return 'Never';
  const s = Math.max(0, (now - lastSync) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
