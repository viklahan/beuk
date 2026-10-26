import { rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from './db.js';

/**
 * Call right after an export's bytes were written to disk. The exports
 * row is inserted before the file is written, so an account deletion
 * that commits in between would delete the row (and rm the folder)
 * while the file lands afterwards, outliving the account. If the row is
 * gone by now, the file goes too, and the user's folder with it when it
 * is empty. Returns false when the file was dropped.
 *
 * Ordering covers every interleaving with deleteAccount (rows in one
 * transaction, then rm of the folder): a file written before that rm is
 * removed by it; a file written after it is found here with no row.
 */
export async function keepExportFileIfRowSurvived(db: Db, exportDir: string, userId: string, exportId: string): Promise<boolean> {
  const r = await db.query('select 1 from exports where id = $1 and user_id = $2', [exportId, userId]);
  if (r.rows.length) return true;
  await unlink(path.join(exportDir, userId, exportId)).catch(() => {});
  await rmdir(path.join(exportDir, userId)).catch(() => {});
  return false;
}
