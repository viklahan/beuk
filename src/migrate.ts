import { loadConfig } from './config.js';
import { createPgDb, defaultMigrationsDir, runMigrations } from './db.js';

const config = loadConfig();
if (!config.databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const db = createPgDb(config.databaseUrl);
try {
  const applied = await runMigrations(db, defaultMigrationsDir());
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'already up to date');
} finally {
  await db.end();
}
