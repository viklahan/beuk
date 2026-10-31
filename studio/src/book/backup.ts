/* 1.0's backup file, both ways (client/index.html, "backups: a whole-book
   file the writer keeps": localBackupFilename, localExportBackup,
   localParseBackup). A backup 2.0 writes is byte-for-byte the shape 1.0
   writes, so 1.0's "Open a backup…" opens it unchanged. */

/** 1.0's slug(s), ported exactly (client/index.html `function slug(s)`): lower case, every run of
 *  anything but a-z0-9 becomes "-", trimmed of "-"; empty → "section". Non-Latin titles slug to "section". */
export function slug(s: unknown): string {
  return String(s || 'section').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
}

/** 1.0's localBackupFilename: `<slug(title) or "book">-<YYYY-MM-DD, local date>.beuk-backup.json`. */
export function backupFilename(title: unknown, d: Date = new Date()): string {
  const stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const ti = String(title || '').trim();
  return ((ti && slug(ti)) || 'book') + '-' + stamp + '.beuk-backup.json';
}

/** 1.0's localExportBackup payload, serialised as 1.0 does (JSON.stringify, no indentation). */
export function backupJson(book: unknown, d: Date = new Date()): string {
  return JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: d.toISOString(), book });
}

/** 1.0's localParseBackup: the book of a backup file's text, or null. Accepts exactly what 1.0 accepts. */
export function parseBackup(text: string): Record<string, unknown> | null {
  try {
    const d = JSON.parse(text) as { format?: unknown; book?: unknown } | null;
    if (d && d.format === 'beuk-backup' && d.book && typeof d.book === 'object' && Array.isArray((d.book as { sections?: unknown }).sections)) {
      return d.book as Record<string, unknown>;
    }
  } catch {
    /* not JSON */
  }
  return null;
}

/** Hand the browser a file to save (1.0's downloadBlob). */
export function downloadText(text: string, filename: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
