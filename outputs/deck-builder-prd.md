# Product Requirements Document: SWU Holocron Deck Builder

**Version**: 1.0  
**Status**: Draft  
**Owner**: Loki / Holocron Labs  
**Last Updated**: 2026-05-01

---

## Problem Statement

Star Wars Unlimited is a mechanically rich TCG, but new players face a steep deckbuilding learning curve: they lack structured guidance on how to construct a functional deck, how formats differ, and how to progress from "collection of cards" to "something I can actually play." Experienced players, meanwhile, need tools that keep pace with their workflow — fast card lookup, format legality validation, export compatibility with tournament platforms, and result tracking over time.

The current deck builder covers the mechanical basics but does not guide new players through the *why* of deckbuilding decisions, is not usable on mobile (where many players browse between games), and does not yet support formats beyond Premier. Without improvement, Holocron risks being a collection tracker that happens to have a deck builder tacked on, rather than the destination players return to for the full play loop.

---

## Goals

1. **New player onboarding**: A player with no prior TCG experience can build a playable, legal Premier deck within 15 minutes using guided tools (shells, packets, inline validation).
2. **Mobile usability**: The deck builder is fully functional on a 390px mobile viewport with no horizontal overflow, no truncated controls, and touch-friendly tap targets throughout.
3. **Format coverage**: Twin Suns and Trilogy formats are fully supported with correct deck construction rules enforced automatically by the end of 2026.
4. **Player retention**: Players who build decks log at least one game result, creating a habit loop between deckbuilding and game tracking.
5. **Community growth**: Deck sharing creates inbound traffic — shared deck URLs drive new user registrations from players who receive a link and want to see the full build.

---

## Non-Goals

| Out of scope | Rationale |
|---|---|
| Sealed / Draft format simulation | Requires pod management, pack randomization, and a completely different UX paradigm. Scope for a dedicated Sealed mode after core format support is stable. |
| Market price integration in the deck builder | Price data requires a background sync service (already discussed as a separate initiative). The shopping list surface is the right home for cost awareness once pricing is available. |
| Social features (comments, follows, likes on shared decks) | This is a content platform problem distinct from the deckbuilding tool. Deck sharing (view-only links) is in scope; community engagement is not. |
| AI-generated deck lists | AI card *suggestions* within a deck the player is building is in scope. Fully AI-generated decklists from a prompt are not — the goal is to teach deckbuilding, not skip it. |
| Competitive metagame analysis / tier lists | This requires ongoing curation and editorial judgment. Archetype tagging and personal result tracking are in scope; metagame rankings are not. |

---

## User Personas

### The Curious New Player
Has recently picked up a starter set or watched someone play SWU. Has a collection but has never built a deck from scratch. Does not know what "resource curve" means. Gets overwhelmed by a blank search box and 1,000+ cards. Wants to be told *what to do* before they want to be told *why*.

### The Competitive Grinder
Attends locals weekly and regionals seasonally. Builds 5–10 decks per set release, tests variants, and tracks results meticulously. Already uses SWUDB or Forcetable but wants a single platform that connects their collection, deck testing, and game log. Values speed and precision over guidance.

---

## User Stories

### Curious New Player

- As a new player, I want to start from a pre-built shell (e.g., "Han Solo Aggro") so I know roughly what kind of deck I'm building before I have to make any decisions.
- As a new player, I want to swap in pre-configured card packets (e.g., "ramp package", "card draw package") so I can learn how different strategic modules affect the deck without having to know individual card names.
- As a new player, I want the builder to tell me in plain language if my deck is illegal and why, so I don't show up to game night with an invalid list.
- As a new player, I want to see which cards I already own highlighted in the builder, so I know what I need to acquire vs. what I have.
- As a new player, I want to share my deck with an experienced friend via a link so they can review and give feedback before I play it.

### Competitive Grinder

- As a competitive player, I want to switch between Premier, Twin Suns, and Trilogy construction rules so I can build for the format I'm preparing for.
- As a competitive player, I want to tag decks with archetype labels and personal notes so I can quickly find "my Vader control list" vs. "my Vader aggro list" in a growing deck library.
- As a competitive player, I want to log game results with opponent leader and outcome, so I can see my win rate by matchup over time.
- As a competitive player, I want to export my list to SWUDB or Forcetable format with a single tap, so I can move from Holocron to my tournament platform without reformatting.
- As a competitive player, I want a sideboard section so I can prepare for best-of-three play.
- As a competitive player, I want a legality checker that flags banned or restricted cards and alerts me when a card rotates out of a format.

---

## Requirements

### P0 — Must-Have (blocking launch-quality experience)

#### Mobile-responsive layout
The current two-panel desktop layout (search left, deck right) collapses on mobile. The deck builder must work as a single-panel, tab-navigated layout on viewports below 768px.

**Acceptance criteria:**
- On a 390px viewport: full functionality accessible without horizontal scrolling
- Card search, deck list, shopping list, and import/export each occupy a full-screen tab
- All buttons and quantity controls have a minimum tap target of 44×44px
- Leader/base selection modals are scrollable and dismissable on mobile

#### Deck legality checker
Before a player can save or share a deck, the builder validates it against the active format's rules and surfaces violations in plain language.

**Acceptance criteria:**
- Checks enforced: card copy limits (3 for most cards, 1 for leader/base), total deck size (50 for Premier), banned/restricted card list
- Violations displayed inline next to the offending card, not just as a summary banner
- "Ready to save" state only reached when zero violations exist
- Banned list sourced from a maintainable config (not hardcoded), so it can be updated without a deployment

#### Tag management UI
Tags are already stored in the deck data model but have no UI. Players need to add, remove, and filter decks by tags.

**Acceptance criteria:**
- Tags input on the deck edit screen: free-text with autocomplete from existing tags
- Suggested tag categories surfaced in autocomplete: archetype (aggro, midrange, control, ramp, combo), format (premier, twin suns, trilogy), lifecycle (testing, tournament-ready, retired)
- Deck list on DeckManager filterable and sortable by tag
- Tags persist to Firestore with the deck document

#### Shells and packets system — new player guided mode
A curated library of "shells" (complete 50-card starting points built around a specific leader) and "packets" (6–8 card thematic modules) that new players can use as a starting point. This is the primary new-player onboarding feature.

**Acceptance criteria:**
- Shell library: at minimum 1 shell per released leader, browseable by leader image and archetype tag
- Packet library: modular card groups categorized by function (ramp, card draw, removal, board wipe, tutoring, control, aggression), each with a 1–2 sentence plain-English description of what it does for the deck
- Loading a shell pre-fills the deck with the shell's card list and opens the builder in edit mode
- Swapping a packet: player selects "Add packet", sees cards that will be added and cards recommended to remove to maintain 50-card limit, and confirms
- Shells and packets are maintainable by the admin without a code deployment (stored in Firestore, editable via the Admin panel)
- Guided mode is opt-in — experienced players can dismiss it and go straight to the blank builder

### P1 — Nice-to-Have (next meaningful release)

#### Deck sharing via public link
Any saved deck can be published as a read-only, publicly accessible URL that does not require the viewer to be logged in.

**Acceptance criteria:**
- "Share" button on DeckManager generates a unique slug (e.g., `swu.holocronlabs.net/deck/a1b2c3`)
- Public view shows leader, base, full card list, cost curve, and deck description — no edit controls
- Owner can revoke the link at any time (link becomes 404)
- Shared links include an Open Graph image (leader card art) for link previews in Discord/social

#### Twin Suns and Trilogy format support
Twin Suns is a 2v2 format with different deck construction rules. Trilogy restricts cards to a specific set window.

**Acceptance criteria:**
- Format selector in the deck creation flow (not buried in settings)
- Per-format rule enforcement: Twin Suns uses a 40-card deck with a 2-leader setup; Trilogy restricts legal card sets to the current trilogy window
- Format badge shown on deck card in DeckManager
- Export formats adapted to match the target format's conventions

#### Sideboard
A secondary card list (up to 10 cards) for best-of-three play, stored alongside the main deck.

**Acceptance criteria:**
- Sideboard section below the main deck list in the builder
- Sideboard cards subject to the same copy-limit rules as the main deck (combined across both)
- Sideboard included in export formats that support it (Forcetable JSON)
- Sideboard excluded from the 50-card main deck count

#### AI-assisted card suggestions
While building a deck, the player can request suggestions for cards that complement their current build. The goal is education, not automation — suggestions come with a one-sentence rationale.

**Acceptance criteria:**
- "Suggest cards" action available once leader and at least 10 main deck cards are selected
- Suggestions ranked by relevance to current deck archetype and aspect identity
- Each suggestion includes: card name, cost, type, and a 1-sentence "why this fits" explanation
- Suggestions filtered to cards the player already owns (owned-first mode) with an option to show all
- Powered by Claude Haiku via the Anthropic API; result is advisory only, player must manually add

### P2 — Future Considerations

#### Matchup and result tracking
Beyond the existing W/L/D log, track opponent leader and format to build a personal matchup history.

**Why deferred**: The game log exists and captures basic results. Matchup analysis requires enough data volume to be meaningful — most players will need 20+ logged games before the data is useful. Ship the logging first, build the analytics surface once there's data to analyze.

#### Metagame insights
Aggregated (anonymized) data from public deck shares and logged results, surfaced as "popular builds this week" or "most-played leaders."

**Why deferred**: Requires critical mass of users sharing decks and logging results. Privacy policy implications need to be resolved before any aggregation.

#### Print / proxy export
Export a deck as a printable PDF of card images for playtesting proxies.

**Why deferred**: Legal risk around card image reproduction needs to be evaluated. Low priority until the core deckbuilding experience is complete.

---

## Success Metrics

### Leading indicators (visible within weeks of launch)

| Metric | Target |
|---|---|
| % of new users who complete a deck (Leader + Base + 50 cards) | ≥ 40% within first session |
| % of deck builder sessions on mobile that result in a saved deck | ≥ 25% (up from baseline ~5%) |
| Shells loaded per week | ≥ 50 in first month post-launch |
| Avg. time to first saved deck for new users | < 15 minutes |

### Lagging indicators (meaningful at 90 days)

| Metric | Target |
|---|---|
| % of registered users with at least one saved deck | ≥ 60% |
| Decks with at least one logged game result | ≥ 30% |
| Inbound registrations via shared deck links | ≥ 10% of new signups |
| Deck builder NPS (in-app prompt after 3rd save) | ≥ 40 |

---

## Open Questions

| Question | Owner | Priority |
|---|---|---|
| Who curates and maintains shells and packets? Is this Loki alone or a community contributor model? | Product | High — determines build scope for admin tooling |
| What is the source of truth for banned/restricted card lists? Is there an official FFG API or RSS feed, or is this maintained manually? | Engineering | High — affects legality checker architecture |
| For the Twin Suns format: does each player bring one leader and one base, or does the team share one base? Rules need to be confirmed before implementing format validation. | Product / Rules | High |
| What sets constitute the current "Trilogy" window, and how does that window shift over time? Is there a rotation schedule? | Product | Medium |
| For AI suggestions: should the Anthropic API call be made client-side (exposing the key) or server-side (requires a backend function)? Current architecture is fully client-side. | Engineering | High — affects feasibility of P1 AI feature |
| Does sharing a deck also share game log results, or only the deck list? | Product | Medium |

---

## Phasing

### Phase 1 — Foundation (current sprint target)
Mobile layout refactor, deck legality checker, tag management UI.
These are prerequisites for everything else — mobile blocks new player adoption, legality bugs erode trust, tags are needed before deck sharing is useful.

### Phase 2 — New Player Onboarding
Shells and packets system, guided mode, plain-language error messaging.
Core to the stated success definition. Should be launched alongside a "how to build your first deck" content piece on the site.

### Phase 3 — Sharing and Format Expansion
Deck sharing / public links, Twin Suns format, Trilogy format, sideboard.
Unlocks community growth loop and competitive player retention.

### Phase 4 — Intelligence Layer
AI card suggestions, matchup tracking, metagame insights.
Requires Phase 1–3 to be stable and a user base large enough to make the data meaningful.

---

## Appendix: Existing Feature Inventory

The following features are already shipped and are in-scope for bug fixing and polish but not redesign in this PRD cycle.

| Feature | Status | Notes |
|---|---|---|
| Deck creation / editing | Shipped | Name, description, leader, base, 50-card list |
| Cost curve visualization | Shipped | Bar chart, 0–6 costs + 7+ bucket |
| Collection integration | Shipped | Ownership indicators (green/yellow/red) on search results |
| Export: SWUDB text | Shipped | Plain-text list format |
| Export: Forcetable JSON | Shipped | JSON format for Forcetable import |
| Import: SWUDB / Forcetable | Shipped | With error messaging |
| Shopping list | Shipped | Cross-references deck vs. collection |
| Game log (W/L/D) | Shipped | Per-deck record tracking |
| Deck history / versioning | Shipped | Restore previous versions |
| Deck duplication | Shipped | Clone an existing deck |
| Aspect extraction | Shipped | Auto-computed from deck cards, stored in Firestore |
| Tags field | Stubbed | Data model ready, no UI |
| Format field | Stubbed | Hardcoded to "Premier", no selector |
