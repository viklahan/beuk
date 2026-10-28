#!/usr/bin/env bash
# Runs inside mcr.microsoft.com/playwright:v1.49.1-noble (started by
# tools/sim/sim.mjs with --network container:beuk-sim-caddy-1, so
# http://localhost:8190 is the simulation stack's own origin — a secure
# context, the same origin the studio is served from).
# Playwright itself is cached on the beuk-pw-cache volume at /tmp/node_modules.
set -e
cd /tmp && [ -d node_modules/playwright ] || npm i -s playwright@1.49.1 >/dev/null 2>&1
cd /sim && for s in "$@"; do node "$s"; done
