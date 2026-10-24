import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

// Return `date` columns (OID 1082) as plain 'YYYY-MM-DD' strings, not Dates.
pg.types.setTypeParser(1082, (v: string) => v);

export interface QueryResult<T> {
  rows: T[];
}

/** Minimal DB interface — satisfied by a pg Pool in production and by an
 *  embedded Postgres (PGlite) in tests, so identical code paths run. */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Run fn inside a single transaction on one connection. */
  tx<T>(fn: (txDb: Db) => Promise<T>): Promise<T>;
}

export function createPgDb(databaseUrl: string): Db & { end: () => Promise<void> } {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const wrap = (queryFn: (text: string, params?: unknown[]) => Promise<QueryResult<unknown>>): Db => ({
    query: async <T>(text: string, params?: unknown[]) =>
      queryFn(text, params) as Promise<QueryResult<T>>,
    tx: async <T>(fn: (txDb: Db) => Promise<T>): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn(
          wrap(async (text, params) => client.query(text, params as unknown[]) as Promise<QueryResult<unknown>>),
        );
        await client.query('commit');
        return result;
      } catch (err) {
        await client.query('rollback');
        throw err;
      } finally {
        client.release();
      }
    },
  });
  const db = wrap(async (text, params) => pool.query(text, params as unknown[]) as Promise<QueryResult<unknown>>);
  return { ...db, end: () => pool.end() };
}

/** Apply any not-yet-applied .sql files from `dir`, in filename order.
 *  Each file runs in its own transaction and is recorded in
 *  schema_migrations, so re-running is a no-op. */
export async function runMigrations(db: Db, dir: string): Promise<string[]> {
  await db.query(`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
  const done = await db.query<{ name: string }>('select name from schema_migrations');
  const applied = new Set(done.rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), 'utf8');
    await db.tx(async (tx) => {
      await tx.query(sql);
      await tx.query('insert into schema_migrations (name) values ($1)', [file]);
    });
    newlyApplied.push(file);
  }
  return newlyApplied;
}

export function defaultMigrationsDir(): string {
  // Works from src/ (tsx dev) and from dist/ (compiled): both sit one level
  // below the project root, migrations/ sits at the root.
  return path.resolve(import.meta.dirname, '..', 'migrations');
}
