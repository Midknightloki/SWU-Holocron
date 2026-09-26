# Functions runtime service account

> **This is a two-part change and the parts must go together.** The code in
> `functions/index.js` now names a dedicated runtime service account. Until the
> commands in Step 1 have been run, `firebase deploy --only functions` will fail
> because that account does not exist. A failed deploy leaves the currently
> running functions untouched, so the failure mode is loud and safe — but do
> Step 1 first.

## The problem

Both Gen 2 functions run as the project's **default compute service account**:

```
151643530726-compute@developer.gserviceaccount.com
```

which holds a single role:

```
roles/editor
```

`roles/editor` is project-wide write access: every Firestore document, every
bucket, every service. `getCardSuggestions` needs to call one Vertex AI model and
`redeemInviteCode` needs to read one document and write two. Neither needs
anything close to that.

This is not a hypothetical. `getCardSuggestions` passes user-supplied deck text to
a language model and acts on the reply. That is exactly the shape of code that
should hold the narrowest credentials in the project, not the widest.

Verified with:

```bash
gcloud functions list --project=swu-holocron-93a18 \
  --format="table(name,environment,serviceConfig.serviceAccountEmail)"

gcloud projects get-iam-policy swu-holocron-93a18 \
  --flatten="bindings[].members" \
  --filter="bindings.members:151643530726-compute@developer.gserviceaccount.com" \
  --format="value(bindings.role)"
```

## Why a new account, rather than stripping the old one

Do **not** remove `roles/editor` from the default compute account. It is the
default identity for other things in the project — anything running on Cloud Run
or Compute Engine that was deployed without an explicit service account. Removing
it could break something unrelated and unobvious.

A dedicated account for these two functions is both narrower and safer: nothing
else uses it, so nothing else can be affected.

## Step 1 — create the account and grant it what it needs

```bash
PROJECT=swu-holocron-93a18
SA=swu-functions@${PROJECT}.iam.gserviceaccount.com

gcloud iam service-accounts create swu-functions \
  --project="$PROJECT" \
  --display-name="SWU Holocron Cloud Functions runtime"

# Firestore read/write for redeemInviteCode (Admin SDK).
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA}" \
  --role="roles/datastore.user"

# Vertex AI predictions for getCardSuggestions.
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA}" \
  --role="roles/aiplatform.user"

# So the functions can write their own logs.
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA}" \
  --role="roles/logging.logWriter"
```

Then let the deployer act as that account. `firebase deploy` runs as you, and
setting a runtime service account on a Cloud Run service requires
`iam.serviceAccounts.actAs` on it:

```bash
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --project="$PROJECT" \
  --member="user:midknightloki@gmail.com" \
  --role="roles/iam.serviceAccountUser"
```

Confirm the three roles landed:

```bash
gcloud projects get-iam-policy "$PROJECT" \
  --flatten="bindings[].members" \
  --filter="bindings.members:${SA}" \
  --format="value(bindings.role)"
```

## Step 2 — deploy

```bash
cd SWU-Holocron
firebase deploy --only functions
```

`functions/index.js` passes the account through `setGlobalOptions`, so both
functions pick it up and it survives future deploys — unlike a
`gcloud run services update`, which the next `firebase deploy` would overwrite.

## Step 3 — verify it took, and that both functions still work

```bash
gcloud functions list --project=swu-holocron-93a18 \
  --format="table(name,serviceConfig.serviceAccountEmail)"
```

Both rows should now read `swu-functions@…`.

Then exercise each one, because this is the only way to find a missing permission:

1. **AI suggestions** — open a deck in the deck builder and ask for suggestions.
   A failure here means `roles/aiplatform.user` did not apply, or the region in
   `GOOGLE_CLOUD_LOCATION` is not enabled for the model.
2. **Invite redemption** — issue a code in the admin panel and redeem it from a
   second Google account. A failure here means `roles/datastore.user` did not
   apply.

Logs for either:

```bash
gcloud functions logs read getCardSuggestions --project=swu-holocron-93a18 --limit=30
gcloud functions logs read redeemInviteCode  --project=swu-holocron-93a18 --limit=30
```

A permission problem shows up as `PERMISSION_DENIED` naming the permission it
wanted, which tells you exactly which role to add.

## Rolling back

Remove the `serviceAccount` line from `setGlobalOptions` in `functions/index.js`
and redeploy. The functions return to the default compute account. The
`swu-functions` account can then be deleted, though leaving it costs nothing.

## What was deliberately not granted

- **`roles/firebaseauth.admin`** — not needed. The callable verifies the caller's
  ID token against Google's public certificates over HTTPS; that is not an IAM
  operation.
- **`roles/iam.serviceAccountTokenCreator`** — only required for minting custom
  tokens or signing blobs, neither of which these functions do.
- **Artifact Registry read** — the Cloud Run service agent pulls the image, not
  the runtime account.

If a future function needs any of these, add it to that function rather than
widening this account.
