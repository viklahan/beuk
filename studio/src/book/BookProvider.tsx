import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Y from 'yjs';
import { BODY, BookImportError, META, observeSections, sectionList, sectionsCount, unwrapBackup, type TextWarning } from '@book/editor/index.js';
import { readBook } from '@book/read.js';
import { LANG_CODES } from '@book/upgrade.js';
import { loadClosure } from '../closure/index';
import { backupArrival, live } from '../history/history';
import { deskIsUntouchedSample } from '../sample/sample';
import { useConfirm } from '../shell/Dialog';
import meta from '../generated/strings-meta.json';
import { useLocale } from '../i18n/LocaleProvider';
import { useToast } from '../shell/Toasts';
import { backupFilename, backupJson, downloadText, parseBackup } from './backup';
import { readLegacyBook } from './legacy10';
import { outlineRows, type OutlineRow } from './outlineRows';
import { REGISTRY_KEY, bookMeta, importToDevice, openStoredBook, registryEpoch, startBook, type OpenBook } from './store';

/* useBook(): the book open in /next, its outline, and what the writer can
   do with it (open a backup, export one). One open book in step 4; the
   store keeps the list of books on this device for later.

   Start-up (store.ts startBook): the book open last on this device
   (y-indexeddb, so it opens offline too), else any 2.0 book found on this
   device, else 1.0's own book imported once, read-only (legacy10.ts never
   writes 1.0's database), with 1.0's "Welcome back" toast. Else the empty
   desk.

   Opening a backup over the open book (1.0 localOpenBackupFile /
   localApplyBackup, Part C ruling 3 resolved): 1.0's confirm first
   (local.backupConfirm*: "the current book is kept first as a snapshot"),
   unless the desk is empty; then a "Before opening a backup" History
   snapshot of the open book goes into the arriving book's History; then
   the replace (a new generation). History → "Restore the whole book" on
   that snapshot brings the old book back.

   Generations: when another tab replaces this book (it opened a backup),
   this tab's generation goes stale and the newest one is reopened in its
   place, keeping the chosen section. */

export type Phase = 'starting' | 'empty' | 'open';
/** Wave 5a, round 2 — 1.0's BEUK:local status, as far as 2.0's store knows it:
 *  - checking: the desk is starting (the store not yet read);
 *  - saved: the store holds the book (y-indexeddb writes every change as it happens; it was opened and synced);
 *  - blocked / quota / error: storing a book failed (the start, or a book opened or replaced here), by the error's name
 *    as 1.0's localClassifyError reads it;
 *  - persisted: navigator.storage's standing answer (1.0's persisted(): true, false, or "unsupported" without the API);
 *    null until it is known.
 *  1.0's "saving" (its 1.2 s debounce) has no 2.0 signal: never shown. */
export type LocalStatus = { status: 'checking' | 'saved' | 'blocked' | 'quota' | 'error'; errorName: string; persisted: boolean | 'unsupported' | null };
/** 1.0's localClassifyError (client/index.html BEUK:local). */
export function localClassifyError(e: unknown): 'quota' | 'blocked' | 'error' {
  const name = (e && typeof e === 'object' && (e as { name?: unknown }).name) || 'Error';
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return 'quota';
  if (name === 'SecurityError' || name === 'InvalidStateError' || name === 'NotSupportedError' || name === 'UnknownError' || name === 'InvalidAccessError') return 'blocked';
  return 'error';
}
const errName = (e: unknown): string => String((e && typeof e === 'object' && (e as { name?: unknown }).name) || 'Error');

export type BookApi = {
  phase: Phase;
  book: OpenBook | null;
  /** The title as the top bar shows it (1.0's imRealTitle: trimmed, a stored "Untitled Book" in any language counts as none). */
  title: string;
  /** The author line as the top bar shows it (1.0: "by {author}", or nothing). */
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
  /** Open `doc` (a book document) in place of the open book, as a new generation (a whole-book History restore). */
  /** Open `doc` in place of the open book as a new generation (a whole-book History restore). `from` is the Y.Doc the
   *  caller read: when it is no longer the live book (another tab replaced it while a confirm waited), nothing is
   *  replaced and this resolves false without a toast (the caller says so). */
  replaceBook: (doc: Record<string, unknown>, from: Y.Doc) => Promise<boolean>;
  /** Open `doc` as a new generation in place of the book `from` (the sample, the empty book of New book / Remove sample),
   *  or — `from` null — only while no book is open. Refused (null, no toast) when `from` is no longer the live book; a
   *  book the device will not store has its toast. */
  replaceWith: (doc: Record<string, unknown>, from: Y.Doc | null) => Promise<OpenBook | null>;
  /** Is this Y.Doc still the live, current book of this tab (not replaced, not stale)? Read at call time, never from a
   *  render: an async path that awaited a confirm asks this before it writes. */
  isLive: (ydoc: Y.Doc | null) => boolean;
  /** True once for a book that reached the desk from outside this studio — this device's book restored at start-up, or
   *  a backup opened — which is where 1.0 runs its sweep of old sample copies (sampleSweepPreRename). Asking takes it. */
  takeOutsideArrival: (ydoc: Y.Doc) => boolean;
  exportBackup: () => void;
  /** Wave 5a, round 2: what the device store knows, as 1.0's local pill shows it (src/book/LocalPill.tsx). */
  local: LocalStatus;
};

const BookContext = createContext<BookApi | null>(null);

/** The section the desk opens on: the first body section with text, else the first section with text. */
function firstChapter(b: OpenBook): number | null {
  const list = sectionList(b.ydoc);
  const editable = (s: unknown): s is Y.Map<unknown> => s instanceof Y.Map && s.get(BODY) instanceof Y.XmlFragment;
  const body = list.findIndex((s) => editable(s) && s.get('kind') === 'body');
  if (body >= 0) return body;
  const any = list.findIndex(editable);
  return any >= 0 ? any : null;
}
const BOOK_RTL: readonly string[] = (meta as { bookRtl?: string[] }).bookRtl ?? [];
const UNTITLED: readonly string[] = ['Untitled Book', ...((meta as { untitledBook?: string[] }).untitledBook ?? [])];

/** 1.0's imRealTitle / imIsPlaceholderTitle. */
export function realTitle(v: unknown): string {
  const s = String(v || '').trim();
  return s && UNTITLED.includes(s) ? '' : s;
}

export function BookProvider({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const [phase, setPhase] = useState<Phase>('starting');
  const [book, setBook] = useState<OpenBook | null>(null);
  const [rev, setRev] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const [local, setLocal] = useState<LocalStatus>({ status: 'checking', errorName: '', persisted: null });
  const failed = useCallback((e: unknown) => setLocal((l) => ({ ...l, status: localClassifyError(e), errorName: errName(e) })), []);
  const started = useRef(false);
  const current = useRef<OpenBook | null>(null);
  const outside = useRef(new WeakSet<Y.Doc>());

  const reopen = useRef<(stale: OpenBook) => void>(() => undefined);

  const show = useCallback((b: OpenBook | null, keepActive = false) => {
    const prev = current.current;
    current.current = b;
    if (b) b.onStale = (stale) => reopen.current(stale);
    setBook(b);
    setActive((a) => {
      if (!b) return null;
      if (keepActive && a !== null && a < sectionsCount(b.ydoc)) return a;
      return firstChapter(b);
    });
    setPhase(b ? 'open' : 'empty');
    if (prev && prev !== b) void prev.close();
  }, []);

  // This tab's generation was replaced elsewhere: open the newest one in its place.
  reopen.current = (stale: OpenBook) => {
    if (current.current !== stale) return;
    void openStoredBook(stale.id)
      .catch(() => null)
      .then((nb) => {
        if (current.current !== stale) return void nb?.close();
        show(nb, true);
      });
  };

  // A newer generation in the registry (written by another tab) also makes this one stale.
  useEffect(() => {
    const check = (e?: StorageEvent) => {
      if (e && e.key !== REGISTRY_KEY) return;
      const b = current.current;
      const ep = b && registryEpoch(b.id);
      if (b && ep && ep > b.epoch) b.markStale();
    };
    const onFocus = () => check();
    window.addEventListener('storage', check);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('storage', check);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      // 1.0's localAskPersist with no writing yet: only the standing answer is read, never asked for
      const sm = typeof navigator !== 'undefined' ? navigator.storage : undefined;
      if (!sm || typeof sm.persist !== 'function') setLocal((l) => ({ ...l, persisted: 'unsupported' }));
      else if (typeof sm.persisted === 'function') void sm.persisted().then((p) => setLocal((l) => ({ ...l, persisted: !!p })), () => undefined);
      try {
        const r = await startBook(readLegacyBook);
        setLocal((l) => ({ ...l, status: 'saved', errorName: '' }));
        if (r) {
          outside.current.add(r.book.ydoc);
          show(r.book);
          if (r.importedLegacy) toast(t('local.restored'), 'HardDrive');
          if (r.picsMissing > 0) toast(t('local.picsMissing', { n: r.picsMissing }), 'ImageOff');
          return;
        }
      } catch (e) {
        /* storage refused or the book cannot be read: an empty desk, nothing written — the pill says so */
        failed(e);
      }
      show(null);
    })();
  }, [show, toast, t]);

  useEffect(() => () => void current.current?.close(), []);

  // Re-read the title and the outline when the book's meta, its list of sections or a section's own fields change
  // (wave 2c: a retype, the include eye; typing inside a chapter touches only its text fragment, never these).
  useEffect(() => {
    if (!book) return;
    const bump = () => setRev((r) => r + 1);
    const m = book.ydoc.getMap(META);
    m.observe(bump);
    const off = observeSections(book.ydoc, bump);
    return () => {
      m.unobserve(bump);
      off();
    };
  }, [book]);

  /** Open `doc` as a new generation of its book, in place of the open one. Throws as importToDevice does. */
  const replace = useCallback(
    async (doc: unknown) => {
      // the book open here is about to be replaced by this tab itself: its going stale is not news
      const prev = current.current;
      if (prev) prev.onStale = null;
      try {
        const b = await importToDevice(doc);
        show(b);
        setLocal((l) => ({ ...l, status: 'saved', errorName: '' }));
        return b;
      } catch (e) {
        if (prev && current.current === prev) prev.onStale = (stale) => reopen.current(stale);
        // the device would not store the book (not a refused book): the pill says why, as 1.0's says a failed save
        if (!(e instanceof BookImportError)) failed(e);
        throw e;
      }
    },
    [show, failed],
  );

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
      const raw = unwrapBackup(parsed) as Record<string, unknown>;
      const read = readBook(raw);
      if (read.status !== 'ok') {
        // readBook said 'newer' or 'failed': this studio must not open (and so never save) it
        toast(t('local.backupBad'), 'HardDrive');
        return;
      }
      const readDoc = read.book as unknown as Record<string, unknown>;
      // unchanged, the file itself goes to importBook (one readBook, exactly as step 4 opened it)
      let doc: unknown = parsed;
      const open = current.current;
      try {
        if (open) {
          const c = await loadClosure();
          const L = live(c, open.ydoc);
          // 1.0: an empty desk, or the untouched sample, is replaced without asking (it holds nothing to keep)
          const untouched = deskIsUntouchedSample(c, open.ydoc);
          if (!c.api.isEmptyDesk() && !untouched) {
            const title = String(L.state.meta.title || '') || t('misc.untitledBook');
            const ok = await confirm({ title: t('local.backupConfirmTitle'), body: t('local.backupConfirmBody', { title }), yes: t('local.backupConfirmYes'), no: t('confirm.keep') });
            // another tab may have replaced the book while the confirm waited: then this tab now holds a newer generation
            if (ok !== true || current.current !== open || open.isStale) return;
          }
          const arrived = backupArrival(c, open.ydoc, raw, readDoc, untouched);
          if (arrived !== readDoc) doc = arrived;
        }
      } catch {
        toast(t('local.blocked'), 'HardDrive');
        return;
      }
      try {
        const b = await replace(doc);
        outside.current.add(b.ydoc);
        // 1.0's localApplyBackup clears sampleState.loaded: the new generation starts without the sample record
        // 1.0's localApplyBackup: state.meta.title || "Untitled Book"
        toast(t('local.backupOpened', { title: String(bookMeta(b.ydoc).title || '') || t('misc.untitledBook') }), 'HardDrive');
      } catch (e) {
        // anything but a refused book: this device would not store it (storage blocked or full)
        toast(t(e instanceof BookImportError ? 'local.backupBad' : 'local.blocked'), 'HardDrive');
      }
    },
    [replace, confirm, toast, t],
  );

  const isLive = useCallback((ydoc: Y.Doc | null) => {
    const b = current.current;
    return !!ydoc && !!b && b.ydoc === ydoc && !b.isStale;
  }, []);

  const replaceBook = useCallback(
    async (doc: Record<string, unknown>, from: Y.Doc) => {
      if (!isLive(from)) return false;
      try {
        await replace(doc);
        return true;
      } catch (e) {
        toast(t(e instanceof BookImportError ? 'local.backupBad' : 'local.blocked'), 'HardDrive');
        return false;
      }
    },
    [replace, toast, t, isLive],
  );

  const replaceWith = useCallback(
    async (doc: Record<string, unknown>, from: Y.Doc | null) => {
      if (from ? !isLive(from) : current.current !== null) return null;
      try {
        return await replace(doc);
      } catch (e) {
        toast(t(e instanceof BookImportError ? 'local.backupBad' : 'local.blocked'), 'HardDrive');
        return null;
      }
    },
    [replace, toast, t, isLive],
  );

  const takeOutsideArrival = useCallback((ydoc: Y.Doc) => outside.current.delete(ydoc), []);

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
      title: realTitle(m.title),
      author: m.author ? t('misc.byAuthor', { author: m.author }) : '',
      rows,
      bookLang: lang,
      bookDir: BOOK_RTL.includes(lang) ? 'rtl' : 'ltr',
      notes,
      active,
      select: setActive,
      openBackupFile,
      replaceBook,
      replaceWith,
      isLive,
      takeOutsideArrival,
      exportBackup,
      local,
    };
    // rev: the book's meta or sections changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, book, rev, active, t, openBackupFile, replaceBook, replaceWith, isLive, takeOutsideArrival, exportBackup, local]);

  return <BookContext.Provider value={value}>{children}</BookContext.Provider>;
}

export function useBook(): BookApi {
  const v = useContext(BookContext);
  if (!v) throw new Error('useBook() outside <BookProvider>');
  return v;
}
