# CI/CD and Architecture Repair — Design

**Date:** 2026-09-24
**Status:** Awaiting review
**Branch:** `chore/revive-ci`
**Amended 2026-09-24:** the `FIREBASE_SERVICE_ACCOUNT` secret assumed throughout
Phases 0 and 2 is no longer obtainable. Service-account key creation is blocked
by org policy, so authentication moves to Workload Identity Federation — see
`SWU-Holocron/docs/CI-KEYLESS-AUTH.md`. No new repository secret is required.

## Problem

SWU Holocron has passed through many iterations, agents, and harnesses. The
result is a codebase where the documentation describes a system that does not
exist, several UI features are wired to Firestore paths they have no permission
to touch, and the card database only updates when the maintainer runs a script
by hand.

The root cause is not any single bug. It is that **nothing has ever verified a
claim**. Six of seven GitHub Actions workflows sat in a directory GitHub does
not read, and the husky hooks never installed, so for the entire life of this
repo no lint, no test, and no rules check has ever gated a change. Features were
built, documented as working, and never exercised.

This document records what is actually true as of 2026-09-24, the deltas against
intent, and a phased plan to close them — with the emphasis on making each fix
*self-verifying* so the same rot cannot recur.

## Verification method

Every claim below was checked against code, `git` history, or the GitHub API.
Claims that could not be verified are marked as such rather than assumed.

---

## Ground truths, as verified

The maintainer supplied five ground truths. Verification results:

### 1. Self-hosted Docker container — ✅ CONFIRMED

`Dockerfile` is a multi-stage build (node:20-alpine → nginx:alpine) with an SPA
rewrite in `nginx.conf` and a container healthcheck. Images publish to
`ghcr.io/Midknightloki/SWU-Holocron`.

### 2. Watchtower replaced by a self-hosted runner — ✅ CONFIRMED

`build-and-push-docker.yml` has a `deploy` job with `runs-on: self-hosted` that
runs `docker compose pull web && docker compose up -d web` in
`/opt/swu-holocron`, then posts a Discord embed on success or failure.

- Runner `nidavellir` (`self-hosted, Linux, X64`) is **online**.
- Last run (`27320912327`): `build-and-push` ✅, `deploy` ✅.

**This is the only automation in the project that works.** It accounts for 53 of
the last 100 Actions runs; every other workflow has zero runs, ever.

**Documentation delta:** `AGENT_CONTEXT.md` still describes Watchtower polling
every 5 minutes, and `CLAUDE.md` repeated that error because it was written
from `AGENT_CONTEXT.md`. Both need correcting.

### 3. Seeder runs on a release-calendar schedule — ❌ NEVER TRUE

Three independent blockers:

1. `sync-cards.yml` lived in `SWU-Holocron/.github/workflows/`, which GitHub
   Actions does not read. It has never executed. *(Fixed on this branch — moved
   to the repo root.)*
2. It requires the `FIREBASE_SERVICE_ACCOUNT` secret, which does not exist —
   the repo has exactly one secret, `DISCORD_WEBHOOK_URL`. Infisical was checked
   directly (all three environments, root path) and holds only `GHCR_USER`,
   `GHCR_PAT`, `MIDKNIGHTLOKI_PAT` and `SWU_HOLOCRON_TUNNEL_TOKEN` — no Firebase
   credential under any name. **It cannot be created either:** the org policy
   `constraints/iam.disableServiceAccountKeyCreation` blocks new keys, and the
   existing `github-action-…` service account has no Firestore role and an
   unrecoverable key. Resolved by moving to Workload Identity Federation
   (`docs/CI-KEYLESS-AUTH.md`).
3. There is **no release calendar anywhere in the repo** — no release dates, no
   calendar logic. The trigger was a flat daily `0 6 * * *`, which is not
   release-aware.

Its failure handler opens a GitHub issue, so enabling the cron before the secret
exists would produce a red run and an auto-filed bug every night. The cron is
therefore currently commented out with instructions in the file header.

### 4. Public API, reconciled against the official site — ⚠️ PARTIALLY TRUE

All three stages exist as well-formed scripts. Nothing orchestrates them.

| Script | Source | Writes |
|---|---|---|
| `seedCardDatabase.js` | swu-db API | `sets/{SET}/data` |
| `scrapeOfficialCards.js` | official site (Playwright) | `sets/{SET}/official-data` |
| `mergeCardSources.js` | reconciles both; official wins on overlap | `sets/{SET}/data` |
| `verifyCardDatabase.js` | integrity check | — (unwired) |

`sync-cards.yml` invokes **only the seeder**. Scrape and merge have never run
from automation.

**Data-loss hazard:** merge writes the same `data` doc the app reads. A
seeder-only run overwrites the merged result, silently discarding every
official-site correction. Manual runs are lossy unless always performed in
seed → scrape → merge order.

### 5. Firestore + Google accounts — ⚠️ PARTIALLY TRUE

Firestore and Google sign-in are correct, with two qualifications.

**Anonymous guest auth is a first-class path** (`AuthContext.loginAnonymously`).
Guest collections are keyed to an ephemeral anonymous UID with no recovery path
and no anonymous→Google linking. Clearing browser state orphans the collection
permanently. *Decision: keep as-is, document the limitation (see Decisions).*

**The rules file leaves three shipped features unable to function.** Mapping
every Firestore path the app touches against the rules that exist:

| Path | App behaviour | Rule | Result |
|---|---|---|---|
| `users/{uid}/**` | collection, decks, profile | own-uid read/write | ✅ correct |
| `public/data/cardDatabase/**` | client reads | read if authed, `write: false` | ✅ correct |
| `public/decks/{slug}` | shared decks | public read, owner write | ✅ correct |
| `shells`, `packets` | contributor content | admin/contributor write | ✅ correct |
| `submissions` | `CardSubmissionForm.jsx:371` **writes** | **no rule** | ❌ default deny — feature dead |
| `admin/sync/logs` | `AdminPanel.jsx:415` **reads** | **no rule** | ❌ default deny — dead; explains the skipped "display recent sync logs" test |
| `contributorInvites` | `checkAndApplyInvite` runs on **every** non-anonymous login | admin-only | ❌ a non-admin invitee can never be promoted, and the call is wrapped in `.catch(() => {})` so it fails **silently** |
| `public/data/sync_*` | `App.jsx` still offers the legacy path | `request.time < 2025-02-01` | ❌ **expired 19 months ago** — legacy users locked out of their own collections |

**Unverified:** the above is the rules file *in the repo*. Rules have only ever
been deployed by hand, so the live ruleset may differ. There is no `emulators`
block in `firebase.json` and no `@firebase/rules-unit-testing` dependency, so
rules cannot currently be tested at all. Resolving repo-vs-live is Phase 0.

---

## Additional findings

Discovered while verifying the above; not part of the five ground truths.

- **`DeckBuilder` loaded zero cards.** Its effect iterated
  `for (const set of setsToLoad)` but called `fetchSetData(code)`; `code` was
  undefined, and the `catch` referenced `code` too, so it threw again and broke
  the loop on the first iteration. The card pool was always empty. ESLint had
  been reporting it as `no-undef` the whole time. *(Fixed on this branch.)*
- **Coverage thresholds are decorative.** `vite.config.js` declares 80/80/70 for
  services/utils/components, but Vitest matches those keys as globs and a bare
  `src/services/` matches nothing. Real coverage: utils ~87%, services ~64%,
  components ~48%, ~33% overall. `npm run test:ci` exits 0 regardless. The
  README's "80%+ coverage" describes only `src/utils/`.
- **Husky hooks have never been active.** `.husky/pre-commit` and `pre-push`
  exist as files; `husky install` fails because it looks for `.git` in
  `SWU-Holocron/` while `.git` is one level up. `core.hooksPath` is unset and
  there is no `_` shim. `npm install` exits non-zero for the same reason.
- **Lint backlog of 242 warnings**, accumulated with no gate running:
  `react/prop-types` (123), `no-unused-vars` (84), `no-console` (21),
  `react-hooks/exhaustive-deps` (15). All 18 *errors* are fixed on this branch.
- **No error boundaries anywhere**; a render error blanks the app.

---

## Decisions taken

| Decision | Choice | Rationale |
|---|---|---|
| Sequencing | Rules and dead features first | The card database is at least manually fixable; these features are broken with no workaround. |
| Card sync schedule | Weekly idempotent cron, Mondays 06:00 UTC, plus `workflow_dispatch` with `force_update` | The seeder already hash-checks for changes, so no-op runs are nearly free. New sets appear within 7 days with no calendar to maintain and drift. |
| Guest mode | Keep as-is; document the limitation | Preserves low-friction entry; account-linking deferred as a separate piece of work. |
| Live rules verification | Maintainer authenticates the Firebase CLI; diff live against repo | Every conclusion about the dead features depends on which ruleset is deployed. |
| CI authentication to Google | Workload Identity Federation, not a service-account key | Key creation is blocked by org policy, and keyless removes a long-lived credential from both GitHub and Infisical rather than copying one between them. |

## Non-goals

- Splitting `DeckBuilder.jsx` (2,166 lines) or `App.jsx` (1,091). Needs its own
  design pass, and it is where active feature work is happening.
- Anonymous→Google account linking.
- Burning down the 242 lint warnings wholesale.
- The React Native migration scoped in
  `SWU Holocron - React Native Migration Context.md`.
- Adding Firebase Hosting as a second deploy target. Docker/GHCR → self-hosted
  runner is the deploy path and remains so.

---

## Phase 0 — Establish ground truth

**Blocks Phase 1.**

1. Maintainer runs `firebase login` in an interactive terminal (the CLI cannot
   authenticate from this session's non-interactive shell). `firebase-tools`
   v15.4.0 is already installed globally.
2. Retrieve the live Firestore and Storage rulesets and diff against
   `firestore.rules` / `storage.rules`.
3. Record the diff. If live differs from repo, re-evaluate the dead-feature
   conclusions in the table above before changing anything.

**Deliverable:** a confirmed baseline, and a definitive answer on whether the
`submissions` / `admin` denials are real.

**Fallback if CLI auth is declined:** proceed to Phase 1 using the repo rules as
the specification and rely on emulator tests; accept that the first live deploy
may reveal drift.

**Note:** once the WIF setup in `docs/CI-KEYLESS-AUTH.md` is complete, rules
could also be deployed from CI using the same federated identity (with an
added `roles/firebaserules.admin` binding), which resolves the open question at
the end of Phase 1 without introducing a deploy key.

## Phase 1 — Rules correctness and regression protection

The tests matter more than the fixes. Rules are the one part of this system with
no local verification story, which is why three features could break silently.

1. Add `firebase-tools` and `@firebase/rules-unit-testing` as devDependencies;
   add an `emulators` block to `firebase.json`.
2. Write rules tests covering **every** row of the path table: own-vs-other-user
   access, card DB read-but-never-client-write, submissions by
   contributor/admin/anonymous, admin log reads, the full invite-apply flow,
   public deck read vs owner write, and legacy `sync_*`.
   Tests are written against the *intended* behaviour, so the ones for the four
   broken paths fail first, then pass once the rules are fixed.
3. Fix the rules:
   - add a `submissions` rule (create by any authenticated user or
     contributor-only — decide during implementation, driven by how
     `CardSubmissionForm` is meant to be used);
   - add `admin/**` reads for admins;
   - allow an invitee to read and apply *their own* `contributorInvites` entry;
   - resolve the expired legacy `sync_*` rule. Recommended: remove the rule
     **and** the legacy path from `App.jsx` together, so the UI stops offering a
     door that cannot open. `MigrationService` already exists for the one-time
     move.
4. Stop swallowing the failure in `AuthContext`'s
   `checkAndApplyInvite(...).catch(() => {})` so permission errors surface.
5. Add an emulator job to `ci.yml` so rules are tested on every PR.

**Deliverable:** card submission, the admin sync-log view, and contributor
invites work, each covered by a test that fails if the rule regresses.

**Open question:** should `firebase deploy --only firestore:rules,storage:rules`
run from CI on merge to `main` (needs a deploy service account secret), or remain
a manual step with a checklist? Automating it removes the class of bug where code
and rules ship out of step — which is exactly what happened here.

## Phase 2 — Card database pipeline

1. Replace the seeder-only job with one orchestrated workflow running
   **seed → scrape → merge → verify** in strict order, fail-fast, with
   `verifyCardDatabase.js` as a real gate rather than an unused script.
2. Trigger: `cron: '0 6 * * 1'` (Mondays 06:00 UTC) plus `workflow_dispatch`
   with the existing `force_update` input. Re-enable the commented-out schedule
   only once the secret exists and one manual run has been observed to write
   correctly.
3. **Remove the overwrite hazard structurally.** Recommended: the seeder writes
   to a staging doc (`sets/{SET}/swu-db-data`) and *only* merge composes the
   authoritative `data` doc the app reads. A pipeline that is merely safe when
   run in the right order will eventually be run in the wrong order. This
   requires updating `seedCardDatabase.js`, `mergeCardSources.js`, and the
   Firestore rules, and a one-time backfill so `data` is merge-authored.
4. Keep the Discord notification pattern already used by the deploy job, so a
   failed sync is visible without watching the Actions tab.

**Blocked on:** the one-time Workload Identity Federation setup in
`SWU-Holocron/docs/CI-KEYLESS-AUTH.md` (Step 1 must be run by the maintainer;
it needs gcloud credentials). No repository secret is involved. Note that Step 2
of that document — replacing the duplicated credential block in all four data
scripts with a shared `scripts/firebaseAdmin.js` helper — is a prerequisite for
this phase, since none of the scripts currently understand Application Default
Credentials.

**Deliverable:** the card database updates itself, and a seed-only run can no
longer destroy official-site corrections.

## Phase 2b — Placeholder cards for known-but-unknown cards

**Depends on Phase 1.** Do not start before the submission rules are fixed.

swu-db's set catalog reports sets whose cards endpoint returns nothing, and the
official scrape does not cover them either. `SOROPJ` is the first case: `/sets`
says 2 cards, `/cards/SOROPJ` returns 0, and the official site has no data for
it. Verify currently fails the whole run over it, which in CI means a red build
and an auto-filed issue on every sync, forever, for something upstream.

The agreed approach is not to suppress it. Where we can be reasonably sure a
card exists but do not know what it is — the catalog states a card count we
cannot fill from either source — create a **placeholder card** and let the
community complete it through the existing card submission system.

Sketch:

1. The seeder compares the catalog's `numberCards` against what it could
   actually fetch, and emits placeholders for the shortfall, flagged
   (`isPlaceholder: true`) and carrying only what is known: set, number, and
   that it needs submission.
2. Verify treats a set filled by placeholders as complete-with-placeholders —
   informational, not a failure — so CI stays honest without going permanently
   red.
3. The UI marks placeholders visibly and routes to the submission form.
4. A submission that is accepted replaces the placeholder; a later upstream fix
   does the same automatically, so the mechanism self-heals from either
   direction.

**Blocking dependency:** `artifacts/{APP_ID}/submissions` has no Firestore rule,
so `CardSubmissionForm.jsx:371` cannot write and the submission feature is dead
(see Phase 1). Shipping placeholders before that is fixed would create cards
nobody can fill, which is worse than the current gap — it would look like a
working feature that silently discards every contribution.

Open questions for that phase: whether placeholders should count toward
collection completion percentages, and whether a placeholder awaiting
submission should be visible to all users or only to contributors.

## Phase 3 — Documentation truth pass

The governing rule: **delete rather than preserve.** An unverifiable document is
worse than no document, because the next agent will believe it. This project's
documentation problem is a direct cause of its engineering problem.

1. Audit each remaining doc against code. For every claim: verify, correct, or
   delete.
2. Known offenders:
   - `AGENT_CONTEXT.md` — Watchtower deployment model, stale fix log,
     "deck builder coming soon" while `DeckBuilder.jsx` is the largest file.
   - `CLAUDE.md` — the Watchtower error inherited from `AGENT_CONTEXT.md`.
   - `README.md` — "automated daily card database updates" (never ran), "80%+
     test coverage" (true only of `src/utils/`), deck building listed as
     "coming soon".
   - Eleven root markdown files with heavy overlap: `DOCUMENTATION_INDEX.md`
     *and* `DOCUMENTATION_SUMMARY.md`; `QUICK_DEPLOY.md` /
     `DEPLOYMENT_GUIDE.md` / `DEPLOYMENT_STATUS.md` / `FIRESTORE_RULES_DEPLOY.md`
     / `FIREBASE_FIXES_APPLIED.md` / `START_HERE.md`.
   - `TEST_FAILURE_ANALYSIS.md` and `INTEGRATION-TESTS-FUTURE.md` — describe
     failures that are now skipped or resolved.
3. Target shape: `CLAUDE.md` as the single architecture reference, one deployment
   runbook, one testing doc, `README.md` for users. Everything else retired.

**Precedent:** `.github/copilot-instructions.md` was retired this way on this
branch — its four genuine house rules were verified against code and moved into
`CLAUDE.md`, and the ~80% that was falsified was deleted.

**Deliverable:** no document in the repo contradicts the code.

## Phase 4 — Remaining gaps

Independent, individually small, in rough value order.

1. Make the coverage thresholds real (`src/services/**` glob syntax) or delete
   them. Currently they claim a standard nothing enforces. Making them real
   fails immediately at 64%/48%, so pair with a target or a documented ratchet.
2. Fix husky so local hooks actually run: `prepare` must execute from the git
   root, and both hook scripts need to `cd SWU-Holocron` before running npm.
3. Add error boundaries around the major views.
4. Document the guest-mode limitation in `CLAUDE.md` and the README.
5. Burn down lint warnings incrementally. Do **not** fix
   `react-hooks/exhaustive-deps` mechanically — adding dependencies to
   `App.jsx`/`DeckBuilder.jsx` effects risks infinite render loops, and no test
   covers those paths.

---

## Verification strategy

Each phase must leave behind an automated check, not a claim:

| Phase | Leaves behind |
|---|---|
| 1 | Emulator rules tests in CI; a rule regression fails a PR |
| 2 | `verifyCardDatabase.js` as a pipeline gate; Discord alert on failure |
| 3 | No automated check is possible for prose — so the rule is deletion over preservation, and `CLAUDE.md` anchors claims to `file:line` so they can be re-checked cheaply |
| 4 | Real coverage thresholds; working pre-commit and pre-push hooks |

## Risks

- **Live rules may differ from the repo.** Mitigated by Phase 0. If CLI auth is
  declined, the first rules deploy may surface drift.
- **The Phase 2 staging-doc restructure touches the write path for all card
  data.** Needs a backfill and a verified dry run (`--dry-run` exists on both
  merge and scrape) before the first scheduled execution.
- **Enabling the sync cron without the secret** produces nightly red runs and an
  auto-filed issue. The ordering in Phase 2 exists specifically to prevent this.
- **`CLAUDE.md` will itself drift.** Claims anchored to line numbers
  (`App.jsx:377`, `:982`, `:995`, `csvParser.js:113`) are the first to rot after
  any refactor of `App.jsx`. The house rules should outlive the line numbers.
