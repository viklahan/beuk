#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Beuk — Housekeeping from the server's shell.
#
# Housekeeping has no UI (README "Housekeeping"): it is the admin API under
# /api/housekeeping/*, answering 404 to anyone who is not a signed-in admin.
# This script signs in as an admin account, calls ONE named action, prints
# the JSON answer and signs out again. Run it on the box, in the deploy
# directory (it reads DOMAIN from .env and talks to Caddy on this machine).
#
#   ./deploy/hk.sh you@example.com self-checks      run every self-check
#   ./deploy/hk.sh you@example.com rehearse         migrations + boot on a scratch DB
#   ./deploy/hk.sh you@example.com mail             is email configured?
#   ./deploy/hk.sh you@example.com mail-test        send a test email to you
#   ./deploy/hk.sh you@example.com backup [name]    make a named local backup now
#   ./deploy/hk.sh you@example.com backups          list local backups
#   ./deploy/hk.sh you@example.com offsite          off-site (B2) status
#   ./deploy/hk.sh you@example.com offsite-run      push the latest backup off-site now
#   ./deploy/hk.sh you@example.com offsite-drill    restore drill of the off-site copy
#   ./deploy/hk.sh you@example.com restore-preview <name>
#   ./deploy/hk.sh you@example.com restore <name> <previewId>   REPLACES the live data
#
# The password is read from the terminal (never echoed, never on the
# command line). The session cookie lives in a mode-600 temp file that is
# removed on exit. The account must already be admin:
#   docker compose exec app node dist/admin-cli.js grant you@example.com
#
# Testing only: HK_PASSWORD supplies the password non-interactively and
# HK_INSECURE=1 accepts a self-signed certificate (a rehearsal box with
# Caddy's internal CA). Neither belongs on the production box.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/.."

usage() { sed -n '11,22p' "${BASH_SOURCE[0]}" | sed 's/^#  //'; exit 2; }
[ $# -ge 2 ] || usage
EMAIL="$1"; ACTION="$2"; shift 2

DOMAIN="$(grep '^DOMAIN=' .env 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
[ -n "${DOMAIN}" ] || { echo "no DOMAIN in .env — run this in the deploy directory" >&2; exit 1; }
case "${DOMAIN}" in
  http://*|https://*) echo "DOMAIN=${DOMAIN} is a local dev setting; this script is for a deployed box" >&2; exit 1 ;;
esac
BASE="https://${DOMAIN}"

if [ -n "${HK_PASSWORD:-}" ]; then
  PASSWORD="${HK_PASSWORD}"
else
  read -rsp "Password for ${EMAIL}: " PASSWORD </dev/tty; echo >&2
fi

JAR="$(mktemp)"; chmod 600 "${JAR}"
BODY="$(mktemp)"; chmod 600 "${BODY}"
cleanup() {
  curl -s -o /dev/null "${CURL_OPTS[@]}" -b "${JAR}" -X POST "${BASE}/api/auth/logout" || true
  rm -f "${JAR}" "${BODY}"
}
# Talk to this machine's Caddy whatever DNS currently says.
CURL_OPTS=(--silent --show-error --max-time 900 --resolve "${DOMAIN}:443:127.0.0.1")
[ "${HK_INSECURE:-0}" = "1" ] && CURL_OPTS+=(--insecure)
trap cleanup EXIT

json_str() { # minimal JSON string escaping for the login body
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}
printf '{"email":"%s","password":"%s"}' "$(json_str "${EMAIL}")" "$(json_str "${PASSWORD}")" > "${BODY}"
CODE="$(curl "${CURL_OPTS[@]}" -o /dev/null -w '%{http_code}' -c "${JAR}" \
  -H 'content-type: application/json' --data-binary "@${BODY}" "${BASE}/api/auth/login")"
: > "${BODY}"
[ "${CODE}" = "200" ] || { echo "sign-in failed (HTTP ${CODE})" >&2; exit 1; }

call() { # call METHOD PATH [JSON]
  local method="$1" path="$2" data="${3:-}" args=()
  [ -n "${data}" ] && args=(-H 'content-type: application/json' --data-binary "${data}")
  curl "${CURL_OPTS[@]}" -b "${JAR}" -X "${method}" -w '\n(HTTP %{http_code})\n' "${args[@]}" "${BASE}/api/housekeeping${path}"
}

case "${ACTION}" in
  self-checks)     call POST /self-checks/run ;;
  rehearse)        call POST /rehearse ;;
  mail)            call GET /mail ;;
  mail-test)       call POST /mail/test ;;
  backup)          if [ $# -ge 1 ]; then call POST /backups "{\"name\":\"$1\"}"; else call POST /backups '{}'; fi ;;
  backups)         call GET /backups ;;
  offsite)         call GET /offsite ;;
  offsite-run)     call POST /offsite/run ;;
  offsite-drill)   call POST /offsite/drill ;;
  restore-preview) [ $# -ge 1 ] || usage; call POST /restore/preview "{\"name\":\"$1\"}" ;;
  restore)         [ $# -ge 2 ] || usage; call POST /restore "{\"name\":\"$1\",\"previewId\":\"$2\",\"confirmed\":true}" ;;
  *)               usage ;;
esac
