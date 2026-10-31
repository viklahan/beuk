import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Y from 'yjs';
import { BODY, BookImportError, META, SECTIONS, type TextWarning } from '@book/editor/index.js';
import { LANG_CODES } from '@book/upgrade.js';
import meta from '../generated/strings-meta.json';
import { useLocale } from '../i18n/LocaleProvider';
import { useToast } from '../shell/Toasts';
import { backupFilename, backupJson, downloadText, parseBackup } from './backup';
import { readLegacyBook } from './legacy10';
import { outlineRows, type OutlineRow } from './outlineRows';
import { bookMeta, importToDevice, openLastBook, type OpenBook } from './store';

/* useBook(): the book open in /next, its outline, and what the writer can
   do with it (open a backup, export one). One open book in step 4; the
   store keeps the list of books on this device for later.

   Start-up: the book open last on this device (y-indexeddb, so it opens
   offline too). With none, 1.0's own book on this device is imported once,
   read-only (legacy10.ts never writes 1.0's database), with 1.0's
   "Welcome back" toast. With neither, the desk is empty. */

export type Phase = 'starting' | 'empty' | 'open';

export type BookApi = {
  phase: Phase;
  book: OpenBook | null;
  title: string;
  author: string;
  rows: OutlineRow[];
  /** The book's language (a LANG_PACKS key, 1.0's bookLang: unknown codes read as "en") and direction. */
  bookLang: string;
  bookDir: 'ltr' | 'rtl';
  /** What the import had to change (lone surrogates), each with the section's outline name. */
  notes: { warning: TextWarning; chapter: string }[];
  active: number | null;
  select: (index: number | null) => void;
  openBackupFile: (file: File) => Promise<void>;
  exportBackup: () => void;
};

const BookContext = createContext<BookApi | null>(null);

/** The section the desk opens on: the first body section with text, else the first section with text. */
function firstChapter(b: OpenBook): number | null {
  const list = b.ydoc.getArray<unknown>(SECTIONS).toArray();
  const editable = (s: unknown): s is Y.Map<unknown> => s instanceof Y.Map && s.get(BODY) instanceof Y.XmlFragment;
  const body = list.findIndex((s) => editable(s) && s.get('kind') === 'body');
  if (body >= 0) return body;
  const any = list.findIndex(editable);
  return any >= 0 ? any : null;
}
const BOOK_RTL: readonly string[] = (meta as { bookRtl?: string[] }).bookRtl ?? [];

export function BookProvider({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>('starting');
  const [book, setBook] = useState<OpenBook | null>(null);
  const [rev, setRev] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const started = useRef(false);
  const current = useRef<OpenBook | null>(null);

  const show = useCallback((b: OpenBook | null) => {
    const prev = current.current;
    current.current = b;
    setBook(b);
    setActive(b ? firstChapter(b) : null);
    setPhase(b ? 'open' : 'empty');
    if (prev && prev !== b) void prev.close();
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const last = await openLastBook();
        if (last) return show(last);
        const legacy = await readLegacyBook();
        if (legacy) {
          const b = await importToDevice(legacy.book);
          show(b);
          toast(t('local.restored'), 'HardDrive');
          return;
        }
      } catch {
        /* storage refused or the book cannot be read: an empty desk, nothing written */
      }
      show(null);
    })();
  }, [show, toast, t]);

  useEffect(() => () => void current.current?.close(), []);

  // Re-read the title and the outline when the book's meta or its list of sections changes
  // (shallow: typing inside a chapter does not touch either).
  useEffect(() => {
    if (!book) return;
    const bump = () => setRev((r) => r + 1);
    const m = book.ydoc.getMap(META);
    const s = book.ydoc.getArray(SECTIONS);
    m.observe(bump);
    s.observe(bump);
    return () => {
      m.unobserve(bump);
      s.unobserve(bump);
    };
  }, [book]);

  const openBackupFile = useCallback(
    async (file: File) => {
      let text = '';
      try {
        text = await file.text();
      } catch {
        /* unreadable: treated as not a backup */
      }
      const parsed = parseBackup(text);
      if (!parsed) {
        toast(t('local.backupBad'), 'HardDrive');
        return;
      }
      try {
        const b = await importToDevice(parsed);
        show(b);
        const title = String(bookMeta(b.ydoc).title ?? '').trim();
        toast(t('local.backupOpened', { title: title || t('misc.untitledBook') }), 'HardDrive');
      } catch (e) {
        // readBook said 'newer' or 'failed': this studio must not open (and so never save) it
        // anything else: this device would not store it (storage blocked or full)
        toast(t(e instanceof BookImportError ? 'local.backupBad' : 'local.blocked'), 'HardDrive');
      }
    },
    [show, toast, t],
  );

  const exportBackup = useCallback(() => {
    const b = current.current;
    if (!b) return;
    const doc = b.export();
    const m = (doc.meta ?? {}) as { title?: unknown };
    downloadText(backupJson(doc), backupFilename(m.title));
  }, []);

  const value = useMemo<BookApi>(() => {
    const m = book ? bookMeta(book.ydoc) : {};
    const rows = book ? outlineRows(book.ydoc, t) : [];
    const lang = typeof m.language === 'string' && LANG_CODES.includes(m.language) ? m.language : 'en';
    const notes = (book?.textWarnings ?? []).map((warning) => {
      const row = warning.sectionId == null ? undefined : rows.find((r) => r.id === warning.sectionId);
      return { warning, chapter: row ? row.name || t('side.untitled') : String(m.title ?? '') || t('misc.untitledBook') };
    });
    return {
      phase,
      book,
      title: String(m.title ?? ''),
      author: String(m.author ?? ''),
      rows,
      bookLang: lang,
      bookDir: BOOK_RTL.includes(lang) ? 'rtl' : 'ltr',
      notes,
      active,
      select: setActive,
      openBackupFile,
      exportBackup,
    };
    // rev: the book's meta or sections changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, book, rev, active, t, openBackupFile, exportBackup]);

  return <BookContext.Provider value={value}>{children}</BookContext.Provider>;
}

export function useBook(): BookApi {
  const v = useContext(BookContext);
  if (!v) throw new Error('useBook() outside <BookProvider>');
  return v;
}
