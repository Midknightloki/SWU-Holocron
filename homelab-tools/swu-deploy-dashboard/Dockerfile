FROM nginx:alpine

# Copy the HTML template — envsubst fills in env vars at container start
COPY index.html /app/index.html.template

# Default values (override via docker-compose env or -e flags)
ENV GITHUB_REPO="owner/repo" \
    LIVE_URL="https://example.com" \
    PROJECT_NAME="Deploy Dashboard"

# On start: substitute only the three known placeholders (leaves JS ${} alone),
# write the result to nginx's html root, then start nginx.
CMD ["/bin/sh", "-c", \
    "envsubst '${LIVE_URL} ${GITHUB_REPO} ${PROJECT_NAME}' \
        < /app/index.html.template \
        > /usr/share/nginx/html/index.html && \
     exec nginx -g 'daemon off;'"]

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
    CMD wget -qO- http://localhost/ > /dev/null || exit 1
