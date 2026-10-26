import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config.js';
import { isValidBackupName, readManifest, type BackupManifest } from '../housekeeping/backup.js';
import type { HousekeepingLock } from '../housekeeping/lock.js';
import { writeFileAtomic } from '../housekeeping/fsutil.js';
import { opsSettings } from './settings.js';

/**
 * Local backup retention (BACKUP_KEEP_DAYS / BACKUP_KEEP_COUNT).
 *
 * Unset (the default, V has not decided) = keep everything: nothing is
 * ever deleted, exactly as before. When set, a local backup is deleted
 * only when EVERY rule that is set lets it go:
 *   BACKUP_KEEP_COUNT=n  the n newest backups are kept;
 *   BACKUP_KEEP_DAYS=d   backups younger than d days are kept.
 * (Both set: a backup survives if either rule keeps it. The safer reading.)
 *
 * Never deleted, whatever the settings:
 *   - the newest complete backup (manifest written: createBackup writes the
 *     manifest last, so a directory with a readable manifest is finished);
 *   - any directory without a readable manifest (unfinished, damaged or not
 *     a backup: retention cannot tell, so it does not touch it);
 *   - dot-files (the schedule / off-site / drill status files).
 * Pruning takes the one Housekeeping lock, which every backup, restore and
 * rehearsal holds while it runs; if the lock is held, pruning is skipped
 * ("a backup is running") and tried again on the next tick.
 *
 * The outcome of the last run is kept in BACKUP_DIR/.retention-status.json.
 */

export interface RetentionPolicy {
  keepDays: number | null;
  keepCount: number | null;
  /** True when neither is set: keep everything. */
  keepAll: boolean;
  /** One plain sentence for Housekeeping. */
  description: string;
}

export function retentionPolicy(config: Config): RetentionPolicy {
  const o = opsSettings(config);
  const keepAll = o.backupKeepDays === null && o.backupKeepCount === null;
  let description: string;
  if (keepAll) {
    description = 'keep everything: local backups are never deleted automatically (BACKUP_KEEP_DAYS and BACKUP_KEEP_COUNT are not set)';
  } else {
    const rules: string[] = [];
    if (o.backupKeepCount !== null) rules.push(`the newest ${o.backupKeepCount}`);
    if (o.backupKeepDays !== null) rules.push(`every backup younger than ${o.backupKeepDays} days`);
    description = `keep ${rules.join(' and ')}; the newest complete backup is always kept, and nothing is deleted while a backup is running`;
  }
  return { keepDays: o.backupKeepDays, keepCount: o.backupKeepCount, keepAll, description };
}

export interface RetentionResult {
  ranAt: string;
  outcome: 'keep-all' | 'skipped-busy' | 'pruned' | 'nothing-to-prune' | 'error';
  kept: string[];
  deleted: string[];
  detail: string;
}

export const RETENTION_STATUS_FILE = '.retention-status.json';

export async function readRetentionStatus(config: Config): Promise<RetentionResult | null> {
  try {
    return JSON.parse(await readFile(path.join(config.backupDir, RETENTION_STATUS_FILE), 'utf8')) as RetentionResult;
  } catch {
    return null;
  }
}

/** Pure part: which complete backups the policy deletes. */
export function chooseDeletions(
  manifests: Pick<BackupManifest, 'name' | 'createdAt'>[],
  policy: RetentionPolicy,
  now: Date,
): { keep: string[]; remove: string[] } {
  if (policy.keepAll || !manifests.length) return { keep: manifests.map((m) => m.name), remove: [] };
  const sorted = [...manifests].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.name.localeCompare(a.name));
  const keep: string[] = [];
  const remove: string[] = [];
  sorted.forEach((m, i) => {
    if (i === 0) return keep.push(m.name); // the newest complete backup, always
    const byCount = policy.keepCount !== null && i < policy.keepCount;
    const ageDays = (now.getTime() - Date.parse(m.createdAt)) / 86_400_000;
    const byDays = policy.keepDays !== null && (!(ageDays >= 0) || ageDays < policy.keepDays);
    // An unparseable createdAt is never "old enough" to delete.
    if (byCount || byDays || Number.isNaN(Date.parse(m.createdAt))) keep.push(m.name);
    else remove.push(m.name);
  });
  return { keep, remove };
}

export async function applyRetention(
  config: Config,
  lock: HousekeepingLock,
  now: Date = new Date(),
): Promise<RetentionResult> {
  const policy = retentionPolicy(config);
  const ranAt = now.toISOString();
  if (policy.keepAll) {
    return { ranAt, outcome: 'keep-all', kept: [], deleted: [], detail: policy.description };
  }
  if (!lock.tryAcquire('backups.retention')) {
    const result: RetentionResult = {
      ranAt, outcome: 'skipped-busy', kept: [], deleted: [],
      detail: `skipped: ${lock.heldBy} is running; nothing is deleted while a backup, restore or rehearsal runs`,
    };
    await writeFileAtomic(path.join(config.backupDir, RETENTION_STATUS_FILE), JSON.stringify(result, null, 2)).catch(() => {});
    return result;
  }
  let result: RetentionResult;
  try {
    const names = await readdir(config.backupDir).catch(() => [] as string[]);
    const manifests: BackupManifest[] = [];
    for (const name of names) {
      if (!isValidBackupName(name)) continue;
      const m = await readManifest(config, name);
      // The manifest must name its own directory, or it is not ours to judge.
      if (m && m.name === name) manifests.push(m);
    }
    const { keep, remove } = chooseDeletions(manifests, policy, now);
    const deleted: string[] = [];
    const problems: string[] = [];
    for (const name of remove) {
      const dir = path.join(config.backupDir, name);
      // isValidBackupName (checked above) allows no separators and no
      // "..": the directory is always a direct child of BACKUP_DIR.
      try {
        await rm(dir, { recursive: true, force: false });
        deleted.push(name);
      } catch (err) {
        problems.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    result = {
      ranAt,
      outcome: problems.length ? 'error' : deleted.length ? 'pruned' : 'nothing-to-prune',
      kept: keep,
      deleted,
      detail: problems.length
        ? `deleted ${deleted.length}, could not delete: ${problems.join('; ')}`
        : `kept ${keep.length}, deleted ${deleted.length} (${policy.description})`,
    };
  } catch (err) {
    result = { ranAt, outcome: 'error', kept: [], deleted: [], detail: err instanceof Error ? err.message : String(err) };
  } finally {
    lock.release();
  }
  await writeFileAtomic(path.join(config.backupDir, RETENTION_STATUS_FILE), JSON.stringify(result, null, 2)).catch(() => {});
  return result;
}
