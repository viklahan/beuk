import { forwardRef, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Editor } from '@tiptap/core';
import type * as Y from 'yjs';
import { bookState, closureIfLoaded, loadClosure, type Closure, type ClosureApi } from '../closure';
import type { UiKey } from '../i18n/strings';
import { useLocale } from '../i18n/LocaleProvider';
import { Dialog } from '../shell/Dialog';
import { Icon, type IconName } from '../shell/Icon';
import { useToast } from '../shell/Toasts';
import { applyTextEdit, editorText, textArea } from './insert';
import { ImageDialog } from '../pictures/ImageDialog';
import { IMG_AUTO_REFUSED } from '../pictures/scene';
import {
  autoFormatEdit, footnoteEdit, footnoteNumber, linkEdit, linkWordsOf, marginEdit, marginLastName, marginWordsOf, textAction, type ToolKind,
} from './tools';

/* BEUK:toolbar — 1.0's #insertToolbar (client/index.html, the markup around
   line 3011, the click handler in initEditor): the Format, Structure, Blocks
   and Assist groups with 1.0's data-insert kinds, data-collapse levels,
   icons and keys, and the Footnote, Link and Margin note dialogs (1.0's
   #modalFootnote, #modalLink, #modalMargin: ids, keys, z-index 66, their
   Enter / Ctrl+Enter / Escape keys).

   Each action is 1.0's own text edit (tools.ts, through the browser
   closure) written into the editor as one transaction and one undo step
   (insert.ts). Bold and Italic stay the editor's marks (step 4).

   Insert Image (wave 2b) opens 1.0's picture dialog (pictures/ImageDialog);
   the scene bar a new scene break opens is pictures/SceneBar.

   Left out, with their waves: Dictate (wave 3) and the Focus cluster — Read
   Aloud and Zen (wave 3). */

type Btn = { kind: ToolKind | 'bold' | 'italic'; icon: IconName; label: UiKey; title: UiKey };

const FORMAT: Btn[] = [
  { kind: 'link', icon: 'Link', label: 'tool.link', title: 'tool.linkTitle' },
  { kind: 'redact', icon: 'EyeOff', label: 'tool.redact', title: 'tool.redactTitle' },
];
const STRUCTURE: Btn[] = [
  { kind: 'blockquote', icon: 'Quote', label: 'tool.blockquote', title: 'tool.blockquoteTitle' },
  { kind: 'attribution', icon: 'Signature', label: 'tool.attribution', title: 'tool.attributionTitle' },
  { kind: 'ul', icon: 'List', label: 'tool.ul', title: 'tool.ulTitle' },
  { kind: 'ol', icon: 'ListOrdered', label: 'tool.ol', title: 'tool.olTitle' },
  { kind: 'scenebreak', icon: 'Sparkle', label: 'tool.sceneBreak', title: 'tool.sceneBreakTitle' },
  { kind: 'emdash', icon: 'Minus', label: 'tool.emDash', title: 'tool.emDashTitle' },
  { kind: 'endnote', icon: 'NotebookPen', label: 'tool.footnote', title: 'tool.footnoteTitle' },
];
const BLOCKS: Btn[] = [
  { kind: 'columns', icon: 'Columns2', label: 'tool.columns', title: 'tool.columnsTitle' },
  { kind: 'hanging', icon: 'IndentIncrease', label: 'tool.hanging', title: 'tool.hangingTitle' },
  { kind: 'verse', icon: 'Feather', label: 'tool.verse', title: 'tool.verseTitle' },
  { kind: 'center', icon: 'AlignCenter', label: 'tool.center', title: 'tool.centerTitle' },
  { kind: 'right', icon: 'AlignRight', label: 'tool.right', title: 'tool.rightTitle' },
  { kind: 'texts', icon: 'MessagesSquare', label: 'tool.texts', title: 'tool.textsTitle' },
  { kind: 'letter', icon: 'MailOpen', label: 'tool.letter', title: 'tool.letterTitle' },
  { kind: 'transcript', icon: 'MicVocal', label: 'tool.transcript', title: 'tool.transcriptTitle' },
  { kind: 'log', icon: 'SquareTerminal', label: 'tool.log', title: 'tool.logTitle' },
  { kind: 'insert', icon: 'StickyNote', label: 'tool.insert', title: 'tool.insertTitle' },
  { kind: 'margin', icon: 'PenLine', label: 'tool.margin', title: 'tool.marginTitle' },
  { kind: 'sideways', icon: 'RotateCw', label: 'tool.sideways', title: 'tool.sidewaysTitle' },
  { kind: 'upsidedown', icon: 'FlipVertical2', label: 'tool.upsideDown', title: 'tool.upsideDownTitle' },
];
/** The kinds 1.0 refuses (silently) on a generated section (its AUTO_TYPES): the three dialogs and Auto-Format. */
const AUTO_GUARDED = new Set<string>(['endnote', 'link', 'margin', 'autoformat']);

/** 1.0's Auto-Format toasts: plain English in 1.0 (no key), kept as 1.0 shows them (see the wave 2a report). */
export const AUTO_FORMAT_CLEAN = 'Text is already clean — nothing to change';
export const AUTO_FORMAT_DONE = 'Auto-Format applied: smart quotes, em-dashes, ellipses, scene breaks';

type Props = {
  editor: Editor | null;
  marks: { strong: boolean; em: boolean };
  onMark: (name: 'strong' | 'em') => void;
  /** The open section's `type` (1.0's AUTO_TYPES refuse the dialogs and Auto-Format). */
  sectionType: () => unknown;
  /** Every section's text, in book order (the margin dialog offers the book's last margin name). */
  sectionTexts: () => string[];
  /** The book (Auto-Format's quotes follow its language: 1.0's curlify reads bookLang() from the state). */
  ydoc: Y.Doc | null;
};

function withClosure(fn: (c: ClosureApi, whole: Closure) => void): void {
  const c = closureIfLoaded();
  if (c) fn(c.api, c);
  else void loadClosure().then((l) => fn(l.api, l));
}

export const EditorToolbar = forwardRef<HTMLDivElement, Props>(function EditorToolbar({ editor, marks, onMark, sectionType, sectionTexts, ydoc }, ref) {
  const { t } = useLocale();
  const toast = useToast();
  const [fn, setFn] = useState<{ n: number } | null>(null);
  const [lnk, setLnk] = useState<{ words: string } | null>(null);
  const [mn, setMn] = useState<{ name: string; words: string } | null>(null);
  const [img, setImg] = useState(false);

  const live = (): Editor | null => (editor && !editor.isDestroyed ? editor : null);
  const back = () => {
    const ed = live();
    if (ed) ed.view.focus();
  };

  const run = (kind: ToolKind | 'autoformat') => {
    const ed = live();
    if (!ed) return;
    withClosure((c, whole) => {
      if (AUTO_GUARDED.has(kind) && c.AUTO_TYPES.includes(String(sectionType() ?? ''))) return;
      const cur = editorText(ed);
      if (kind === 'endnote') return setFn({ n: footnoteNumber(c, cur.text) });
      if (kind === 'link') return setLnk({ words: linkWordsOf(cur) });
      if (kind === 'margin') return setMn({ name: marginLastName(c, sectionTexts()), words: marginWordsOf(cur) });
      if (kind === 'autoformat') {
        if (ydoc) bookState(whole, ydoc); // 1.0's state for this book: its language picks the quotes
        const next = autoFormatEdit(c, cur);
        const clean = next.text === textArea(cur.text, 0, 0).value; // 1.0 compares its textarea (no CR) before and after
        if (!clean) applyTextEdit(ed, next);
        ed.view.focus();
        toast(clean ? AUTO_FORMAT_CLEAN : AUTO_FORMAT_DONE, 'WandSparkles');
        return;
      }
      const next = textAction(c, kind, cur);
      if (next) applyTextEdit(ed, next);
      ed.view.focus();
    });
  };

  const button = (b: Btn, collapse: number) => {
    const isMark = b.kind === 'bold' || b.kind === 'italic';
    return (
      <button
        key={b.kind}
        type="button"
        className="tool-btn"
        data-collapse={collapse}
        data-insert={b.kind}
        title={t(b.title)}
        aria-pressed={isMark ? (b.kind === 'bold' ? marks.strong : marks.em) : undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (b.kind === 'bold' ? onMark('strong') : b.kind === 'italic' ? onMark('em') : run(b.kind as ToolKind))}
      >
        <Icon name={b.icon} />
        <span className="tl">{t(b.label)}</span>
      </button>
    );
  };

  return (
    <>
      <div className="toolbar" id="insertToolbar" role="toolbar" aria-controls="manuscript" ref={ref}>
        <div className="tool-group" data-tg="format">
          {button({ kind: 'bold', icon: 'Bold', label: 'tool.bold', title: 'tool.boldTitle' }, 1)}
          {button({ kind: 'italic', icon: 'Italic', label: 'tool.italic', title: 'tool.italicTitle' }, 1)}
          {FORMAT.map((b) => button(b, 1))}
        </div>
        <span className="tool-break" aria-hidden="true" />
        <div className="tool-group" data-tg="structure">
          <span className="tool-sep" aria-hidden="true" />
          {STRUCTURE.map((b) => button(b, 2))}
        </div>
        <span className="tool-break" aria-hidden="true" />
        <div className="tool-group" data-tg="blocks">
          <span className="tool-sep" aria-hidden="true" />
          {BLOCKS.map((b) => button(b, 2))}
        </div>
        <span className="tool-break" aria-hidden="true" />
        <div className="tool-group" data-tg="assist">
          <span className="tool-sep" aria-hidden="true" />
          <button
            type="button"
            className="tool-btn"
            data-collapse={3}
            id="btnInsertImage"
            title={t('tool.insertImageTitle')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              // 1.0's openImageModal: a generated section takes no picture
              withClosure((c) => {
                if (c.AUTO_TYPES.includes(String(sectionType() ?? ''))) toast(IMG_AUTO_REFUSED, 'Image');
                else if (ydoc) setImg(true);
              });
            }}
          >
            <Icon name="ImagePlus" />
            <span className="tl">{t('tool.insertImage')}</span>
          </button>
          {/* Dictate (wave 3) stands here, before Auto-Format, in 1.0 */}
          <button type="button" className="tool-btn accent" id="btnBeautify" title={t('tool.autoFormatTitle')} onMouseDown={(e) => e.preventDefault()} onClick={() => run('autoformat')}>
            <Icon name="WandSparkles" />
            <span className="tl">{t('tool.autoFormat')}</span>
          </button>
        </div>
        {/* the Focus cluster (Read Aloud, Zen) is wave 3 */}
      </div>

      {img && ydoc && (
        <ImageDialog
          ydoc={ydoc}
          editor={live()}
          onClose={() => {
            setImg(false);
            back();
          }}
        />
      )}
      {fn && (
        <FootnoteDialog
          n={fn.n}
          onCancel={() => {
            back();
            setFn(null);
          }}
          onDone={(note) => {
            const ed = live();
            withClosure((c) => {
              if (ed) {
                applyTextEdit(ed, footnoteEdit(c, editorText(ed), fn.n, note));
                ed.view.focus();
              }
              setFn(null);
            });
          }}
        />
      )}
      {lnk && (
        <LinkDialog
          words={lnk.words}
          onCancel={() => {
            back();
            setLnk(null);
          }}
          tryDone={(words, url) => {
            const ed = live();
            const c = closureIfLoaded()?.api;
            if (!c) return false;
            const next = ed ? linkEdit(c, editorText(ed), words, url) : null;
            if (ed && !next) return false; // the address can't be a link: the dialog says so and stays
            if (ed && next) {
              applyTextEdit(ed, next);
              ed.view.focus();
            }
            setLnk(null);
            return true;
          }}
        />
      )}
      {mn && (
        <MarginDialog
          name={mn.name}
          words={mn.words}
          onCancel={() => {
            back();
            setMn(null);
          }}
          tryDone={(name, words) => {
            const ed = live();
            const c = closureIfLoaded()?.api;
            if (!c) return false;
            const next = ed ? marginEdit(c, editorText(ed), name, words) : null;
            if (ed && !next) return false; // no name: the dialog says so and stays
            if (ed && next) {
              applyTextEdit(ed, next);
              ed.view.focus();
            }
            setMn(null);
            return true;
          }}
        />
      )}
    </>
  );
});

/* ---- the dialogs ---- */

function FootnoteDialog({ n, onCancel, onDone }: { n: number; onCancel: () => void; onDone: (note: string) => void }) {
  const { t } = useLocale();
  const text = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => text.current?.focus({ preventScroll: true }), []);
  const done = () => onDone(text.current?.value ?? '');
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      done();
    }
  };
  return (
    <Dialog open onClose={onCancel} id="modalFootnote" z={66} labelledBy="fnH" modalStyle={{ maxWidth: 440 }}>
      <h2 id="fnH">
        <Icon name="NotebookPen" />
        <span id="fnTitle">{t('fn.titleN', { n })}</span>
      </h2>
      <div className="form-grid" style={{ marginTop: 16 }}>
        <div className="full">
          <textarea className="txt-input" id="fnText" rows={3} placeholder={t('fn.placeholder')} aria-label="Footnote text" style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} ref={text} onKeyDown={onKey} />
        </div>
      </div>
      <div className="modal-actions">
        <button type="button" className="tb-btn" id="btnCancelFootnote" onClick={onCancel}>
          {t('fn.cancel')}
        </button>
        <button type="button" className="tb-btn primary" id="btnDoFootnote" onClick={done}>
          <Icon name="Check" />
          {t('fn.add')}
        </button>
      </div>
    </Dialog>
  );
}

function LinkDialog({ words, onCancel, tryDone }: { words: string; onCancel: () => void; tryDone: (words: string, url: string) => boolean }) {
  const { t } = useLocale();
  const wordsEl = useRef<HTMLInputElement>(null);
  const urlEl = useRef<HTMLInputElement>(null);
  const [bad, setBad] = useState(false);
  useLayoutEffect(() => (words ? urlEl : wordsEl).current?.focus({ preventScroll: true }), [words]);
  const done = () => {
    if (tryDone(wordsEl.current?.value ?? '', urlEl.current?.value ?? '')) return;
    setBad(true);
    urlEl.current?.focus();
  };
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      done();
    }
  };
  return (
    <Dialog open onClose={onCancel} id="modalLink" z={66} labelledBy="lnkH" modalStyle={{ maxWidth: 460 }}>
      <h2 id="lnkH">
        <Icon name="Link" />
        <span>{t('lnk.title')}</span>
      </h2>
      <div className="form-grid" style={{ marginTop: 16 }}>
        <div className="full">
          <label className="field-lab" htmlFor="lnkText">
            {t('lnk.text')}
          </label>
          <input className="txt-input" id="lnkText" type="text" placeholder={t('lnk.textPh')} style={{ width: '100%' }} defaultValue={words} ref={wordsEl} onKeyDown={onKey} />
        </div>
        <div className="full">
          <label className="field-lab" htmlFor="lnkUrl">
            {t('lnk.url')}
          </label>
          <input className="txt-input" id="lnkUrl" type="url" inputMode="url" spellCheck={false} placeholder={t('lnk.urlPh')} style={{ width: '100%' }} defaultValue="" ref={urlEl} onKeyDown={onKey} />
        </div>
        <div className="full">
          <p className={'cover-note' + (bad ? ' is-bad' : '')} id="lnkHint" style={{ margin: 0 }}>
            {t(bad ? 'lnk.bad' : 'lnk.hint')}
          </p>
        </div>
      </div>
      <div className="modal-actions">
        <button type="button" className="tb-btn" id="btnCancelLink" onClick={onCancel}>
          {t('lnk.cancel')}
        </button>
        <button type="button" className="tb-btn primary" id="btnDoLink" onClick={done}>
          <Icon name="Check" />
          {t('lnk.add')}
        </button>
      </div>
    </Dialog>
  );
}

function MarginDialog({ name, words, onCancel, tryDone }: { name: string; words: string; onCancel: () => void; tryDone: (name: string, words: string) => boolean }) {
  const { t } = useLocale();
  const nameEl = useRef<HTMLInputElement>(null);
  const textEl = useRef<HTMLTextAreaElement>(null);
  const [bad, setBad] = useState(false);
  useLayoutEffect(() => {
    if (name) textEl.current?.focus({ preventScroll: true });
    else nameEl.current?.focus({ preventScroll: true });
  }, [name]);
  const done = () => {
    if (tryDone(nameEl.current?.value ?? '', textEl.current?.value ?? '')) return;
    setBad(true);
    nameEl.current?.focus();
  };
  return (
    <Dialog open onClose={onCancel} id="modalMargin" z={66} labelledBy="mnH" modalStyle={{ maxWidth: 460 }}>
      <h2 id="mnH">
        <Icon name="StickyNote" />
        <span>{t('mn.title')}</span>
      </h2>
      <div className="form-grid" style={{ marginTop: 16 }}>
        <div className="full">
          <label className="field-lab" htmlFor="mnName">
            {t('mn.name')}
          </label>
          <input
            className="txt-input"
            id="mnName"
            type="text"
            maxLength={40}
            placeholder={t('mn.namePh')}
            style={{ width: '100%' }}
            defaultValue={name}
            ref={nameEl}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                done();
              }
            }}
          />
        </div>
        <div className="full">
          <label className="field-lab" htmlFor="mnText">
            {t('mn.text')}
          </label>
          <textarea
            className="txt-input"
            id="mnText"
            rows={3}
            placeholder={t('mn.textPh')}
            style={{ width: '100%', resize: 'vertical' }}
            defaultValue={words}
            ref={textEl}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                done();
              }
            }}
          />
        </div>
        <div className="full">
          <p className={'cover-note' + (bad ? ' is-bad' : '')} id="mnHint" style={{ margin: 0 }}>
            {t(bad ? 'mn.bad' : 'mn.hint')}
          </p>
        </div>
      </div>
      <div className="modal-actions">
        <button type="button" className="tb-btn" id="btnCancelMargin" onClick={onCancel}>
          {t('mn.cancel')}
        </button>
        <button type="button" className="tb-btn primary" id="btnDoMargin" onClick={done}>
          <Icon name="Check" />
          {t('mn.add')}
        </button>
      </div>
    </Dialog>
  );
}
