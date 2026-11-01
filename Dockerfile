# Beuk SaaS app — Node + TypeScript (Express), compiled to dist/.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Beuk 2.0 studio (React, served at /next by the app): studio/ has its own
# package.json and lockfile. Its build extracts the interface strings and
# the theme tokens from client/index.html (studio/scripts/extract-studio.mjs,
# with src/book/studio/closure.ts's parser selection) and imports the
# book-format code from src/book, so it needs both. Output: client/next/.
FROM node:24-slim AS studio
WORKDIR /app
COPY studio/package.json studio/package-lock.json ./studio/
RUN cd studio && npm ci
COPY studio ./studio
COPY client/index.html ./client/index.html
COPY client/assets/vendor/lucide.min.js ./client/assets/vendor/lucide.min.js
COPY src/book ./src/book
RUN cd studio && npm run build

# Off-site backups: restic, pinned release + the sha256 published in the
# release's SHA256SUMS (any other bytes fail the build). The app runs it
# (src/housekeeping/offsite.ts) only when the OFFSITE_* + RESTIC_PASSWORD
# settings are present.
#   https://github.com/restic/restic/releases/tag/v0.19.1
#   https://github.com/restic/restic/releases/download/v0.19.1/SHA256SUMS
# The CA bundle comes along: restic (Go) verifies the B2 TLS certificate
# against the system store, which node:24-slim does not ship.
FROM debian:bookworm-slim AS restic
ARG TARGETARCH=amd64
ARG RESTIC_VERSION=0.19.1
ARG RESTIC_SHA256_AMD64=f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c
ARG RESTIC_SHA256_ARM64=a5f64aaab53d51e311fa3829124c5b703f2d14cf187d8640b6be3b2b49376465
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl bzip2 \
 && rm -rf /var/lib/apt/lists/* \
 && case "$TARGETARCH" in \
      amd64) sha="$RESTIC_SHA256_AMD64" ;; \
      arm64) sha="$RESTIC_SHA256_ARM64" ;; \
      *) echo "no pinned restic checksum for $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && curl -fsSL --retry 3 -o /tmp/restic.bz2 \
      "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_${TARGETARCH}.bz2" \
 && echo "$sha  /tmp/restic.bz2" | sha256sum -c - \
 && bunzip2 -c /tmp/restic.bz2 > /usr/local/bin/restic \
 && chmod 0755 /usr/local/bin/restic \
 && /usr/local/bin/restic version

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# SQL migrations are read from disk at boot.
COPY migrations ./migrations
# Housekeeping's Reference pillar renders these repo files at runtime.
COPY docs ./docs
# M4 warmth pages: the app serves client/help/, client/thanks/ and
# CHANGELOG.md at request time (Caddy proxies /help*, /thanks*,
# /changelog to it — see the Caddyfile). The deploy image must carry
# them; they are NOT served from Caddy's static ./client mount, which
# only the caddy container sees.
COPY client ./client
# The 2.0 studio's build (studio stage above), served at /next.
COPY --from=studio /app/client/next ./client/next
COPY CHANGELOG.md ./CHANGELOG.md
# H1/H2 Help: the guides (Markdown), the error dictionary and the home
# page data, read at request time and indexed for search at boot.
COPY content ./content
# M5: the PDF/X definition file the pdfx job hands to Ghostscript.
# (The JRE + EPUBCheck jar + Ghostscript binaries themselves are a
# production install step — see the README "Jobs" section.)
COPY tools ./tools
# Self-check jobs.pdfx.rendition.renderer-isolated reads these from the
# deploy tree; without them the run fails and promotion is blocked.
COPY deploy/Dockerfile.tools deploy/docker-compose.tools.yml ./deploy/
COPY deploy/renderer/Dockerfile deploy/renderer/server.mjs ./deploy/renderer/
# Self-checks infra.deploy.security-headers / infra.deploy.signals-healthchecks
# read these two from the deploy tree (no secrets: values come from .env).
COPY Caddyfile docker-compose.yml ./
# Off-site backups: the pinned restic binary and a CA bundle (stage above).
COPY --from=restic /usr/local/bin/restic /usr/local/bin/restic
COPY --from=restic /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
# The exportdata/backupdata named volumes mount here. A fresh volume takes
# its ownership from the image's mountpoint, so these must exist and be
# owned by `node` — otherwise Docker creates them root-owned and every
# export and backup fails with EACCES.
RUN mkdir -p /data/exports /data/backups && chown -R node:node /data
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
