const { setGlobalOptions } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

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
