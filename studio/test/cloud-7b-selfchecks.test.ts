import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import markup from '../src/generated/cloud-markup.json';
import { cloudFacts, loadClosure, pageEnv, resetCloudFacts, setClosureLang, setClosureT } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { importWire } from '../src/import/import';
import { cloudReset, loadCloud } from '../src/cloud/cloud';

/* Wave 7b — review focus #5: 1.0's self-checks for the wave's families (client/index.html, `id: "bulk.` 7, `id: "offline.`
   2, `id: "pwa.` 1, `id: "help.` 1; `beta`, `sw`, `errs`: 0), RUN VERBATIM where 2.0's code can hold them: each check's own
   object literal, cut out of 1.0's source by the TypeScript AST, is evaluated in a scope of 2.0's lifted 1.0 code — the
   main closure's api for bulk import (its bulkBuildBook in the import session, as the studio runs it), the shelf's module
   for offline — with 1.0's own two self-check helpers (scVerdict, FAKE_PNG) cut from the same source. Assignments a check
   makes to a module's own `let` (cloudDirty) reach that module (its vars). The rest are listed with their reason. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
const HTML = readFileSync(path.join(import.meta.dirname, '..', '..', 'client', 'index.html'), 'utf8');

export const SKIP: Record<string, string> = {
  'offline.reconciliation':
    "it drives 1.0's page whole (its state.history on the desk, window.fetch swapped, the conflict modal's markup and 1.0's resolveConflict's re-seat on 1.0's own state): 2.0's History is the Y.Doc's; re-expressed by cloud-7b (offline: queued, one save on reconnect, no conflict), cloud-ui's three conflict choices and the e2e (wave7b offline, wave7a conflict)",
  'pwa.installable':
    "it checks 1.0's manifest and 1.0's own worker (sw.js, its BEUK_CACHE and precache list): 2.0's worker is its own (public/sw.js, scope /next/), held by the e2e (wave7b update: scope, caches, the update flow)",
  'help.validator.beuk-codes': 'run verbatim by wave 5a (test/export-selfchecks.test.ts)',
};

type Check = { id: string; text: string };
let checks: Check[] = [];
let helpers = '';
beforeAll(async () => {
  const { studioScript } = await import('../../src/book/studio/closure');
  const sf = ts.createSourceFile('studio.js', studioScript(HTML), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const walk = (n: ts.Node) => {
    if (ts.isObjectLiteralExpression(n)) {
      const idp = n.properties.find((x): x is ts.PropertyAssignment => ts.isPropertyAssignment(x) && ts.isIdentifier(x.name) && x.name.text === 'id');
      const fp = n.properties.find((x): x is ts.PropertyAssignment => ts.isPropertyAssignment(x) && ts.isIdentifier(x.name) && x.name.text === 'feature');
      if (idp && fp && ts.isStringLiteral(idp.initializer) && /^(bulk|offline|pwa|help|beta|sw|errs)\./.test(idp.initializer.text)) checks.push({ id: idp.initializer.text, text: n.getText(sf) });
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  for (const st of sf.statements)
    if (ts.isVariableStatement(st) && st.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && ['scVerdict', 'FAKE_PNG'].includes(d.name.text))) helpers += st.getText(sf) + '\n';
  await loadClosure();
  setClosureT(t);
  setClosureLang('en');
}, 60_000);

/** 1.0's check object, evaluated in `scope` (names read and written through it: `with`, as 1.0's page has them global). */
function build(text: string, scope: Rec): { run: () => { pass: boolean; detail: string } } {
  const proxy = new Proxy(scope, { has: (o, k) => typeof k === 'string' && k in o });
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function('scope', `with (scope) { ${helpers} return (${text}); }`)(proxy);
}

describe("1.0's self-checks for wave 7b's families, run verbatim", () => {
  it('the counts, by the source: bulk 7, offline 2, pwa 1, help 1; beta, sw, errs 0', () => {
    const count = (f: string) => checks.filter((c) => c.id.startsWith(f + '.')).length;
    expect([count('bulk'), count('offline'), count('pwa'), count('help'), count('beta'), count('sw'), count('errs')]).toEqual([7, 2, 1, 1, 0, 0, 0]);
    expect(helpers).toContain('scVerdict');
  });

  it("bulk import's seven, on 2.0's main closure (bulkBuildBook in the import session)", async () => {
    const c = await importWire();
    resetCloudFacts();
    document.body.innerHTML = markup.shelf + markup.bulkHint;
    const scope: Rec = { ...c.api, cloud: cloudFacts, $: (id: string) => pageEnv.$(id) };
    // (a let 2.0 wraps: the check reaches the wrapped one, as 1.0's own code inside the closure does)
    Object.defineProperty(scope, 'bulkBuildBook', { get: () => c.vars.bulkBuildBook, enumerable: true });
    const bulk = checks.filter((x) => x.id.startsWith('bulk.'));
    const out = bulk.map((x) => {
      const r = build(x.text, scope).run();
      return x.id + ': ' + (r.pass ? 'pass' : 'FAIL ' + r.detail);
    });
    expect(out).toEqual(bulk.map((x) => x.id + ': pass'));
    document.body.innerHTML = '';
  }, 60_000);

  it("offline.state, on 2.0's shelf module (its setConnectivity, net pill and noteBookEdited)", async () => {
    const cm = await loadCloud();
    resetCloudFacts();
    cloudReset();
    document.body.innerHTML = markup.netPill + markup.syncRow + '<textarea id="editorArea"></textarea>';
    const scope: Rec = { ...cm.api, cloud: cloudFacts, t, $: (id: string) => document.getElementById(id) };
    Object.defineProperty(scope, 'cloudDirty', { get: () => cm.vars.cloudDirty, set: (v) => (cm.vars.cloudDirty = v), enumerable: true });
    const x = checks.find((k) => k.id === 'offline.state')!;
    const r = build(x.text, scope).run();
    expect(r.detail).toMatch(/true.*true.*true/);
    expect(r.pass).toBe(true);
    document.body.innerHTML = '';
    cloudReset();
  }, 60_000);

  it('every other check of these families is skipped with its reason', () => {
    const ran = new Set([...checks.filter((x) => x.id.startsWith('bulk.')).map((x) => x.id), 'offline.state']);
    const rest = checks.map((x) => x.id).filter((id) => !ran.has(id));
    expect(rest.sort()).toEqual(Object.keys(SKIP).sort());
  });
});
