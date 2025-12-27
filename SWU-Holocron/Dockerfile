# Build stage
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files
COPY SWU-Holocron/package*.json ./

# Copy local dependency directories
COPY SWU-Holocron/src/dataconnect-admin-generated ./src/dataconnect-admin-generated
COPY SWU-Holocron/src/dataconnect-generated ./src/dataconnect-generated

# Install dependencies
RUN npm ci

# Copy source code
COPY SWU-Holocron . .

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy built assets from build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Copy custom nginx config for SPA support
COPY SWU-Holocron/nginx.conf /etc/nginx/conf.d/default.conf

# Add health check for container orchestration
HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=5s \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
