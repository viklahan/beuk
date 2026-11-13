import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/* BEUK:lanhttps — start-local.ps1 serves every IPv4 address on https too,
   from Caddy's local CA, so a phone on the same network gets a secure
   context (service worker: offline + install). Caddy itself was proven
   live (README "Run it locally"); here: the wiring that must not drift. */

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFile(path.join(here, '..', f), 'utf8');

test('lanhttps: no-SNI clients get the LAN certificate; production names none', async () => {
  const caddy = await read('Caddyfile');
  const global = caddy.slice(0, caddy.indexOf('{$DOMAIN}'));
  // The global block declares default_sni (and, since BEUK:tunnel, a
  // trusted_proxies servers block beside it): assert the directive, not
  // that it stands alone, so an unrelated global addition can't break this.
  assert.match(global, /^\tdefault_sni \{\$DEFAULT_SNI:beuk\.invalid\}$/m, 'global default_sni, harmless default');
});

test('lanhttps: the https sites have their own variable, never folded into DOMAIN', async () => {
  const caddy = await read('Caddyfile');
  // {$SITE_PREFIX} (BEUK:tunnel) is the leading seam: empty normally,
  // "http://" in tunnel mode. LAN_SITES must still be its own token
  // alongside DOMAIN and WWW_DOMAIN, never folded into DOMAIN.
  assert.match(caddy, /^\{\$SITE_PREFIX\}\{\$DOMAIN\} \{\$WWW_DOMAIN\} \{\$LAN_SITES\} \{$/m);
  // The www redirect names DOMAIN as one token: a list in DOMAIN broke Caddy.
  assert.match(caddy, /redir @www https:\/\/\{\$DOMAIN\}\{uri\} permanent/);
  const ps = await read('start-local.ps1');
  assert.match(ps, /\$siteAddr = if \(\$Lan\) \{ "http:\/\/:\$\{Port\}" \}/, 'DOMAIN stays one address');
  assert.match(ps, /LAN_SITES: `"\$lanSites`"/);
  assert.match(ps, /\$lanSites = \(@\("https:\/\/localhost:\$\{HttpsPort\}"\) \+ \(\$ips \| ForEach-Object \{ "https:\/\/\$\{_\}:\$\{HttpsPort\}" \}\)\) -join ' '/);
  assert.match(ps, /DEFAULT_SNI: `"\$lanIp`"/);
  assert.match(ps, /- `"\$\{HttpsPort\}:\$\{HttpsPort\}`"/, 'the https port is published');
});

test('lanhttps: the CA download exists only when start-local turns it on', async () => {
  const caddy = await read('Caddyfile');
  const m = caddy.match(/@localca \{\n\t\tpath \/beuk-local-ca\.crt\n\t\texpression `\{env\.BEUK_LOCAL_CA\} == "1"`\n\t\}/);
  assert.ok(m, 'path AND env gate in one matcher');
  const block = caddy.slice(caddy.indexOf('handle @localca {'), caddy.indexOf('handle /api/*'));
  assert.match(block, /root \* \/data\/caddy\/pki\/authorities\/local/);
  assert.match(block, /rewrite \* \/root\.crt/, 'the root certificate, never root.key');
  assert.doesNotMatch(block, /\.key/);
  const ps = await read('start-local.ps1');
  assert.match(ps, /\$caddyEnv = if \(\$Lan\) \{ "`n      LAN_SITES: `"\$lanSites`"`n      BEUK_LOCAL_CA: `"1`"" \} else \{ "" \}/, '-LocalOnly turns it off');
});
