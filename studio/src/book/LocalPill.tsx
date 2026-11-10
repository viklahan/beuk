import { useEffect, useRef, useState } from 'react';
import { closureIfLoaded, cloudFacts, loadClosure } from '../closure/index';
import { loadCloud } from '../cloud/cloud';
import { useLocale } from '../i18n/LocaleProvider';
import { BodyModalStack } from '../shell/BodyModalStack';
import { Icon } from '../shell/Icon';
import { useBook, type LocalStatus } from './BookProvider';

/* Wave 5a, round 2 (V: 1.0's layout, one Export button): the backup lives where 1.0 keeps it — 1.0's "Saving on this
   device" pill (client/index.html BEUK:local: #localPill, #localPillBtn, #btnLocalBackupInline, #localPop with
   Export a backup and Open a backup…, #localBackupInput). The markup, classes, ids and keys are 1.0's; its CSS is
   extracted verbatim (src/generated/local.css). The words are 1.0's localStatusText / localDetailText on what 2.0's
   store knows (BookProvider's LocalStatus; "Last saved {time}" is the store's last completed write, OpenBook.savedAt).
   1.0's "saving" (its pause before a save) has no 2.0 counterpart: y-indexeddb writes each change at once. Export a backup is the book's backup download (bk.exportBackup); Open a backup… is the
   desk's own flow (bk.openBackupFile: it asks before replacing a book). The popover closes as 1.0's does: its
   buttons, a click outside it, Escape.
   Locked backups and the authorship record (design 2026-11-09, task 3): 1.0's #lockBackup fieldset above the actions,
   run by 1.0's own lock machinery (BEUK:lockcopy lockFieldsWire / lockFieldsRender / lockFieldsClear, the scope
   "backup": day 22 hides it, a closed popover keeps no password, a refusal keeps the popover open with its message), and
   1.0's #btnAuthorshipRecord, signed in only, opening 1.0's record dialog (the shelf's module: authorshipRecordOpen). */

type T = (k: string, p?: Record<string, unknown>) => string;
const failedOf = (s: LocalStatus) => s.status === 'blocked' || s.status === 'quota' || s.status === 'error';
/** 1.0's localStatusText. */
export function localStatusText(s: LocalStatus, t: T): { full: string; short: string } {
  switch (s.status) {
    case 'checking':
      return { full: t('local.checking'), short: t('local.checkingShort') };
    case 'saved':
      return { full: t('local.saved'), short: s.persisted === false || s.persisted === 'unsupported' ? t('local.savedRiskShort') : t('local.savedShort') };
    case 'blocked':
      return { full: t('local.blocked'), short: t('local.notSavedShort') };
    case 'quota':
      return { full: t('local.quota'), short: t('local.notSavedShort') };
    default:
      return { full: t('local.error', { name: s.errorName || 'Error' }), short: t('local.notSavedShort') };
  }
}
/** 1.0's fmtLocalTime: the time of day in the interface language. */
export function fmtLocalTime(ms: number, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleTimeString();
  }
}
/** 1.0's localDetailText; `savedAt` is the store's last completed write (OpenBook.savedAt; 0: none yet). */
export function localDetailText(s: LocalStatus, t: T, savedAt = 0, lang = 'en'): string {
  if (failedOf(s)) return t('local.detailFailed');
  let d = savedAt ? t('local.detailSaved', { time: fmtLocalTime(savedAt, lang) }) : t('local.detailSavedNoTime');
  if (s.persisted === true) d += ' ' + t('local.detailPersisted');
  else if (s.persisted === false) d += ' ' + t('local.detailEvictable');
  else if (s.persisted === 'unsupported') d += ' ' + t('local.detailUnsupported');
  return d;
}

/** 1.0's LOCAL_DEBOUNCE_MS (BEUK:local): the pause after an edit before 1.0 saves and its pill says the time. */
export const LOCAL_QUIET_MS = 800;

export function LocalPill() {
  const { t, lang } = useLocale();
  const bk = useBook();
  const s = bk.local;
  const [open, setOpen] = useState(false);
  // the store's last completed write, followed as 1.0's pill follows its saves (only this small part re-renders).
  // Wave 5b (constraint 63): y-indexeddb writes on every keystroke; with the popover closed the pill is drawn again
  // once a run of writes has gone quiet (1.0's LOCAL_DEBOUNCE_MS: 1.0 saves, and says its time, after that pause), so
  // typing does not re-render it per key; with the popover open, at each write. Every render reads the store's time.
  const ob = bk.book;
  const [, setTick] = useState(0);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!ob) return;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const off = ob.onWrite((err) => {
      if (err !== null) return;
      clearTimeout(quiet);
      if (openRef.current) setTick((n) => n + 1);
      else quiet = setTimeout(() => setTick((n) => n + 1), LOCAL_QUIET_MS);
    });
    return () => {
      clearTimeout(quiet);
      off();
    };
  }, [ob]);
  const savedAt = ob?.savedAt ?? 0;
  const input = useRef<HTMLInputElement>(null);
  const txt = localStatusText(s, t as T);
  const detail = localDetailText(s, t as T, savedAt, lang);
  const failed = failedOf(s);
  const evictable = s.status === 'saved' && (s.persisted === false || s.persisted === 'unsupported');

  // BEUK:lockcopy — 1.0's own wiring of the lock box (the box shows its fields when ticked; typing clears its message)
  useEffect(() => {
    let alive = true;
    void loadClosure().then((c) => {
      if (alive) c.api.lockFieldsWire('backup');
    });
    return () => {
      alive = false;
    };
  }, []);
  // opened: the plan's day 22 hides the box (1.0's lockFieldsRender); closed: nothing typed stays behind
  useEffect(() => {
    const c = closureIfLoaded();
    if (!c) return;
    if (open) c.api.lockFieldsRender();
    else {
      c.api.lockFieldsClear('backup');
      c.api.lockFieldsSay('backup', '');
    }
  }, [open]);
  const signedIn = !!cloudFacts.user;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (!el || !el.closest || (!el.closest('#localPop') && !el.closest('#localPillBtn'))) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      {/* BEUK:authorship — 1.0's two dialogs (on <body>, made by 1.0's code) take their place on the dialog stack while
          open: Tab stays inside, and above the export modal (Add a Book's locked volume) Escape closes only the top one */}
      <BodyModalStack id="modalBackupPw" closeSel="#btnBackupPwCancel" />
      <BodyModalStack id="modalAuthorship" closeSel="#btnAuthClose" />
      {/* BEUK:importlock — the same dialog asking a locked file's password (the Import button, Bulk import, Add a Book) */}
      <BodyModalStack id="modalPasswordAsk" closeSel="#btnPasswordAskCancel" />
    <div className={'local-wrap' + (failed ? ' is-failed' : '')}>
      <span className="local-pill" id="localPill" data-state={s.status} data-evictable={evictable ? '' : undefined} role="status" aria-live="polite" title={txt.full + ' — ' + detail}>
        <button
          className="local-pill-btn"
          id="localPillBtn"
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open ? 'true' : 'false'}
          aria-controls="localPop"
          aria-label={txt.full + (evictable ? ' — ' + detail : '') + ' — ' + t('local.aria')}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          <span className="local-dot" aria-hidden="true" />
          <span className="local-warn" aria-hidden="true">
            !
          </span>
          <span className="local-short" id="localPillShort" aria-hidden="true">
            {txt.short}
          </span>
          <span className="local-full" id="localPillText">
            {txt.full}
          </span>
        </button>
        <button
          className="local-backup-inline"
          id="btnLocalBackupInline"
          type="button"
          hidden={!failed}
          disabled={bk.backupBusy}
          onClick={(e) => {
            e.stopPropagation();
            bk.exportBackup(true);
          }}
        >
          {t('local.backup')}
        </button>
      </span>
      <div className="local-pop" id="localPop" role="dialog" aria-labelledby="localPopTitle" hidden={!open}>
        <h3 id="localPopTitle">{txt.full}</h3>
        <p id="localPopDetail">{detail}</p>
        {/* BEUK:authorship — the backup's optional lock (1.0's fieldset); the password never leaves the device */}
        <fieldset className="lock-fs" id="lockBackup" style={{ border: 0, padding: 0, margin: '10px 0 0', minWidth: 0 }}>
          <label className="acx-check">
            <input type="checkbox" id="lockBackupOn" name="lockcopy-backup-on" /> <span>{t('lock.toggle')}</span>
          </label>
          <div id="lockBackupFields" hidden>
            <div>
              <label className="field-lab" htmlFor="lockBackupPw">
                {t('lock.pw')}
              </label>
              <input className="txt-input" id="lockBackupPw" name="lockcopy-backup-pw" type="password" autoComplete="new-password" />
            </div>
            <div>
              <label className="field-lab" htmlFor="lockBackupPw2">
                {t('lock.pw2')}
              </label>
              <input className="txt-input" id="lockBackupPw2" name="lockcopy-backup-pw2" type="password" autoComplete="new-password" />
            </div>
            <p className="acx-note">{t('backup.lockNote')}</p>
            <p className="acx-note acx-warn" id="lockBackupErr" role="alert" hidden />
          </div>
        </fieldset>
        <div className="local-pop-actions">
          <button
            className="tb-btn primary"
            id="btnLocalBackup"
            type="button"
            disabled={bk.backupBusy}
            onClick={() => {
              if (bk.exportBackup()) setOpen(false);
            }}
          >
            <Icon name="Download" />
            <span>{t('local.backup')}</span>
          </button>
          <button
            className="tb-btn"
            id="btnLocalOpenBackup"
            type="button"
            onClick={() => {
              setOpen(false);
              if (input.current) {
                input.current.value = '';
                input.current.click();
              }
            }}
          >
            <Icon name="FolderOpen" />
            <span>{t('local.openBackup')}</span>
          </button>
          <button
            className="tb-btn"
            id="btnAuthorshipRecord"
            type="button"
            hidden={!signedIn}
            onClick={() => {
              setOpen(false);
              void loadCloud().then((cm) => cm.api.authorshipRecordOpen());
            }}
          >
            <Icon name="Stamp" />
            <span>{t('auth.record')}</span>
          </button>
        </div>
        <input
          type="file"
          id="localBackupInput"
          ref={input}
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={() => {
            const f = input.current?.files?.[0];
            if (f) void bk.openBackupFile(f);
          }}
        />
      </div>
    </div>
    </>
  );
}
