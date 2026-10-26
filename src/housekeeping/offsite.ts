import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import {
  createBackup,
  isValidBackupName,
  readManifest,
  type BackupManifest,
} from './backup.js';
import { writeAudit } from './context.js';
import { writeFileAtomic } from './fsutil.js';
import type { HousekeepingLock } from './lock.js';
import { scrubText } from './scrub.js';

/**
 * Scheduled local backups + encrypted off-site copies (restic) +
 * a restore drill. Phase 1 of docs/plan-billing-backups-restore-branding.md.
 *
 * Off-site target: Backblaze B2 through its S3-compatible API. restic's
 * own docs: "Due to issues with error handling in the current B2 library
 * that restic uses, the recommended way to utilize Backblaze B2 is by
 * using its S3-compatible API" — repository "s3:https://server:port/bucket"
 * with the S3 keys in AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
 * https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html
 * Backblaze's restic guide uses the same S3 form:
 * https://www.backblaze.com/docs/cloud-storage-integrate-restic-with-backblaze-b2
 *
 * restic encrypts everything before it leaves the box; the repository
 * password (RESTIC_PASSWORD) is the only key — "Losing your password
 * means that your data is irrecoverably lost." (same docs page).
 *
 * Every restic call gets a MINIMAL environment (repository, password,
 * the two S3 keys, cache dir): none of the app's other secrets reach
 * the child, credentials never go on argv, and every message stored or
 * returned passes through the secret scrubber.
 *
 * Status lives next to the backups as dot-files (never listed as
 * backups: names starting with "." are not valid backup names):
 *   .schedule-status.json  last scheduled local backup
 *   .offsite-status.json   last off-site backup + retention run
 *   .drill-status.json     last restore drill
 * Nothing here deletes a local backup: local retention is undecided.
 */

/* ---------------- configuration ---------------- */

export interface OffsiteSettings {
  repository: string;
  env: Record<string, string>;
}

/** Null unless every off-site setting is present. */
export function offsiteSettings(config: Config): OffsiteSettings | null {
  const o = config.offsite;
  if (!o.b2KeyId || !o.b2ApplicationKey || !o.b2Bucket || !o.b2Endpoint || !o.resticPassword) {
    return null;
  }
  const endpoint = /^https?:\/\//.test(o.b2Endpoint) ? o.b2Endpoint : `https://${o.b2Endpoint}`;
  const prefix = o.repoPrefix ? `/${o.repoPrefix.replace(/^\/+|\/+$/g, '')}` : '';
  const repository = `s3:${endpoint.replace(/\/+$/, '')}/${o.b2Bucket}${prefix}`;
  return {
    repository,
    env: {
      RESTIC_REPOSITORY: repository,
      RESTIC_PASSWORD: o.resticPassword,
      AWS_ACCESS_KEY_ID: o.b2KeyId,
      AWS_SECRET_ACCESS_KEY: o.b2ApplicationKey,
      RESTIC_CACHE_DIR: path.join(config.backupDir, '.restic-cache'),
      HOME: os.tmpdir(),
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    },
  };
}

/** Which off-site settings are missing (names only, never values). */
export function missingOffsiteSettings(config: Config): string[] {
  const o = config.offsite;
  const missing: string[] = [];
  if (!o.b2KeyId) missing.push('OFFSITE_B2_KEY_ID');
  if (!o.b2ApplicationKey) missing.push('OFFSITE_B2_APPLICATION_KEY');
  if (!o.b2Bucket) missing.push('OFFSITE_B2_BUCKET');
  if (!o.b2Endpoint) missing.push('OFFSITE_B2_ENDPOINT');
  if (!o.resticPassword) missing.push('RESTIC_PASSWORD');
  return missing;
}

/* ---------------- restic runner (the seam tests replace) ---------------- */

export interface ResticOutcome {
  code: number;
  stdout: string;
  stderr: string;
}
export type ResticRunner = (
  args: string[],
  env: Record<string, string>,
  timeoutMs: number,
) => Promise<ResticOutcome>;

export function execRestic(bin: string): ResticRunner {
  return (args, env, timeoutMs) =>
    new Promise((resolve) => {
      execFile(
        bin,
        args,
        { env, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
        (err, stdout, stderr) => {
          const e = err as (NodeJS.ErrnoException & { code?: number | string; killed?: boolean }) | null;
          let code = 0;
          if (e) {
            if (typeof e.code === 'number') code = e.code;
            else if (e.killed) code = RESTIC_TIMED_OUT;
            else code = 127;
          }
          const extra = e && typeof e.code !== 'number' ? `\n${e.message}` : '';
          resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') + extra });
        },
      );
    });
}

/** restic exit codes (https://restic.readthedocs.io/en/stable/075_scripting.html):
 *  0 ok, 1 failed, 3 backup could not read some source data, 10 repository
 *  does not exist (>= 0.17.0), 11 lock failed, 12 wrong password (>= 0.17.1),
 *  130 cancelled. "If an unknown exit code is returned, then it MUST be
 *  treated as a command failure." */
const RESTIC_NO_REPO = 10;
/** What execRestic reports when our own timeout stopped restic. */
const RESTIC_TIMED_OUT = 124;

function lastLines(text: string, n = 6): string {
  return text.trim().split('\n').filter(Boolean).slice(-n).join(' | ');
}

/* ---------------- status files ---------------- */

export interface ScheduleStatus {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastBackupName: string | null;
  lastError: string | null;
}
export interface OffsiteStatus {
  repository: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastSnapshotId: string | null;
  lastBackupName: string | null;
  lastDataAdded: number | null;
  /** Null when the most recent attempt succeeded. */
  lastError: string | null;
  lastErrorAt: string | null;
  retention: { ranAt: string; ok: boolean; detail: string } | null;
}
export interface DrillStatus {
  lastRunAt: string | null;
  ok: boolean | null;
  snapshotId: string | null;
  backupName: string | null;
  detail: string | null;
}

export const STATUS_FILES = {
  schedule: '.schedule-status.json',
  offsite: '.offsite-status.json',
  drill: '.drill-status.json',
} as const;

async function readStatus<T>(config: Config, file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(config.backupDir, file), 'utf8')) as T;
  } catch {
    return null;
  }
}
async function writeStatus(config: Config, file: string, value: unknown, secrets: readonly string[]): Promise<void> {
  await writeFileAtomic(path.join(config.backupDir, file), scrubText(JSON.stringify(value, null, 2), secrets));
}
export const readScheduleStatus = (c: Config) => readStatus<ScheduleStatus>(c, STATUS_FILES.schedule);
export const readOffsiteStatus = (c: Config) => readStatus<OffsiteStatus>(c, STATUS_FILES.offsite);
export const readDrillStatus = (c: Config) => readStatus<DrillStatus>(c, STATUS_FILES.drill);

/* ---------------- the service ---------------- */

export interface OffsiteDeps {
  db: Db;
  config: Config;
  secrets: readonly string[];
  runRestic?: ResticRunner;
  now?: () => Date;
}

export interface OffsiteRunResult {
  ok: boolean;
  snapshotId: string | null;
  detail: string;
}

export interface DrillResult {
  ok: boolean;
  snapshotId: string | null;
  backupName: string | null;
  detail: string;
}

export class OffsiteBackups {
  private readonly run: ResticRunner;
  private readonly now: () => Date;
  constructor(private readonly deps: OffsiteDeps) {
    this.run = deps.runRestic ?? execRestic(deps.config.offsite.resticBin);
    this.now = deps.now ?? (() => new Date());
  }

  private get config(): Config {
    return this.deps.config;
  }
  private scrub(text: string): string {
    return scrubText(text, this.deps.secrets);
  }

  private async restic(settings: OffsiteSettings, args: string[], timeoutMs = this.config.offsite.resticTimeoutMs): Promise<ResticOutcome> {
    const out = await this.run(args, settings.env, timeoutMs);
    return { code: out.code, stdout: this.scrub(out.stdout), stderr: this.scrub(out.stderr) };
  }

  private fail(step: string, out: ResticOutcome): Error {
    const text = out.stderr || out.stdout;
    // restic retries backend errors (a wrong key, a missing bucket) with
    // backoff instead of exiting; when our timeout stops it, the useful
    // part is the error it kept retrying on, e.g. "Stat: The request
    // signature we calculated does not match the signature you provided."
    const retried = [...text.matchAll(/returned error, retrying after [^:]+: (.*)$/gm)].map((m) => m[1]);
    if (out.code === RESTIC_TIMED_OUT && retried.length) {
      return new Error(`restic ${step} gave up after the timeout; it kept retrying on: ${retried[retried.length - 1]}`);
    }
    return new Error(`restic ${step} failed (exit ${out.code}): ${lastLines(text) || 'no output'}`);
  }

  /** `restic cat config`: 0 = exists; 10 = no repository yet -> init.
   *  Runs with the short probe timeout: restic 0.19.1 retries a wrong
   *  key or a missing bucket for minutes rather than exiting (observed
   *  against MinIO in the full-stack proof). */
  private async ensureRepository(settings: OffsiteSettings): Promise<'existing' | 'initialised'> {
    const probe = await this.restic(settings, ['cat', 'config'], this.config.offsite.probeTimeoutMs);
    if (probe.code === 0) return 'existing';
    if (probe.code !== RESTIC_NO_REPO) throw this.fail('cat config', probe);
    const init = await this.restic(settings, ['init']);
    if (init.code !== 0) throw this.fail('init', init);
    return 'initialised';
  }

  /** Copy one local backup directory off-site, then apply retention. */
  async pushBackup(backupName: string): Promise<OffsiteRunResult> {
    const settings = offsiteSettings(this.config);
    if (!settings) {
      return { ok: false, snapshotId: null, detail: `off-site backups not configured (missing ${missingOffsiteSettings(this.config).join(', ')})` };
    }
    if (!isValidBackupName(backupName)) throw new Error(`invalid backup name: ${backupName}`);
    const previous = (await readOffsiteStatus(this.config)) ?? emptyOffsite();
    const startedAt = this.now().toISOString();
    const o = this.config.offsite;
    try {
      const repo = await this.ensureRepository(settings);
      const backup = await this.restic(settings, [
        'backup', '--json', '--host', o.resticHost, '--tag', o.resticTag,
        path.join(this.config.backupDir, backupName),
      ]);
      if (backup.code !== 0) throw this.fail('backup', backup);
      const summary = backup.stdout
        .split('\n')
        .map((line) => { try { return JSON.parse(line) as Record<string, unknown>; } catch { return null; } })
        .find((m) => m?.message_type === 'summary');
      const snapshotId = typeof summary?.snapshot_id === 'string' ? summary.snapshot_id : null;
      if (!snapshotId) throw new Error('restic backup reported no snapshot_id in its summary');
      const dataAdded = typeof summary?.data_added === 'number' ? summary.data_added : null;

      // Retention: restic groups by host+paths by default; every backup
      // here has its own path, so group by host+tags instead or nothing
      // would ever be forgotten.
      // https://restic.readthedocs.io/en/stable/060_forget.html
      const forget = await this.restic(settings, [
        'forget', '--host', o.resticHost, '--tag', o.resticTag, '--group-by', 'host,tags',
        '--keep-daily', String(o.keepDaily), '--keep-weekly', String(o.keepWeekly),
        '--keep-monthly', String(o.keepMonthly), '--prune',
      ]);
      const retention = {
        ranAt: this.now().toISOString(),
        ok: forget.code === 0,
        detail: forget.code === 0
          ? `keep daily ${o.keepDaily} / weekly ${o.keepWeekly} / monthly ${o.keepMonthly}: ${lastLines(forget.stdout, 3) || 'done'}`
          : this.fail('forget --prune', forget).message,
      };
      const status: OffsiteStatus = {
        repository: settings.repository,
        lastAttemptAt: startedAt,
        lastSuccessAt: this.now().toISOString(),
        lastSnapshotId: snapshotId,
        lastBackupName: backupName,
        lastDataAdded: dataAdded,
        lastError: retention.ok ? null : retention.detail,
        lastErrorAt: retention.ok ? null : retention.ranAt,
        retention,
      };
      await writeStatus(this.config, STATUS_FILES.offsite, status, this.deps.secrets);
      return {
        ok: retention.ok,
        snapshotId,
        detail: `snapshot ${snapshotId} of ${backupName} (${repo} repository, ${dataAdded ?? '?'} bytes added); retention ${retention.ok ? 'ran' : 'FAILED'}`,
      };
    } catch (err) {
      const message = this.scrub(err instanceof Error ? err.message : String(err));
      await writeStatus(this.config, STATUS_FILES.offsite, {
        ...previous,
        repository: settings.repository,
        lastAttemptAt: startedAt,
        lastError: message,
        lastErrorAt: this.now().toISOString(),
      } satisfies OffsiteStatus, this.deps.secrets);
      return { ok: false, snapshotId: null, detail: message };
    }
  }

  /** Restore the latest off-site snapshot into a fresh temp directory
   *  and check it against its own manifest: file hashes, per-table row
   *  counts, export file count/bytes, and (when the local copy still
   *  exists) byte-identical manifest. The temp directory is removed. */
  async drill(): Promise<DrillResult> {
    const settings = offsiteSettings(this.config);
    if (!settings) {
      return { ok: false, snapshotId: null, backupName: null, detail: 'off-site backups not configured' };
    }
    const o = this.config.offsite;
    const ranAt = this.now().toISOString();
    let result: DrillResult;
    let scratch: string | null = null;
    try {
      const list = await this.restic(settings, ['snapshots', '--json', '--host', o.resticHost, '--tag', o.resticTag, 'latest']);
      if (list.code !== 0) throw this.fail('snapshots', list);
      const snaps = JSON.parse(list.stdout || '[]') as { id?: string; short_id?: string; paths?: string[] }[];
      const snap = snaps[0];
      if (!snap?.id || !snap.paths?.length) throw new Error('the off-site repository holds no Beuk snapshot to drill');
      scratch = await mkdtemp(path.join(os.tmpdir(), 'beuk-drill-'));
      const restore = await this.restic(settings, ['restore', snap.id, '--target', scratch]);
      if (restore.code !== 0) throw this.fail('restore', restore);
      const dir = path.join(scratch, snap.paths[0]);
      const problems = await verifyRestoredBackup(dir, this.config);
      const name = path.basename(snap.paths[0]);
      result = problems.problems.length
        ? { ok: false, snapshotId: snap.id, backupName: name, detail: `restored ${name} but: ${problems.problems.join('; ')}` }
        : { ok: true, snapshotId: snap.id, backupName: name, detail: `restored ${name} from snapshot ${snap.short_id ?? snap.id}: ${problems.summary}` };
    } catch (err) {
      result = { ok: false, snapshotId: null, backupName: null, detail: this.scrub(err instanceof Error ? err.message : String(err)) };
    } finally {
      // Only the drill's own mkdtemp directory is removed.
      if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => {});
    }
    await writeStatus(this.config, STATUS_FILES.drill, {
      lastRunAt: ranAt,
      ok: result.ok,
      snapshotId: result.snapshotId,
      backupName: result.backupName,
      detail: result.detail,
    } satisfies DrillStatus, this.deps.secrets);
    return result;
  }
}

function emptyOffsite(): OffsiteStatus {
  return {
    repository: null, lastAttemptAt: null, lastSuccessAt: null, lastSnapshotId: null,
    lastBackupName: null, lastDataAdded: null, lastError: null, lastErrorAt: null, retention: null,
  };
}

/** Check a restored backup directory against its own manifest. */
export async function verifyRestoredBackup(
  dir: string,
  config: Config,
): Promise<{ problems: string[]; summary: string }> {
  const problems: string[] = [];
  let manifestRaw: string;
  try {
    manifestRaw = await readFile(path.join(dir, 'manifest.json'), 'utf8');
  } catch {
    return { problems: ['manifest.json missing from the restored snapshot'], summary: '' };
  }
  const manifest = JSON.parse(manifestRaw) as BackupManifest;
  for (const f of manifest.files) {
    try {
      const bytes = await readFile(path.join(dir, f.path));
      const sha = createHash('sha256').update(bytes).digest('hex');
      if (sha !== f.sha256) problems.push(`${f.path} sha256 mismatch`);
    } catch {
      problems.push(`${f.path} missing`);
    }
  }
  let tableSummary = '';
  try {
    const doc = JSON.parse(await readFile(path.join(dir, 'db.json'), 'utf8')) as { tables: Record<string, unknown[]> };
    const parts: string[] = [];
    for (const [table, expected] of Object.entries(manifest.tables)) {
      const actual = Array.isArray(doc.tables[table]) ? doc.tables[table].length : -1;
      if (actual !== expected) problems.push(`${table}: manifest ${expected} rows, db.json ${actual}`);
      parts.push(`${table}=${actual}`);
    }
    tableSummary = parts.join(' ');
  } catch {
    problems.push('db.json unreadable');
  }
  let count = 0;
  let bytes = 0;
  const walk = async (d: string): Promise<void> => {
    for (const entry of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) { count += 1; bytes += (await stat(full)).size; }
    }
  };
  await walk(path.join(dir, 'files'));
  if (count !== manifest.exportFiles.count || bytes !== manifest.exportFiles.bytes) {
    problems.push(`export files: manifest ${manifest.exportFiles.count} files/${manifest.exportFiles.bytes} B, restored ${count}/${bytes} B`);
  }
  const local = await readManifest(config, manifest.name);
  let localNote = 'local copy no longer present';
  if (local) {
    if (JSON.stringify(local) !== JSON.stringify(manifest)) problems.push('restored manifest differs from the local copy');
    else localNote = 'manifest identical to the local copy';
  }
  return {
    problems,
    summary: `${manifest.files.length} file hashes match, rows ${tableSummary}, ${count} export files (${bytes} B), ${localNote}`,
  };
}

/* ---------------- the scheduler ---------------- */

export interface SchedulerDeps extends OffsiteDeps {
  lock: HousekeepingLock;
}

const HOUR = 3_600_000;

/** One tick: if a scheduled backup is due, take the lock, make a local
 *  backup, push it off-site (when configured), and run the restore
 *  drill when that is due. Every step is audited as actor "scheduler";
 *  a failure is recorded as `error`, never swallowed. */
export class BackupScheduler {
  readonly offsite: OffsiteBackups;
  private readonly now: () => Date;
  constructor(private readonly deps: SchedulerDeps) {
    this.offsite = new OffsiteBackups(deps);
    this.now = deps.now ?? (() => new Date());
  }

  private async audit(action: string, result: string, detail: string, params: Record<string, unknown> = {}, actor = 'scheduler'): Promise<void> {
    await writeAudit(this.deps.db, {
      actorId: null,
      actorEmail: actor,
      action,
      params,
      result,
      detail: scrubText(detail, this.deps.secrets),
    }).catch((err) => console.error('scheduler audit write failed', err));
  }

  async isDue(): Promise<boolean> {
    const hours = this.deps.config.backupIntervalHours;
    if (!(hours > 0)) return false;
    const s = await readScheduleStatus(this.deps.config);
    if (!s?.lastAttemptAt) return true;
    const sinceAttempt = this.now().getTime() - Date.parse(s.lastAttemptAt);
    // After a failure, retry hourly rather than waiting a whole interval.
    const wait = s.lastError ? Math.min(hours * HOUR, HOUR) : hours * HOUR;
    return sinceAttempt >= wait;
  }

  async drillDue(): Promise<boolean> {
    const hours = this.deps.config.offsite.drillIntervalHours;
    if (!(hours > 0) || !offsiteSettings(this.deps.config)) return false;
    const d = await readDrillStatus(this.deps.config);
    if (!d?.lastRunAt) return true;
    return this.now().getTime() - Date.parse(d.lastRunAt) >= hours * HOUR;
  }

  /** Make a local backup now and push it off-site (manual or scheduled).
   *  Caller holds the lock. */
  async backupNow(createdBy: string): Promise<{ local: { ok: boolean; name: string | null; detail: string }; offsite: OffsiteRunResult | null }> {
    const name = `${createdBy === 'scheduler' ? 'scheduled' : 'offsite'}-${this.now().toISOString().replace(/[:.]/g, '-')}`;
    const attemptAt = this.now().toISOString();
    let manifest: BackupManifest;
    try {
      manifest = await createBackup(this.deps.db, this.deps.config, { name, createdBy, secrets: this.deps.secrets });
    } catch (err) {
      const message = scrubText(err instanceof Error ? err.message : String(err), this.deps.secrets);
      if (createdBy === 'scheduler') {
        const prev = await readScheduleStatus(this.deps.config);
        await writeStatus(this.deps.config, STATUS_FILES.schedule, {
          lastAttemptAt: attemptAt, lastSuccessAt: prev?.lastSuccessAt ?? null,
          lastBackupName: prev?.lastBackupName ?? null, lastError: message,
        } satisfies ScheduleStatus, this.deps.secrets).catch(() => {});
      }
      await this.audit(createdBy === 'scheduler' ? 'backups.scheduled' : 'backups.create', 'error', message, { name }, createdBy);
      return { local: { ok: false, name: null, detail: message }, offsite: null };
    }
    if (createdBy === 'scheduler') {
      await writeStatus(this.deps.config, STATUS_FILES.schedule, {
        lastAttemptAt: attemptAt, lastSuccessAt: this.now().toISOString(), lastBackupName: name, lastError: null,
      } satisfies ScheduleStatus, this.deps.secrets);
    }
    const rows = Object.values(manifest.tables).reduce((a, b) => a + b, 0);
    await this.audit(createdBy === 'scheduler' ? 'backups.scheduled' : 'backups.create', 'created', `${name}: ${rows} rows, ${manifest.exportFiles.count} export files`, { name }, createdBy);
    if (!offsiteSettings(this.deps.config)) {
      return { local: { ok: true, name, detail: 'local backup created' }, offsite: null };
    }
    const pushed = await this.offsite.pushBackup(name);
    await this.audit('offsite.backup', pushed.ok ? 'pushed' : 'error', pushed.detail, { name }, createdBy);
    return { local: { ok: true, name, detail: 'local backup created' }, offsite: pushed };
  }

  async runDrill(actor = 'scheduler'): Promise<DrillResult> {
    const result = await this.offsite.drill();
    await this.audit('offsite.drill', result.ok ? 'pass' : 'fail', result.detail, {}, actor);
    return result;
  }

  /** The timer body. Never throws. */
  async tick(): Promise<'not-due' | 'lock-held' | 'ran'> {
    try {
      const due = await this.isDue();
      const drill = await this.drillDue();
      if (!due && !drill) return 'not-due';
      if (!this.deps.lock.tryAcquire('backups.scheduled')) return 'lock-held';
      try {
        if (due) await this.backupNow('scheduler');
        if (await this.drillDue()) await this.runDrill();
      } finally {
        this.deps.lock.release();
      }
      return 'ran';
    } catch (err) {
      console.error('backup scheduler tick failed', err instanceof Error ? scrubText(err.message, this.deps.secrets) : err);
      return 'ran';
    }
  }
}

/* ---------------- self-check helpers ---------------- */

export type HealthVerdict =
  | { status: 'pass'; detail: string }
  | { status: 'fail'; detail: string }
  | { status: 'not-configured'; detail: string };

const ageHours = (iso: string, now: Date) => (now.getTime() - Date.parse(iso)) / HOUR;

export async function offsiteFreshness(config: Config, now = new Date()): Promise<HealthVerdict> {
  if (!offsiteSettings(config)) {
    return { status: 'not-configured', detail: `off-site backups not configured (missing ${missingOffsiteSettings(config).join(', ')})` };
  }
  const s = await readOffsiteStatus(config);
  const max = config.offsite.maxAgeHours;
  if (!s?.lastAttemptAt) return { status: 'fail', detail: 'configured, but no off-site backup has run yet' };
  if (s.lastError) {
    return { status: 'fail', detail: `last off-site run failed at ${s.lastErrorAt}: ${s.lastError}` };
  }
  if (!s.lastSuccessAt) return { status: 'fail', detail: 'no successful off-site backup recorded' };
  const age = ageHours(s.lastSuccessAt, now);
  if (age > max) {
    return { status: 'fail', detail: `last successful off-site backup is ${age.toFixed(1)} h old (limit ${max} h): snapshot ${s.lastSnapshotId}` };
  }
  return { status: 'pass', detail: `snapshot ${s.lastSnapshotId} of ${s.lastBackupName}, ${age.toFixed(1)} h old (limit ${max} h); retention ${s.retention?.ok ? 'ran' : 'not run'}` };
}

export async function drillHealth(config: Config, now = new Date()): Promise<HealthVerdict> {
  if (!offsiteSettings(config)) return { status: 'not-configured', detail: 'off-site backups not configured, so there is nothing to drill' };
  const d = await readDrillStatus(config);
  const max = config.offsite.drillMaxAgeHours;
  if (!d?.lastRunAt) return { status: 'fail', detail: 'no restore drill has run yet: the off-site copy is unverified' };
  if (!d.ok) return { status: 'fail', detail: `last restore drill failed at ${d.lastRunAt}: ${d.detail}` };
  const age = ageHours(d.lastRunAt, now);
  if (age > max) return { status: 'fail', detail: `last restore drill passed but is ${age.toFixed(1)} h old (limit ${max} h)` };
  return { status: 'pass', detail: `${d.detail} (${age.toFixed(1)} h ago)` };
}

export async function scheduleHealth(config: Config, now = new Date()): Promise<HealthVerdict> {
  const hours = config.backupIntervalHours;
  if (!(hours > 0)) return { status: 'not-configured', detail: 'scheduled backups are off (BACKUP_INTERVAL_HOURS=0)' };
  const s = await readScheduleStatus(config);
  if (!s?.lastAttemptAt) return { status: 'fail', detail: 'no scheduled backup has run yet' };
  if (s.lastError) return { status: 'fail', detail: `last scheduled backup failed at ${s.lastAttemptAt}: ${s.lastError}` };
  const age = s.lastSuccessAt ? ageHours(s.lastSuccessAt, now) : Infinity;
  // Two intervals plus an hour of slack for the timer granularity.
  if (age > hours * 2 + 1) return { status: 'fail', detail: `last scheduled backup is ${age.toFixed(1)} h old (every ${hours} h)` };
  return { status: 'pass', detail: `${s.lastBackupName}, ${age.toFixed(1)} h old (every ${hours} h; local retention: see GET /api/housekeeping/ops)` };
}
