/**
 * Contributor invite codes.
 *
 * The code IS the Firestore document id of the invite (see `redeemInviteCode` in
 * functions/index.js). That is deliberate: a redeemer never needs read access to
 * the invites collection, and codes cannot be enumerated. It also means the code
 * has to survive being read off a screen and typed into a box by hand, which an
 * auto-generated Firestore id does not.
 *
 * So codes are generated from an alphabet with no visually ambiguous characters,
 * and `normalizeInviteCode` puts what the user typed back into the exact form the
 * document id takes.
 *
 * @environment:none — pure functions, safe everywhere
 */

/** No 0/O, 1/I/L — the characters people mistype when copying a code by eye. */
export const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Characters in a code, excluding the grouping hyphens. */
export const INVITE_CODE_LENGTH = 12;

const GROUP_SIZE = 4;

/**
 * Group bare code characters the way the document id stores them: ABCD-EFGH-JKMN.
 */
export function formatInviteCode(bare) {
  const groups = [];
  for (let i = 0; i < bare.length; i += GROUP_SIZE) {
    groups.push(bare.slice(i, i + GROUP_SIZE));
  }
  return groups.join('-');
}

function randomBytes(count) {
  // @environment:web — crypto is global in browsers and in Node 20+, but guard
  // anyway so a stripped environment degrades instead of throwing.
  const webCrypto = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (webCrypto?.getRandomValues) {
    return webCrypto.getRandomValues(new Uint8Array(count));
  }
  const fallback = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    fallback[i] = Math.floor(Math.random() * 256);
  }
  return fallback;
}

/**
 * A fresh invite code, in document-id form.
 *
 * @returns {string} e.g. 'H7QK-3MRT-XB29'
 */
export function generateInviteCode() {
  const bytes = randomBytes(INVITE_CODE_LENGTH);
  let bare = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
    bare += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  }
  return formatInviteCode(bare);
}

/**
 * Put a typed code back into document-id form.
 *
 * Forgives case, spaces and missing or extra hyphens, so `h7qk 3mrt xb29` and
 * `H7QK3MRTXB29` both resolve to `H7QK-3MRT-XB29`.
 *
 * Anything that is not a code of ours is returned trimmed and otherwise
 * untouched: invites issued before this format existed carry mixed-case
 * auto-generated Firestore ids, and uppercasing one would break it.
 *
 * @param {string} raw whatever the user typed
 * @returns {string} the document id to look up
 */
export function normalizeInviteCode(raw) {
  const trimmed = String(raw ?? '').trim();
  const bare = trimmed.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  const isOurs =
    bare.length === INVITE_CODE_LENGTH &&
    [...bare].every((char) => INVITE_ALPHABET.includes(char));

  return isOurs ? formatInviteCode(bare) : trimmed;
}

/**
 * What state an invite document is in.
 *
 * `expiresAt` is compared numerically because the Cloud Function compares it
 * against `Date.now()`. It is stored as milliseconds, not a Firestore Timestamp,
 * and this is the same judgement the function makes.
 *
 * @param {object} invite the invite document
 * @param {number} [now] current time in ms, injectable for tests
 * @returns {'claimed'|'expired'|'pending'}
 */
export function inviteStatus(invite, now = Date.now()) {
  if (invite?.claimed === true) return 'claimed';
  const expiresAt = invite?.expiresAt;
  if (typeof expiresAt === 'number' && expiresAt < now) return 'expired';
  return 'pending';
}
