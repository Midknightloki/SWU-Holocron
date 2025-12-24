IMPLEMENTATION-PLAN: Deckbuilder + Analysis (Premier → Twin Suns → Trilogy)
Overview
This plan adds a Deckbuilder feature to SWU Holocron that teaches players why a deck is “good” by guiding them through Leader/Base/Archetype/Format selection, offering an eligible card pool (based on aspect identity), surfacing explainable synergy matches, and providing an “Analyze” report covering deterministic legality/math plus optional AI coaching. The work is structured for parallel execution by different agents, aligned with existing Vitest + GitHub Actions CI and a TDD-first workflow.

Key decisions (locked)
Card identity for deckbuilding: Title (counts, legality, analysis, synergy).
Canonical display printing per title: newest printing by set release order (rotation-safe).
Format priority: Premier first, then Twin Suns, then Trilogy.
Testing standard: TDD-first, deterministic analyzers, no network dependency in tests.
Constraints and repo alignment
UI navigation is currently state-driven in App (no React Router).
Tests run under Vitest with RTL patterns and Firebase SDK module mocks.
CI runs unit/integration/build/coverage; Husky pre-push runs npm run test:unit.
Card legality metadata (banned lists/rotation) is not currently present in the card DB; format legality starts with rules + placeholders and can expand when a data source is chosen.
Deliverables (what “done” means)
A new Deckbuilder top-level view integrated into the app.
Selection flow: Leader + Base + Archetype + Format.
Eligible card pool filtered by aspect identity and format rules.
Synergy matches with human-readable explanations (traits/keywords/text heuristics).
Analyze report:
Legal/illegal checks by format
Curve analysis (cost histogram)
Aspect penalties and off-identity counts
Anti-synergy warnings (deterministic heuristics)
Optional AI coaching (server-side) gated behind an explicit action.
Agent lanes and responsibilities
Lane A — Background (business logic + unit tests, no UI)
Goal: ship deterministic rules and analysis as pure functions with high coverage.

A1. Domain contracts

Define deck DTO contract (Title-based):
Deck header: name, formatId, archetypeId, leaderTitle, baseTitle
Entries: [{ title, qty, preferredSetNumber? }]
Define analyzer output contract:
errors[], warnings[], curve, aspects, synergyFindings[], antiSynergyFindings[]
A2. Format rules (Premier first)

Implement Premier legality rules:
Deck size constraints
Leader/base required
Copy limits (Title-based)
Mainboard eligibility (exclude leaders/bases; other type constraints as applicable)
A3. Aspect identity and penalties

Implement getDeckIdentityAspects(leaderCard, baseCard) and isCardEligibleForIdentity(card, identity)
Implement “aspect penalty” reporting: off-identity aspect counts and thresholds per format config
A4. Curve and composition

Implement cost histogram using numeric Cost
Add counts by Type and by Aspects for reporting
A5. Synergy and anti-synergy (deterministic)

Synergy scoring:
Trait overlap (Traits)
Keyword overlap (Keywords)
Lightweight text heuristics (Front_Text/Back_Text) with explainable “why” tags
Anti-synergy heuristics:
Rules that detect internally conflicting signals vs chosen archetype (kept simple, explainable)
A6. Tests (TDD)

Unit tests in src/test/utils:
Eligibility predicates
Copy limit enforcement
Curve calculations
Aspect penalties
Synergy “why” tags are stable and deterministic
Deliverable: logic modules + tests merged without UI dependencies.

Lane B — Foreground (technical wiring with oversight)
Goal: integrate logic into the app with minimal new architecture and robust tests.

B1. Card pool indexing by Title

Build a stable cardsByTitle map and printingsByTitle list.
Enforce canonical printing rule: newest printing by explicit set-order configuration.
Ensure determinism independent of fetch order.
B2. Deck persistence

Add DeckService to persist decks under Firestore paths consistent with user vs sync-code modes.
Support draft save/load, plus a lightweight index list for “My Decks”.
B3. Tests

Service unit tests using the existing Firebase SDK mocking patterns.
Unit tests for cardsByTitle builder and newest-printing selection logic.
Deliverable: persistence + card indexing are tested and ready for UI consumption.

Lane C — Interactive (design choices and product checkpoints)
Goal: make limited, high-impact decisions with you, early, to avoid rework.

C1. Format definitions

Premier MVP rules: deck size, copy limits, leader/base requirements, banned list placeholder.
Confirm Twin Suns and Trilogy differences (deck size, copy limits, additional constraints).
C2. Archetype taxonomy

Finalize the initial archetype list:
aggro, midrange, control, combo (plus any SWU-specific archetypes if desired)
Decide whether archetype influences only synergy ranking or also analysis warnings.
C3. Analyze report UX

Confirm the sections and ordering:
Legality errors first
Warnings next
Curve visualization
Aspect/penalty breakdown
Synergy/anti-synergy findings
C4. AI gating

Decide where AI appears:
Separate “AI Coach” button vs integrated into Analyze
Decide data retention policy for AI requests/responses.
Deliverable: locked UX/rules decisions and acceptance criteria.

Implementation sequence (PR-ready slices)
PR 1 — Deck domain + Premier rules (logic-only)
Add deck rule modules and unit tests (Premier only).
Add deck analyzer skeleton returning deterministic structures.
CI must pass with coverage maintained.
PR 2 — Title indexing + newest printing resolution
Add “pool by title” builder and tests.
Add explicit set release order config.
PR 3 — Deck persistence (DeckService)
Add Firestore schema and DeckService methods.
Add service tests with SDK mocks.
PR 4 — Deckbuilder UI (selection + eligible pool + decklist editing)
Add Deckbuilder view and minimal UX.
Add RTL tests for selection and adding/removing cards.
PR 5 — Analyze UI panel (deterministic output)
Render analyzer output and add RTL tests for key errors/warnings/curve counts.
PR 6 — Twin Suns rules
Extend format config + rules + tests; ensure existing Premier behaviors unchanged.
PR 7 — Trilogy rules
Extend format config + rules + tests.
PR 8 (optional) — AI coach (server-side + gated UI)
Add Cloud Function endpoint, request/response schema, and UI integration.
Keep core Deckbuilder functional without AI.
CI/CD and TDD requirements
Every PR includes tests for new logic and/or UI behavior.
Avoid flaky tests:
Deterministic analyzers only (no random, no time, no network)
AI analysis is mocked in UI tests and kept out of core analyzer unit tests
Keep functions changes isolated:
Cloud Functions may need a separate workflow/job due to Node version differences; keep optional AI PR separate.
Open items (confirm before PR 1 starts)
Exact Premier deck size and copy limits.
Exact aspect identity rule interpretation for SWU (leader/base aspects → allowed aspects).
Set release order list source (manual config vs derived).