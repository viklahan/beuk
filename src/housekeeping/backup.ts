import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { writeFileAtomic } from './fsutil.js';
import { scrubText } from './scrub.js';

/**
 * Evidence pillar: named backups + two-step restore.
 *
 * A backup is a directory under BACKUP_DIR:
 *   <name>/manifest.json   what is inside, with hashes (scrubbed)
 *   <name>/db.json         logical dump of the data tables
 *   <name>/settings.json   non-secret config; secrets EXCLUDED BY NAME
 *   <name>/files/…         a copy of the export volume
 *
 * Deliberately NOT in a backup: the Housekeeping audit + check-run
 * tables (append-only evidence — a restore must not rewrite history),
 * schema_migrations, and every secret value.
 */

/** Data tables, in FK-safe restore order (parents before children). */
export const BACKUP_TABLES = [
  'users',
  'manuscripts',
  'streak_state',
  'streak_days',
  'streak_freezes',
  'exports',
  'sessions',
  'founders_applications',
] as const;

/** Config keys whose VALUES are secrets: excluded from backups by name. */
export const SECRET_CONFIG_KEYS = [
  'DATABASE_URL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'POSTGRES_PASSWORD',
] as const;

export interface BackupManifest {
  name: string;
  createdAt: string;
  buildStamp: string;
  createdBy: string;
  tables: Record<string, number>;
  exportFiles: { count: number; bytes: number };
  files: { path: string; bytes: number; sha256: string }[];
  excluded: string[];
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isValidBackupName(name: string): boolean {
  return NAME_RE.test(name) && !name.includes('..');
}

export function defaultBackupName(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `backup-${stamp}-${randomBytes(2).toString('hex')}`;
}

function backupPath(config: Config, name: string): string {
  return path.join(config.backupDir, name);
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

async function dumpTables(db: Db): Promise<Record<string, unknown[]>> {
  const dump: Record<string, unknown[]> = {};
  for (const table of BACKUP_TABLES) {
    const result = await db.query(`select * from ${table}`);
    dump[table] = result.rows as unknown[];
  }
  return dump;
}

function settingsDocument(config: Config, createdBy: string): Record<string, unknown> {
  return {
    generatedAt: new Date().toISOString(),
    buildStamp: config.buildStamp,
    createdBy,
    config: {
      port: config.port,
      timeZone: config.timeZone,
      cookieSecure: config.cookieSecure,
      sessionTtlDays: config.sessionTtlDays,
      exportMaxBytes: config.exportMaxBytes,
      appBaseUrl: config.appBaseUrl,
      billingConfigured: Boolean(
        config.stripeSecretKey && config.stripeWebhookSecret && config.stripePriceId,
      ),
      treeClean: config.treeClean,
    },
    excludedSecrets: [...SECRET_CONFIG_KEYS],
    note: 'Secret values are excluded by name and never written to a backup.',
  };
}

async function copyExportVolume(
  config: Config,
  destDir: string,
): Promise<{ count: number; bytes: number }> {
  let count = 0;
  let bytes = 0;
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        count += 1;
        bytes += (await stat(full)).size;
      }
    }
  };
  await walk(config.exportDir);
  if (count > 0) {
    await cp(config.exportDir, destDir, { recursive: true });
  } else {
    await mkdir(destDir, { recursive: true });
  }
  return { count, bytes };
}

export async function createBackup(
  db: Db,
  config: Config,
  opts: { name?: string; createdBy: string; secrets: readonly string[] },
): Promise<BackupManifest> {
  const name = opts.name ?? defaultBackupName();
  if (!isValidBackupName(name)) throw new Error(`invalid backup name: ${name}`);
  const dir = backupPath(config, name);
  await mkdir(dir, { recursive: true });

  const tables = await dumpTables(db);
  const tableCounts: Record<string, number> = {};
  for (const table of BACKUP_TABLES) tableCounts[table] = tables[table].length;

  const dbJson = JSON.stringify({ tables }, jsonReplacer, 2);
  await writeFileAtomic(path.join(dir, 'db.json'), dbJson);

  const settingsJson = scrubText(
    JSON.stringify(settingsDocument(config, opts.createdBy), null, 2),
    opts.secrets,
  );
  await writeFileAtomic(path.join(dir, 'settings.json'), settingsJson);

  const exportFiles = await copyExportVolume(config, path.join(dir, 'files'));

  const fileEntries: BackupManifest['files'] = [];
  for (const fileName of ['db.json', 'settings.json']) {
    const bytes = await readFile(path.join(dir, fileName));
    fileEntries.push({
      path: fileName,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }

  const manifest: BackupManifest = {
    name,
    createdAt: new Date().toISOString(),
    buildStamp: config.buildStamp,
    createdBy: opts.createdBy,
    tables: tableCounts,
    exportFiles,
    files: fileEntries,
    excluded: [
      'config secrets by name: DATABASE_URL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, POSTGRES_PASSWORD',
      'housekeeping_audit / housekeeping_check_runs / housekeeping_signoffs (append-only evidence)',
      'schema_migrations (owned by the migration runner)',
    ],
  };
  const manifestJson = scrubText(JSON.stringify(manifest, null, 2), opts.secrets);
  await writeFileAtomic(path.join(dir, 'manifest.json'), manifestJson);
  return manifest;
}

export async function readManifest(config: Config, name: string): Promise<BackupManifest | null> {
  if (!isValidBackupName(name)) return null;
  try {
    const raw = await readFile(path.join(backupPath(config, name), 'manifest.json'), 'utf8');
    return JSON.parse(raw) as BackupManifest;
  } catch {
    return null;
  }
}

export async function listBackups(config: Config): Promise<BackupManifest[]> {
  const names = await readdir(config.backupDir).catch(() => [] as string[]);
  const manifests: BackupManifest[] = [];
  for (const name of names.sort().reverse()) {
    const manifest = await readManifest(config, name);
    if (manifest) manifests.push(manifest);
  }
  return manifests;
}

interface BackupData {
  manifest: BackupManifest;
  tables: Record<string, unknown[]>;
}

async function readBackup(config: Config, name: string): Promise<BackupData | null> {
  const manifest = await readManifest(config, name);
  if (!manifest) return null;
  try {
    const raw = await readFile(path.join(backupPath(config, name), 'db.json'), 'utf8');
    const parsed = JSON.parse(raw) as { tables: Record<string, unknown[]> };
    return { manifest, tables: parsed.tables };
  } catch {
    return null;
  }
}

export interface RestoreDiff {
  backup: string;
  createdAt: string;
  buildStamp: string;
  tables: { table: string; backupRows: number; currentRows: number }[];
  exportFiles: { backupFiles: number; note: string };
}

/** Step one of restore: a diff summary against current state. */
export async function previewRestore(
  db: Db,
  config: Config,
  name: string,
): Promise<RestoreDiff | null> {
  const data = await readBackup(config, name);
  if (!data) return null;
  const tables: RestoreDiff['tables'] = [];
  for (const table of BACKUP_TABLES) {
    const current = await db.query<{ c: unknown }>(`select count(*) as c from ${table}`);
    tables.push({
      table,
      backupRows: (data.tables[table] ?? []).length,
      currentRows: Number(current.rows[0]?.c ?? 0),
    });
  }
  return {
    backup: name,
    createdAt: data.manifest.createdAt,
    buildStamp: data.manifest.buildStamp,
    tables,
    exportFiles: {
      backupFiles: data.manifest.exportFiles.count,
      note: 'the export volume is replaced with the backup copy; a snapshot of current state is taken first',
    },
  };
}

export interface RestoreResult {
  restoredFrom: string;
  snapshot: string;
  tablesRestored: Record<string, number>;
}

/** Step two of restore (caller has confirmed): snapshot current state,
 *  then replace data tables + export volume with the backup's. */
export async function executeRestore(
  db: Db,
  config: Config,
  opts: { name: string; createdBy: string; secrets: readonly string[] },
): Promise<RestoreResult> {
  const data = await readBackup(config, opts.name);
  if (!data) throw new Error(`backup not found: ${opts.name}`);

  const snapshotName = `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const snapshot = await createBackup(db, config, {
    name: snapshotName,
    createdBy: 'housekeeping-restore',
    secrets: opts.secrets,
  });

  const tablesRestored: Record<string, number> = {};
  await db.tx(async (tx) => {
    for (const table of [...BACKUP_TABLES].reverse()) {
      await tx.query(`delete from ${table}`);
    }
    for (const table of BACKUP_TABLES) {
      const rows = (data.tables[table] ?? []) as Record<string, unknown>[];
      tablesRestored[table] = rows.length;
      if (!rows.length) continue;
      const columns = Object.keys(rows[0]);
      for (const row of rows) {
        const values = columns.map((col) => row[col] ?? null);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        await tx.query(
          `insert into ${table} (${columns.join(', ')}) values (${placeholders})`,
          values,
        );
      }
    }
  });

  // Replace the export volume with the backup's copy (snapshot above
  // holds the pre-restore volume, so this is recoverable).
  const filesDir = path.join(backupPath(config, opts.name), 'files');
  await rm(config.exportDir, { recursive: true, force: true });
  await mkdir(config.exportDir, { recursive: true });
  const copied = await readdir(filesDir).catch(() => [] as string[]);
  if (copied.length) {
    await cp(filesDir, config.exportDir, { recursive: true });
  }

  return { restoredFrom: opts.name, snapshot: snapshot.name, tablesRestored };
}
