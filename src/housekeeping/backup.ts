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
 * Deliberately NOT in a backup: the tables in EXCLUDED_TABLES (each
 * with its reason) and every secret value. Every public table must be
 * in exactly one of BACKUP_TABLES / EXCLUDED_TABLES: the self-check
 * data.backup.tables-classified and tests/restore-coverage.test.ts fail
 * the day a migration adds a table nobody classified.
 */

/** Data tables, in FK-safe restore order (parents before children):
 *  jobs after exports (source/artifact export ids), shares after
 *  manuscripts, share_comments / share_readers after shares.
 *  billing_subscriptions / billing_events (migration 012) only reference
 *  users. They are backed up, not excluded: billing_subscriptions holds
 *  the grace clock (status_since) and the user attribution that access
 *  is derived from, and both have user_id ... on delete set null, so a
 *  restore that deleted users while leaving them in place would silently
 *  null every attribution. billing_events is the webhook dedupe ledger;
 *  restoring it to the backup's point is safe because a re-delivered
 *  event re-fetches the subscription from Stripe rather than trusting
 *  the event body (src/billing-sync.ts). */
export const BACKUP_TABLES = [
  'users',
  'manuscripts',
  'streak_state',
  'streak_days',
  'streak_freezes',
  'exports',
  'jobs',
  'sessions',
  'founders_applications',
  'shares',
  'share_comments',
  'share_readers',
  'billing_subscriptions',
  'billing_events',
] as const;

/** Tables a backup deliberately leaves out, and why. Restore never
 *  rewrites these from a backup (password_resets is emptied instead). */
export const EXCLUDED_TABLES: Readonly<Record<string, string>> = {
  password_resets:
    'live credentials (single-use reset tokens); restore deletes every row so no pre-restore reset link keeps working',
  housekeeping_audit: 'append-only evidence; a restore must not rewrite history',
  housekeeping_check_runs: 'append-only evidence; a restore must not rewrite history',
  housekeeping_signoffs: 'append-only evidence; a restore must not rewrite history',
  schema_migrations: 'owned by the migration runner',
  help_docs: 'derived: rebuilt from content/help/ on every boot (H2 search index)',
  search_log: 'anonymous search statistics (query text + result count, no user id, no IP); not user data, and a restore must not rewrite them',
};

export interface TableClassification {
  /** Public tables in neither list. */
  unclassified: string[];
  /** Tables listed in both lists. */
  both: string[];
  /** Listed tables the database does not have. */
  missing: string[];
  total: number;
}

/** Compare every public base table against BACKUP_TABLES / EXCLUDED_TABLES. */
export async function classifyTables(db: Db): Promise<TableClassification> {
  const r = await db.query<{ table_name: string }>(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
  );
  const present = new Set(r.rows.map((row) => row.table_name));
  const backed = new Set<string>(BACKUP_TABLES);
  const excluded = new Set(Object.keys(EXCLUDED_TABLES));
  return {
    unclassified: [...present].filter((t) => !backed.has(t) && !excluded.has(t)),
    both: [...backed].filter((t) => excluded.has(t)),
    missing: [...backed, ...excluded].filter((t) => !present.has(t)),
    total: present.size,
  };
}

/** Config keys whose VALUES are secrets: excluded from backups by name. */
export const SECRET_CONFIG_KEYS = [
  'DATABASE_URL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'POSTGRES_PASSWORD',
  'SMTP_URL',
  // Off-site backups (restic -> Backblaze B2 S3 API): see offsite.ts.
  'RESTIC_PASSWORD',
  'OFFSITE_B2_KEY_ID',
  'OFFSITE_B2_APPLICATION_KEY',
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
  /** How the dump was taken, as reported by Postgres itself inside the
   *  dump transaction (absent in backups made before this field). */
  consistency?: { isolation: string; readOnly: boolean };
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

/** Every table read inside ONE repeatable-read, read-only transaction,
 *  so the dump is a single consistent snapshot across tables (no
 *  manuscript without its exports, no comment without its share).
 *  https://www.postgresql.org/docs/16/transaction-iso.html#XACT-REPEATABLE-READ
 *  https://www.postgresql.org/docs/16/sql-set-transaction.html */
async function dumpTables(
  db: Db,
): Promise<{ tables: Record<string, unknown[]>; consistency: { isolation: string; readOnly: boolean } }> {
  return db.tx(async (tx) => {
    await tx.query('set transaction isolation level repeatable read, read only');
    const mode = await tx.query<{ iso: string; ro: string }>(
      `select current_setting('transaction_isolation') as iso,
              current_setting('transaction_read_only') as ro`,
    );
    const dump: Record<string, unknown[]> = {};
    for (const table of BACKUP_TABLES) {
      const result = await tx.query(`select * from ${table}`);
      dump[table] = result.rows as unknown[];
    }
    return {
      tables: dump,
      consistency: { isolation: mode.rows[0]?.iso ?? 'unknown', readOnly: mode.rows[0]?.ro === 'on' },
    };
  });
}

/** jsonb columns per table, from information_schema. */
async function jsonbColumns(db: Db): Promise<Map<string, Set<string>>> {
  const r = await db.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
     where table_schema = 'public' and data_type = 'jsonb'`,
  );
  const out = new Map<string, Set<string>>();
  for (const row of r.rows) {
    if (!out.has(row.table_name)) out.set(row.table_name, new Set());
    out.get(row.table_name)!.add(row.column_name);
  }
  return out;
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
      mailConfigured: Boolean(config.smtpUrl && config.mailFrom),
      mailFrom: config.mailFrom,
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

  const { tables, consistency } = await dumpTables(db);
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
      `config secrets by name: ${SECRET_CONFIG_KEYS.join(', ')}`,
      ...Object.entries(EXCLUDED_TABLES).map(([table, reason]) => `${table} (${reason})`),
    ],
    consistency,
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
  /** Tables this server backs up that the backup does not carry (it was
   *  taken before they were added). Restore refuses such a backup:
   *  restoring it would delete every row of those tables. */
  missingTables: string[];
}

function missingTablesOf(data: BackupData): string[] {
  return BACKUP_TABLES.filter((t) => !Array.isArray(data.tables[t]));
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
    missingTables: missingTablesOf(data),
  };
}

/** A restore refused for a named reason (nothing was touched). */
export class RestoreRefused extends Error {}

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
  const missing = missingTablesOf(data);
  if (missing.length) {
    throw new RestoreRefused(
      `backup ${opts.name} does not carry ${missing.join(', ')} (taken before they were backed up); restoring it would delete every row of those tables`,
    );
  }
  const jsonb = await jsonbColumns(db);

  const snapshotName = `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const snapshot = await createBackup(db, config, {
    name: snapshotName,
    createdBy: 'housekeeping-restore',
    secrets: opts.secrets,
  });

  const tablesRestored: Record<string, number> = {};
  await db.tx(async (tx) => {
    // Reset tokens are never restored: every pre-restore link dies.
    await tx.query('delete from password_resets');
    for (const table of [...BACKUP_TABLES].reverse()) {
      await tx.query(`delete from ${table}`);
    }
    for (const table of BACKUP_TABLES) {
      const rows = (data.tables[table] ?? []) as Record<string, unknown>[];
      tablesRestored[table] = rows.length;
      if (!rows.length) continue;
      const columns = Object.keys(rows[0]);
      const jsonCols = jsonb.get(table) ?? new Set<string>();
      // jsonb values go in as JSON text with an explicit cast: node-pg
      // turns a JS array parameter into a Postgres ARRAY literal
      // ('{"1","2"}'), which jsonb rejects ("invalid input syntax for
      // type json") — reproduced against postgres:16 + pg 8.23.1.
      const placeholders = columns
        .map((col, i) => (jsonCols.has(col) ? `$${i + 1}::text::jsonb` : `$${i + 1}`))
        .join(', ');
      for (const row of rows) {
        const values = columns.map((col) => {
          const v = row[col] ?? null;
          return jsonCols.has(col) && v !== null ? JSON.stringify(v) : v;
        });
        await tx.query(
          `insert into ${table} (${columns.join(', ')}) values (${placeholders})`,
          values,
        );
      }
    }
  });

  // Replace the export volume with the backup's copy (snapshot above
  // holds the pre-restore volume, so this is recoverable).
  // The export dir itself is NOT removed, only emptied: in Compose it is
  // a volume mount point, and rmdir on a mount point fails with EBUSY
  // (seen in the full-stack proof: the DB had committed, the file step
  // threw, the API answered 500 with no verification run).
  const filesDir = path.join(backupPath(config, opts.name), 'files');
  await mkdir(config.exportDir, { recursive: true });
  for (const entry of await readdir(config.exportDir)) {
    await rm(path.join(config.exportDir, entry), { recursive: true, force: true });
  }
  const copied = await readdir(filesDir).catch(() => [] as string[]);
  if (copied.length) {
    await cp(filesDir, config.exportDir, { recursive: true });
  }

  return { restoredFrom: opts.name, snapshot: snapshot.name, tablesRestored };
}
