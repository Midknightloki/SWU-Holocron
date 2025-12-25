# Deployment Documentation

## Overview

SWU Holocron is deployed as a Docker container on the `Nidavellir` host within the HomeLab infrastructure. It is accessible via Cloudflare Tunnel.

- **Production URL:** [https://swu.holocronlabs.net](https://swu.holocronlabs.net)
- **Host:** Nidavellir (192.168.1.30)
- **Infrastructure Project:** [Mimir](../../../Mimir/README.md)

## Deployment Architecture

The application is containerized using Docker and orchestrated via Docker Compose. A Cloudflare Tunnel (`cloudflared`) sidecar container exposes the application securely to the internet without opening inbound ports.

### Components

1.  **Web App Container:**
    -   Image: Built from `Dockerfile`
    -   Port: 5173 (Internal)
    -   Command: `npm run preview -- --host 0.0.0.0 --port 5173`

2.  **Cloudflare Tunnel:**
    -   Image: `cloudflare/cloudflared:latest`
    -   Connects to Cloudflare Edge
    -   Routes traffic to `web:5173`

## Deployment Process

The deployment is managed via the `Mimir` infrastructure repository.

### Location
Configuration files are located in `Mimir/gitops/swu-holocron/`.

### Automatic Updates
The service is configured to auto-sync with the `main` branch of this repository every 5 minutes via a cron job on the host.

### Manual Deployment (On Host)

1.  SSH into Nidavellir.
2.  Navigate to `/opt/swu-holocron`.
3.  Run the sync script:
    ```bash
    ./monitor-and-sync.sh
    ```

## Infrastructure Details

For detailed infrastructure documentation, refer to the `Mimir` project:
-   `Mimir/HomeLab/Networking/Nidavellir*.md`
-   `Mimir/gitops/swu-holocron/README.md`
