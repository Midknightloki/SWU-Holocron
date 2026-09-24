# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout gotcha

The git root is `SWU-Holocron/`, but the actual application lives one level down in
`SWU-Holocron/SWU-Holocron/` (not a submodule — just a nested directory). **All npm
commands must run from the nested directory**, which is where `package.json`,
`vite.config.js`, `firebase.json`, `src/`, and `scripts/` live.

```bash
cd SWU-Holocron        # from git root
npm install            # node_modules is NOT checked in / may be absent
```

`npm install` exits non-zero on the `prepare` step: it runs `husky install`,
which looks for `.git` in the package directory and fails, because `.git` is one
level up at the git root. Dependencies do install (prepare runs last) — the
failure is cosmetic locally, but it means **the git hooks have never actually
been active** (no `.husky/_` shim, `core.hooksPath` unset). `pre-commit` and
`pre-push` exist as files but do not run. Set `HUSKY=0` to silence it; CI does
exactly that on `npm ci`.

The git root holds only ops/docs material: `AGENT_CONTEXT.md` (the most detailed
existing guide — read it for known-issue history and deployment runbooks),
deployment markdown, `deploy.js`, `homelab-tools/swu-deploy-dashboard/` (static
dashboard that polls `/version.json`), and scratch files. `Melee.txt` and
`decklist.swu.text` are tracked deck-list parser samples; `cards.json`,
`cards-page.html`, `debug_nextjs.py` and `image/` are gitignored local clutter.

Requires Node 20+. CI pins Node 20; `functions/` declares Node 24.

## Commands

All from `SWU-Holocron/` (the nested dir):

```bash
npm run dev            # Vite dev server on :5173 (PWA dev mode enabled)
npm run build          # production build -> dist/
npm run preview        # serve dist/ on :5173
npm run lint           # --max-warnings 0; CI gates on errors only (see below)

npm test               # vitest watch
npm run test:unit      # single run, verbose
npm run test:ci        # single run + coverage (thresholds are inert, see Testing)
npm run test:changed   # only tests for changed files
```

Single test file / single test:

```bash
npx vitest run src/test/services/CardService.test.js
npx vitest run -t "should generate a unique collection ID"
npx vitest related --run src/utils/csvParser.js   # what lint-staged does
```

Admin/data scripts (need `firebase-admin-key.json` or `FIREBASE_SERVICE_ACCOUNT`):

```bash
npm run admin:seed-cards       # write card DB to Firestore -- currently the ONLY way it updates
npm run admin:verify-db        # integrity check
npm run admin:scrape-dry-run   # scrape official card site without writing
npm run admin:merge-dry-run    # preview merge of swu-db + official sources
```

Git hooks are configured but **inactive** — `.husky/pre-commit` (`lint-staged`) and
`.husky/pre-push` (`npm run test:unit`) exist as files that never execute, for the
reason given above. Treat CI as the only gate, and run `npm run lint` and
`npx vitest run` yourself before pushing.

## Architecture

React 18 + Vite + Tailwind PWA. No router — `App.jsx` holds a `view` state string
(`'binder' | 'dashboard' | 'admin' | 'decks' | ...`) and switch-renders components.
All persistent state is in Firestore; there is no server of our own except one
Cloud Function.

### Firestore is the single data namespace

Everything hangs off `artifacts/{APP_ID}/…` where `APP_ID = 'swu-holocron-v1'`
(exported from `src/firebase.js`, distinct from the Firebase project id
`swu-holocron-93a18`). The paths that matter:

```
artifacts/{APP_ID}/public/data/cardDatabase/sets/{SET}/data   card data per set (8 segments)
artifacts/{APP_ID}/public/data/cardDatabase/metadata          sync version/metadata
artifacts/{APP_ID}/public/data/sync_{code}/*                  LEGACY collection sync (deprecated)
artifacts/{APP_ID}/public/decks/{slug}                        publicly shared decks
artifacts/{APP_ID}/users/{uid}                                profile doc: isAdmin / isContributor
artifacts/{APP_ID}/users/{uid}/collection/{SET_NNN_std|foil}  owned-card quantities
artifacts/{APP_ID}/users/{uid}/decks/{deckId}                 + /versions, /gamelogs subcollections
artifacts/{APP_ID}/submissions, /shells, /packets, /contributorInvites
artifacts/{APP_ID}/admin/sync/logs
```

Firestore requires alternating collection/document segments, so path arity is
load-bearing — a 6-segment `collection()` throws at runtime. This has broken the
app before (see `AGENT_CONTEXT.md`). The client SDK also cannot list
subcollections, so `CardService.getAvailableSets()` probes each known set code
from `SETS` individually rather than enumerating.

Firestore/Storage rules (`firestore.rules`, `storage.rules`) are **not** deployed
by any CI job — they must be published manually via
`firebase deploy --only firestore:rules` or the console. Changing a path in code
usually means changing rules too.

### Card data: four tiers, and a cache with no expiry

Loading a set goes through **two** layers. `App.jsx#loadSetData()` checks
localStorage first, and only then calls into the service:

1. `localStorage['swu-cards-{SET}']` (`App.jsx:299`) — **no TTL.** Once a set is
   cached it is served forever until `loadSetData(force = true)`. This is the
   usual reason a user reports stale card data, and the reason a Firestore
   re-seed appears not to take effect.
2. `CardService.fetchSetData()`, itself three-tiered:
   - Firestore `cardDatabase` (primary)
   - legacy `public/data/sets/{SET}` cache, if under 7 days old
   - direct `https://api.swu-db.com` fetch (emergency only)
3. On throw, `reconstructCardsFromCollection()` rebuilds a degraded card list
   from the metadata stored on the user's own collection docs.

The app is offline-first by design: the live external API should almost never be
hit at runtime. Workbox caches swu-db responses CacheFirst for 7 days. Card images
are URLs built by `CardService.getCardImage()` — never stored.

The Firestore `cardDatabase` is **not** currently updated automatically — see
Deployment below.

### Identity of a card, and set codes

A collected card's key is `getCollectionId(set, number, isFoil)` →
`SOR_001_std` / `SOR_001_foil`, with the number zero-padded to 3
(`src/utils/collectionHelpers.js`). Padding is deliberate: card numbers arrive as
both ints and strings, and an unpadded key silently forks a user's collection.
Separately, `src/utils/officialCodeUtils.js` maps internal set codes (`SOR`) to
official printed/CDN codes (`01`, `G25`, `I01`) — two different code systems
coexist, and `SET_CODE_MAP` carries both directions in one object.

### Services layer

`src/services/` is where Firebase touches happen; components are meant to call
into it rather than import `firebase/firestore` directly (`App.jsx` is the main
exception — it owns the collection `onSnapshot` listener).

- `CardService` — card fetch/fallback, image URLs, set discovery
- `DeckService` — deck CRUD + version snapshots + game logs + public deck slugs
- `LegalityService` — format rules table (Premier/Eternal/Twin Suns/Trilogy: deck
  size, leader count, max copies, singleton, rotation) validated against
  `src/data/banned-list.json`
- `PricingService`, `GuidedModeService` (contributor invites), `MigrationService`
  (legacy sync-code → uid-scoped collection), `AiSuggestionsService`

`AiSuggestionsService` calls the one Cloud Function, `getCardSuggestions` in
`functions/index.js`, which proxies deck state to Claude via the
`ANTHROPIC_API_KEY` secret. That key must never reach the client bundle — the
function exists for exactly that reason.

### Auth and roles

`src/contexts/AuthContext.jsx` wraps the app: Google popup or anonymous guest
sign-in, plus it reads `isAdmin`/`isContributor` off the user's profile doc. Roles
are Firestore data, not custom claims, so they must also be enforced in
`firestore.rules`; the `view === 'admin'` guard in `App.jsx` is UI-only.

### Constants split

`src/cardData.js` holds pure data (`API_BASE`, `SETS`, `FALLBACK_DATA`) and is
Node-safe; `src/constants.js` re-exports it and adds `ASPECTS` with Vite-specific
`?react`/`?url` SVG imports. Node scripts under `scripts/` must import from
`cardData.js` — importing `constants.js` breaks them. `vite.config.js` also marks
`scripts/` external so admin code stays out of the browser bundle.

## Testing

Vitest + Testing Library, `happy-dom` environment. `src/test/setup.js` globally
mocks `../firebase` to `{ auth: null, db: null, isConfigured: false }` and stubs
`localStorage`, so any code path needing a real `db` requires per-test mocking.

Tests live in **two** places — `src/test/{utils,services,components,contexts,integration}/`
and `src/components/__tests__/` (the newer deck-feature components). Check both
before assuming a component is untested.

Coverage thresholds in `vite.config.js` **look** per-directory
(`src/services/` and `src/utils/` at 80%, `src/components/` at 70%) but are
inert: Vitest matches these keys as globs, and a bare `src/services/` matches no
files. Real coverage is utils ~87%, services ~64%, components ~48% (~33%
overall), so `npm run test:ci` exits 0 well below the stated bar. Writing them as
`src/services/**` would switch enforcement on — and immediately fail. The
README's "80%+ coverage" claim describes only `src/utils/`.

`test:unit` and `test:integration` are currently the same command, so "unit" runs
integration tests too. Several suites are deliberately skipped with reasons in
`TEST_FAILURE_ANALYSIS.md` and `INTEGRATION-TESTS-FUTURE.md` (AdvancedSearch async
init timeout, card-submission integration, legacy sync-code flow, some
duplicate-detection Firebase-mock tests) — read those before "fixing" a skip.

## Deployment

**Workflows only run from the git root's `.github/workflows/`.** The app's nested
`SWU-Holocron/.github/workflows/` is invisible to GitHub Actions — six workflows
sat there and had never executed once. Anything added there is dead config.
Because the app is one level down, every root workflow job needs
`defaults.run.working-directory: SWU-Holocron`, a `cache-dependency-path` for
`setup-node`, and `HUSKY=0` on `npm ci` (see the install caveat above).

**One live deploy path:** `build-and-push-docker.yml` builds with context
`./SWU-Holocron`, injects `public/version.json` (commit sha, message, build
time), pushes to `ghcr.io`, and Watchtower on the homelab host pulls it within
~5 min. Multi-stage build → nginx with SPA rewrite (`nginx.conf`).
`/version.json` is served `no-store` with `Access-Control-Allow-Origin: *` so
the external deploy dashboard can poll it.

**Not running, and why** — only `DISCORD_WEBHOOK_URL` is configured as a repo
secret:

| Workflow | Blocked on |
|---|---|
| `sync-cards.yml` (at root, `workflow_dispatch` only) | `FIREBASE_SERVICE_ACCOUNT`. Its cron is commented out deliberately: a failing run auto-files a GitHub issue, so enabling it without the secret means a red run and a new bug every night. Until it runs, the card database changes **only** via a manual `npm run admin:seed-cards`. |
| `firebase-hosting-{merge,pull-request}.yml` (still nested, dormant) | `FIREBASE_SERVICE_ACCOUNT_SWU_HOLOCRON_93A18`, plus they'd add a second deploy target alongside Docker/Watchtower. |
| Codecov upload in `ci.yml` | `CODECOV_TOKEN` absent; the repo is public so tokenless upload works, and `fail_ci_if_error` is off so it can't fail a build. |

`deploy.js` at the git root is a stub — the Admin SDK cannot upload hosting.

## Linting

`npm run lint` uses `--max-warnings 0`, but **CI deliberately gates on errors
only** (`eslint src --ext js,jsx --quiet`) and reports warnings non-blocking.
There is a ~242-warning backlog that accumulated while no gate of any kind was
running: `react/prop-types` (123), `no-unused-vars` (84), `no-console` (21),
`react-hooks/exhaustive-deps` (15). Keep **errors at zero** — that is the real
contract. Don't "fix" `exhaustive-deps` mechanically; adding dependencies to
`App.jsx`/`DeckBuilder.jsx` effects can cause infinite render loops, and the
test suite does not cover those paths.

`no-console` allows only `console.warn`/`console.error` — the many
`console.log('✓ …')` calls in services predate the rule; don't add new ones.

CSV import/export (`src/utils/csvParser.js`) must stay round-trip compatible with
Moxfield and Archidekt exports; `deckImportExport.js` handles deck-list text
formats (see `decklist.swu.text` / `Melee.txt` at the git root for samples). The
parser is a character-by-character state machine that handles doubled `""`
escapes inside quoted fields (`csvParser.js:113`) — not a regex split, so don't
"simplify" it into one.

## House rules

Carried over from the retired `.github/copilot-instructions.md`; each verified
against the code as of 2026-09-23.

**Write tests first for new features.** This is the project's stated workflow:
failing test, minimum implementation, then refactor against a green suite.

**Collection controls stay inline.** Browsing cards and managing your collection
are the same activity — cards in the database are just cards you don't own yet.
Quantity/foil controls are embedded in the card grid (hover overlay), the card
modal header, and the dashboard's missing-cards table. Never route the user to a
separate "manage collection" screen; it breaks the core design principle.

**Firestore batch writes chunk at 400 operations.** The hard limit is 500;
`App.jsx:377` commits and reopens the batch at 400 for headroom. CSV imports
depend on this.

**Every hook before any conditional return.** Calling `useMemo`/`useEffect` after
an early exit changes hook order between renders → "Rendered more hooks than
during the previous render". `react-hooks/rules-of-hooks` now catches this, and
it is an ESLint *error*, so CI blocks on it.

## Conventions

- Environment tags in comments mark platform coupling, and are worth preserving
  and adding: `@environment:firebase`, `@environment:web-file-api`,
  `@environment:web-localstorage`, `@environment:react`, plus `@critical`.
- Services are object literals exported by name — `export const CardService = {}`
  — so import them as `import { CardService }`, never as a default.
- A test file containing JSX must use the `.jsx` extension or Vite/esbuild won't
  parse it. All 35 current test files follow this.
- `ASPECTS` is an array of objects, not strings — render `aspect.name`.
- `localStorage` keys are `swu-`-prefixed: `swu-cards-{SET}`, `swu-available-sets`,
  `swu-active-set`, `swu-has-visited`, `swu-sync-code`, `swu-holocron`.
- Leaders and Bases are horizontal: `aspect-[88/63] col-span-2`. Everything else
  is `aspect-[63/88] col-span-1` (`App.jsx:982`).
- Owned counts render as a dual `3 +2F` — standard count prominent, foil count as
  a smaller yellow badge (`App.jsx:995`).
- Tailwind dark theme throughout (`bg-gray-950`/`bg-gray-900` grounds,
  `text-gray-100` base). Degrade gracefully rather than crashing: show fallback
  data, and always check `db` exists before a Firestore call.

## Known gaps

Long-standing, still true, and each one a reasonable thing to pick up:

- **No error boundaries anywhere.** A render error in any component blanks the app.
- **No store.** Everything prop-drills from `App.jsx`; collection update callbacks
  are threaded through every component that touches quantities.
- **No memoization on the card grid**, which routinely renders 200+ cards.
- `.animate-shimmer` (the foil effect) is defined in `src/index.css` but
  referenced by no component — dead CSS left from `Prototype/app.jsx`.
- A React Native migration has been scoped but not started, in
  `SWU Holocron - React Native Migration Context.md` and
  `docs/PLATFORM-ARCHITECTURE-DECISION.md`. The platform-coupled spots it cares
  about are the `@environment:` tags above.
