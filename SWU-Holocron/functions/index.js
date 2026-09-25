const { setGlobalOptions } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const APP_ID = "swu-holocron-v1";

const anthropicKey = defineSecret("ANTHROPIC_API_KEY");

setGlobalOptions({ maxInstances: 10 });

/**
 * getCardSuggestions — proxies deck state to Claude Haiku and returns
 * 5 card suggestions with a one-sentence rationale each.
 *
 * Setup: firebase functions:secrets:set ANTHROPIC_API_KEY
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
  { maxInstances: 5, secrets: [anthropicKey] },
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

    const apiKey = anthropicKey.value();
    if (!apiKey) {
      logger.error("ANTHROPIC_API_KEY secret is empty");
      throw new HttpsError("internal", "AI service not configured.");
    }

    // Lazy-load to avoid cold-start overhead when secret isn't needed
    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });

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

Respond with ONLY a valid JSON array — no markdown, no explanation:
[
  {"id": "SET_NUM", "name": "Card Name", "reason": "One sentence why this fits."},
  ...
]`;

    let responseText;
    try {
      const message = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      responseText = message.content[0].text;
    } catch (err) {
      logger.error("Anthropic API error:", err);
      throw new HttpsError("internal", "AI request failed: " + err.message);
    }

    // Extract JSON array from response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.error("Could not parse AI response:", responseText);
      throw new HttpsError("internal", "Failed to parse AI suggestions.");
    }

    let suggestions;
    try {
      suggestions = JSON.parse(jsonMatch[0]);
    } catch (err) {
      logger.error("JSON parse error:", responseText);
      throw new HttpsError("internal", "Failed to parse AI suggestions.");
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
