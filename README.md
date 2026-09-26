# 🌌 SWU Holocron

> A collection manager and deck builder for **Star Wars™: Unlimited**, the trading card game by Fantasy Flight Games.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-enabled-brightgreen.svg)](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
[![Firebase](https://img.shields.io/badge/Firebase-powered-orange.svg)](https://firebase.google.com/)

## Overview

SWU Holocron is an offline-first Progressive Web App for tracking a Star Wars:
Unlimited collection and building decks from it. Card data is stored locally and
in Firestore, so the app keeps working without a connection and never depends on
a live third-party API at runtime.

Live at **[swu.holocronlabs.net](https://swu.holocronlabs.net)**.

## Features

**Collection**
- Track owned quantities per card across every set, standard and foil separately
- Completion stats: percentage, playsets, missing cards
- CSV import and export, round-trip compatible with Moxfield and Archidekt
- Quantity controls are inline everywhere cards appear — the grid, the card
  modal, the missing-cards table and the deck builder's shopping list. There is
  deliberately no separate "manage collection" screen.

**Search**
- Relevance-ranked search over name, subtitle, rules text, traits and keywords
- Filter by aspect, card type, set and cost range

**Deck building**
- Format validation for Premier, Eternal, Twin Suns and Trilogy: deck size,
  leader count, copy limits, singleton rules, rotation and the banned list
- Cost curve and aspect breakdown
- Version snapshots, game logs and win/loss records per deck
- Deck list import and export (SWUDB, Forcetable, Melee, swu.com text)
- Publicly shareable deck links
- A shopping list of what a deck needs that you do not own, with optional
  TCGplayer pricing
- AI card suggestions, ranked by what you own, aspect fit, traits, set proximity
  and a deck concept you describe in your own words

**Sync and offline**
- Firestore-backed, live across devices
- Google sign-in, or guest mode for local-only use
- Installable as a PWA; works offline after first load

**Administration**
- Card database seeding, verification and sync logs
- Community card submissions with duplicate detection
- Contributor invites by one-time code

## Quick start

### Users

Open [swu.holocronlabs.net](https://swu.holocronlabs.net), then install it from
your browser's menu to use it offline.

To bring an existing collection across, export it from Moxfield or Archidekt as
CSV and import that file from the collection view.

### Developers

Requires **Node 20+**.

Note the repository layout: the git root holds ops and documentation, and the
application lives one level down in `SWU-Holocron/`. All npm commands run from
there.

```bash
git clone https://github.com/Midknightloki/SWU-Holocron.git
cd SWU-Holocron/SWU-Holocron
npm install
npm run dev            # http://localhost:5173
```

`npm install` exits non-zero on its `prepare` step, which runs `husky install`
and cannot find `.git` from the nested directory. Dependencies still install.
Set `HUSKY=0` to silence it. The consequence is that the git hooks have never
been active, so **run `npm run lint` and `npx vitest run` yourself before
pushing** — CI is the only gate.

Firebase configuration lives in `src/firebase.js`. See
[FIREBASE-SETUP-GUIDE.md](./SWU-Holocron/docs/FIREBASE-SETUP-GUIDE.md) to point
it at your own project.

## Technology

| Layer | Choice |
|---|---|
| UI | React 18, Vite, Tailwind CSS, Lucide icons |
| Data | Cloud Firestore, Firebase Authentication |
| Server code | One Cloud Function (`getCardSuggestions`, Gemini via Vertex AI) and one for redeeming invites |
| Offline | vite-plugin-pwa, Workbox, localStorage |
| Testing | Vitest, Testing Library, happy-dom |
| Hosting | Docker image on GHCR → container on a self-hosted host → Cloudflare Tunnel |

There is no router: `App.jsx` holds a view string and switch-renders. There is
no state store; state is prop-drilled from `App.jsx`.

A `dataconnect/` directory and generated Data Connect SDKs exist in the tree but
no application code imports them.

## Scripts

All from `SWU-Holocron/`:

| Script | Description |
|---|---|
| `npm run dev` | Dev server on :5173 |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve `dist/` on :5173 |
| `npm test` | Vitest in watch mode |
| `npm run test:unit` | Single run |
| `npm run test:ci` | Single run with coverage |
| `npm run test:changed` | Only tests for changed files |
| `npm run lint` | ESLint |
| `npm run admin:seed-cards` | Write the card database to Firestore |
| `npm run admin:verify-db` | Integrity check |

Admin scripts need `firebase-admin-key.json` or `FIREBASE_SERVICE_ACCOUNT`.

## Testing

Run from `SWU-Holocron/`:

```bash
npx vitest run          # whole suite, once
npm test                # watch mode
npm run test:ci         # with coverage
```

Coverage as measured, rather than as aspired to:

| Area | Line coverage |
|---|---|
| `src/utils/` | ~89% |
| `src/contexts/` | ~75% |
| `src/services/` | ~70% |
| `src/components/` | ~49% |
| Whole repo, including scripts and functions | ~45% |

The thresholds configured in `vite.config.js` do not currently enforce anything
— see [TESTING.md](./SWU-Holocron/TESTING.md), which also lists the suites that
are skipped and why.

## CI/CD

Workflows live in `.github/workflows/` at the **git root**. GitHub Actions does
not read the nested `SWU-Holocron/.github/workflows/`, so anything placed there
never runs.

| Workflow | What it does |
|---|---|
| `ci.yml` | Lint, unit tests, build, Firestore rules tests against the emulator |
| `build-and-push-docker.yml` | Builds the image, pushes to GHCR, then a self-hosted runner pulls and restarts the container |
| `deploy-firestore-rules.yml` | Publishes `firestore.rules`, gated on the emulator tests passing |
| `sync-cards.yml` | Refreshes the card database from swu-db and the official card site. Manual only: its weekly schedule stays commented out until one manual run has been watched end to end. |

Deployment details, manual procedures and past incidents are in the
[deployment runbook](./SWU-Holocron/docs/DEPLOYMENT_RUNBOOK.md).

## Documentation

- **[CLAUDE.md](./CLAUDE.md)** — architecture reference: data model, services,
  conventions, house rules, known gaps. Start here to work on the code.
- **[DEPLOYMENT_RUNBOOK.md](./SWU-Holocron/docs/DEPLOYMENT_RUNBOOK.md)** — how
  deploys work, how to force one, how to diagnose a failed one
- **[TESTING.md](./SWU-Holocron/TESTING.md)** — test layout, conventions, skips
- **[CARD-DATABASE-ARCHITECTURE.md](./SWU-Holocron/docs/CARD-DATABASE-ARCHITECTURE.md)** — card data sources and sync
- **[SWU-RULES-AND-FORMATS.md](./SWU-Holocron/docs/SWU-RULES-AND-FORMATS.md)** — game rules reference
- **[CI-KEYLESS-AUTH.md](./SWU-Holocron/docs/CI-KEYLESS-AUTH.md)** — Workload Identity Federation setup for CI
- **[PLATFORM-ARCHITECTURE-DECISION.md](./SWU-Holocron/docs/PLATFORM-ARCHITECTURE-DECISION.md)** — multi-platform strategy

## Contributing

1. Branch from `main`
2. Write a failing test first — this is the project's stated workflow
3. `npm run lint` and `npx vitest run` must pass; keep ESLint **errors** at zero
   (there is a warning backlog, and CI gates on errors only)
4. Open a pull request

## Known limitations

- Card images load from an external CDN, so they need a connection even though
  card data does not
- The card database updates only when someone runs the sync; there is no
  schedule yet
- `localStorage` card caches have no expiry, so a re-seed may not be visible
  until a forced reload
- Guest mode is local to one browser; nothing syncs until you sign in
- iOS Safari supports a reduced set of PWA features
- No error boundaries: a render error in any component blanks the app

Report bugs via [GitHub Issues](https://github.com/Midknightloki/SWU-Holocron/issues).

## License

MIT — see the LICENSE file.

## Disclaimer

An unofficial, fan-made application. Star Wars™ and Star Wars: Unlimited™ are
trademarks of Lucasfilm Ltd. and Fantasy Flight Games. This project is not
affiliated with, endorsed by or sponsored by either.

Card data comes from community-maintained sources and the official card site,
and may lag the most current official information.

## Acknowledgments

- **Fantasy Flight Games** — for Star Wars: Unlimited
- **SWU-DB** — for the community card API
- **Karabast.net** — for additional card data
