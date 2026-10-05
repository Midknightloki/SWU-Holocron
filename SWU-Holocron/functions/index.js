const { setGlobalOptions } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { createScanCardHandler, createLocateCardHandler } = require("./scanCard");

if (!admin.apps.length) {
  admin.initializeApp();
}

const APP_ID = "swu-holocron-v1";

// Vertex AI. No API key: the function authenticates with its own service
// account through Application Default Credentials, so there is no secret to
// store, rotate or leak. Billing goes through this GCP project.
const VERTEX_LOCATION = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";

// 2nd-gen functions run on Cloud Run, which does NOT inject GOOGLE_CLOUD_PROJECT
// the way 1st-gen did. Left to that variable alone the SDK receives undefined
// and throws "Authentication is not set up" at construction.
const GCP_PROJECT =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  process.env.GCP_PROJECT ||
  "swu-holocron-93a18";
const GEMINI_MODEL = "gemini-2.5-flash";

// Runtime identity for both functions. Without this they run as the project's
// default compute service account, which holds roles/editor -- project-wide write
// access, for code whose whole job is one Vertex AI call and three Firestore
// operations. This account holds datastore.user, aiplatform.user and
// logging.logWriter and nothing else.
//
// Set here rather than with `gcloud run services update`, which the next
// `firebase deploy` would overwrite.
//
// REQUIRES the account to exist first. See docs/FUNCTIONS-RUNTIME-SA.md --
// deploying before those commands have run fails (safely: the running functions
// are left alone).
const RUNTIME_SERVICE_ACCOUNT = `swu-functions@${GCP_PROJECT}.iam.gserviceaccount.com`;

setGlobalOptions({ maxInstances: 10, serviceAccount: RUNTIME_SERVICE_ACCOUNT });

/**
 * getCardSuggestions — proxies deck state to Gemini 2.5 Flash on Vertex AI
 * and returns
 * 5 card suggestions with a one-sentence rationale each.
 *
 * No API key: authenticates with the function's own service account via
 * Application Default Credentials. Billing goes through this GCP project.
 *
 * Request data:
 *   leaderName   string
 *   baseName     string
 *   aspects      string[]          e.g. ["Aggression", "Command"]
 *   deckCards    {count, name, type}[]
 *   availableCards {id, name, type, cost, aspects, traits}[]
 *
 * Response:
 *   { suggestions: [{id, name, reason}] }
 */
exports.getCardSuggestions = onCall(
  { maxInstances: 5 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const { leaderName, baseName, aspects, deckCards, availableCards, deckConcept } = request.data;

    if (!leaderName || !baseName) {
      throw new HttpsError("invalid-argument", "leaderName and baseName are required.");
    }
    if (!Array.isArray(availableCards) || availableCards.length === 0) {
      throw new HttpsError("invalid-argument", "availableCards must be a non-empty array.");
    }

    // Lazy-load to keep cold starts cheap for callers that never reach here.
    const { GoogleGenAI } = require("@google/genai");
    const ai = new GoogleGenAI({
      enterprise: true,
      project: GCP_PROJECT,
      location: VERTEX_LOCATION,
    });

    // The user's own description of what they are building. The shortlist is
    // already keyword-weighted toward it; this gives the model the intent in
    // full, which keyword matching cannot capture ("go wide", "tempo").
    const concept = typeof deckConcept === "string" ? deckConcept.trim().slice(0, 200) : "";
    const conceptLine = concept ? `
- Concept (the player's stated plan): ${concept}` : "";

    const cardListText = availableCards
      .map((c) => {
        const aspectStr = (c.aspects || []).join("/") || "Neutral";
        const traitStr = (c.traits || []).slice(0, 3).join(", ");
        return `[${c.id}] ${c.name} (${c.type}, Cost:${c.cost ?? "?"}, Aspects:${aspectStr}${traitStr ? ", Traits:" + traitStr : ""})`;
      })
      .join("\n");

    const totalCards = (deckCards || []).reduce((s, c) => s + c.count, 0);
    const deckSummary =
      totalCards > 0
        ? (deckCards || []).map((c) => `${c.count}x ${c.name}`).join(", ")
        : "empty";

    const prompt = `You are a Star Wars: Unlimited deck-building expert. Analyze the deck below and suggest exactly 5 cards from the available pool that would strengthen it.

DECK:${conceptLine}
- Leader: ${leaderName}
- Base: ${baseName}
- Aspects: ${(aspects || []).join(", ") || "None"}
- Current cards (${totalCards}/50): ${deckSummary}

AVAILABLE CARDS (not yet at max copies):
${cardListText}

Rules:
1. Only recommend cards whose ID appears in the AVAILABLE CARDS list above.
${concept ? "0. Above all, favour cards that serve the stated concept." : ""}
2. Prioritize cards that match the deck's aspects to avoid penalty costs.
3. Consider synergy with the leader's playstyle and existing cards.
4. Each reason must be exactly one concise sentence.

Rules recap: use only IDs from the list above, respect the deck's aspects, and keep each reason to one concise sentence.`;

    // The response schema constrains the model's output, so there is no JSON to
    // scrape out of prose. The previous implementation matched a bracket regex
    // against free text and broke whenever the model added any commentary.
    const SUGGESTION_SCHEMA = {
      type: "object",
      properties: {
        suggestions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              reason: { type: "string" },
            },
            required: ["id", "name", "reason"],
          },
        },
      },
      required: ["suggestions"],
    };

    let suggestions;
    try {
      const result = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          maxOutputTokens: 2048,
          temperature: 0.7,
          // Gemini 2.5 Flash thinks by default and those tokens count against
          // maxOutputTokens. Left on with a small cap, reasoning consumes the
          // budget and the response returns empty with finishReason MAX_TOKENS.
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: "application/json",
          responseSchema: SUGGESTION_SCHEMA,
        },
      });
      suggestions = JSON.parse(result.text).suggestions;
    } catch (err) {
      logger.error("Vertex AI error:", err);
      throw new HttpsError("internal", "AI request failed: " + err.message);
    }


    // Validate each suggestion has required fields and matches a real card ID
    const validIds = new Set(availableCards.map((c) => c.id));
    const valid = suggestions.filter(
      (s) => s && typeof s.id === "string" && typeof s.name === "string" && typeof s.reason === "string" && validIds.has(s.id)
    );

    logger.info(`Suggestions returned: ${valid.length} of ${suggestions.length}`, {
      uid: request.auth.uid,
      leader: leaderName,
    });

    return { suggestions: valid };
  }
);

/**
 * scanCard — reads one photographed card for the card scanner.
 *
 * Entitlement (isAdmin || isPro), the daily quota and input validation live in
 * scanCard.js, where they are unit-tested. This file only supplies the Gemini
 * call. It returns what was read and never writes to the user's collection:
 * the client resolves the read and the user approves the batch.
 */
// No example set codes: listing "SOR, SHD, ..." made Gemini fall back to SOR
// whenever the small set code was hard to read, and every such card then
// failed the name check against the wrong set. An empty set lets the client
// fall back to the sets the user picked in the scanner instead.
const SCAN_PROMPT = `This is a photo of a Star Wars: Unlimited trading card. The card may be rotated.
Read four things from it:
- set: the set code printed in the collector line along the card's bottom edge, just before the language code (as in "XXX • EN"). Copy it letter by letter exactly as printed. If you cannot read the set code with confidence, leave set empty -- do not guess, and do not substitute a different or more common set.
- number: the collector number from that same line, without any "/total" part. Some cards (a leader shown face up) have no collector line: then leave set and number empty.
- name: the card's title as printed, without its subtitle.
- subtitle: the smaller line printed directly under the title, if there is one; otherwise empty.
If there is no card in the photo, or you cannot read the name with confidence, set readable to false and leave the other fields empty. If you can read the name but not the number, set readable to true, leave number empty, and still fill in name and subtitle.`;

const SCAN_SCHEMA = {
  type: "object",
  properties: {
    readable: { type: "boolean" },
    set: { type: "string" },
    number: { type: "string" },
    name: { type: "string" },
    subtitle: { type: "string" },
  },
  required: ["readable", "set", "number", "name", "subtitle"],
};

// One image, one prompt, schema-constrained JSON out. Shared by scanCard and
// locateCard so the Vertex setup and the thinking-budget fix exist once.
async function askGemini(imageBase64, prompt, schema) {
  const { GoogleGenAI } = require("@google/genai");
  const ai = new GoogleGenAI({ enterprise: true, project: GCP_PROJECT, location: VERTEX_LOCATION });
  const result = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
        { text: prompt },
      ],
    }],
    config: {
      maxOutputTokens: 256,
      temperature: 0,
      // Required: see getCardSuggestions. Thinking tokens count against the cap.
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  });
  return JSON.parse(result.text);
}

async function readCardWithGemini(imageBase64) {
  return askGemini(imageBase64, SCAN_PROMPT, SCAN_SCHEMA);
}

const scanCardHandler = createScanCardHandler({
  db: admin.firestore(),
  appId: APP_ID,
  readCard: readCardWithGemini,
  HttpsError,
  logger,
});

exports.scanCard = onCall({ maxInstances: 10 }, scanCardHandler);

/**
 * locateCard — finds the card in a scanner-rig calibration photo, using
 * Gemini's native bounding-box format. Called once per rig, not per scan.
 */
const LOCATE_PROMPT = `This photo is taken from above a scanning rig and shows one Star Wars: Unlimited trading card, possibly with paper, a ruler or other objects around it.
Return the bounding box of the card itself -- its outer edge, including the black border -- as box_2d [ymin, xmin, ymax, xmax], normalised to 0-1000.
If there is no card in the photo, set found to false.`;

const LOCATE_SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean" },
    box_2d: { type: "array", items: { type: "integer" } },
  },
  required: ["found", "box_2d"],
};

async function locateCardWithGemini(imageBase64) {
  return askGemini(imageBase64, LOCATE_PROMPT, LOCATE_SCHEMA);
}

const locateCardHandler = createLocateCardHandler({
  db: admin.firestore(),
  appId: APP_ID,
  locate: locateCardWithGemini,
  HttpsError,
  logger,
});

exports.locateCard = onCall({ maxInstances: 5 }, locateCardHandler);

/**
 * User management (admin console). Admin-only: each handler checks the
 * caller's profile. Pro and Contributor can be granted or revoked here; Admin
 * stays a Firebase-console change. Every change is audited at
 * admin/audit/roleChanges. See functions/adminUsers.js.
 */
const { createAdminUsersHandlers } = require("./adminUsers");
const { createAdminUsersStore } = require("./adminUsersStore");
const { AggregateField } = require("firebase-admin/firestore");

const adminUsers = createAdminUsersHandlers({
  auth: admin.auth(),
  store: createAdminUsersStore({ db: admin.firestore(), appId: APP_ID, AggregateField }),
  HttpsError,
});

exports.adminListUsers = onCall({ maxInstances: 2 }, adminUsers.listUsers);
exports.adminGetUserDetail = onCall({ maxInstances: 2 }, adminUsers.getUserDetail);
exports.adminSetRole = onCall({ maxInstances: 2 }, adminUsers.setRole);

/**
 * redeemInviteCode — grants the contributor role in exchange for a valid invite
 * code.
 *
 * WHY THIS IS A FUNCTION
 *
 * Roles live on the user's own profile document. Previously the client wrote
 * `isContributor: true` there itself, which meant the grant was unenforceable:
 * any authenticated account -- including an anonymous guest -- could simply set
 * isAdmin on itself and become an administrator. firestore.rules now forbids a
 * client from touching the role fields at all, so the grant has to happen here,
 * where the Admin SDK legitimately bypasses rules.
 *
 * The invite code is the document id, so a redeemer never needs read access to
 * the invites collection and codes cannot be enumerated.
 *
 * Request data: { code: string }
 * Response:     { granted: true, role: 'contributor' }
 */
exports.redeemInviteCode = onCall({ maxInstances: 5 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in before redeeming an invite.");
  }
  if (request.auth.token?.firebase?.sign_in_provider === "anonymous") {
    throw new HttpsError(
      "permission-denied",
      "Guest accounts cannot be contributors. Sign in with Google first."
    );
  }

  const code = typeof request.data?.code === "string" ? request.data.code.trim() : "";
  if (!code) {
    throw new HttpsError("invalid-argument", "An invite code is required.");
  }

  const db = admin.firestore();
  const inviteRef = db
    .collection("artifacts").doc(APP_ID)
    .collection("contributorInvites").doc(code);
  const userRef = db
    .collection("artifacts").doc(APP_ID)
    .collection("users").doc(request.auth.uid);

  try {
    await db.runTransaction(async (tx) => {
      const invite = await tx.get(inviteRef);

      // Same message whether the code is wrong or already used, so the response
      // cannot be used to probe which codes exist.
      if (!invite.exists || invite.data().claimed === true) {
        throw new HttpsError("not-found", "That invite code is not valid.");
      }

      const expiresAt = invite.data().expiresAt;
      if (expiresAt && expiresAt < Date.now()) {
        throw new HttpsError("not-found", "That invite code is not valid.");
      }

      tx.set(userRef, { isContributor: true }, { merge: true });
      tx.update(inviteRef, {
        claimed: true,
        claimedBy: request.auth.uid,
        claimedAt: Date.now(),
      });
    });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error("redeemInviteCode failed", { uid: request.auth.uid, error: error.message });
    throw new HttpsError("internal", "Could not redeem that invite.");
  }

  logger.info("contributor role granted", { uid: request.auth.uid });
  return { granted: true, role: "contributor" };
});
