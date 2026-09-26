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

---

## Watchtower is not involved

Earlier documentation described deploys as: push to Gitea, Watchtower notices
within five minutes, the host rebuilds the Docker image. None of that is true and
none of it ever was in this repository's workflows. There is no Watchtower
container, and no reference to one in any compose file, workflow or Dockerfile.

What actually happens is the diagram at the top: GitHub Actions builds the image
on a hosted runner and pushes it to GHCR, then a **second job on the self-hosted
runner** pulls that image and restarts the container. The host never builds, and
nothing polls on a timer — the deploy is part of the same workflow run, so it
starts seconds after the build finishes, not minutes.

This matters when a deploy does not land: the thing to check is the build job and
the runner service, not a poller.

---

## Rollback

```bash
git log --oneline | head -5           # find the bad commit
git revert <sha>
git push origin main                  # this rebuilds and redeploys
```

A revert only rebuilds if it touches a path in the trigger filter above. If it
does not, force one with `workflow_dispatch`.

To go back faster without waiting for a build, redeploy the previous image by
digest on the host:

```bash
docker image ls ghcr.io/midknightloki/swu-holocron --digests
cd /opt/swu-holocron
# Pin the digest in docker-compose.yml, then:
docker compose up -d web
```

---

## Post-deploy verification

```bash
curl -s https://swu.holocronlabs.net/version.json      # sha should match main
```

Then in the browser console (F12), a healthy load shows:

```
Setting up collection listener - uid: <uid> mode: user
✓ Loaded <n> cards from Firestore (SOR)
Collection updated: <n> items
```

And should show none of:

```
Invalid collection reference ... 6 segments        # Firestore path arity
Missing or insufficient permissions               # rules not deployed
```

Functionally: sign in, pick a set, add a card, reload, confirm the count
persisted.

---

## Cloudflare Tunnel

The tunnel runs as its own container beside the app and is the only public route
in. It is independent of the app deploy, so a tunnel fault looks like a site
outage even though the deploy succeeded.

### 502s, or the connection dropping every few minutes

QUIC over UDP is unstable on this network. The tunnel must run over HTTP/2.

```bash
docker logs swu-holocron-tunnel | grep -E 'timeout.*no recent network activity|QUIC'   # the bad sign
docker logs swu-holocron-tunnel | grep 'protocol=http2'                                 # the good sign
```

`docker-compose.yml` needs:

```yaml
tunnel:
  command: tunnel run --protocol http2
```

Then `docker compose up -d tunnel`.

### Tunnel not connecting at all

`Failed to dial a quic connection` in the logs. Check `TUNNEL_TOKEN` is set in
`.env`, confirm the HTTP/2 setting above, then
`docker compose restart tunnel`.

```bash
docker logs swu-holocron-tunnel | grep -E 'ERR|WRN|Failed|Registered'
```

---

## Vestigial configuration

`vite.config.js` sets `server.allowedHosts` and `preview.allowedHosts` to include
`swu.holocronlabs.net`. That was load-bearing when the container ran
`vite preview` against a git checkout on the host. It is not any more: the image
is a multi-stage build whose final stage is **nginx serving static `dist/`**
(`Dockerfile`, `nginx.conf`), and nginx has no host allowlist. The Vite settings
now only affect local `npm run dev` and `npm run preview`.

So a `Blocked request. This host is not allowed.` error in production would mean
something is serving the app through Vite, which is itself the bug.

---

## Firestore rules

Rules are no longer deployed by hand. `deploy-firestore-rules.yml` publishes them
on a push to `main` that changes `SWU-Holocron/firestore.rules`, and only after
the emulator rules tests pass. See that workflow, and `src/test/rules/`.

To publish out of band:

```bash
cd SWU-Holocron
firebase deploy --only firestore:rules
```
