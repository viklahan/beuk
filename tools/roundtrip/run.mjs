// Host side of the sample's print round trip: runs tools/roundtrip/sample-pdf.mjs
// in the pinned Playwright image, inside the running stack's Caddy network
// namespace (so http://localhost:8090 is the studio, as served). Usage:
//   node tools/roundtrip/run.mjs            (stack: beuk-saas)
//   RT_KEEP_PDF=1 node tools/roundtrip/run.mjs   (also keeps out/sample.pdf)
//   RT_PROJECT=beuk-sim RT_BASE=http://localhost:8190 node tools/roundtrip/run.mjs
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PW_IMAGE = 'mcr.microsoft.com/playwright:v1.49.1-noble';
const PROJECT = process.env.RT_PROJECT || 'beuk-saas';
const BASE = process.env.RT_BASE || 'http://localhost:8090';
const name = 'roundtrip-pw';
spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
const r = spawnSync('docker', ['run', '--rm', '--name', name, '--network', `container:${PROJECT}-caddy-1`, '--shm-size=2g',
  '-e', 'RT_BASE=' + BASE, '-e', 'RT_KEEP_PDF=' + (process.env.RT_KEEP_PDF || ''), '-v', `${HERE}:/rt`, '-v', 'beuk-pw-cache:/tmp/node_modules', PW_IMAGE,
  'bash', '-c', 'cd /tmp && ([ -d node_modules/playwright ] || npm i -s playwright@1.49.1 >/dev/null 2>&1) && node /rt/sample-pdf.mjs'], { stdio: 'inherit' });
process.exit(r.status ?? 1);
