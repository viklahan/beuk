/**
 * Beuk Weekly drafter: decide what this run does, BEFORE any writing (and
 * before any of V's subscription is spent).
 *
 *   node --import tsx tools/weekly/plan-run.ts --server <url> [--weekly] [--force]
 *
 * Prints one JSON line: { action: rewrite | new | waiting | idle, ... }.
 *   rewrite  the editor sent a draft back: rewrite it with the notes
 *   new      the weekly trigger (or -Force), and no draft is waiting
 *   waiting  the weekly trigger, but last week's draft is still open:
 *            no new draft; the run tells the editor
 *   idle     the daily trigger with nothing sent back
 * The weekly trigger passes --weekly, so a Thursday missed with the
 * laptop off drafts at the next wake (StartWhenAvailable), whatever day
 * that is. The token is BEUK_WEEKLY_TOKEN. Exit 2 when the server
 * cannot be asked.
 */

export type RunPlan =
  | { action: 'rewrite'; replaces: string; notes: string | null }
  | { action: 'new' }
  | { action: 'waiting'; previewUrl: string }
  | { action: 'idle'; why: string };

export function decideRun(i: {
  sentBack: { id: string; notes: string | null }[];
  drafted: { id: string; previewUrl: string }[];
  weekly: boolean;
  force: boolean;
}): RunPlan {
  if (i.sentBack.length) return { action: 'rewrite', replaces: i.sentBack[0].id, notes: i.sentBack[0].notes };
  if (i.drafted.length) return i.weekly || i.force ? { action: 'waiting', previewUrl: i.drafted[0].previewUrl } : { action: 'idle', why: 'a draft is waiting for the editor' };
  if (i.weekly || i.force) return { action: 'new' };
  return { action: 'idle', why: 'not the weekly run, and nothing sent back' };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const i = args.indexOf('--server');
  const server = (i >= 0 ? args[i + 1] : '').replace(/\/$/, '');
  const get = async <T>(status: string): Promise<T> => {
    const res = await fetch(`${server}/api/weekly/drafts?status=${status}`, { headers: { authorization: `Bearer ${process.env.BEUK_WEEKLY_TOKEN ?? ''}` } });
    if (!res.ok) throw new Error(`GET drafts?status=${status} answered ${res.status}`);
    return (await res.json()) as T;
  };
  try {
    const plan = decideRun({
      sentBack: await get('sent_back'),
      drafted: await get('drafted'),
      weekly: args.includes('--weekly'),
      force: args.includes('--force'),
    });
    console.log(JSON.stringify(plan));
  } catch (err) {
    console.log(`could not ask the server at ${server}: ${(err as Error).message}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.filename === (await import('node:path')).resolve(process.argv[1])) await main();
