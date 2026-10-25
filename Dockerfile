# Beuk SaaS app — Node + TypeScript (Express), compiled to dist/.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

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
COPY CHANGELOG.md ./CHANGELOG.md
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
# The exportdata/backupdata named volumes mount here. A fresh volume takes
# its ownership from the image's mountpoint, so these must exist and be
# owned by `node` — otherwise Docker creates them root-owned and every
# export and backup fails with EACCES.
RUN mkdir -p /data/exports /data/backups && chown -R node:node /data
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
