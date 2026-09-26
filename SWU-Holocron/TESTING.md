# Testing

Vitest with Testing Library, in the `happy-dom` environment. All commands run
from `SWU-Holocron/` (the nested application directory, not the git root).

```bash
npx vitest run                  # whole suite, once
npm test                        # watch mode
npm run test:ci                 # once, with a coverage report
npm run test:changed            # only tests affected by changed files
npm run test:rules              # Firestore rules, against the emulator

npx vitest run src/test/services/CardService.test.js     # one file
npx vitest run -t "should generate a unique collection ID" # one test
npx vitest related --run src/utils/csvParser.js           # what lint-staged would run
```

`test:unit` and `test:integration` are **the same command** — both are
`vitest run --reporter=verbose` over everything. "Run only the unit tests" is not
currently a thing you can do.

## Where tests live

Two places, for historical reasons. Check both before concluding something is
untested.

| Location | Contents |
|---|---|
| `src/test/utils/` | 13 files — pure functions |
| `src/test/services/` | 6 files |
| `src/test/components/` | 5 files — the older component tests |
| `src/test/contexts/` | 1 file — `AuthContext` |
| `src/test/integration/` | 10 files |
| `src/test/rules/` | 1 file — Firestore rules, emulator only |
| `src/components/__tests__/` | 7 files — the newer deck-feature components |

`src/test/fixtures/` holds recorded API payloads; `src/test/utils/mockData.js`
holds hand-written fixtures.

### Conventions

- **A test file containing JSX must be named `.jsx`**, or esbuild will not parse
  it. Every current JSX test file follows this.
- `src/test/setup.js` globally mocks `../firebase` to
  `{ auth: null, db: null, isConfigured: false }` and stubs `localStorage`. Any
  code path that needs a real `db` must be mocked per-test.
- When you add a method to a service, **add it to that service's mocks too**.
  Component tests mock whole service objects, so a new method is `undefined`
  inside them, and an unhandled rejection from it can pass locally and fail in
  CI on timing.

## Coverage

Measured, as of the last run:

| Area | Lines |
|---|---|
| `src/utils/` | ~89% |
| `src/contexts/` | ~75% |
| `src/services/` | ~70% |
| `src/components/` | ~49% |
| Whole repo, including `scripts/`, `functions/` and `Prototype/` | ~45% |

### The thresholds are a ratchet

They enforce, as of the fix below. They used to be decorative: Vitest matches
threshold keys as **globs**, and they were written as bare directories
(`'src/services/'`), which match no files. So `npm run test:ci` passed at any
coverage at all while appearing to demand 80%.

They are now `src/utils/**`, `src/services/**`, `src/contexts/**` and
`src/components/**`, with each floor a few points under what the suite actually
achieves. That catches a regression without failing today.

**Raise a floor when you raise the coverage. Do not lower one to make a run go
green** — that is how the numbers became decorative the first time.

The gate was verified in both directions: the real floors pass, and a deliberately
impossible one fails with
`ERROR: Coverage for lines (89.1%) does not meet "src/utils/**" threshold (99%)`
and exit 1.

## Environment tags

Comments marking platform coupling, so the React Native migration can find it.
Worth preserving and extending:

`@environment:firebase`, `@environment:firebase-emulator`,
`@environment:web-file-api`, `@environment:web-localstorage`,
`@environment:react`, `@environment:web`, `@environment:none`, plus
`@critical`.

## Firestore rules tests

`npm run test:rules` runs `firebase emulators:exec` against a throwaway project
id and executes `src/test/rules/` with its own Vitest config
(`vitest.rules.config.js`). It needs a JDK — CI installs Temurin 21.

These tests are the reason `firestore.rules` can be deployed automatically:
`deploy-firestore-rules.yml` publishes rules only after they pass.

`@firebase/rules-unit-testing` is pinned to **3.0.4**. Version 5 requires
`firebase@^12` and this project is on `^10`.

## Skipped suites, and why

Read this before "fixing" a skip. Each one was examined and left off
deliberately.

| Skipped | Why |
|---|---|
| `src/components/__tests__/AdvancedSearch.test.jsx` — one `describe.skip` | The component's async initialization does not settle inside the test timeout. The failures were timeouts, not assertions; the non-skipped tests in the same file cover the search behaviour. |
| `src/test/integration/cardSubmission.test.jsx` — whole suite | Needs an App-level harness that does not exist: the real routing, the full context provider chain, and Firebase initialization mocked deeply enough to render the submission flow end to end. |
| `src/test/integration/syncCodeEntry.test.jsx` — whole suite | Tests the legacy sync-code flow, which Google SSO replaced. Kept rather than deleted because `MigrationService` still has to migrate those collections. |
| `src/test/utils/duplicateDetection.test.js` — 3 tests | Firebase mock setup: the assertions depend on query call counts and ordering the mock does not reproduce. The functions themselves are covered by the other 15 tests in the file. |
| `src/test/components/AdminPanel.test.jsx` — 3 tests | Depend on sync metadata and log documents that the mocked Firestore does not return. |

The common thread in the integration skips is that there is no shared test
harness for "render the real app with real routing". Building one is the
prerequisite for un-skipping them, and it is a larger job than any individual
skip suggests.

## Git hooks

They run, as of the fix described below. Before it they existed as files and had
never once executed.

| Hook | Runs |
|---|---|
| `pre-commit` | `lint-staged`: `eslint --fix` and `vitest related --run` on staged `.js`/`.jsx` |
| `pre-push` | `npm run test:unit` |

`npm install`'s `prepare` step used to run `husky install` from `SWU-Holocron/`,
which has no `.git` — that lives one level up at the git root — so it failed, no
`.husky/_` shim was written, and `core.hooksPath` was never set. `prepare` is now
`cd .. && husky install SWU-Holocron/.husky`.

Git runs hooks from the top level of the working tree, so each hook `cd`s into
`SWU-Holocron` before doing anything. Anything you add to them must too.

A fresh clone needs one `npm install` before the hooks exist, and `HUSKY=0`
skips the install (CI does this). So **CI is still the authoritative gate** — the
hooks are a convenience that catches things earlier, not a guarantee.

## CI

`.github/workflows/ci.yml`, at the **git root** — GitHub Actions does not read
the nested `SWU-Holocron/.github/workflows/`. Every job needs
`defaults.run.working-directory: SWU-Holocron`, a `cache-dependency-path` for
`setup-node`, and `HUSKY=0` on `npm ci`.

Jobs: lint, test, build, and `rules-tests` (which installs a JDK for the
emulator).

The lint gate is deliberately `eslint src --ext js,jsx --quiet` — **errors only**.
Warnings are reported but do not fail the build, because there is a large
inherited backlog (`react/prop-types`, `no-unused-vars`, `no-console`,
`react-hooks/exhaustive-deps`). Keeping errors at zero is the actual contract.

Codecov upload is configured without `CODECOV_TOKEN`. The repository is public so
tokenless upload works, and `fail_ci_if_error` is off, so it cannot fail a build
either way.

## Writing tests here

The project's stated workflow is test-first: a failing test, the minimum
implementation, then refactor against a green suite.

Two things happy-dom cannot do, so do not try to test them here:

- **Layout.** `getBoundingClientRect` and `offsetHeight` are always 0, so CSS
  bugs — a collapsed flex height, a sticky offset — are invisible to the suite.
  Verify those in a browser and record the measurement in the commit message.
- **Painting.** Compositing and rasterization artifacts are not observable from
  JavaScript at all.
