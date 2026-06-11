# SWU Holocron — Deployment Runbook

## Architecture

```
git push → GitHub Actions (ubuntu-latest)
             └─ build-and-push-docker.yml
                ├─ build-and-push job  →  ghcr.io/midknightloki/swu-holocron:latest
                └─ deploy job (self-hosted: nidavellir)
                     └─ docker compose pull web && docker compose up -d web
                          └─ swu-holocron-web container (port 5173)
                               └─ cloudflared tunnel → swu.holocronlabs.net
```

**Key locations on Nidavellir:**
- Compose file: `/opt/swu-holocron/docker-compose.yml`
- Actions runner: `/home/loki/actions-runner/`
- Runner service: `actions.runner.Midknightloki-SWU-Holocron.nidavellir.service`

---

## Workflow Trigger Paths

The build workflow only fires on pushes to `main` that touch:
- `SWU-Holocron/**`
- `Dockerfile`
- `.github/workflows/build-and-push-docker.yml`

**Implication:** commits that only touch root-level docs, other workflow files, or the `homelab-tools/` directory do NOT trigger a build. Use `workflow_dispatch` to force a build in those cases.

---

## Deploy Dashboard

A lightweight status page lives at `homelab-tools/swu-deploy-dashboard/`.

**Setup on Nidavellir:**
```bash
mkdir -p /opt/swu-deploy-dashboard
# Copy index.html and docker-compose.yml from homelab-tools/swu-deploy-dashboard/
cd /opt/swu-deploy-dashboard
docker compose up -d
# Dashboard available at http://nidavellir:8082
```

The dashboard fetches:
- `https://swu.holocronlabs.net/version.json` — what's deployed (written at build time)
- GitHub API for the latest `main` commit — what exists
- Cloudflare cache headers from the response

---

## Discord Notifications

### Setup
1. In your Discord server: **Server Settings → Integrations → Webhooks → New Webhook**
2. Choose the channel, copy the URL
3. In GitHub repo: **Settings → Secrets → Actions → New repository secret**
   - Name: `DISCORD_WEBHOOK_URL`
   - Value: the webhook URL

### Notifications you'll receive
| Event | Color |
|---|---|
| 🔨 Build failed (no image pushed) | Red |
| 🚀 Deployed successfully | Green |
| ❌ Deploy failed (image built, nidavellir step failed) | Red |

---

## Incident: Silent Deploy Failure (2026-06-05 → 2026-06-10)

### What happened
Commits merged to `main` after `52313ce` (`CardPickerModal.jsx`, `DeckBuilder.jsx`) did not appear in production for 5 days.

### Root cause
The `build-and-push` job on GitHub's hosted runners either failed silently or encountered an issue before pushing a new image to GHCR. Without Discord notifications on the build job, there was no alert. The runner on Nidavellir was healthy and listening the entire time — the problem was upstream.

The `$(date -u +'%Y-%m-%dT%H:%M:%SZ')` shell substitution in `build-args` does not evaluate in the GitHub Actions YAML context (it's passed as a literal string). This was removed in the updated workflow.

### How it was diagnosed
1. `docker events` on Nidavellir showed no pull/restart since Jun 5
2. `docker pull ghcr.io/midknightloki/swu-holocron:latest` confirmed GHCR still had the Jun 5 image
3. `git diff --name-only 52313ce HEAD` confirmed files changed DO match the paths filter — the problem was in the build job, not the trigger

### What was fixed
- Added Discord notifications to the **build job** (not just deploy)
- Removed `BUILD_DATE=$(date ...)` from `build-args` (shell substitution doesn't work in YAML)
- Added `version.json` generation so future failures are immediately visible on the dashboard

---

## Manual Deploy Procedures

### Force a build + deploy (when commits exist but never built)
Go to: **GitHub → Actions → Build and Push Docker Image to GHCR → Run workflow**

This uses `workflow_dispatch` to bypass the paths filter and kick off a full build + deploy.

### Force redeploy of whatever is on GHCR (when build succeeded but deploy job failed)
SSH into Nidavellir and run:
```bash
cd /opt/swu-holocron
docker compose pull web
docker compose up -d web
```

### Check what's actually running
```bash
# On Nidavellir — check image revision vs GitHub HEAD
docker inspect swu-holocron-web --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'

# Compare to GitHub:
curl -s https://api.github.com/repos/Midknightloki/SWU-Holocron/commits/main | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['sha'][:7], d['commit']['message'].split('\n')[0])"
```

### Check runner health
```bash
systemctl status actions.runner.Midknightloki-SWU-Holocron.nidavellir.service
journalctl -u 'actions.runner.*' -n 20 --no-pager
```

### Purge Cloudflare cache (if new deploy isn't showing)
```bash
# Via Cloudflare dashboard: Caching → Configuration → Purge Everything
# Or via API (requires CF_ZONE_ID and CF_API_TOKEN):
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

---

## version.json

After the first build post-runbook, `https://swu.holocronlabs.net/version.json` returns:
```json
{
  "sha": "3c3573d...",
  "short_sha": "3c3573d",
  "ref": "main",
  "message": "Merge pull request #6...",
  "author": "Midknightloki",
  "built_at": "2026-06-10T00:00:00Z",
  "run_id": "12345678"
}
```

If this endpoint returns 404, no deploy has run since the version.json change was introduced.
