/* Writes the grid: every applicable shape × format file into
   tests/fixtures/manuscripts/files/, and manifest.json (file, shape,
   format, sha256). Deterministic, so the files are committed and the
   grid never needs this to run; tests/import-shapes.test.ts checks the
   committed files still match.   npm run import-shapes:gen */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDocx } from './render-docx.js';
import { renderPdf } from './render-pdf.js';
import { renderMd, renderRtf, renderTxt } from './render-text.js';
import { loadShapes, MANIFEST, OUT_DIR, type Format, type Shape } from './shape.js';

export async function renderShape(s: Shape, f: Format): Promise<Buffer> {
  switch (f) {
    case 'docx': return renderDocx(s);
    case 'pdf': return renderPdf(s);
    case 'rtf': return renderRtf(s);
    case 'txt': return renderTxt(s);
    case 'md': return renderMd(s);
  }
}

export type Cell = { file: string; shape: string; format: Format; sha256: string; data: Buffer };

/** Every applicable cell, sorted by file name. */
export async function buildAll(): Promise<Cell[]> {
  const cells: Cell[] = [];
  for (const s of loadShapes()) {
    for (const f of s.formats) {
      const data = await renderShape(s, f);
      cells.push({ file: `${s.id}.${f}`, shape: s.id, format: f, sha256: createHash('sha256').update(data).digest('hex'), data });
    }
  }
  return cells.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

async function main() {
  const cells = await buildAll();
  mkdirSync(OUT_DIR, { recursive: true });
  const keep = new Set(cells.map((c) => c.file));
  for (const f of readdirSync(OUT_DIR)) if (!keep.has(f)) rmSync(path.join(OUT_DIR, f));
  for (const c of cells) writeFileSync(path.join(OUT_DIR, c.file), c.data);
  writeFileSync(MANIFEST, JSON.stringify(cells.map(({ file, shape, format, sha256 }) => ({ file, shape, format, sha256 })), null, 2) + '\n');
  console.log(`${cells.length} files written to ${path.relative(process.cwd(), OUT_DIR)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
