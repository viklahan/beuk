#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Beuk SaaS — one-command install for a fresh Hetzner box (Debian/Ubuntu).
#
#   1. Copy this whole directory (beuk-saas/) onto the box.
#   2. Point DNS for your domain at the box (A/AAAA records).
#   3. Run:
#        DEPLOY_DOMAIN=beuk.studio ./deploy/install.sh
#
# What it does:
#   • installs Docker + the Compose plugin if they are missing
#   • writes a real .env from .env.example (generating a strong Postgres
#     password; an existing .env is respected and NEVER overwritten, and an
#     existing real password is never rotated — the database volume is
#     initialized with it)
#   • stamps the build (git SHA when available) and marks the tree clean
#     for Housekeeping's promotion gate
#   • builds and starts the stack (db + app + Caddy); migrations run on boot
#   • unless INSTALL_TOOLS=0: downloads EPUBCheck and builds the tools
#     overlay image (JRE + Ghostscript + ICC profiles) plus the isolated
#     renderer service (headless Chromium in its own locked-down container)
#     so EPUBCheck and PDF/X jobs run for real; if the tools step fails,
#     the deploy still completes and the jobs honestly report "not configured"
#   • verifies the app answers /api/health from inside the stack and
#     prints a summary with the next steps
#
# Optional knobs (environment variables):
#   DEPLOY_DOMAIN       default beuk.studio (use "localhost" for a first
#                       look over the raw IP — see the note at the end)
#   SUPPORT_EMAIL / SUPPORT_NAME / SUPPORT_REPLY_PROMISE   Help-page contact
#   KOFI_URL            Ko-fi page; unset → no tip jar is rendered anywhere
#   SMTP_URL / MAIL_FROM  outgoing email for password-reset links, e.g.
#                       SMTP_URL=smtp://user:pass@smtp.example.com:587
#                       MAIL_FROM="Beuk <no-reply@beuk.studio>"; unset →
#                       no email is sent (Housekeeping: "email not configured")
#   APP_TIMEZONE        default UTC (e.g. America/Los_Angeles)
#   DEPLOY_WWW          default 1: also serve www.<domain> and redirect it
#                       to <domain> (needs a www DNS record too); 0 = apex only
#   INSTALL_TOOLS       default 1; set 0 to skip EPUBCheck/Ghostscript
#   EPUBCHECK_VERSION   default 5.2.1
#
# Idempotent: safe to re-run (e.g. after editing knobs) — it rebuilds and
# restarts the stack with the current tree and .env.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# Compose project name. It is ALSO written into .env (below) so that a
# bare `docker compose …` typed later in this directory talks to the same
# stack: without it Compose falls back to the directory's basename (e.g.
# "beuk-saas" for a git clone) and `docker compose exec app …` finds no
# container, while `docker compose up -d` would start a SECOND, empty
# stack. https://docs.docker.com/compose/how-tos/environment-variables/envvars/
if [ -z "${COMPOSE_PROJECT_NAME:-}" ] && [ -f .env ]; then
  COMPOSE_PROJECT_NAME="$(grep '^COMPOSE_PROJECT_NAME=' .env | tail -n 1 | cut -d= -f2- || true)"
fi
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-beuk}"

DEPLOY_DOMAIN="${DEPLOY_DOMAIN:-beuk.studio}"
APP_TIMEZONE="${APP_TIMEZONE:-UTC}"
INSTALL_TOOLS="${INSTALL_TOOLS:-1}"
EPUBCHECK_VERSION="${EPUBCHECK_VERSION:-5.2.1}"

log()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
warn() { printf '   \033[33m! %s\033[0m\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# sudo for docker/apt when not root
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 && SUDO="sudo"
fi

# ── 0. Local-only files must not ride along to a real server ─────────────
# docker-compose.override.yml is written by start-local.ps1 for a dev box
# (Caddy on 127.0.0.1:8090 only). Compose loads it automatically for any
# bare `docker compose up` in this directory, which on a server would
# take the site off 80/443. This script always passes -f explicitly, but
# a later hand-typed command would not — so refuse instead of guessing.
if [ "${DEPLOY_DOMAIN}" != "localhost" ] && [ -f docker-compose.override.yml ]; then
  die "docker-compose.override.yml is present (a LOCAL dev file from start-local.ps1). Deploy from a fresh 'git clone', or move that file out of this directory, then re-run."
fi

# ── 1. Docker ────────────────────────────────────────────────────────────────
log "Docker"
if command -v docker >/dev/null 2>&1; then
  note "docker already installed: $(docker --version)"
else
  note "installing Docker (get.docker.com)…"
  curl -fsSL https://get.docker.com | ${SUDO} sh
  ${SUDO} systemctl enable --now docker 2>/dev/null || true
fi
if ${SUDO} docker compose version >/dev/null 2>&1; then
  COMPOSE="${SUDO} docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="${SUDO} docker-compose"
else
  die "Docker Compose plugin not found. Install docker-compose-plugin and re-run."
fi
note "compose: $(${COMPOSE} version 2>/dev/null | head -n 1)"

# ── 2. .env ──────────────────────────────────────────────────────────────────
log "Configuration (.env)"
FRESH_ENV=0
if [ ! -f .env ]; then
  cp .env.example .env
  FRESH_ENV=1
  note "created .env from .env.example"
else
  note "keeping the existing .env (values are respected, never overwritten)"
fi

set_env() { # set_env KEY VALUE — replace the KEY= line or append it
  local key="$1" val="$2" esc
  esc="$(printf '%s' "${val}" | sed -e 's/[|&]/\\&/g')"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${esc}|" .env
  else
    printf '%s=%s\n' "${key}" "${val}" >> .env
  fi
}
get_env() { grep "^$1=" .env | tail -n 1 | cut -d= -f2- || true; }

# Postgres password: generate once, never rotate afterwards (the pgdata
# volume is initialized with the first password it ever sees).
CURRENT_PW="$(get_env POSTGRES_PASSWORD)"
if [ -z "${CURRENT_PW}" ] || [ "${CURRENT_PW}" = "change-me-local-only" ]; then
  if command -v openssl >/dev/null 2>&1; then
    NEW_PW="$(openssl rand -hex 24)"
  else
    NEW_PW="$(od -An -tx1 -N24 /dev/urandom | tr -d ' \n')"
  fi
  set_env POSTGRES_PASSWORD "${NEW_PW}"
  note "generated a strong POSTGRES_PASSWORD (stored only in .env)"
else
  note "POSTGRES_PASSWORD already set — leaving it untouched"
fi

set_env COMPOSE_PROJECT_NAME "${COMPOSE_PROJECT_NAME}"
set_env DOMAIN "${DEPLOY_DOMAIN}"
if [ "${DEPLOY_DOMAIN}" = "localhost" ]; then
  set_env COOKIE_SECURE "false"
  set_env APP_BASE_URL "https://localhost"
  set_env WWW_DOMAIN ""
else
  set_env COOKIE_SECURE "true"
  set_env APP_BASE_URL "https://${DEPLOY_DOMAIN}"
  if [ "${DEPLOY_WWW:-1}" = "1" ]; then
    set_env WWW_DOMAIN "www.${DEPLOY_DOMAIN}"
  else
    set_env WWW_DOMAIN ""
  fi
fi
set_env APP_TIMEZONE "${APP_TIMEZONE}"
[ -n "${SUPPORT_EMAIL:-}" ]          && set_env SUPPORT_EMAIL "${SUPPORT_EMAIL}"
[ -n "${SUPPORT_NAME:-}" ]           && set_env SUPPORT_NAME "${SUPPORT_NAME}"
[ -n "${SUPPORT_REPLY_PROMISE:-}" ]  && set_env SUPPORT_REPLY_PROMISE "${SUPPORT_REPLY_PROMISE}"
[ -n "${KOFI_URL:-}" ]               && set_env KOFI_URL "${KOFI_URL}"
[ -n "${SMTP_URL:-}" ]               && set_env SMTP_URL "${SMTP_URL}"
[ -n "${MAIL_FROM:-}" ]              && set_env MAIL_FROM "${MAIL_FROM}"
# A localhost install is a local stack: show reset links in the app log
# while email is unconfigured. A real domain never logs them.
if [ "${DEPLOY_DOMAIN}" = "localhost" ]; then
  [ -z "$(get_env MAIL_LOG_LINKS)" ] && set_env MAIL_LOG_LINKS "true"
else
  set_env MAIL_LOG_LINKS "false"
fi
if [ -n "$(get_env SMTP_URL)" ] && [ -n "$(get_env MAIL_FROM)" ]; then
  MAIL_STATE="configured (run Housekeeping's mail test to verify delivery)"
else
  MAIL_STATE="NOT configured — password-reset emails are not sent until SMTP_URL and MAIL_FROM are set"
fi

# Build stamp for Housekeeping self-checks / promotion manifest.
if git -C "${REPO_ROOT}" rev-parse --short HEAD >/dev/null 2>&1; then
  SHA="$(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
  set_env GIT_SHA "${SHA}"
  set_env BUILD_STAMP "${SHA}"
else
  STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  set_env BUILD_STAMP "${STAMP}"
fi
[ -z "$(get_env APP_VERSION)" ] && set_env APP_VERSION "$(get_env BUILD_STAMP)"
# Deploying this tree IS the clean-tree attestation the promotion gate asks for.
set_env TREE_CLEAN "true"
chmod 600 .env
note "DOMAIN=${DEPLOY_DOMAIN}  WWW_DOMAIN=$(get_env WWW_DOMAIN)  APP_TIMEZONE=${APP_TIMEZONE}  BUILD_STAMP=$(get_env BUILD_STAMP)"

[ -f client/index.html ] || warn "client/index.html is missing — the studio bundle is not in this tree; Caddy will have nothing to serve at /."

# ── 3. Build the stock app image ─────────────────────────────────────────────
log "Build (stock app image)"
${COMPOSE} -f docker-compose.yml build app

# ── 4. Job tools (EPUBCheck + Ghostscript) ───────────────────────────────────
COMPOSE_FILES=(-f docker-compose.yml)
TOOLS_STATE="skipped (INSTALL_TOOLS=0) — jobs will report \"not configured\""
if [ "${INSTALL_TOOLS}" = "1" ]; then
  log "Job tools (EPUBCheck ${EPUBCHECK_VERSION} + Ghostscript + isolated Chromium renderer for PDF rendition)"
  TOOLS_OK=1
  (
    set -e
    mkdir -p tools-bin
    if [ ! -f tools-bin/epubcheck.jar ]; then
      TMPD="$(mktemp -d)"
      note "downloading EPUBCheck v${EPUBCHECK_VERSION}…"
      curl -fsSL -o "${TMPD}/epubcheck.zip" \
        "https://github.com/w3c/epubcheck/releases/download/v${EPUBCHECK_VERSION}/epubcheck-${EPUBCHECK_VERSION}.zip"
      (command -v unzip >/dev/null 2>&1 || ${SUDO} apt-get install -y unzip >/dev/null)
      unzip -q "${TMPD}/epubcheck.zip" -d "${TMPD}"
      cp -r "${TMPD}/epubcheck-${EPUBCHECK_VERSION}/." tools-bin/
      rm -rf "${TMPD}"
    fi
    [ -f tools-bin/epubcheck.jar ]
  ) || TOOLS_OK=0
  if [ "${TOOLS_OK}" = "1" ]; then
    COMPOSE_FILES+=(-f deploy/docker-compose.tools.yml)
    TOOLS_STATE="enabled — app image rebuilt with JRE + Ghostscript + EPUBCheck (PDF/X press profile SWOP2006_Coated3v2.icc, CGATS TR 003, sha256-pinned); print-html renders in the isolated renderer service"
    note "tools overlay will be used"
  else
    TOOLS_STATE="FAILED to prepare — deploy continues; jobs will report \"not configured\" until fixed"
    warn "EPUBCheck download/prep failed; continuing without the tools overlay."
  fi
fi

# ── 5. Up ────────────────────────────────────────────────────────────────────
log "Starting the stack"
${COMPOSE} "${COMPOSE_FILES[@]}" up -d --build

# ── 6. Health ────────────────────────────────────────────────────────────────
log "Health check"
HEALTH=""
for i in $(seq 1 30); do
  if HEALTH="$(${COMPOSE} "${COMPOSE_FILES[@]}" exec -T app node -e \
      "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(t=>{console.log(t)}).catch(()=>process.exit(1))" \
      2>/dev/null)"; then
    break
  fi
  HEALTH=""
  sleep 2
done
if [ -n "${HEALTH}" ]; then
  note "app /api/health answered: ${HEALTH}"
else
  ${COMPOSE} "${COMPOSE_FILES[@]}" ps || true
  die "the app did not answer /api/health within ~60s. Inspect with: ${COMPOSE} logs --tail=100 app"
fi

# ── 7. Summary ───────────────────────────────────────────────────────────────
COMPOSE_CMD="${COMPOSE} -f docker-compose.yml"
[ "${#COMPOSE_FILES[@]}" -gt 1 ] && COMPOSE_CMD="${COMPOSE_CMD} -f deploy/docker-compose.tools.yml"

{
  echo "Beuk install — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "  domain:        ${DEPLOY_DOMAIN}"
  echo "  www redirect:  $(get_env WWW_DOMAIN)"
  echo "  compose proj:  ${COMPOSE_PROJECT_NAME}"
  echo "  build stamp:   $(get_env BUILD_STAMP)"
  echo "  tools:         ${TOOLS_STATE}"
  echo "  email:         ${MAIL_STATE}"
  echo "  compose cmd:   ${COMPOSE_CMD}"
} > deploy/last-install.txt

log "Done — Beuk is up"
if [ "${DEPLOY_DOMAIN}" = "localhost" ]; then
  note "Site: https://localhost (Caddy internal cert — expect a browser warning)"
  note "For a look over the raw IP instead, browse https://<box-ip> the same way."
else
  note "Site:        https://${DEPLOY_DOMAIN}/"
  note "Help:        https://${DEPLOY_DOMAIN}/help"
  note "Status line: https://${DEPLOY_DOMAIN}/api/status"
  note "Caddy fetches the Let's Encrypt certificate automatically once DNS resolves here."
fi
note "Next steps:"
note "  1. Register your account in the app, then make it the Housekeeping admin:"
note "       ${COMPOSE_CMD} exec app node dist/admin-cli.js grant <your-email>"
note "  2. Open Housekeeping and run Rehearse, then a Self-checks run."
note "  3. Write something and watch for \"On your shelf ✓\" (cloud sync working)."
note "Tools: ${TOOLS_STATE}"
note "Email: ${MAIL_STATE}"
note "Secrets live only in .env (chmod 600) — it was never printed. Day-to-day:"
note "  logs:    ${COMPOSE_CMD} logs -f app"
note "  restart: ${COMPOSE_CMD} up -d        (re-run ./deploy/install.sh after pulling changes)"
note "This summary is also saved to deploy/last-install.txt (no secrets in it)."
[ "${FRESH_ENV}" = "1" ] && note "First boot: the database volume initialized with the generated password — do not change POSTGRES_PASSWORD in .env afterwards."
exit 0
