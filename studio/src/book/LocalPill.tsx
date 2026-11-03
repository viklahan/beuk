import { useEffect, useRef, useState } from 'react';
import { useLocale } from '../i18n/LocaleProvider';
import { Icon } from '../shell/Icon';
import { useBook, type LocalStatus } from './BookProvider';

/* Wave 5a, round 2 (V: 1.0's layout, one Export button): the backup lives where 1.0 keeps it — 1.0's "Saving on this
   device" pill (client/index.html BEUK:local: #localPill, #localPillBtn, #btnLocalBackupInline, #localPop with
   Export a backup and Open a backup…, #localBackupInput). The markup, classes, ids and keys are 1.0's; its CSS is
   extracted verbatim (src/generated/local.css). The words are 1.0's localStatusText / localDetailText on what 2.0's
   store knows (BookProvider's LocalStatus): 2.0 has no save time (1.0's "Last saved {time}") and no "saving" signal,
   so neither is ever shown. Export a backup is the book's backup download (bk.exportBackup); Open a backup… is the
   desk's own flow (bk.openBackupFile: it asks before replacing a book). The popover closes as 1.0's does: its
   buttons, a click outside it, Escape. */

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
/** 1.0's localDetailText (without a save time: 2.0's store keeps none, so 1.0's "no time" sentence). */
export function localDetailText(s: LocalStatus, t: T): string {
  if (failedOf(s)) return t('local.detailFailed');
  let d = t('local.detailSavedNoTime');
  if (s.persisted === true) d += ' ' + t('local.detailPersisted');
  else if (s.persisted === false) d += ' ' + t('local.detailEvictable');
  else if (s.persisted === 'unsupported') d += ' ' + t('local.detailUnsupported');
  return d;
}

export function LocalPill() {
  const { t } = useLocale();
  const bk = useBook();
  const s = bk.local;
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const txt = localStatusText(s, t as T);
  const detail = localDetailText(s, t as T);
  const failed = failedOf(s);
  const evictable = s.status === 'saved' && (s.persisted === false || s.persisted === 'unsupported');

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
          onClick={(e) => {
            e.stopPropagation();
            bk.exportBackup();
          }}
        >
          {t('local.backup')}
        </button>
      </span>
      <div className="local-pop" id="localPop" role="dialog" aria-labelledby="localPopTitle" hidden={!open}>
        <h3 id="localPopTitle">{txt.full}</h3>
        <p id="localPopDetail">{detail}</p>
        <div className="local-pop-actions">
          <button
            className="tb-btn primary"
            id="btnLocalBackup"
            type="button"
            onClick={() => {
              bk.exportBackup();
              setOpen(false);
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
  );
}
