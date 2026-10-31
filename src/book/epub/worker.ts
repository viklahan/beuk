import vm from 'node:vm';
import { parentPort, workerData } from 'node:worker_threads';
import { makeSandbox } from './sandbox.js';

/* BEUK:epub-server — one EPUB build, in its own worker thread and its own
   vm context. The parent terminates the worker at the time cap and caps
   its heap (src/book/epub/closure.ts runWorker), so a book that makes the
   studio code spin or swell never stalls the server. */

export type WorkerJob = {
  mode: 'files' | 'build';
  code: string;
  jszip: string;
  clientDir: string;
  stateJson: string;
  platform: string;
  lang: string;
};

type Api = {
  buildEpubBlob(): Promise<Blob>;
  epubFiles(preset?: string): { path: string; content: string; binary?: boolean }[];
  ensureScriptFonts(sections: unknown, lang: unknown, meta: unknown): Promise<{ failed: string[]; displayFailed?: string[] }>;
  platformFilename(id?: string): string;
  setUiLang(lang: string): void;
};

async function run(job: WorkerJob): Promise<unknown> {
  const notes: string[] = [];
  const ctx = makeSandbox({ clientDir: job.clientDir, notes });
  new vm.Script(job.jszip, { filename: 'jszip.min.js' }).runInContext(ctx);
  new vm.Script(job.code, { filename: 'client/index.html (EPUB closure)' }).runInContext(ctx);
  /* The book enters as JSON parsed inside the context, so its arrays and
     objects belong to the studio code's own realm. */
  ctx.__beukStateJson = job.stateJson;
  vm.runInContext('globalThis.state = JSON.parse(globalThis.__beukStateJson); delete globalThis.__beukStateJson;', ctx);
  const api = ctx.__beukEpub as Api;
  api.setUiLang(job.lang);
  const state = ctx.state as { sections: unknown; meta: { language: unknown }; exportPlatform: string };
  state.exportPlatform = job.platform;
  if (job.mode === 'files') {
    await api.ensureScriptFonts(state.sections, state.meta.language, state.meta);
    const files = api.epubFiles(job.platform).map((f) => ({ path: String(f.path), content: String(f.content), binary: !!f.binary }));
    return { files, notes };
  }
  const blob = await api.buildEpubBlob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, notes, filename: api.platformFilename() };
}

if (parentPort) {
  run(workerData as WorkerJob).then(
    (out) => {
      const o = out as { bytes?: Uint8Array };
      parentPort!.postMessage({ ok: true, out }, o.bytes ? [o.bytes.buffer as ArrayBuffer] : []);
    },
    (err: unknown) => parentPort!.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
}
