import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Db } from '../db.js';
import { checkWeeklyContent, clearWeeklyCache, loadIssueFolder, weeklyDir } from './content.js';

/**
 * The Beuk Weekly press's draft store (spec 2026-10-29). The Legion
 * drafter uploads an issue folder; it waits in <WEEKLY_DIR>/drafts/<id>/
 * until an admin approves it, which moves it to published/<NNN>/ where
 * the Weekly loader reads it beside git's content/weekly/en/.
 *
 *   drafted ──approve──▶ published
 *      │  ▲
 *  send back  replaceDraft (the drafter's rewrite)
 *      ▼  │
 *   sent_back           drafted / sent_back ──withdraw──▶ withdrawn
 *
 * Nothing here publishes on its own: approveAndPublish is called only by
 * an admin's Approve. One draft is open at a time (a partial unique index,
 * migration 020). The number and week are set at publish: the highest of
 * git's and the press's numbers plus one, dated the Monday of the publish
 * week, so a late approval never back-dates and never takes a number git
 * already has.
 *
 * Approve first claims the row with one atomic statement (drafted →
 * approved), so a double-click or a second tab can never publish twice:
 * the second claim matches no row. Then the folder is renamed into
 * published/, then the row is marked published. A failure before the
 * rename hands the draft back (approved → drafted); a crash after it
 * leaves the issue on disk with its row still `approved`, and the
 * Housekeeping check weekly.drafts.no-orphans names it.
 */

export interface DraftUpload {
  sourceCommit: string;
  /** File name → base64 content. A flat folder: no paths. */
  files: Record<string, string>;
  /** Stories the drafter could not source, and why. */
  dropped: { title: string; why: string }[];
  /** Outlets the drafter read this week, named so the editor can veto one. */
  outlets: string[];
}

export type DraftStatus = 'drafted' | 'sent_back' | 'approved' | 'published' | 'withdrawn';

export interface DraftRow {
  id: string;
  status: DraftStatus;
  issueNumber: number | null;
  week: string | null;
  sourceCommit: string;
  notes: string | null;
  dropped: { title: string; why: string }[];
  outlets: string[];
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export class DraftConflict extends Error {
  constructor(readonly id: string) {
    super('a draft is already waiting');
  }
}
export class DraftStateError extends Error {}
export class DraftInvalid extends Error {
  constructor(readonly problems: string[]) {
    super(`the draft is not valid: ${problems.join('; ')}`);
  }
}

const FILE_NAME = /^[a-z0-9][a-z0-9._-]*\.(md|jpg|jpeg|png|webp|json)$/;
const MAX_BYTES = 25 * 1024 * 1024;
const COMMIT = /^[0-9a-f]{7,40}$/;
const OPEN = ['drafted', 'sent_back'];

interface SourceEntry {
  url?: unknown;
  fetchedAt?: unknown;
  quote?: unknown;
  story?: unknown;
}

/** Everything wrong with an upload; empty means it may be stored. */
export function validateUpload(u: DraftUpload): string[] {
  const problems: string[] = [];
  if (typeof u?.sourceCommit !== 'string' || !COMMIT.test(u.sourceCommit)) problems.push('sourceCommit must be a git commit (7–40 hex characters)');
  if (!Array.isArray(u?.dropped) || u.dropped.some((d) => typeof d?.title !== 'string' || typeof d?.why !== 'string'))
    problems.push('dropped must be a list of { title, why }');
  if (!Array.isArray(u?.outlets) || u.outlets.some((o) => typeof o !== 'string')) problems.push('outlets must be a list of names');
  if (!u?.files || typeof u.files !== 'object') return [...problems, 'files is missing'];

  const decoded = new Map<string, Buffer>();
  let total = 0;
  for (const [name, content] of Object.entries(u.files)) {
    if (!FILE_NAME.test(name)) {
      problems.push(`${name}: not an allowed file name (a plain lower-case .md, .jpg, .jpeg, .png, .webp or .json name)`);
      continue;
    }
    if (typeof content !== 'string') {
      problems.push(`${name}: content must be base64 text`);
      continue;
    }
    const buf = Buffer.from(content, 'base64');
    total += buf.length;
    decoded.set(name, buf);
  }
  if (total > MAX_BYTES) problems.push(`the draft is ${Math.ceil(total / 1024 / 1024)} MB; the limit is 25 MB`);
  if (!decoded.has('issue.md')) problems.push('issue.md is required');
  if (!decoded.has('sources.json')) problems.push('sources.json is required (an empty list when there are no outside stories)');
  if (problems.length) return problems;

  let sources: SourceEntry[];
  try {
    sources = JSON.parse(decoded.get('sources.json')!.toString('utf8'));
    if (!Array.isArray(sources)) throw new Error('not a list');
  } catch (e) {
    return [`sources.json: not a JSON list (${(e as Error).message})`];
  }

  // Parse the folder exactly as the site will, as issue 1 on its own: the
  // real number is only set at publish.
  const tmp = mkdtempSync(path.join(tmpdir(), 'beuk-weekly-check-'));
  try {
    for (const [name, buf] of decoded) writeFileSync(path.join(tmp, name), buf);
    const issue = loadIssueFolder(tmp, 1);
    const own = { issues: [issue], issueByNumber: new Map([[1, issue]]), latest: issue, stamp: '' };
    for (const p of checkWeeklyContent(own)) problems.push(p.split(tmp + path.sep).join(''));
    for (const s of issue.storyBySlug.values()) {
      for (const url of s.sources) {
        const entry = sources.find((e) => e?.url === url);
        if (!entry) problems.push(`${s.slug}: source ${url} is not in sources.json (every outside source is fetched and quoted)`);
        else if (typeof entry.quote !== 'string' || !entry.quote.trim()) problems.push(`${s.slug}: source ${url} has no fetched quote in sources.json`);
      }
    }
  } catch (e) {
    problems.push((e as Error).message.split(tmp + path.sep).join(''));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return problems;
}

const draftDir = (dir: string, id: string) => path.join(dir, 'drafts', id);

function writeFolder(target: string, u: DraftUpload): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const staging = `${target}.incoming`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging);
  for (const [name, content] of Object.entries(u.files)) writeFileSync(path.join(staging, name), Buffer.from(content, 'base64'));
  rmSync(target, { recursive: true, force: true });
  renameSync(staging, target);
}

function toRow(r: Record<string, unknown>): DraftRow {
  const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
  const week = r.week == null ? null : r.week instanceof Date ? r.week.toISOString().slice(0, 10) : String(r.week).slice(0, 10);
  const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
  return {
    id: String(r.id),
    status: r.status as DraftStatus,
    issueNumber: r.issue_number == null ? null : Number(r.issue_number),
    week,
    sourceCommit: String(r.source_commit),
    notes: (r.notes as string | null) ?? null,
    dropped: json(r.dropped) as DraftRow['dropped'],
    outlets: json(r.outlets) as string[],
    approvedBy: (r.approved_by as string | null) ?? null,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    publishedAt: iso(r.published_at),
  };
}

export async function getDraft(db: Db, id: string): Promise<DraftRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await db.query('select * from weekly_drafts where id = $1', [id]);
  return r.rows[0] ? toRow(r.rows[0]) : null;
}

export async function listDrafts(db: Db, status?: DraftStatus): Promise<DraftRow[]> {
  const r = status
    ? await db.query('select * from weekly_drafts where status = $1 order by created_at desc', [status])
    : await db.query('select * from weekly_drafts order by created_at desc');
  return r.rows.map(toRow);
}

async function openDraft(db: Db): Promise<string | null> {
  const r = await db.query<{ id: string }>(`select id from weekly_drafts where status in ('drafted', 'sent_back') limit 1`);
  return r.rows[0]?.id ?? null;
}

export async function createDraft(db: Db, dir: string, u: DraftUpload): Promise<{ id: string }> {
  const problems = validateUpload(u);
  if (problems.length) throw new DraftInvalid(problems);
  const waiting = await openDraft(db);
  if (waiting) throw new DraftConflict(waiting);
  let id: string;
  try {
    const r = await db.query<{ id: string }>(
      `insert into weekly_drafts (status, source_commit, dropped, outlets) values ('drafted', $1, $2, $3) returning id`,
      [u.sourceCommit, JSON.stringify(u.dropped), JSON.stringify(u.outlets)],
    );
    id = r.rows[0].id;
  } catch (e) {
    // Two uploads racing: the partial unique index lets only one through.
    if ((e as { code?: string }).code === '23505') {
      const other = await openDraft(db);
      if (other) throw new DraftConflict(other);
    }
    throw e;
  }
  try {
    writeFolder(draftDir(dir, id), u);
  } catch (e) {
    await db.query('delete from weekly_drafts where id = $1', [id]);
    throw e;
  }
  return { id };
}

/** The drafter's rewrite of a sent-back draft: new files, back to drafted. */
export async function replaceDraft(db: Db, dir: string, id: string, u: DraftUpload): Promise<void> {
  const problems = validateUpload(u);
  if (problems.length) throw new DraftInvalid(problems);
  const r = await db.query<{ status: string }>('select status from weekly_drafts where id = $1', [id]);
  if (r.rows[0]?.status !== 'sent_back') throw new DraftStateError(`draft ${id} is ${r.rows[0]?.status ?? 'unknown'}, not sent back`);
  writeFolder(draftDir(dir, id), u);
  const done = await db.query(
    `update weekly_drafts set status = 'drafted', source_commit = $2, dropped = $3, outlets = $4, updated_at = now()
     where id = $1 and status = 'sent_back' returning id`,
    [id, u.sourceCommit, JSON.stringify(u.dropped), JSON.stringify(u.outlets)],
  );
  if (!done.rows.length) throw new DraftStateError(`draft ${id} changed while it was being rewritten`);
}

/** The Monday of `now`'s week, in UTC, as YYYY-MM-DD. */
export function mondayOf(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const folderNumbers = (root: string) =>
  existsSync(root) ? readdirSync(root).filter((f) => /^\d{3}$/.test(f)).map(Number) : [];

export async function approveAndPublish(
  db: Db,
  dir: string,
  id: string,
  userId: string,
  now: Date,
  opts: { gitRoot?: string } = {},
): Promise<{ number: number; week: string }> {
  const claim = await db.query(
    `update weekly_drafts set status = 'approved', approved_by = $2, updated_at = now() where id = $1 and status = 'drafted' returning id`,
    [id, userId],
  );
  if (!claim.rows.length) {
    const row = await getDraft(db, id);
    throw new DraftStateError(`draft ${id} is ${row?.status ?? 'unknown'}; only a drafted issue can be approved`);
  }
  const published = path.join(dir, 'published');
  let number: number;
  let week: string;
  try {
    const max = await db.query<{ n: number | null }>(`select max(issue_number) as n from weekly_drafts where status = 'published'`);
    number = Math.max(Number(max.rows[0].n ?? 0), ...folderNumbers(opts.gitRoot ?? weeklyDir('en')), ...folderNumbers(published), 0) + 1;
    week = mondayOf(now);
    const src = draftDir(dir, id);
    const ifile = path.join(src, 'issue.md');
    const issueMd = readFileSync(ifile, 'utf8').replace(/\r\n/g, '\n');
    if (!/^week: .*$/m.test(issueMd)) throw new DraftStateError(`draft ${id}: issue.md has no week line`);
    const target = path.join(published, String(number).padStart(3, '0'));
    if (existsSync(target)) throw new DraftStateError(`published/${path.basename(target)} already exists`);
    writeFileSync(ifile, issueMd.replace(/^week: .*$/m, `week: ${week}`));
    mkdirSync(published, { recursive: true });
    renameSync(src, target);
  } catch (e) {
    await db.query(`update weekly_drafts set status = 'drafted', approved_by = null, updated_at = now() where id = $1 and status = 'approved'`, [id]);
    throw e;
  }
  await db.query(
    `update weekly_drafts set status = 'published', issue_number = $2, week = $3, published_at = $4, updated_at = now() where id = $1`,
    [id, number, week, now.toISOString()],
  );
  clearWeeklyCache();
  return { number, week };
}

export async function sendBack(db: Db, id: string, notes: string): Promise<void> {
  const n = typeof notes === 'string' ? notes.trim() : '';
  if (!n || n.length > 4000) throw new DraftStateError('notes are 1–4000 characters');
  const r = await db.query(`update weekly_drafts set status = 'sent_back', notes = $2, updated_at = now() where id = $1 and status = 'drafted' returning id`, [id, n]);
  if (!r.rows.length) throw new DraftStateError(`draft ${id} is not waiting for the editor`);
}

export async function withdraw(db: Db, dir: string, id: string): Promise<void> {
  const r = await db.query(
    `update weekly_drafts set status = 'withdrawn', updated_at = now() where id = $1 and status = any($2::text[]) returning id`,
    [id, OPEN],
  );
  if (!r.rows.length) throw new DraftStateError(`draft ${id} is not open`);
  rmSync(draftDir(dir, id), { recursive: true, force: true });
}
