import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createPgDb } from '../db.js';
import type { ScratchDbFactory } from './context.js';

function withDatabase(databaseUrl: string, dbName: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${dbName}`;
  return url.toString();
}

/**
 * Production scratch databases for Rehearse: a real, empty Postgres
 * database on the same server, created for the rehearsal and dropped
 * after. Production data is never touched.
 */
export function createPgScratchFactory(databaseUrl: string): ScratchDbFactory {
  return async () => {
    const name = `beuk_scratch_${randomBytes(6).toString('hex')}`;
    const admin = new pg.Pool({ connectionString: withDatabase(databaseUrl, 'postgres') });
    try {
      await admin.query(`create database "${name}"`);
    } finally {
      await admin.end();
    }
    const db = createPgDb(withDatabase(databaseUrl, name));
    return {
      db,
      cleanup: async () => {
        await db.end();
        const janitor = new pg.Pool({ connectionString: withDatabase(databaseUrl, 'postgres') });
        try {
          await janitor.query(`drop database if exists "${name}"`);
        } finally {
          await janitor.end();
        }
      },
    };
  };
}
