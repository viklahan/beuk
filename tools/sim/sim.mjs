// Beuk world simulation — one entry point.
//
//   node tools/sim/sim.mjs all          up -> world -> seed -> personas -> monster -> check -> report -> down
//   node tools/sim/sim.mjs up | world | seed | personas | monster | check | report | down [--images]
//
// The stack is a separate, disposable compose project "beuk-sim" on
// http://localhost:8190 (tools/sim/docker-compose.sim.yml, tools/sim/sim.env).
// It never starts, stops or reads the local "beuk-saas" stack, its database
// or its volumes. "down" removes the sim containers AND their volumes.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const OUT = path.join(HERE, 'out');
const PROJECT = 'beuk-sim';
const BASE_URL = 'http://localhost:8190';
const RAMP = process.env.SIM_RAMP_DIR || path.resolve(HERE, '..', '..', '..', '..', 'beuk-whole-project', '10-ramp-gallery', 'books');
const SAGAS = process.env.SIM_SAGAS_DIR || path.resolve(HERE, '..', '..', '..', '..', 'beuk-whole-project', '10-ramp-gallery', 'sagas');
const COMPOSE = ['compose', '-p', PROJECT, '--env-file', 'tools/sim/sim.env', '-f', 'docker-compose.yml', '-f', 'deploy/docker-compose.tools.yml', '-f', 'tools/sim/docker-compose.sim.yml'];
const PW_IMAGE = 'mcr.microsoft.com/playwright:v1.49.1-noble';

const run = (cmd, args, opts = {}) => {
  console.log('[sim] $', cmd, args.join(' '));
  const r = spawnSync(cmd, args, { cwd: REPO, stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' }, ...opts });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${cmd} exited ${r.status}`);
  return r.status;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function up() {
  if (!existsSync(path.join(REPO, 'tools-bin', 'epubcheck.jar'))) {
    const main = process.env.SIM_TOOLS_BIN || path.resolve(HERE, '..', '..', '..', '..', 'beuk-final', 'beuk-saas', 'tools-bin');
    if (!existsSync(path.join(main, 'epubcheck.jar'))) throw new Error('tools-bin/epubcheck.jar missing (set SIM_TOOLS_BIN to a folder holding it)');
    cpSync(main, path.join(REPO, 'tools-bin'), { recursive: true });
  }
  run('docker', ['build', '-q', '-t', 'beuk-sim-base:latest', '.']);
  run('docker', [...COMPOSE, 'build']);
  run('docker', [...COMPOSE, 'up', '-d', '--remove-orphans']);
  for (let i = 0; i < 90; i++) {
    try { const r = await fetch(BASE_URL + '/api/health'); if (r.ok) { console.log('[sim] up:', BASE_URL, await r.text()); return; } } catch { /* not yet */ }
    await sleep(2000);
  }
  throw new Error('sim stack not healthy after 180 s');
}
function down(images) {
  run('docker', [...COMPOSE, 'down', '-v', '--remove-orphans'], { allowFail: true });
  if (images) run('docker', ['image', 'rm', '-f', 'beuk-sim-app:latest', 'beuk-sim-base:latest', 'beuk-sim-renderer:latest'], { allowFail: true });
}
function world() {
  run('node', ['tools/sim/world.mjs']);
}
/** A Playwright script, inside the pinned Playwright image, sharing the
 *  sim Caddy's network namespace (so http://localhost:8190 is the stack). */
function pw(script, extra = []) {
  mkdirSync(OUT, { recursive: true });
  const name = 'sim-pw-' + path.basename(script, '.mjs');
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  run('docker', ['run', '--rm', '--name', name, '--network', `container:${PROJECT}-caddy-1`, '--shm-size=2g',
    '-e', 'SIM_BASE=' + BASE_URL, '-e', 'SIM_ONLY=' + (process.env.SIM_ONLY || ''),
    '-v', `${HERE}:/sim`, '-v', `${RAMP}:/ramp:ro`, '-v', `${SAGAS}:/sagas`, '-v', 'beuk-pw-cache:/tmp/node_modules',
    PW_IMAGE, 'bash', '/sim/pw.sh', '/sim/' + script, ...extra]);
}

const cmd = process.argv[2];
const t0 = Date.now();
const phases = { up, down: () => down(process.argv.includes('--images')), world, seed: () => pw('seed.mjs'), personas: () => pw('personas.mjs'), monster: () => pw('monster.mjs'), check: () => run('node', ['tools/sim/checks.mjs']), report: () => run('node', ['tools/sim/report.mjs']) };
if (cmd === 'all') {
  const timings = {};
  try {
    for (const p of ['up', 'world', 'seed', 'personas', 'monster', 'check', 'report']) {
      const s = Date.now();
      await phases[p]();
      timings[p] = Date.now() - s;
      writeFileSync(path.join(OUT, 'phase-timings.json'), JSON.stringify(timings, null, 1));
    }
  } finally {
    if (!process.argv.includes('--keep')) down(false);
  }
  console.log('[sim] all done in', Math.round((Date.now() - t0) / 1000), 's');
} else if (phases[cmd]) {
  await phases[cmd]();
} else {
  console.log('usage: node tools/sim/sim.mjs all|up|world|seed|personas|monster|check|report|down [--images] [--keep]');
  process.exit(2);
}
