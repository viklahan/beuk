/**
 * Beuk Weekly drafter: hand a draft to the Beuk server, or report a run that
 * could not make one. The token comes from BEUK_WEEKLY_TOKEN, which
 * draft.ps1 sets for this process from Windows Credential Manager.
 *
 *   upload.ts <folder> --server <url> --commit <sha> [--replaces <id>]
 *   upload.ts --failed "<step>: <message>" --server <url>
 *
 * Exit codes:
 *   0  uploaded (the server's JSON reply is the last line) / failure reported
 *   1  refused: no token, a bad draft (every problem listed), or another refusal
 *   2  could not reach the server, or it answered 5xx
 *   3  a draft is already waiting; this run reported that through /failed,
 *      so V hears about it instead of nothing happening
 */
import { folderUpload } from './folder.js';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const server = (flag('--server') ?? '').replace(/\/$/, '');
const token = process.env.BEUK_WEEKLY_TOKEN ?? '';

/** Thrown to end the run with an exit code. process.exit() straight after a
 *  fetch can trip a libuv assertion on Windows and lose the code, so main()
 *  sets process.exitCode and returns instead. */
class Done {
  constructor(readonly code: number) {}
}
const done = (code: number): never => {
  throw new Done(code);
};

async function post(p: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(`${server}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.log(`could not reach the server at ${server}: ${(err as Error).message}`);
    done(2);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status >= 500) {
    console.log(`the server answered ${res.status}: ${JSON.stringify(data)}`);
    done(2);
  }
  return { status: res.status, data };
}

async function main(): Promise<void> {
  if (!server) {
    console.log('usage: upload.ts <folder> --server <url> --commit <sha> | --failed "<reason>" --server <url>');
    done(1);
  }
  if (!token) {
    console.log('BEUK_WEEKLY_TOKEN is empty: no press token for this run');
    done(1);
  }
  const failed = flag('--failed');
  if (failed !== undefined) {
    const r = await post('/api/weekly/drafts/failed', { reason: failed.slice(0, 2000) });
    console.log(`failure reported (${r.status}): ${JSON.stringify(r.data)}`);
    done(r.status === 202 ? 0 : 1);
  }
  const dir = args[0];
  const commit = flag('--commit') ?? '';
  const replaces = flag('--replaces');
  const r = await post('/api/weekly/drafts', { ...folderUpload(dir, commit), ...(replaces ? { replaces } : {}) });
  if (r.status === 201) {
    console.log(JSON.stringify(r.data));
    done(0);
  }
  if (r.status === 409 && typeof r.data.previewUrl === 'string') {
    const reason = `last week's draft is still waiting: ${r.data.previewUrl}`;
    console.log(reason);
    await post('/api/weekly/drafts/failed', { reason });
    done(3);
  }
  if (r.status === 400 && Array.isArray(r.data.problems)) {
    console.log(`the server refused the draft:\n${(r.data.problems as string[]).map((p) => `  - ${p}`).join('\n')}`);
  } else {
    console.log(`the server refused the draft (${r.status}): ${JSON.stringify(r.data)}`);
  }
  done(1);
}

await main().catch((e) => {
  if (e instanceof Done) process.exitCode = e.code;
  else {
    console.log(`upload failed: ${(e as Error).message}`);
    process.exitCode = 1;
  }
});
