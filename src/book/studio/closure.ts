import { createHash } from 'node:crypto';
import { Worker, type WorkerOptions } from 'node:worker_threads';
import ts from 'typescript';

/* BEUK:studio-closure — the generic half of running the studio's own code
   on the server (step 3, parts 3 and 4). A build names its ROOTS (the
   studio functions it calls), the SUPPLIED names its sandbox stands in
   for, and the CLOSURE: every top-level declaration reached from the
   roots. This module lifts those declarations out of client/index.html
   with the TypeScript parser, checks the list against what the code
   really reaches, and runs one build in a worker thread with a time cap,
   a heap cap and an environment holding only the temp-directory
   variables. The EPUB build (src/book/epub/closure.ts) and the cover
   wrap (src/book/wrap/closure.ts) are its two users. One source: no
   studio function is copied into src/. */

/** The interface-string tables t() reads: their declarations and every
 *  top-level statement that writes into them (the same selection
 *  tests/localization.test.ts guards; a write tucked elsewhere fails it). */
const STRING_TABLE = /^(UI_STRINGS|UI_LANG_ORDER|UI_LANG_NAMES|UI_PLURAL_FORMS|[A-Z][A-Z0-9_]*_STRINGS)$/;

export type ClosureSource = {
  /** The lifted statements in studio order, then the API object. */
  code: string;
  /** Declarations lifted (the closure plus, when asked, the string tables). */
  names: string[];
  /** Lines of studio code lifted. */
  lines: number;
  /** sha256 of the studio file the code came from. */
  studioSha: string;
};

/** The studio's main inline script: the one that declares epubFiles (it
 *  also holds the cover maker and every other export path). */
export function studioScript(studioHtml: string): string {
  for (const m of studioHtml.matchAll(/<script>([\s\S]*?)<\/script>\n/g)) if (m[1]!.includes('function epubFiles(')) return m[1]!;
  throw new Error('client/index.html: no inline <script> declares epubFiles');
}

const declNames = (st: ts.Statement): string[] => {
  if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) return [st.name.text];
  if (ts.isVariableStatement(st)) return st.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []));
  return [];
};

function rootOf(x: ts.Expression): string {
  while (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) x = x.expression;
  return ts.isIdentifier(x) ? x.text : '';
}

/** A direct write into a string table: Object.assign(T…, …) or T… = …. */
function directWrite(e: ts.Node, sf: ts.SourceFile): boolean {
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken) return STRING_TABLE.test(rootOf(e.left));
  if (ts.isCallExpression(e)) {
    const callee = e.expression.getText(sf);
    if (callee === 'Object.assign') return !!e.arguments[0] && STRING_TABLE.test(rootOf(e.arguments[0]));
    const m = /^Object\.keys\((\w+)\)\.forEach$/.exec(callee);
    if (m) return STRING_TABLE.test(m[1]!);
  }
  return false;
}

/** Does this top-level statement write into a string table? A direct
 *  write, the Object.keys(X_STRINGS).forEach merge, or the
 *  [["es", …], …].forEach(… Object.assign(UI_STRINGS[lang], …)) rows idiom. */
function writesTable(st: ts.Statement, sf: ts.SourceFile): boolean {
  if (!ts.isExpressionStatement(st)) return false;
  const e = st.expression;
  if (directWrite(e, sf)) return true;
  if (!ts.isCallExpression(e) || !ts.isPropertyAccessExpression(e.expression) || e.expression.name.text !== 'forEach') return false;
  if (!ts.isArrayLiteralExpression(e.expression.expression)) return false;
  let hit = false;
  const walk = (n: ts.Node): void => {
    if (hit) return;
    if (directWrite(n, sf)) hit = true;
    else ts.forEachChild(n, walk);
  };
  walk(e);
  return hit;
}

function indexStudio(studioHtml: string): { sf: ts.SourceFile; byName: Map<string, ts.Statement> } {
  const sf = ts.createSourceFile('studio.js', studioScript(studioHtml), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const byName = new Map<string, ts.Statement>();
  for (const st of sf.statements) for (const n of declNames(st)) if (!byName.has(n)) byName.set(n, st);
  return { sf, byName };
}

export type ExtractOptions = {
  /** Where the list lives, for the error message (e.g. "src/book/wrap/closure.ts WRAP_CLOSURE"). */
  listRef: string;
  /** Code appended after the lifted statements: the API object the worker calls. */
  api: string;
  /** Also lift the interface-string tables and every statement that writes into them (t() needs them). */
  stringTables: boolean;
};

/** Lift `names` out of the studio, in studio order. Throws naming every
 *  declaration that is missing. */
export function extractStudioSource(studioHtml: string, names: readonly string[], opts: ExtractOptions): ClosureSource {
  const { sf, byName } = indexStudio(studioHtml);
  const missing = names.filter((n) => !byName.has(n));
  if (missing.length) throw new Error(`client/index.html no longer declares: ${missing.join(', ')} (${opts.listRef})`);
  const take = new Set<ts.Statement>(names.map((n) => byName.get(n)!));
  if (opts.stringTables) {
    for (const st of sf.statements) {
      if (declNames(st).some((n) => STRING_TABLE.test(n)) || writesTable(st, sf)) take.add(st);
    }
  }
  const lifted = sf.statements.filter((st) => take.has(st));
  let lines = 0;
  const parts = lifted.map((st) => {
    const text = st.getText(sf);
    lines += text.split('\n').length;
    return text;
  });
  return {
    code: parts.join('\n') + opts.api,
    names: [...new Set(lifted.flatMap(declNames))],
    lines,
    studioSha: createHash('sha256').update(studioHtml).digest('hex'),
  };
}

/** Every top-level declaration the studio's code reaches from `roots`,
 *  stopping at `stop`. Property names and object keys are not references.
 *  It over-approximates (a local that shadows a top-level name still
 *  counts), which only makes the coverage check stricter. */
export function reachableFrom(studioHtml: string, roots: readonly string[], stop: readonly string[]): string[] {
  const { byName } = indexStudio(studioHtml);
  const refs = (node: ts.Node): string[] => {
    const out: string[] = [];
    const walk = (n: ts.Node): void => {
      if (ts.isIdentifier(n)) {
        const p = n.parent;
        const isKey = (ts.isPropertyAccessExpression(p) && p.name === n)
          || ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)) && p.name === n);
        if (!isKey) out.push(n.text);
      }
      ts.forEachChild(n, walk);
    };
    walk(node);
    return out;
  };
  const stopSet = new Set(stop);
  const seen = new Set<string>();
  const done = new Set<ts.Statement>();
  const queue = [...roots];
  while (queue.length) {
    const n = queue.pop()!;
    if (seen.has(n) || stopSet.has(n)) continue;
    seen.add(n);
    const st = byName.get(n);
    if (!st || done.has(st)) continue;
    done.add(st);
    for (const r of refs(st)) if (!seen.has(r)) queue.push(r);
  }
  return [...seen].filter((n) => byName.has(n)).sort();
}

/* ---- the worker runner: one build, its own thread, capped ---- */

/** The only variables a build worker sees: where the temp directory is
 *  (with none at all, Node on Windows resolves os.tmpdir() to
 *  "undefined/temp" in the working directory). Never DATABASE_URL, Stripe
 *  keys or any other secret. */
export const STUDIO_WORKER_ENV_KEYS: readonly string[] = ['TMPDIR', 'TMP', 'TEMP'];

/** A build worker's options: its own environment (STUDIO_WORKER_ENV_KEYS
 *  only) and a heap cap. */
export function studioWorkerOptions(workerData: unknown, heapMb: number): WorkerOptions {
  const env: Record<string, string> = {};
  for (const k of STUDIO_WORKER_ENV_KEYS) if (process.env[k]) env[k] = process.env[k]!;
  return { workerData, env, resourceLimits: { maxOldGenerationSizeMb: heapMb } };
}

export type BuildFailure = 'timeout' | 'memory' | 'failed';

export type RunOptions = {
  timeoutMs: number;
  heapMb: number;
  /** What the build makes, for the messages ("EPUB", "cover wrap"). */
  noun: string;
  /** The error the caller's route recognises. */
  error: (message: string, reason: BuildFailure) => Error;
};

/** Run one build in a fresh worker. It answers with { ok, out } or
 *  { ok: false, error }; the parent stops it at the time cap, and an
 *  out-of-heap worker is a 'memory' failure. */
export function runStudioWorker(url: URL, workerData: unknown, opts: RunOptions): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const w = new Worker(url, studioWorkerOptions(workerData, opts.heapMb));
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      void w.terminate();
    };
    const timer = setTimeout(() => done(() => reject(opts.error(`the ${opts.noun} build did not finish within ${opts.timeoutMs} ms and was stopped`, 'timeout'))), opts.timeoutMs);
    w.once('message', (m: { ok: boolean; out?: unknown; error?: string }) =>
      done(() => (m.ok ? resolve(m.out) : reject(opts.error(`the ${opts.noun} build failed: ${m.error}`, 'failed')))));
    w.once('error', (err: Error & { code?: string }) =>
      done(() => reject(err.code === 'ERR_WORKER_OUT_OF_MEMORY'
        ? opts.error(`the ${opts.noun} build ran out of memory and was stopped`, 'memory')
        : opts.error(`the ${opts.noun} build failed: ${err.message}`, 'failed'))));
    w.once('exit', (code) => done(() => reject(opts.error(`the ${opts.noun} build stopped (exit ${code})`, 'failed'))));
  });
}

/** The worker module next to `moduleUrl`: worker.ts under tsx (tests,
 *  dev), worker.js in dist. */
export function siblingWorkerUrl(moduleUrl: string): URL {
  return new URL(moduleUrl.endsWith('.ts') ? './worker.ts' : './worker.js', moduleUrl);
}
