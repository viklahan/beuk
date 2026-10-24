#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Beuk renderer attack proof — re-runnable.
#
# Brings up an ISOLATED copy of the tools stack (db + renderer + app; no
# Caddy, no published host ports, its own compose project and image
# names), plants canary secrets in the app's environment and canary files
# in its export/backup volumes, then — through the real API, as a user —
# submits a hostile print-html (deploy/renderer-attack/attack-print.html)
# and a legitimate one, and checks the PDFs that come back:
#   • the hostile PDF contains the page's own marker text and NONE of:
#     the canaries, any environment text, the app's /api/health JSON,
#     anything from the database port, the renderer's own /health, or
#     example.com's page;
#   • the legitimate PDF has its trim size, page count and text.
# It also inspects the renderer container's posture (env, mounts,
# capabilities, read-only fs, network reach) and, as a CONTROL, renders
# the same hostile page the OLD way (chromium --no-sandbox --print-to-pdf
# on a file:// URL with a canary in the environment) to show the fixture
# does catch a leak when one is possible.
#
#   ./deploy/renderer-attack.sh                    # run, then tear down
#   KEEP=1 ./deploy/renderer-attack.sh             # leave the stack up
#   STUDIO_HTML=/path/print.html ./deploy/...      # also render a real studio interior
#   CONTROL=0 ./deploy/...                         # skip the old-topology control
# Needs: docker with compose v2, and ../tools-bin/epubcheck.jar (install.sh
# downloads it) because the tools image copies it.
# Exit status: 0 only if every check passed.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"
# Git Bash on Windows: hand docker native paths (run with MSYS_NO_PATHCONV=1).
if command -v cygpath >/dev/null 2>&1; then REPO_ROOT="$(cygpath -m "${REPO_ROOT}")"; fi
FX="${REPO_ROOT}/deploy/renderer-attack"
PROJECT="${ATTACK_PROJECT:-beuk-attack}"
export ATTACK_PREFIX="${PROJECT}"
export POSTGRES_PASSWORD="BEUKCANARYPGPASS${RANDOM}"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/beuk-attack-out.XXXXXX")"
chmod 777 "${OUT}"
if command -v cygpath >/dev/null 2>&1; then OUT="$(cygpath -m "${OUT}")"; fi
COMPOSE=(docker compose -p "${PROJECT}" -f docker-compose.yml -f deploy/docker-compose.tools.yml -f deploy/renderer-attack/compose.attack.yml)
FAILS=0
pass() { printf '  PASS  %s\n' "$*"; }
fail() { printf '  FAIL  %s\n' "$*"; FAILS=$((FAILS + 1)); }
section() { printf '\n== %s\n' "$*"; }

cleanup() {
  if [ "${KEEP:-0}" != "1" ]; then
    "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

[ -f tools-bin/epubcheck.jar ] || { echo "tools-bin/epubcheck.jar missing (run deploy/install.sh once, or copy it in)"; exit 2; }

section "Build (${PROJECT}-app, ${PROJECT}-app-tools, ${PROJECT}-renderer)"
docker build -q -t "${PROJECT}-app:latest" . >/dev/null
"${COMPOSE[@]}" build -q app renderer

section "Up (db, renderer, app — no Caddy, no host ports)"
"${COMPOSE[@]}" up -d db renderer app >/dev/null
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then break; fi
  sleep 2
done
"${COMPOSE[@]}" ps --format '{{.Service}} {{.State}} ports=[{{.Ports}}]'

# Canary files on the app's volumes.
"${COMPOSE[@]}" exec -T app sh -c 'echo BEUKCANARYEXPORTFILE > /data/exports/canary.txt; echo BEUKCANARYBACKUPFILE > /data/backups/canary.txt'

section "Renderer container posture"
RID="$("${COMPOSE[@]}" ps -q renderer)"
ENV_DUMP="$(docker exec "${RID}" sh -c 'cat /proc/1/environ | tr "\0" "\n"')"
if printf '%s' "${ENV_DUMP}" | grep -Eq 'BEUKCANARY|DATABASE_URL|STRIPE|PEXELS|POSTGRES'; then
  fail "renderer environment carries app secrets"
else
  pass "renderer /proc/1/environ has no app secrets ($(printf '%s\n' "${ENV_DUMP}" | cut -d= -f1 | tr '\n' ' '))"
fi
MOUNTS="$(docker inspect -f '{{range .Mounts}}{{.Type}}:{{.Destination}} {{end}}' "${RID}")"
[ -z "${MOUNTS// /}" ] && pass "renderer has no volume/bind mounts" || fail "renderer mounts: ${MOUNTS}"
RO="$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "${RID}")"
[ "${RO}" = "true" ] && pass "renderer root filesystem is read-only" || fail "renderer root fs read-only=${RO}"
if docker exec "${RID}" sh -c 'touch /renderer/x 2>/dev/null'; then fail "renderer could write to /renderer"; else pass "write to /renderer refused"; fi
CAPEFF="$(docker exec "${RID}" sh -c 'grep CapEff /proc/1/status' | awk '{print $2}')"
[ "${CAPEFF}" = "0000000000000000" ] && pass "renderer effective capabilities: none (CapEff=${CAPEFF})" || fail "renderer CapEff=${CAPEFF}"
NNP="$(docker exec "${RID}" sh -c 'grep NoNewPrivs /proc/1/status' | awk '{print $2}')"
[ "${NNP}" = "1" ] && pass "renderer NoNewPrivs=1" || fail "renderer NoNewPrivs=${NNP}"
docker exec "${RID}" sh -c 'id' | sed 's/^/        /'
NETS="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "${RID}")"
printf '        renderer networks: %s\n' "${NETS}"
for target in http://db:5432/ https://example.com/ http://1.1.1.1/ http://169.254.169.254/; do
  if docker exec "${RID}" node -e "fetch('${target}',{signal:AbortSignal.timeout(4000)}).then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; then
    fail "renderer container can reach ${target}"
  else
    pass "renderer container cannot reach ${target}"
  fi
done
if docker exec "${RID}" node -e "fetch('http://app:3000/api/health',{signal:AbortSignal.timeout(4000)}).then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; then
  printf '  NOTE  the renderer CONTAINER can reach app:3000 (the shared internal network; the same public API Caddy serves). Chromium inside it is fenced off from it — see the PDF checks below.\n'
else
  pass "renderer container cannot reach app:3000"
fi

section "PDF/X ICC profile"
# The pdfx job needs a real CMYK profile at PDFX_def.ps's BeukICCPath.
# If the image's profile path does not exist (Debian bookworm's
# icc-profiles-free ships FOGRA characterisation data as .ti3 only, so
# Dockerfile.tools' *fogra*.icc search finds nothing), point it — in
# THIS throwaway proof container only — at Ghostscript's bundled
# default_cmyk.icc so the full job can finish and its PDF be inspected.
# That output is NOT a valid PDF/X claim (the definition file declares
# CGATS TR 001); it exists only to carry the rendered text.
ICC_NOW="$("${COMPOSE[@]}" exec -T app sh -c "sed -n 's|^/BeukICCPath (\(.*\)) def|\1|p' /app/tools/PDFX_def.ps")"
if "${COMPOSE[@]}" exec -T app test -f "${ICC_NOW}"; then
  printf '        BeukICCPath %s exists — used as is\n' "${ICC_NOW}"
else
  printf '  NOTE  BeukICCPath %s does not exist in the image; PROOF-ONLY: repointing at /usr/share/color/icc/ghostscript/default_cmyk.icc\n' "${ICC_NOW}"
  "${COMPOSE[@]}" exec -T -u root app sed -i 's|^/BeukICCPath .*|/BeukICCPath (/usr/share/color/icc/ghostscript/default_cmyk.icc) def|' /app/tools/PDFX_def.ps
fi

section "Direct renderer output (the exact HTML -> PDF step, from the app container)"
# The renderer's own PDF, before Ghostscript touches it: the boundary
# under test, with nothing downstream that could mask or alter content.
for name in attack legit; do
  "${COMPOSE[@]}" exec -T app node -e "
    const chunks=[]; process.stdin.on('data',c=>chunks.push(c)).on('end',async()=>{
      const r=await fetch('http://renderer:3100/render',{method:'POST',headers:{'content-type':'text/html'},body:Buffer.concat(chunks)});
      if(r.status!==200){console.error('renderer HTTP',r.status,await r.text());process.exit(1);}
      console.error('renderer blocked requests:', r.headers.get('x-beuk-blocked-requests'));
      process.stdout.write(Buffer.from(await r.arrayBuffer()));});" \
    < "${FX}/${name}-print.html" > "${OUT}/${name}-direct.pdf" \
    && printf '        %s-direct.pdf: %s bytes\n' "${name}" "$(wc -c < "${OUT}/${name}-direct.pdf")" \
    || fail "direct render of ${name} failed"
done

section "Submit hostile + legitimate print-html through the API"
EXTRA=()
if [ -n "${STUDIO_HTML:-}" ]; then EXTRA=(-v "${STUDIO_HTML}:/extra/studio-print.html:ro"); fi
docker run --rm --network "${PROJECT}_default" -v "${FX}:/fx:ro" -v "${OUT}:/out" "${EXTRA[@]}" \
  node:24-slim node /fx/drive.mjs

section "Extract PDF text (poppler pdftotext / pdfinfo) and rasterise job vs renderer pages"
# Ghostscript's PDF/X rewrite does not keep every glyph text-extractable,
# so the archived job PDFs are ALSO compared page-by-page as pixels
# against the renderer's own PDF (ImageMagick RMSE, normalised 0..1).
docker run --rm -v "${OUT}:/out" debian:bookworm-slim sh -c '
  apt-get update >/dev/null 2>&1 && apt-get install -y --no-install-recommends poppler-utils imagemagick >/dev/null 2>&1
  for f in /out/*.pdf; do pdftotext -layout "$f" "${f%.pdf}.txt"; pdfinfo "$f" > "${f%.pdf}.info"; done
  for n in attack legit; do
    [ -f /out/$n.pdf ] && [ -f /out/$n-direct.pdf ] || continue
    pdftoppm -r 40 -gray -png /out/$n.pdf /out/ras-$n-job; pdftoppm -r 40 -gray -png /out/$n-direct.pdf /out/ras-$n-direct
    : > /out/$n.rastercmp
    for j in /out/ras-$n-job-*.png; do d=$(echo "$j" | sed "s/-job-/-direct-/")
      if [ -f "$d" ]; then printf "%s %s\n" "$(basename "$j")" "$(compare -metric RMSE "$j" "$d" null: 2>&1 | sed "s/.*(\(.*\))/\1/")" >> /out/$n.rastercmp
      else printf "%s missing-in-direct\n" "$(basename "$j")" >> /out/$n.rastercmp; fi; done
  done
  chmod -R a+rw /out'

check_job_vs_direct() { # check_job_vs_direct NAME LABEL — job pages look like the renderer pages
  local n="$1" label="$2" f="${OUT}/$1.rastercmp"
  [ -s "${f}" ] || { fail "${label}: no raster comparison (missing PDF)"; return; }
  local jp dp
  jp="$(awk '/^Pages:/{print $2}' "${OUT}/${n}.info")"; dp="$(awk '/^Pages:/{print $2}' "${OUT}/${n}-direct.info")"
  [ "${jp}" = "${dp}" ] && pass "${label}: ${jp} pages, same as the renderer output" || fail "${label}: ${jp} pages vs renderer ${dp}"
  # The job's own record of the PDF the renderer handed it, against the
  # direct render of the same file: same renderer, same input, same size.
  local rb db
  rb="$(cat "${OUT}/${n}.renderedbytes" 2>/dev/null || echo missing)"; db="$(wc -c < "${OUT}/${n}-direct.pdf" | tr -d ' ')"
  [ "${rb}" = "${db}" ] && pass "${label}: the job's rendered PDF was ${rb} bytes, the same as the direct render" \
    || fail "${label}: job rendered ${rb} bytes vs direct ${db}"
  # Pixel RMSE is INFORMATION, not a gate: the PDF/X rewrite (CMYK,
  # boxes, glyph handling) shifts pixels on identical content. The page
  # images are kept (ras-*.png) for a human to compare.
  printf '  INFO  %s raster RMSE vs renderer per page: %s\n' "${label}" "$(awk '{printf "%s=%s ", $1, $2}' "${f}")"
}

LEAK_RE='BEUKCANARY|DATABASE_URL|postgres://|STRIPE|PEXELS|PATH=|HOSTNAME=|HOME=|NODE_VERSION|"ok"|"db"|db: *up|"busy"|maxBytes|Example Domain|documentation examples|JS-RAN|JS-FETCHED|JS-XHR|root:x:0|ami-id|instance-id'
check_attack_text() { # check_attack_text FILE LABEL EXPECT(clean|leak)
  local txt="$1" label="$2" expect="$3"
  [ -f "${txt}" ] || { fail "${label}: no PDF text (job did not produce a PDF)"; return; }
  grep -q 'ATTACKPAGERENDERED' "${txt}" && grep -q 'ENDOFATTACKFIXTURE' "${txt}" \
    && pass "${label}: page rendered and its text extracts (markers present)" \
    || fail "${label}: page markers missing — extraction proves nothing"
  local hits
  hits="$(grep -Eo "${LEAK_RE}" "${txt}" | sort | uniq -c | tr '\n' ';' || true)"
  if [ "${expect}" = "clean" ]; then
    [ -z "${hits}" ] && pass "${label}: no leak markers in the PDF text" || fail "${label}: LEAKED: ${hits}"
  else
    [ -n "${hits}" ] && pass "${label}: control leaked as expected: ${hits}" || fail "${label}: control did not leak — the fixture may be blind"
  fi
}

check_legit() { # check_legit BASENAME LABEL
  local base="$1" label="$2"
  if [ ! -f "${base}.txt" ]; then fail "${label}: no PDF produced"; return; fi
  local m
  for m in LEGITTITLEPAGE LEGITCHAPTERONE LEGITCHAPTERTWO LEGITENDOFBOOK; do
    grep -q "${m}" "${base}.txt" && pass "${label}: text '${m}' present" || fail "${label}: text '${m}' missing"
  done
  local pages size
  pages="$(awk '/^Pages:/{print $2}' "${base}.info")"
  size="$(awk -F': *' '/^Page size:/{print $2}' "${base}.info")"
  [ "${pages}" = "3" ] && pass "${label}: 3 pages (title + two chapters on fresh pages)" || fail "${label}: ${pages} pages, expected 3"
  case "${size}" in 396*x*612*) pass "${label}: page size ${size} (5.5 x 8.5 in = 396 x 612 pt)";; *) fail "${label}: page size ${size}, expected 396 x 612 pts";; esac
}

section "Hostile PDF — renderer output, then the archived pdfx job output"
check_attack_text "${OUT}/attack-direct.txt" "attack (renderer)" clean
grep -E '^(Pages|Page size|Producer)' "${OUT}/attack-direct.info" 2>/dev/null | sed 's/^/        /' || true
# The archived job output: no leak markers in whatever text survives the
# PDF/X rewrite, and visually the same pages as the renderer produced.
hits="$(grep -Eo "${LEAK_RE}" "${OUT}/attack.txt" 2>/dev/null | sort | uniq -c | tr '\n' ';' || true)"
[ -f "${OUT}/attack.txt" ] && [ -z "${hits}" ] && pass "attack (pdfx job): no leak markers in the PDF text" || fail "attack (pdfx job): missing or LEAKED: ${hits}"
check_job_vs_direct attack "attack (pdfx job)"

section "Legitimate PDF — renderer output, then the archived pdfx job output"
check_legit "${OUT}/legit-direct" "legit (renderer)"
check_legit "${OUT}/legit" "legit (pdfx job)"
check_job_vs_direct legit "legit (pdfx job)"
if [ -f "${OUT}/studio.info" ]; then
  section "Studio print interior (STUDIO_HTML)"
  grep -E '^(Pages|Page size)' "${OUT}/studio.info" | sed 's/^/        /'
  printf '        first lines: %s\n' "$(grep -v '^\s*$' "${OUT}/studio.txt" | head -n 3 | tr -s ' ' | tr '\n' '|')"
fi

section "Job results"
cat "${OUT}/summary.json" | sed 's/^/        /' | cut -c1-220

if [ "${CONTROL:-1}" = "1" ]; then
  section "CONTROL: the same hostile page rendered the OLD way"
  # Old pipeline: chromium --headless --no-sandbox --print-to-pdf on a
  # file:// URL, with whatever the process environment holds.
  docker run --rm -e BEUKCANARYCONTROL=leaked-secret-value -v "${FX}:/fx:ro" -v "${OUT}:/out" \
    --entrypoint chromium "${PROJECT}-renderer:latest" \
    --headless --disable-gpu --no-sandbox --hide-scrollbars --no-pdf-header-footer \
    --print-to-pdf=/out/control.pdf file:///fx/attack-print.html >/dev/null 2>&1 || true
  docker run --rm -v "${OUT}:/out" debian:bookworm-slim sh -c '
    apt-get update >/dev/null 2>&1 && apt-get install -y --no-install-recommends poppler-utils >/dev/null 2>&1
    [ -f /out/control.pdf ] && pdftotext -layout /out/control.pdf /out/control.txt; chmod -R a+rw /out'
  check_attack_text "${OUT}/control.txt" "control (old topology)" leak
fi

section "Result"
printf '  outputs kept in %s\n' "${OUT}"
if [ "${FAILS}" -eq 0 ]; then echo "  ALL CHECKS PASSED"; else echo "  ${FAILS} CHECK(S) FAILED"; exit 1; fi
