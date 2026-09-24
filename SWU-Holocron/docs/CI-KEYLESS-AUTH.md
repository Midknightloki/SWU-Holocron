# Keyless CI Authentication (Workload Identity Federation)

**Status:** Draft — not yet executed
**Supersedes:** the `FIREBASE_SERVICE_ACCOUNT` secret assumed by Phase 0/2 of
`docs/superpowers/specs/2026-09-24-cicd-and-architecture-repair-design.md`

## Why

The card-sync pipeline needs Firestore write access from GitHub Actions. The
original plan stored a downloaded service-account JSON key in two places
(Infisical and GitHub secrets). Two things changed that:

1. Service-account key creation is blocked by the organization policy
   `constraints/iam.disableServiceAccountKeyCreation`, enforced by default for
   organizations created on or after 2024-05-03.
2. The pre-existing service account
   (`github-action-1121877074@swu-holocron-93a18.iam.gserviceaccount.com`,
   created by `firebase init hosting:github`) is unusable for this anyway — it
   holds Hosting/Auth/Functions roles and **no Firestore role**. Its key is also
   unrecoverable; Google returns private key material only once, at creation.

Workload Identity Federation removes the credential entirely. GitHub Actions
mints a short-lived OIDC token, Google exchanges it for a short-lived access
token, and nothing long-lived is ever stored.

## What this creates

| Resource | Name |
|---|---|
| Service account | `card-sync@swu-holocron-93a18.iam.gserviceaccount.com` |
| Role | `roles/datastore.user` — Firestore read/write only |
| Workload identity pool | `github` |
| OIDC provider | `github-oidc` |
| Trust boundary | only `Midknightloki/SWU-Holocron` may impersonate |

**Scope honesty:** `roles/datastore.user` grants read/write to *all* Firestore
in the project, not just `artifacts/{APP_ID}/public/data/cardDatabase/**`. IAM
cannot scope to document paths — Firestore security rules do not apply to the
Admin SDK, which bypasses them by design. This is still far narrower than the
old account (no Authentication Admin, no Hosting Admin) and has no
extractable credential, but it is not path-scoped and should not be described
as such.

---

## Step 1 — Run the setup (once)

You must run these; they need credentials this environment doesn't have.
Authenticate first with `gcloud auth login`.

```bash
PROJECT_ID=swu-holocron-93a18
REPO=Midknightloki/SWU-Holocron
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
echo "Project number: $PROJECT_NUMBER"   # needed in Step 3

# APIs required for token exchange
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com \
  --project="$PROJECT_ID"

# Dedicated least-privilege identity for the card sync
gcloud iam service-accounts create card-sync \
  --project="$PROJECT_ID" \
  --display-name="Card database sync (GitHub Actions)"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:card-sync@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

# Workload identity pool + GitHub OIDC provider
gcloud iam workload-identity-pools create github \
  --project="$PROJECT_ID" --location=global \
  --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc github-oidc \
  --project="$PROJECT_ID" --location=global \
  --workload-identity-pool=github \
  --display-name="GitHub OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository_owner == 'Midknightloki'"

# Allow ONLY this repo to impersonate the service account
gcloud iam service-accounts add-iam-policy-binding \
  "card-sync@${PROJECT_ID}.iam.gserviceaccount.com" \
  --project="$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${REPO}"
```

**The attribute condition is load-bearing.** Without
`assertion.repository_owner == 'Midknightloki'`, *any* GitHub repository on
the public runners could present a token to your pool. The `principalSet`
binding narrows it further to this one repo. Keep both — they are defence in
depth, not redundancy.

## Step 2 — Teach the scripts to use ADC

All four data scripts (`seedCardDatabase.js`, `scrapeOfficialCards.js`,
`mergeCardSources.js`, `verifyCardDatabase.js`) currently duplicate the same
block, which only understands an inline JSON blob or a local key file:

```js
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
}
admin.default.initializeApp({ credential: admin.default.credential.cert(serviceAccount) });
```

Neither path exists under WIF, where credentials arrive as Application Default
Credentials. Replace the duplicated block with one shared helper —
`scripts/firebaseAdmin.js`:

```js
/**
 * Shared firebase-admin bootstrap for the data scripts.
 *
 * Credential resolution, in order:
 *   1. FIREBASE_SERVICE_ACCOUNT   inline JSON (legacy CI path, kept for fallback)
 *   2. Application Default Creds  Workload Identity Federation in CI, or
 *                                 `gcloud auth application-default login` locally
 *   3. firebase-admin-key.json    legacy local key file
 *
 * @environment:firebase
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'swu-holocron-93a18';

export async function initFirestore() {
  const admin = (await import('firebase-admin')).default;
  if (admin.apps.length) return admin.firestore();

  let credential = null;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  } else {
    try {
      credential = admin.credential.applicationDefault();
    } catch {
      try {
        const keyPath = join(__dirname, '..', 'firebase-admin-key.json');
        credential = admin.credential.cert(JSON.parse(readFileSync(keyPath, 'utf8')));
      } catch {
        console.error('No Firebase credentials available.');
        console.error('  In CI this comes from Workload Identity Federation.');
        console.error('  Locally run: gcloud auth application-default login');
        process.exit(1);
      }
    }
  }

  admin.initializeApp({ credential, projectId: PROJECT_ID });
  return admin.firestore();
}
```

Then each script becomes `const db = await initFirestore();`.

This removes four copies of the same logic, and it is why the change is worth
making as a helper rather than four edits: the next credential change touches
one file.

**Local development improves too.** `gcloud auth application-default login`
replaces downloading `firebase-admin-key.json`, so no key file needs to exist
on your machine either. The legacy branches stay only so an existing local key
keeps working during the transition; both can be deleted later.

## Step 3 — Workflow changes

In `.github/workflows/sync-cards.yml`, replace the service-account-file steps
with the auth action. The `id-token: write` permission is what lets GitHub mint
the OIDC token — without it the step fails with a confusing credential error.

```yaml
permissions:
  contents: read
  id-token: write        # REQUIRED for OIDC

jobs:
  sync-cards:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: SWU-Holocron
    env:
      HUSKY: 0
    steps:
      - uses: actions/checkout@v4

      - uses: google-github-actions/auth@v3
        with:
          project_id: swu-holocron-93a18
          workload_identity_provider: projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github/providers/github-oidc
          service_account: card-sync@swu-holocron-93a18.iam.gserviceaccount.com

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: SWU-Holocron/package-lock.json

      - run: npm ci
      - run: node scripts/seedCardDatabase.js
```

Substitute the real `<PROJECT_NUMBER>` from Step 1. The action writes a
credentials file and exports `GOOGLE_APPLICATION_CREDENTIALS`, which
`applicationDefault()` picks up with no further configuration.

**Delete these steps** — they exist only to handle the key file:

- "Create Firebase service account file" (writes `firebase-admin-key.json`)
- "Clean up service account file"

The repository needs **no new secrets**. `FIREBASE_SERVICE_ACCOUNT` is never
created.

### Runner placement

The scrape stage drives Playwright against the official site. A stable homelab
IP is less likely to trip rate limits than rotating GitHub-hosted runner IPs,
so `runs-on: self-hosted` is worth considering for that stage. WIF works
identically on self-hosted runners — the OIDC token comes from GitHub Actions,
not the runner. Decide this independently of auth.

## Step 4 — Verify before scheduling

Do not enable the cron until a manual run has been observed to write correctly.

1. Push the branch and trigger the workflow via **Actions → Run workflow**.
2. Confirm the auth step reports the federated identity.
3. Confirm the seeder writes, then run `node scripts/verifyCardDatabase.js`.
4. Only then uncomment the schedule in `sync-cards.yml`.

Expected failure modes:

| Symptom | Cause |
|---|---|
| `Unable to acquire impersonated credentials` | `principalSet` repo path doesn't match, or pool/provider name typo |
| `The caller does not have permission` on write | `roles/datastore.user` binding missing or still propagating |
| `id-token` / OIDC errors | `permissions: id-token: write` missing from the job |
| Auth works, writes fail | wrong `projectId` — check `GOOGLE_CLOUD_PROJECT` |

## Step 5 — Clean up the orphaned account

Independent of the above, and worth doing regardless.

`github-action-1121877074@swu-holocron-93a18.iam.gserviceaccount.com` holds
**Firebase Authentication Admin** (it can manage your end users) and
**Firebase Hosting Admin**. Its key was created by `firebase init
hosting:github` and its whereabouts are unknown — the matching GitHub secret
`FIREBASE_SERVICE_ACCOUNT_SWU_HOLOCRON_93A18` no longer exists on the repo.

1. Check its **Keys** tab in the console. Delete any key you cannot account for.
2. Since Firebase Hosting is a non-goal (Docker/GHCR is the deploy path),
   consider deleting the service account entirely, along with the dormant
   `firebase-hosting-{merge,pull-request}.yml` workflows.

An untracked key with Authentication Admin is the single riskiest loose end in
this cleanup, and it is unrelated to the card sync.

---

## References

- [google-github-actions/auth](https://github.com/google-github-actions/auth) — v3.0.0
- [Security considerations](https://github.com/google-github-actions/auth/blob/main/docs/SECURITY_CONSIDERATIONS.md) — why the attribute condition matters
- [Best practices for managing service account keys](https://docs.cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys)
- [Secure-by-default organization resources](https://cloud.google.com/resource-manager/docs/secure-by-default-organizations)
