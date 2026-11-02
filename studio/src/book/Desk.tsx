import { useRef, useState, type DragEvent } from 'react';
import * as Y from 'yjs';
import { BODY, escKey, fragmentText, sectionList, sectionAt } from '@book/editor/index.js';
import { ChapterEditor } from '../editor/ChapterEditor';
import { useLocale } from '../i18n/LocaleProvider';
import { Icon } from '../shell/Icon';
import { useBook } from './BookProvider';
import { SecTypeControl } from '../structure/StructureUi';

/* The writing desk (the centre pane's page).
   - Empty desk: 1.0's "Open a backup…" button, and the page takes a
     dropped .beuk-backup.json.
   - Open book: the chosen chapter's editor (one TipTap instance, keyed by
     book and section, so choosing another section unmounts it), and a
     quiet note for anything the import had to change (textWarnings), naming
     the chapter.
   The manuscript page keeps the BOOK's direction and language, never the
   interface's (an Arabic chrome around an English book). */
/** Every section's text, in book order (a section without a text body counts as ""). */
function sectionTexts(ydoc: Y.Doc): string[] {
  return sectionList(ydoc).map((s) => {
    const b = s instanceof Y.Map ? s.get(BODY) : undefined;
    return b instanceof Y.XmlFragment ? fragmentText(b) : '';
  });
}

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

  const sec = bk.active === null ? undefined : sectionAt(bk.book!.ydoc, bk.active);
  const body = sec instanceof Y.Map ? sec.get(BODY) : undefined;
  const fragment = body instanceof Y.XmlFragment ? body : null;
  const row = bk.rows.find((r) => r.index === bk.active);

  return (
    <div className={'desk' + (dropping ? ' drop-on' : '')} {...dragProps}>
      {bk.notes.map(({ warning, chapter }, i) => (
        <p className="ms-note" role="status" key={i} lang={lang}>
          <Icon name="Info" />
          <span>{t('next.textWarning', { n: warning.count, chapter })}</span>
        </p>
      ))}
      {/* wave 3a: 1.0's Zen calm fold (BEUK:zencalm) before #secSettings: shown only in Zen (1.0's .zen-fold CSS); 1.0's
          setZenMode wires its click and zenFoldSync writes its summary and aria-expanded */}
      <button type="button" className="zen-fold" id="zenDetailsToggle" aria-expanded="false" aria-controls="secSettings editorMeta">
        {/* Outside Zen the fold is hidden but still carries its icon, so the tooltip scan counts it: it gets 1.0's own
            base summary (zenFoldSync's t("zen.details")) as its name until Zen writes the full one. 1.0's span starts
            empty and is named only once Zen has run (reported to V). React owns no children here, so 1.0's
            textContent writes never fight a render. */}
        <span
          className="zf-sum"
          id="zenDetailsSum"
          ref={(el) => {
            if (el && !document.body.classList.contains('zen')) el.textContent = t('zen.details');
          }}
        />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {sec instanceof Y.Map && <SecTypeControl key="sectype" section={sec} />}
      {fragment && bk.active !== null ? (
        <ChapterEditor
          key={bk.book!.id + ':' + bk.book!.epoch + ':' + bk.active}
          fragment={fragment}
          dir={bk.bookDir}
          lang={bk.bookLang}
          label={row?.name || t('side.untitled')}
          section={bk.active}
          sectionType={() => (sec instanceof Y.Map ? sec.get(escKey('type')) : undefined)}
          sectionTexts={() => sectionTexts(bk.book!.ydoc)}
          sectionMap={sec instanceof Y.Map ? sec : null}
        />
      ) : (
        <div className="ms-page" id="manuscript" dir={bk.bookDir} lang={bk.bookLang} />
      )}
    </div>
  );
}
