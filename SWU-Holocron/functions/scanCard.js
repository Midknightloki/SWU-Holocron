/**
 * scanCard handler -- entitlement, daily quota and input validation for the
 * card scanner. The Gemini call itself is injected as `readCard`.
 *
 * Everything is injected (Firestore, HttpsError, the reader, the clock) and this
 * file requires no package, so the app's Vitest suite can load it in CI, which
 * does not install functions/node_modules.
 */

const DEFAULT_SCAN_DAILY_LIMIT = 1000;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function utcDate(now) {
  return now.toISOString().slice(0, 10);
}

function nextUtcMidnight(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

function resolveDailyLimit(config) {
  const value = config?.dailyLimit;
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_SCAN_DAILY_LIMIT;
}

function cleanString(value) {
  return typeof value === "string" ? value.trim().slice(0, 100) : "";
}

function sanitizeRead(read) {
  return {
    readable: read?.readable === true,
    set: cleanString(read?.set),
    number: cleanString(read?.number),
    name: cleanString(read?.name),
  };
}

function createScanCardHandler({ db, appId, readCard, HttpsError, logger = console, now = () => new Date() }) {
  const validateImage = (image) => {
    if (typeof image !== "string" || image.length === 0 || !BASE64.test(image)) {
      throw new HttpsError("invalid-argument", "image must be a base64-encoded JPEG.");
    }
    if (Math.floor(image.length * 3 / 4) > MAX_IMAGE_BYTES) {
      throw new HttpsError("invalid-argument", "image is larger than 2 MB.");
    }
  };

  const chargeQuota = async (uid, at) => {
    const configSnap = await db.doc(`artifacts/${appId}/config/scanner`).get();
    const limit = resolveDailyLimit(configSnap.exists ? configSnap.data() : null);
    const usageRef = db.doc(`artifacts/${appId}/scanUsage/${uid}`);
    const today = utcDate(at);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(usageRef);
      const usage = snap.exists ? snap.data() : null;
      const count = usage && usage.date === today ? usage.count : 0;
      if (count >= limit) {
        throw new HttpsError(
          "resource-exhausted",
          `Daily scan limit of ${limit} reached.`,
          { limit, resetsAt: nextUtcMidnight(at) },
        );
      }
      tx.set(usageRef, { date: today, count: count + 1 });
    });
  };

  return async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to scan cards.");
    }
    if (request.auth.token?.firebase?.sign_in_provider === "anonymous") {
      throw new HttpsError("permission-denied", "Guest accounts cannot scan cards.");
    }

    const image = request.data?.image;
    validateImage(image);

    const uid = request.auth.uid;
    const profileSnap = await db.doc(`artifacts/${appId}/users/${uid}`).get();
    const profile = profileSnap.exists ? profileSnap.data() : {};
    const isAdmin = profile.isAdmin === true;

    if (!isAdmin && profile.isPro !== true) {
      throw new HttpsError("permission-denied", "Card scanning is a Pro feature.");
    }

    // Charged before the Gemini call, so a failed call still counts. At this
    // limit that is cheaper than a refund path, and it cannot be gamed.
    if (!isAdmin) {
      await chargeQuota(uid, now());
    }

    let read;
    try {
      read = await readCard(image);
    } catch (err) {
      logger.error("scanCard recognition failed", { uid, error: err.message });
      throw new HttpsError("internal", "Card recognition failed.");
    }

    return sanitizeRead(read);
  };
}

module.exports = { createScanCardHandler, DEFAULT_SCAN_DAILY_LIMIT };
