import { useRef, useState, type DragEvent } from 'react';
import { useLocale } from '../i18n/LocaleProvider';
import { Icon } from '../shell/Icon';
import { useBook } from './BookProvider';

/* The writing desk (the centre pane's page).
   - Empty desk: 1.0's "Open a backup…" button, and the page takes a
     dropped .beuk-backup.json.
   - Open book: the chosen chapter (Task 2 mounts its editor here), and a
     quiet note for anything the import had to change (textWarnings), naming
     the chapter.
   The manuscript page keeps the BOOK's direction and language, never the
   interface's (an Arabic chrome around an English book). */
export function Desk() {
  const { t, lang } = useLocale();
  const bk = useBook();
  const input = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) void bk.openBackupFile(f);
  };
  const dragProps = {
    onDragOver: (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) {
        e.preventDefault();
        setDropping(true);
      }
    },
    onDragLeave: () => setDropping(false),
    onDrop,
  };

  if (bk.phase !== 'open') {
    return (
      <div className={'ms-page desk-empty' + (dropping ? ' drop-on' : '')} id="manuscript" dir="ltr" lang="en" {...dragProps}>
        <p className="ms-placeholder" lang={lang}>
          {t('editor.placeholder')}
        </p>
        {bk.phase === 'empty' && (
          <div className="desk-actions" lang={lang}>
            <button type="button" className="tb-btn" id="btnOpenBackup" onClick={() => input.current?.click()}>
              <Icon name="FolderOpen" />
              <span>{t('local.openBackup')}</span>
            </button>
            <input
              ref={input}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void bk.openBackupFile(f);
              }}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={'desk' + (dropping ? ' drop-on' : '')} {...dragProps}>
      {bk.notes.map(({ warning, chapter }, i) => (
        <p className="ms-note" role="status" key={i} lang={lang}>
          <Icon name="Info" />
          <span>{t('next.textWarning', { n: warning.count, chapter })}</span>
        </p>
      ))}
      <div className="ms-page" id="manuscript" dir={bk.bookDir} lang={bk.bookLang} data-section={bk.active ?? undefined} />
    </div>
  );
}
