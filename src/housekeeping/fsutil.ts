import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Atomic write (Housekeeping spec): write to a temp file in the same
 *  directory, then rename over the target — a crash never leaves a
 *  half-written file at the real path. */
export async function writeFileAtomic(filePath: string, data: string | Buffer): Promise<void> {
  const tmp = path.join(
    path.dirname(filePath),
    `.tmp-${path.basename(filePath)}-${process.pid}-${Date.now()}`,
  );
  await writeFile(tmp, data);
  await rename(tmp, filePath);
}
