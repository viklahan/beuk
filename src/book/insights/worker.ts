import vm from 'node:vm';
import { parentPort, workerData } from 'node:worker_threads';
import { makeSandbox } from '../epub/sandbox.js';

/* BEUK:insights-server — one book's insights, in its own worker thread and
   its own vm context. The parent caps its time and heap (closure.ts
   runWorker), so a pathological book never stalls the server. The studio's
   insComputeFor is pure data, so unlike the EPUB worker there is no
   JSZip, no font fetch, and nothing to transfer back but a plain object. */

export type WorkerJob = {
  mode: 'insights';
  code: string;
  clientDir: string;
  sectionsJson: string;
  lang: string;
};

type Api = {
  compute(sections: unknown, lang: string): unknown;
  setUiLang(lang: string): void;
};

function run(job: WorkerJob): unknown {
  const notes: string[] = [];
  const ctx = makeSandbox({ clientDir: job.clientDir, notes });
  new vm.Script(job.code, { filename: 'client/index.html (insights closure)' }).runInContext(ctx);
  // A minimal `state` is SUPPLIED (not lifted): the word-count helpers read
  // state.meta.language (the book language, as a fallback) and state.sections
  // (the TOC word total). It enters as JSON parsed inside the context so its
  // arrays and objects belong to the studio code's own realm.
  (ctx as Record<string, unknown>).__beukStateJson = JSON.stringify({ meta: { language: job.lang }, sections: JSON.parse(job.sectionsJson) });
  vm.runInContext('globalThis.state = JSON.parse(globalThis.__beukStateJson); delete globalThis.__beukStateJson;', ctx);
  const api = (ctx as Record<string, unknown>).__beukInsights as Api;
  api.setUiLang(job.lang);
  const data = api.compute((ctx as { state: { sections: unknown } }).state.sections, job.lang);
  // Back across the boundary as plain JSON (the studio realm's object graph
  // does not survive postMessage otherwise).
  return { data: JSON.parse(JSON.stringify(data)) };
}

if (parentPort) {
  try {
    parentPort.postMessage({ ok: true, out: run(workerData as WorkerJob) });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
