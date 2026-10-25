# Beuk renderer image — headless Chromium behind a tiny HTTP API, and
# nothing else: no app code, no database client, no secrets, no tools
# the app needs. The pdfx job's print-html → PDF rendition runs here,
# isolated from the app (see server.mjs for the in-container fences and
# deploy/docker-compose.tools.yml for the container ones).
#
# Same base as the app image (node:24-slim) and the same apt package set
# for Chromium (`chromium`, --no-install-recommends) the tools overlay
# used to install into the app, so fonts and rendering stay as they were.
FROM node:24-slim
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    HOME=/tmp \
    XDG_CONFIG_HOME=/tmp \
    XDG_CACHE_HOME=/tmp
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium \
 && rm -rf /var/lib/apt/lists/*
# The book's own typefaces (the studio's twenty body/heading families,
# SIL OFL 1.1, each with its OFL.txt), pinned to one google/fonts commit
# and checked file by file against fonts.lock; then fontconfig's cache
# is rebuilt so Chromium finds them by family name. Without them the
# print interior fell back to DejaVu Serif.
COPY fonts.lock fetch-fonts.mjs /tmp/fonts/
RUN node /tmp/fonts/fetch-fonts.mjs /tmp/fonts/fonts.lock /usr/share/fonts/truetype/beuk \
 && fc-cache -f /usr/share/fonts/truetype/beuk \
 && rm -rf /tmp/fonts
WORKDIR /renderer
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY server.mjs ./
USER node
EXPOSE 3100
HEALTHCHECK --interval=10s --timeout=3s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:3100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
