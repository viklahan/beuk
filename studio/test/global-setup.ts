import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/* The app imports src/generated/ (gitignored): extract it from 1.0 before
   any test, exactly as the build does, so `npx vitest run` stands alone. */
export default function setup(): void {
  const script = fileURLToPath(new URL('../scripts/extract-studio.mjs', import.meta.url));
  execFileSync(process.execPath, [script], { stdio: 'inherit' });
}
