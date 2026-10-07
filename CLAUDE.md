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

`npm install` used to exit non-zero on the `prepare` step, because `husky install`
looks for `.git` in the directory it runs from and `.git` is one level up at the
git root. That is fixed: `prepare` is now `cd .. && husky install
SWU-Holocron/.husky`, which installs from the root and points `core.hooksPath` at
the nested hooks directory. CI still sets `HUSKY=0` on `npm ci`, since hooks have
no job there.

Because the hooks now run from the git root (git runs them at the top level of the
working tree), each one `cd`s into `SWU-Holocron` first. Anything added to them
must do the same, or `npx`, `node_modules` and the eslint config will not
resolve.

The git root holds only ops/docs material: this file, `README.md`, `deploy.js`,
`homelab-tools/swu-deploy-dashboard/` (static dashboard that polls
`/version.json`), and scratch files. Eleven overlapping markdown files that used
to live here — `AGENT_CONTEXT.md`, `START_HERE.md`, two documentation indexes and
a set of dated Firebase-deployment guides — were retired: they documented a
deployment model that never existed (see Deployment below) and a feature set
years out of date. `SWU-Holocron/docs/DEPLOYMENT_RUNBOOK.md` and
`SWU-Holocron/TESTING.md` are now the single runbook and the single testing
reference. `Melee.txt` and
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
npm run admin:seed-cards       # write card DB to Firestore by hand (sync-cards.yml does it weekly)
npm run admin:verify-db        # integrity check
npm run admin:scrape-dry-run   # scrape official card site without writing
npm run admin:merge-dry-run    # preview merge of swu-db + official sources
```

Git hooks work now: `.husky/pre-commit` runs `lint-staged` (eslint --fix plus
`vitest related` on staged `.js`/`.jsx`), `.husky/pre-push` runs
`npm run test:unit`. They had never executed before — see the install note above.
They only apply to files under `SWU-Holocron/`, because lint-staged runs from
there; root-level JavaScript such as `deploy.js` is not linted by them, which is
intentional since it has no eslint config of its own.

A clone needs one `npm install` for the hooks to exist. CI remains the
authoritative gate.

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
artifacts/{APP_ID}/public/data/cardDatabase/sets              SET REGISTRY (discovered set list)
artifacts/{APP_ID}/public/data/cardDatabase/sets/{SET}/data   card data per set (8 segments)
artifacts/{APP_ID}/public/data/cardDatabase/metadata          sync version/metadata
artifacts/{APP_ID}/public/data/sync_{code}/*                  LEGACY collection sync (deprecated)
artifacts/{APP_ID}/public/decks/{slug}                        publicly shared decks
artifacts/{APP_ID}/users/{uid}                                profile doc: isAdmin / isContributor
artifacts/{APP_ID}/users/{uid}/collection/{SET_NNN_std|foil}  owned-card quantities
artifacts/{APP_ID}/users/{uid}/decks/{deckId}                 + /versions, /gamelogs subcollections
artifacts/{APP_ID}/users/{uid}/batches/{batchId}              scanner batch reports (one per box/pre-release)
artifacts/{APP_ID}/submissions, /shells, /packets, /contributorInvites
artifacts/{APP_ID}/admin/sync/logs
artifacts/{APP_ID}/admin/audit/roleChanges/{auto}              role grants/revokes from the Users tab (functions write)
artifacts/{APP_ID}/config/scanner                             { dailyLimit } for the card scanner (function-only)
artifacts/{APP_ID}/scanUsage/{uid}                            per-user daily scan counter (function-only)
artifacts/{APP_ID}/public/data/prebuiltDecks/{sourceId}       precon decks (sync writes; admins publish)
artifacts/{APP_ID}/public/data/cardDatabase/preconProducts    TCGplayer precon products (sync writes)
artifacts/{APP_ID}/users/{uid}/prebuiltAdds/{sourceId}        when a user added a precon
artifacts/{APP_ID}/users/{uid}/lists/{listId}                 saved trade/wants lists (Saved reports/lists)
artifacts/{APP_ID}/publicLists/{code}                         shared trade/wants lists (anyone can read)
```

Firestore requires alternating collection/document segments, so path arity is
load-bearing — a 6-segment `collection()` throws at runtime. This has broken the
app before. The client SDK also cannot list
subcollections, which is why the `sets` document doubles as a **set registry**:
it holds the discovered set list, and its subcollections hold each set's cards.

### Sets are discovered, never hardcoded

`scripts/setDiscovery.js` fetches `https://api.swu-db.com/sets` (51 sets as of
2026-09, 12 of them base sets) and publishes a registry to the `sets` doc. The
seeder iterates the registry; `CardService.getSetRegistry()` reads it in one
call and the client renders from that.

This replaced a hardcoded `SETS` array duplicated across six files, which meant
the seeder could only ever seed sets a human had typed in — `IBH`, `TS26`, `ASH`
and `HMW` were invisible despite existing in the API, some for a year.

**Do not reintroduce a hardcoded set list.** `SETS` in `cardData.js` is a
fallback for a cold database or denied read, nothing more. `PROMO` and `OTHER`
in it are not real API sets: they are legacy buckets kept because collection
documents are keyed `PROMO_001_std`, and dropping them would orphan those cards.
Real promos arrive under their true codes (`SOROP`, `P26`, `HMWP`, …).
`src/setCatalog.js` holds the normalisation and must stay Vite-free so Node
scripts can import it.

Firestore rules **are** deployed by CI: `deploy-firestore-rules.yml` publishes
`firestore.rules` on a push to `main` that changes it, gated on the emulator
tests in `src/test/rules/` passing. `storage.rules` is still manual. Changing a
path in code usually means changing rules too, so expect the rules tests to fail
first — that is the gate working.

`publicDecks` and `publicLists` updates require the existing owner as well as
the new data's uid: checking only the new uid let any signed-in user take over
a shared deck. Writes to both are shape-checked (known fields, bounded size);
`publicLists` codes must look app-made. Running `npm run test:rules` locally needs JDK 21+ (the
emulator refuses older Java).

### Card data: four tiers, and a cache with no expiry

Loading a set goes through **two** layers. `App.jsx#loadSetData()` calls
`loadSet()` (`src/services/setLoader.js`), which checks the local cache first and
only then calls into the service:

1. IndexedDB `swu-holocron` → store `cardSets`, keyed by set code
   (`src/services/cardCache.js`) — **no TTL.** Once a set is cached it is served
   forever until `loadSetData(force = true)`. This is the usual reason a user
   reports stale card data, and the reason a Firestore re-seed appears not to
   take effect.

   It used to be `localStorage['swu-cards-{SET}']`. At ~650 KB per base set that
   filled the ~5 MB localStorage quota, after which **every** other localStorage
   write failed silently (rig calibration, scan drafts) and a fresh fetch whose
   cache write threw fell into the "Network offline" fallback. `App` migrates any
   leftover `swu-cards-*` keys into IndexedDB at startup and deletes them. Keep
   bulk data out of localStorage. A failed cache write never fails a load.
2. `CardService.fetchSetData()`, itself three-tiered:
   - Firestore `cardDatabase` (primary)
   - legacy `public/data/sets/{SET}` cache, if under 7 days old
   - direct `https://api.swu-db.com` fetch (emergency only)
3. On throw, `reconstructCardsFromCollection()` rebuilds a degraded card list
   from the metadata stored on the user's own collection docs.

The app is offline-first by design: the live external API should almost never be
hit at runtime. Workbox caches swu-db responses CacheFirst for 7 days. Card images
are URLs built by `CardService.getCardImage()` — never stored.

The Firestore `cardDatabase` is refreshed weekly by `sync-cards.yml` — see
Deployment below. Note that the weekly refresh does nothing for a user whose
IndexedDB cache already holds the set: that cache has no TTL, so new data waits for
`loadSetData(force = true)`.

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

`AiSuggestionsService` calls `getCardSuggestions` in `functions/index.js`,
which proxies deck state to **Gemini 2.5 Flash on Vertex AI**. There is no API
key: the function authenticates with its own service account through ADC, so
billing runs through the GCP project and there is no secret to rotate or leak.

Two Gemini specifics are load-bearing. `thinkingConfig: { thinkingBudget: 0 }`
is required — 2.5 Flash thinks by default and those tokens count against
`maxOutputTokens`, so a small cap is consumed by reasoning and the response
comes back empty with `finishReason: MAX_TOKENS`. And `responseSchema`
constrains the output, replacing a regex that scraped a JSON array out of prose
and broke on any commentary.

The SDK is `@google/genai` (not the older `@google-cloud/vertexai` or
`@google/generative-ai`), and Vertex init is `enterprise: true` — not the
`vertexai: true` older examples show.

### Auth and roles

`src/contexts/AuthContext.jsx` wraps the app: Google popup or anonymous guest
sign-in, plus it reads `isAdmin`/`isContributor` off the user's profile doc. Roles
are Firestore data, not custom claims, so they must also be enforced in
`firestore.rules`; the `view === 'admin'` guard in `App.jsx` is UI-only.

**Guest mode is a one-way door, and this is the sharpest edge in the app.** A
guest is a real Firebase anonymous account with a real uid, so `isSignedIn()` is
true and the collection is written to Firestore at
`users/{anonymous-uid}/collection` like anyone else's. But the only thing holding
that identity is the browser's local storage. Clear site data, switch browsers or
open the app on a phone and the account is gone — with the collection still
sitting in Firestore, unreachable and never cleaned up.

The way out is **Sign in with Google**, which a signed-in guest gets in the
header and the phone Me sheet. `loginWithGoogle` sees an anonymous current user
and calls `upgradeGuest` (`src/services/guestUpgrade.js`), which links the
Google account to the guest (`linkWithPopup`): same uid, so the collection,
decks, lists and batches all stay. Linking fires no auth-state event, so
`AuthContext` forces a re-render for `isAnonymous` to read false. If that
Google account already exists (`credential-already-in-use`), the guest's
collection is read *first* -- it is unreadable once signed out of the guest --
then the existing account is signed in with the credential from the error and
the cards are added to it through `importToCollection` as a "Guest collection"
batch. Guest decks, lists and batches are not moved in that case. A failed copy
offers the guest cards as a CSV. `AuthContext.upgrade` carries the outcome and
`App` shows it as a dismissible notice. A guest who clears site data before
upgrading still loses the account.

`isPro` is a third profile flag, protected in `firestore.rules` exactly like
`isAdmin`/`isContributor` (Patreon is the planned automatic source).
`AuthContext` exposes it with a derived `canScan = isAdmin || isPro`; the
`scanCard` function enforces the same rule server-side.

**User management.** Admins grant and revoke **Pro** and **Contributor** from
the admin console's **Users** tab, which also lists users and shows each one's
activity (collection size, batches, decks, last scan day). It runs through
three admin-only callables in `functions/adminUsers.js` (handlers, injected
and package-free so CI tests them) and `functions/adminUsersStore.js`
(Firestore, count/sum aggregations). **Admin is deliberately not settable
there** -- it stays a Firebase-console change, so an app session can never mint
admins. Every change is audited at `admin/audit/roleChanges`. Roles are read
at sign-in, so a user sees a change on their next app load; server checks
(the scanner's Pro gate) apply immediately.

Roles are never read for anonymous users (`if (u && !u.isAnonymous)`), and
`redeemInviteCode` rejects them outright, so a guest cannot be a contributor or
an admin.

### Card scanner

Pro users and admins can scan physical cards with a phone or webcam
(`CardScanner.jsx` → `ScanReview.jsx`). Each capture goes to the `scanCard`
Cloud Function, which checks entitlement and a per-user daily quota
(`functions/scanCard.js`), then has Gemini read the set code, number **and
name**. The client resolves the read against its own card data and rejects it
unless the name matches the card at that number (`src/utils/scanResolve.js`) —
that cross-check is what keeps a misread number from adding the wrong card.

- Promo cards print their **parent** set's code: an SHDOP card says "SHD" with
  its own promo number, which in SHD is a different card. When a read fails in
  the printed set, `resolveScan` retries every registered set whose code starts
  with it (SHDOP, SHDPQ, SHDPQJ, ...) — by prefix, because `parentSetId` is
  missing on judge sets — and `ScanService` only downloads those sets then. The
  name check guards every candidate.
- **Set picker (hint, not filter).** The scanner's "Any set / SHD" button stores
  picked set codes per device (`localStorage['swu-scan-sets']`). When the
  printed set code was misread — in practice Gemini reading it as SOR — or left
  empty, `resolveScan` falls back to the picked sets and their promo sets; it
  never overrides a match on the printed set. `scanCard`'s prompt deliberately
  lists no example set codes: the old "for example SOR, SHD, …" made SOR
  Gemini's default guess, and it now leaves `set` empty rather than guessing.
- **Auto mode (hands-free).** Requires a rig calibration. Built for a *swap*
  rig: the rig is empty between cards, so it captures once each time a card
  settles after the rig was empty, and re-arms only when it is empty again —
  one capture per card, however long a card sits there. `frameSampler.js`
  (browser only) takes 48×64 grayscale samples of the calibrated card area of
  the live video at ~10 Hz; the pure reducer in `autoCapture.js` decides
  (`learning → empty → arriving → captured`). The empty-rig baseline is a float
  array that slowly follows lighting drift — whole numbers would round the
  blend away. Tunable per device in `localStorage['swu-scan-auto']`. Auto pauses
  while any overlay is open, at the daily limit, and during a capture.
- **Face-up leaders** carry no collector number. `scanCard` also reads the
  subtitle and returns an empty number rather than giving up; `resolveScan` then
  matches an exact name + subtitle among Leaders (picked sets, then base sets —
  loaded only for such a read), preferring the lowest number (the standard
  printing). Unmatched, the card is reason `no-number` and Pick card opens
  pre-searched with the title.
- **NEW badge:** review marks cards not owned in any finish, and the scanner
  pops up "NEW: <card>" for the first copy of one in a batch.
- The batch lives in `localStorage['swu-scan-draft-{uid}']` until the user
  approves it (`src/utils/scanDraft.js`). The key is per uid on purpose: a
  shared key would let one account's batch land in another's collection.
  Rows only record `hasPhoto`; the photos themselves are in IndexedDB
  (`photoStore.js`, store `scanPhotos`), keyed by row id, and are deleted when
  a row leaves the batch (added, removed, collapsed, discarded).
- **Whole-box pipeline.** Capture never waits on recognition. Each capture is
  stored and queued (`scanQueue.js`): up to 3 reads in flight, network
  failures retried with backoff (1 s → 16 s), the daily limit and going
  offline pause the queue (pending rows become `waiting`), and rows still
  reading are re-queued when the scanner reopens. In Auto, the capture is an
  instant frame of the live stream (`captureVideoFrame`, cropped through
  `videoCropFor`) when it passes the sharpness check
  (`laplacianVariance ≥ settings.sharpness`), else a full photo; manual taps
  always take a full photo. Live feedback is deliberately minimal: no flash on
  success or recognition, a red flash only when nothing usable was captured,
  and unrecognised cards just raise the Review badge. Add commits the matched
  cards even while others are still reading or waiting.
- **Batches and reports.** A batch (a box, a pre-release) is named and
  priced in Review; the draft carries it as `batch: { id, name, pricePaid,
  createdAt }`, created on the first capture (default name `Batch Oct 5`), and
  every draft helper must keep it (`{ ...draft, rows }`). Each Add appends the
  committed cards to `users/{uid}/batches/{id}` (`BatchService`, a
  transaction), with type/rarity/aspects/printing, the market price at that
  moment and whether the card was new to the collection. A line's first
  `isNew` and price stick when the same card is added again. A failed append
  never fails the Add; its lines wait on the batch (`pending`) for a Retry.
  **Only Finish batch ends a batch** -- an Add that empties the list goes back
  to the camera, and closing the scanner keeps the batch open. Finish adds
  any matched cards first, closes the record and opens its report
  (`BatchReport.jsx`, built by the pure `batchReport.js`); rows still in the
  list go into the next batch (`endBatch`). Reports are
  listed under Saved reports/lists → Batches (`BatchesPanel`). CSV imports are
  batches too: **Import cards** (`ImportDialog`) asks Add (additive, like
  scanning) or Replace (sets each card to the file's number) and then opens the
  batch report (`importBatch.js`). A Replace batch holds only the increases;
  decreases are stored as `reductions` and listed under "Quantities lowered".
  A replace that changes nothing files no batch. Export is CSV
  (`batchCsv.js`) and PDF via the browser's print dialog — a print rule in
  `index.css` shows only `#batch-report`. Cards with no price data are listed,
  never counted as $0.
- **One IndexedDB opener.** `appDb.js` opens `swu-holocron` (version 2) and
  creates every store (`cardSets`, `scanPhotos`). A store must never be
  created elsewhere: a module asking for a lower version than another has
  already opened fails with VersionError.
- Commits are **additive** (`increment`), unlike a CSV import in Replace mode,
  which overwrites.
  Committed rows leave the draft after each 400-op chunk, so a retry after a
  mid-commit failure never double-counts.
- The daily limit defaults to 1000 (`DEFAULT_SCAN_DAILY_LIMIT`) and is tuned
  without a redeploy at `config/scanner` → `{ dailyLimit }`. Admins are exempt
  and uncounted.
- `functions/scanCard.js` requires no packages — `HttpsError`, Firestore and
  the Gemini reader are injected — because CI does not install
  `functions/node_modules` and still has to test it
  (`src/test/functions/scanCard.test.js`).
- Functions are deployed by hand
  (`firebase deploy --only functions:scanCard,functions:locateCard`, and
  `functions:adminListUsers,functions:adminGetUserDetail,functions:adminSetRole`
  for user management, whose runtime account also needs
  `roles/firebaseauth.viewer` -- see `docs/FUNCTIONS-RUNTIME-SA.md`); no
  workflow deploys them.
- **Rig calibration.** Users with a fixed scanning rig calibrate once:
  `locateCard` (same pipeline, entitlement and quota as `scanCard`, shared in
  `functions/scanCard.js`) asks Gemini for the card's `box_2d`, the user adjusts
  the corners (`RigCalibration.jsx`), and the result is stored per device in
  `localStorage['swu-scan-rig']` as photo fractions plus the capture source and
  orientation (`src/utils/rigCalibration.js`). Every capture is then cropped to
  that rect plus a 4% margin before scaling to 2048. A capture from a different
  source (photo vs video frame) or orientation is sent full frame instead of
  being cropped to the wrong place. The on-screen guide follows the calibration
  only approximately — the live stream and the still photo can frame
  differently — but the crop is exact because it is applied to the photo.

### Market reports and saved lists

The Command Center's **Market reports** button (the binder's old Value button
is gone) opens a report of what the collection is worth
at today's market prices (`CollectionValueReport.jsx`). The pure model in
`src/utils/collectionValue.js` builds one line per owned collection doc and
holds the filters (set, rarity, type, aspect, printing, finish, priced /
unpriced / minimum price, search), summary, sorting and CSV;
`src/services/collectionValueLoader.js` gathers card details through
`loadSet` (the IndexedDB cache) and prices through
`PricingService.getBulkPrices`. Breakdown rows are shortcuts to filter by
them, and filters persist in `swu-value-filters`. It prints via the batch
report's `#batch-report` id. Only sets the weekly price sync covers are
priced; unpriced cards are listed and the priced share shown, never counted
as $0. The card detail view shows the same prices per card
(`CardPricePanel.jsx`), plus what the user's copies are worth. Reports share
`src/utils/breakdown.js`.

**Surplus mode** (the same report, an All cards / Surplus switch) lists copies
beyond deck use and a playset (`src/utils/surplus.js`): deck usage is summed
across every deck (main, sideboard, leader, base); a deck card takes its
printing's standard copies, then foil; the Normal printing in standard keeps 3
(leader/base 1) and every other printing or finish keeps 1. If the decks can't
be read it shows **no** surplus -- never a list that ignores decks. A **Show
prices** toggle removes every dollar amount from the screen and the exports,
and **Copy as text** gives a trade list for chat (a selectable box when the
clipboard is blocked). Mode and the toggle persist in `swu-value-mode` /
`swu-value-show-prices`.

**Saved reports/lists** (the Command Center's other button,
`SavedListsPage.jsx`) has tabs Batches (moved from the Command Center),
Trade lists and Wants lists. Lists live at `users/{uid}/lists`
(`ListService`); the pure model is `src/utils/cardLists.js`. Items are keyed
`SET_NNN_standard|foil|any` -- a wants item's finish may be `any`, priced at
standard with the pricing service's foil fallback. Trade lists come from
Market reports → Surplus → **Save as trade list** (new, or replacing one);
wants lists from collection gaps (`WantsFromGaps`: the Command Center's
unique-title logic, missing titles or up to a playset), from a deck's Shop
tab (**Save as wants list**), or Add card. Each list is edited in place
(`ListView`: quantity, finish, note, rename) and exports as text, CSV and PDF;
its Show prices choice is stored on the list. Copy as text is escaped and
split for Discord's 2000-character limit (`discordText.js`, `CopyTextButton`:
"Copy part 1 of N"), and list edits are saved together after an 800 ms pause
(flushed on Back and unload).

**Share link** publishes a list at `/list/<code>`: a self-contained copy at
`publicLists/{code}` (`toPublicList`: no owner name, prices only with Show
prices on, frozen as "prices as of"), readable without signing in
(`PublicListView.jsx`, routed in `main.jsx` like `/deck/<slug>`). The copy
can't lean on the card or price database -- both need a signed-in reader. While
shared, `ListView` re-publishes after every change and whenever prices load.
Stop sharing and deleting the list both remove the copy.

### Prebuilt decks

Precon decks (Spotlight, starters, Twin Suns, Intro Battle) are added to a
collection in one tap from the Command Center. No official source publishes
precon contents as data, so they come from **sw-unlimited-db.com**, whose
owner (user **3671**) publishes each precon as it releases:

- `scripts/prebuiltDecks.js` is a step in the weekly card sync. It lists that
  user's published decks (`POST /api/proxy/api/decks/query`, server only) and
  fetches new or edited ones from the deck API
  (`/umbraco/api/deckapi/get?id=`, CORS `*`), which returns exact `SET_NNN`
  printings. It also stores TCGplayer's precon products (via TCGCSV) for each
  deck's product, image and release date. It never fails the sync.
- New decks wait as `review`; nothing reaches collectors until an admin
  publishes it in the **Prebuilt Decks** admin tab. The owner's personal
  decks are marked "Not a precon" once and skipped after that. A deck edited
  at the source becomes `changed` and keeps serving its published list until
  accepted. Older products are backfilled by pasting a deck link (the browser
  fetches it).
- Precons are always the **standard printing**, so cards map to
  `SET_NNN_std`. Adding a deck reuses `ScanService.commitDraft` (additive) and
  records a finished batch with its report (`src/services/prebuiltAdd.js`).
  Cards our database lacks are flagged at review and skipped on add.
- Product matching (`src/utils/prebuiltDecks.js`) needs the same set and a
  shared name word: a shared set alone suggested the SOR starter for the
  owner's personal SOR decks.

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

Coverage thresholds in `vite.config.js` used to be inert: Vitest matches those
keys as globs, and they were written as bare directories (`src/services/`), which
match no files, so `npm run test:ci` passed at any coverage while appearing to
demand 80%. They are now real globs with floors set a few points under the
measured numbers — utils ~89%, contexts ~75%, services ~70%, components ~49%
(and ~45% across the whole repo, which counts `scripts/`, `functions/` and
`Prototype/` at zero). It is a ratchet: **raise a floor when coverage rises,
never lower one to make a run pass.**

`test:unit` and `test:integration` are currently the same command, so "unit" runs
integration tests too. Several suites are deliberately skipped — AdvancedSearch
async init timeout, card-submission integration, the legacy sync-code flow, some
duplicate-detection Firebase-mock tests, three AdminPanel tests. Each skip and
its reason is in `SWU-Holocron/TESTING.md`; read that before "fixing" one.

happy-dom does not lay out or paint, so `getBoundingClientRect` is always 0 there
and CSS bugs are invisible to the suite. Verify those in a browser and record the
measurement.

## Deployment

**Workflows only run from the git root's `.github/workflows/`.** The app's nested
`SWU-Holocron/.github/workflows/` is invisible to GitHub Actions — six workflows
sat there and had never executed once. Anything added there is dead config.
Because the app is one level down, every root workflow job needs
`defaults.run.working-directory: SWU-Holocron`, a `cache-dependency-path` for
`setup-node`, and `HUSKY=0` on `npm ci` (see the install caveat above).

**One live deploy path:** `build-and-push-docker.yml` builds with context
`./SWU-Holocron`, injects `public/version.json` (commit sha, message, build
time) and pushes to `ghcr.io` — then a **second job in the same workflow**, on a
self-hosted runner on the homelab host, runs `docker compose pull web && docker
compose up -d web`. Multi-stage build → nginx with SPA rewrite (`nginx.conf`),
behind a cloudflared tunnel at `swu.holocronlabs.net`. `/version.json` is served
`no-store` with `Access-Control-Allow-Origin: *` so the external deploy
dashboard can poll it.

**There is no Watchtower.** Earlier docs described the host polling for a new
commit every five minutes and rebuilding the image itself; no workflow, compose
file or Dockerfile in this repo has ever contained a Watchtower container. The
deploy is push-triggered and runs seconds after the build, and the host never
builds. When a deploy does not land, check the build job and the runner service
— there is no poller to wait for.

The build only fires on pushes to `main` touching `SWU-Holocron/**`, `Dockerfile`
or that workflow, so a docs-only or workflow-only commit does not deploy. Use
`workflow_dispatch` for those.

**The card sync runs weekly.** `sync-cards.yml` fires Mondays 06:00 UTC,
authenticating keylessly through Workload Identity Federation as `card-sync@`
(`docs/CI-KEYLESS-AUTH.md`) — no secret. It needs `issues: write` as well as
`id-token: write`, because the failure notifier opens an issue and silently 403'd
without it. The cron was enabled 2026-09-26 after a manual run was watched end to
end and came back clean at 51/51 sets and 0 verify issues; the run before that
was not clean, which is what the gate was for.

Pipeline order is seed → scrape → reconcile → **placeholders** → prices →
prebuilt decks → verify. The
placeholder step is what keeps a red run from being permanent: where the catalogue
claims cards no source can describe, it records placeholders instead of failing,
and verify treats that as informational (`src/placeholderCards.js`).

**Not running, and why** — only `DISCORD_WEBHOOK_URL` is configured as a repo
secret:

| Workflow | Blocked on |
|---|---|
| `firebase-hosting-{merge,pull-request}.yml` (still nested, dormant) | `FIREBASE_SERVICE_ACCOUNT_SWU_HOLOCRON_93A18`, plus they'd add a second deploy target alongside the Docker pipeline. |
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
- `localStorage` keys are `swu-`-prefixed: `swu-available-sets`,
  `swu-active-set`, `swu-has-visited`, `swu-sync-code`, `swu-holocron`,
  `swu-scan-draft-{uid}`, `swu-scan-help-seen`, `swu-scan-rig`, `swu-scan-sets`, `swu-scan-auto`,
  `swu-deck-owned-only`, `swu-value-filters`, `swu-value-mode`, `swu-value-show-prices`,
  `swu-saved-lists-tab`.
- Leaders and Bases are horizontal: `aspect-[88/63] col-span-2`. Everything else
  is `aspect-[63/88] col-span-1` (`App.jsx:982`).
- Owned counts render as a dual `3 +2F` — standard count prominent, foil count as
  a smaller yellow badge (`App.jsx:995`).
- Tailwind dark theme throughout (`bg-gray-950`/`bg-gray-900` grounds,
  `text-gray-100` base). Degrade gracefully rather than crashing: show fallback
  data, and always check `db` exists before a Firestore call.

## Known gaps

Long-standing, still true, and each one a reasonable thing to pick up:

- **Error boundaries cover the views, not every component.** `ErrorBoundary.jsx`
  wraps each view in `App.jsx` (keyed on `view`, so navigating clears a crash),
  the card modal and search overlays, and both roots in `main.jsx`. A render
  error inside one view no longer blanks the app. It catches render errors only
  — not event handlers, promises or timers, which React does not route to a
  boundary.
- **No store.** Everything prop-drills from `App.jsx`; collection update callbacks
  are threaded through every component that touches quantities.
- **No memoization on the card grid**, which routinely renders 200+ cards.
- `.animate-shimmer` (the foil effect) is defined in `src/index.css` but
  referenced by no component — dead CSS left from `Prototype/app.jsx`.
- A React Native migration has been scoped but not started, in
  `SWU Holocron - React Native Migration Context.md` and
  `docs/PLATFORM-ARCHITECTURE-DECISION.md`. The platform-coupled spots it cares
  about are the `@environment:` tags above.
