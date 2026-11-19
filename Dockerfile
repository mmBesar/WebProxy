# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build

# Upstream Rammerhead commit this image is built from (tested). Bump to update.
ARG RAMMERHEAD_REPO=https://github.com/binary-person/rammerhead.git
ARG RAMMERHEAD_REF=9d1bafa000e1b31de24379a7620389a3ecbfe1d9

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN git init -q . \
    && git remote add origin "$RAMMERHEAD_REPO" \
    && git fetch -q --depth 1 origin "$RAMMERHEAD_REF" \
    && git checkout -q FETCH_HEAD \
    && rm -rf .git

RUN npm install --no-audit --no-fund && npm run build

# Simple landing page (Catppuccin Macchiato) replaces the upstream session UI
COPY index.html public/index.html

# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
COPY config.js status-log.js gen-sites.js gen-cert.sh entrypoint.sh healthcheck.js /app/

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/sessions /app/cache-js /app/cf-clearances /certs \
    && chown -R node:node /app /certs

USER node
EXPOSE 8080 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node healthcheck.js

CMD ["sh", "/app/entrypoint.sh"]
