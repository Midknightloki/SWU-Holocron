const { setGlobalOptions } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const APP_ID = "swu-holocron-v1";

// Vertex AI. No API key: the function authenticates with its own service
// account through Application Default Credentials, so there is no secret to
// store, rotate or leak. Billing goes through this GCP project.
const VERTEX_LOCATION = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
const GEMINI_MODEL = "gemini-2.5-flash";

setGlobalOptions({ maxInstances: 10 });

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

    const { leaderName, baseName, aspects, deckCards, availableCards } = request.data;

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
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: VERTEX_LOCATION,
    });

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

DECK:
- Leader: ${leaderName}
- Base: ${baseName}
- Aspects: ${(aspects || []).join(", ") || "None"}
- Current cards (${totalCards}/50): ${deckSummary}

AVAILABLE CARDS (not yet at max copies):
${cardListText}

Rules:
1. Only recommend cards whose ID appears in the AVAILABLE CARDS list above.
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
