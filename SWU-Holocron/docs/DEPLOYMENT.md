# Deployment Documentation

## Overview

SWU Holocron is deployed as a Docker container on the `Nidavellir` host within the HomeLab infrastructure. It is accessible via Cloudflare Tunnel.

- **Production URL:** [https://swu.holocronlabs.net](https://swu.holocronlabs.net)
- **Host:** Nidavellir (192.168.1.30)
- **Infrastructure Project:** [Mimir](../../../Mimir/README.md)

## Current Deployment Status

**Active Deployment**: Docker Compose with Node.js build-at-start
- Uses `node:20-alpine` image
- App code: Git-cloned and bind-mounted at `/opt/swu-holocron/app`
- Builds on container start: `npm install && npm run build && npm run preview`
- Cloudflare Tunnel: HTTP2 protocol for stability
- Auto-sync: Manual pull + container restart required for code updates

**Planned Migration**: GHCR image + Watchtower for fully automated updates (pending initial image build)

## Deployment Architecture

The application is containerized using Docker and orchestrated via Docker Compose.

### Components

1.  **Web App Container:**
    -   Image: `node:20-alpine` (builds from source)
    -   Port: 5173 (Internal)
    -   Code: Bind-mounted from `/opt/swu-holocron/app/SWU-Holocron`
    -   Build: `npm install && npm run build && npm run preview -- --host 0.0.0.0 --port 5173`

2.  **Cloudflare Tunnel:**
    -   Image: `cloudflare/cloudflared:latest`
    -   Protocol: HTTP2 (for stable QUIC-free connections)
    -   Routes: `swu.holocronlabs.net` → `http://swu-holocron-web:5173`

3.  **Watchtower:**
    -   Image: `containrrr/watchtower`
    -   Status: Running, awaiting GHCR image availability
    -   Will auto-update once `ghcr.io/midknightloki/swu-holocron:latest` is published

## Deployment Process

The deployment is managed via the `Mimir` infrastructure repository.

### Location
Configuration files are located in `Mimir/gitops/swu-holocron/`.

### Code Updates (Current Manual Process)

To deploy latest code from `main` branch:

```bash
# 1. SSH into Nidavellir
ssh loki@nidavellir.l0k1.net

# 2. Pull latest code
cd /opt/swu-holocron/app/SWU-Holocron
git stash --include-untracked    # Discard local changes if any
git pull --rebase                # Pull from origin/main

# 3. Restart container to rebuild with new code
cd /opt/swu-holocron
docker compose restart web

# 4. Verify build completed
sleep 10
docker logs --tail 50 swu-holocron-web
```

### Future: Automatic Updates via Watchtower

Once `ghcr.io/midknightloki/swu-holocron:latest` is published by CI/CD:

1. Watchtower will detect new images automatically (checks every 5 minutes)
2. The `swu-holocron-web` container will be recreated with the new image
3. No manual intervention required

## Required Configuration: Vite Host Allowlist

**Critical for production access**: `vite.config.js` must include the external hostname:

```javascript
export default defineConfig({
  // ... plugins and other config ...
  
  server: {
    allowedHosts: ['swu.holocronlabs.net', 'swu-holocron-web', 'localhost', '127.0.0.1']
  },
  preview: {
    host: true,
    port: 5173,
    allowedHosts: ['swu.holocronlabs.net', 'swu-holocron-web', 'localhost', '127.0.0.1']
  },
  
  // ... test, plugins, etc ...
})
```

Without this, accessing `swu.holocronlabs.net` will show: `Blocked request. This host is not allowed.`

## Infrastructure Details

For detailed infrastructure documentation, refer to the `Mimir` project:
-   `Mimir/HomeLab/Networking/Nidavellir*.md`
-   `Mimir/gitops/swu-holocron/README.md`

## Troubleshooting

### 502 Bad Gateway / Intermittent Outages

**Symptom**: Cloudflare returns 502 errors; connection drops every few minutes

**Root Cause**: Tunnel was using QUIC protocol (UDP) which is unstable on some networks

**Check**:
```bash
# If using QUIC, you'll see these timeout errors:
docker logs swu-holocron-tunnel | grep -E 'timeout.*no recent network activity|QUIC'

# Correct setup uses HTTP2:
docker logs swu-holocron-tunnel | grep 'protocol=http2'
```

**Fix**: Ensure `docker-compose.yml` has:
```yaml
tunnel:
  command: tunnel run --protocol http2
```

Then restart:
```bash
cd /opt/swu-holocron
docker compose up -d tunnel
sleep 5
docker logs tunnel | grep 'protocol=http2'
```

### "Blocked request" Error When Accessing Site

**Symptom**: Browser shows: `Blocked request. This host ("swu.holocronlabs.net") is not allowed.`

**Root Cause**: Vite preview server doesn't have `swu.holocronlabs.net` in its `allowedHosts`

**Fix**:

1. Update `vite.config.js` (see "Required Configuration" section above)
2. Commit and push changes
3. Pull and restart on host:

```bash
cd /opt/swu-holocron/app/SWU-Holocron
git pull --rebase

cd /opt/swu-holocron
docker compose restart web

# Verify it's serving (wait ~30-60 seconds for build):
sleep 30
docker logs web | grep -E 'Network:|➜'
```

### Changes Not Showing on Live Site

**Symptom**: Pushed code to `main` branch, but old version still showing in production

**Diagnosis**: Check what code the container is running:
```bash
# Get the current git HEAD on the host:
ssh loki@nidavellir.l0k1.net "cd /opt/swu-holocron/app/SWU-Holocron && git log -1 --oneline"

# Compare to latest on GitHub:
git log -1 --oneline
```

**Fix**: Manually pull and restart:
```bash
ssh loki@nidavellir.l0k1.net << 'EOF'
cd /opt/swu-holocron/app/SWU-Holocron
git stash --include-untracked
git pull --rebase

cd /opt/swu-holocron
docker compose restart web

# Wait for rebuild
sleep 30
docker logs --tail 100 web
EOF
```

### Build Errors / Container Exits

**Symptom**: `docker ps` shows container not running, or build output has errors

**Check**:
```bash
# Full logs:
docker logs swu-holocron-web

# Look for:
# - npm ERR! (npm install failed)
# - Error building Vite (vite build failed)
# - Module not found (missing dependencies)
```

**Common Issues**:

- **Peer dependency warnings** (e.g., `firebase` version mismatch): Safe to ignore; app still works
- **Large chunk warnings** ("Some chunks are larger than 500 kB"): Optimization suggestion; not blocking
- **npm audit vulnerabilities**: Document in backlog; can ignore for now

**Fix**:
```bash
# Restart container (clears npm cache, reinstalls dependencies):
docker compose down web
docker compose up -d web

# Monitor build progress:
sleep 30
docker logs -f web
```

### Tunnel Not Connecting

**Symptom**: `docker logs swu-holocron-tunnel` shows `Failed to dial a quic connection`

**Check**:
```bash
# Verify tunnel configuration:
docker exec swu-holocron-tunnel cat /etc/hostname  # Confirm it's running

# Check for connection errors:
docker logs swu-holocron-tunnel | grep -E 'ERR|WRN|Failed|Registered'
```

**Fix**:
1. Verify `TUNNEL_TOKEN` environment variable is set in `.env`
2. Ensure tunnel is using HTTP2 (see "502 Bad Gateway" section above)
3. Restart:
```bash
cd /opt/swu-holocron
docker compose restart tunnel
sleep 5
docker logs tunnel | tail -20
```
