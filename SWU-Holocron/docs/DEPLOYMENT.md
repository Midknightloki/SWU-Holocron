# Deployment Documentation

## Overview

SWU Holocron is deployed as a Docker container on the `Nidavellir` host within the HomeLab infrastructure. It is accessible via Cloudflare Tunnel.

- **Production URL:** [https://swu.holocronlabs.net](https://swu.holocronlabs.net)
- **Host:** Nidavellir (192.168.1.30)
- **Infrastructure Project:** [Mimir](../../../Mimir/README.md)

## Deployment Architecture

The application is containerized using Docker and orchestrated via Docker Compose.

### Components

1.  **Web App Container:**
    -   Image: `ghcr.io/midknightloki/swu-holocron:latest`
    -   Port: 5173 (Internal)
    -   Updates: Managed by Watchtower

2.  **Cloudflare Tunnel:**
    -   Image: `cloudflare/cloudflared:latest`
    -   Connects to Cloudflare Edge (HTTP2 protocol)
    -   Routes traffic to `web:5173`

3.  **Watchtower:**
    -   Image: `containrrr/watchtower`
    -   Monitors for new images and updates the web container automatically.

## Deployment Process

The deployment is managed via the `Mimir` infrastructure repository.

### Location
Configuration files are located in `Mimir/gitops/swu-holocron/`.

### Automatic Updates
The service is configured to auto-update via **Watchtower**. When a new image is pushed to the GitHub Container Registry (GHCR) by the CI/CD pipeline, Watchtower detects the change (checked every 5 minutes) and restarts the container with the new image.

### Manual Deployment (On Host)

1.  SSH into Nidavellir.
2.  Navigate to `/opt/swu-holocron`.
3.  Pull the latest image and restart:
    ```bash
    docker compose pull
    docker compose up -d
    ```

## Infrastructure Details

For detailed infrastructure documentation, refer to the `Mimir` project:
-   `Mimir/HomeLab/Networking/Nidavellir*.md`
-   `Mimir/gitops/swu-holocron/README.md`
