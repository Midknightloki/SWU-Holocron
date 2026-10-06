/**
 * Write one set's card data to its Firestore document -- or, when the upstream
 * payload is unchanged, only record that it was checked.
 *
 * `lastSync` means "last confirmed against the source", not "last changed":
 * verifyCardDatabase.js fails a set whose lastSync is over 7 days old, and
 * the app shows it as "DB: <time>". Skipping the write without touching it
 * froze lastSync while the data sat unchanged, so a quiet week made every set
 * "older than 7 days" and failed the weekly sync.
 *
 * @param setRef Firestore DocumentReference (Admin SDK)
 */
export async function writeSetData(setRef, { setCode, setName, cards, dataHash, forceUpdate = false, now = Date.now }) {
  const existing = await setRef.get();
  const unchanged = existing.exists && existing.data().dataHash === dataHash;

  if (unchanged && !forceUpdate) {
    await setRef.update({ lastSync: now() });
    console.log(`  No changes detected for ${setCode}, recorded the check`);
    return { updated: false, cardCount: cards.length };
  }
  if (unchanged) {
    console.log(`  FORCE_UPDATE: rewriting ${setCode} despite unchanged hash`);
  }

  await setRef.set({
    code: setCode,
    name: setName,
    totalCards: cards.length,
    lastSync: now(),
    syncVersion: '1.0',
    syncSource: 'swu-db.com',
    dataHash,
    cards,
  });
  console.log(`✓ Saved ${cards.length} cards to Firestore (${setCode})`);
  return { updated: true, cardCount: cards.length };
}
