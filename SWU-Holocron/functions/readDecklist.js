/**
 * readDecklist -- reads an official Star Wars: Unlimited decklist image (two
 * decks per image, "<NAME> DECK LIST") for the Prebuilt Decks admin tab.
 * Admin-only. Links are fetched only from the official CDN.
 *
 * Everything is injected (Firestore, HttpsError, the fetch, the Gemini reader)
 * and this file requires no package, so the app's Vitest suite can load it in
 * CI, which does not install functions/node_modules.
 */

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const CDN_HOST = "cdn.starwarsunlimited.com";

function isOfficialImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === CDN_HOST && !url.username && !url.password;
  } catch {
    return false;
  }
}

const clean = (value, max) => (typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, max) : "");

function sanitizeDecklist(output) {
  const decks = Array.isArray(output?.decks) ? output.decks.slice(0, 4) : [];
  return {
    decks: decks.map((d) => ({
      title: clean(d?.title, 80),
      lines: (Array.isArray(d?.lines) ? d.lines.slice(0, 80) : []).map((l) => {
        const raw = clean(l?.number, 12);
        const qty = Math.min(9, Math.max(1, Math.round(Number(l?.qty)) || 1));
        return { number: raw.replace(/[^0-9A-Za-z]/g, ""), fromPreviousSet: l?.fromPreviousSet === true || raw.includes("*"), name: clean(l?.name, 100), qty };
      }).filter((l) => l.number && l.name),
    })).filter((d) => d.lines.length > 0),
  };
}

function createReadDecklistHandler({ db, appId, HttpsError, readImage, fetchImage, logger = console }) {
  return async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to read decklists.");
    const profileSnap = await db.doc(`artifacts/${appId}/users/${request.auth.uid}`).get();
    if (!(profileSnap.exists && profileSnap.data().isAdmin === true)) {
      throw new HttpsError("permission-denied", "Reading decklists is for admins.");
    }

    const { imageUrl, image, mimeType } = request.data ?? {};
    if (Boolean(imageUrl) === Boolean(image)) {
      throw new HttpsError("invalid-argument", "Send an image link or an uploaded image.");
    }

    let data;
    let type;
    if (imageUrl) {
      if (!isOfficialImageUrl(imageUrl)) {
        throw new HttpsError("invalid-argument", "Only official starwarsunlimited.com images can be read.");
      }
      let fetched;
      try {
        fetched = await fetchImage(imageUrl);
      } catch (err) {
        logger.error("readDecklist download failed", { error: err.message });
        throw new HttpsError("unavailable", "Couldn't download the image.");
      }
      type = String(fetched?.contentType ?? "").split(";")[0].trim();
      if (!IMAGE_TYPES.includes(type)) throw new HttpsError("invalid-argument", "That link is not an image.");
      if (!fetched.bytes || fetched.bytes.length > MAX_IMAGE_BYTES) throw new HttpsError("invalid-argument", "The image is larger than 8 MB.");
      data = fetched.bytes.toString("base64");
    } else {
      if (typeof image !== "string" || !BASE64.test(image)) throw new HttpsError("invalid-argument", "image must be base64.");
      if (!IMAGE_TYPES.includes(mimeType)) throw new HttpsError("invalid-argument", "Upload a PNG, JPEG or WebP image.");
      if (Math.floor(image.length * 3 / 4) > MAX_IMAGE_BYTES) throw new HttpsError("invalid-argument", "The image is larger than 8 MB.");
      data = image;
      type = mimeType;
    }

    let output;
    try {
      output = await readImage(data, type);
    } catch (err) {
      logger.error("readDecklist reading failed", { error: err.message });
      throw new HttpsError("internal", "Couldn't read the decklist.");
    }
    return sanitizeDecklist(output);
  };
}

module.exports = { createReadDecklistHandler, isOfficialImageUrl, sanitizeDecklist };
