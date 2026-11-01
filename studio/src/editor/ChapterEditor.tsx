import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type * as Y from 'yjs';
import { useLocale } from '../i18n/LocaleProvider';
import { Icon } from '../shell/Icon';
import { useToast } from '../shell/Toasts';
import { clearActiveEditor, setActiveEditor } from './active';
import { flushNormalize, markActive, toggleBookMark } from './behaviour';
import { createChapterEditor } from './createEditor';
import { tbLayoutInit } from './toolbarLayout';

/* The open chapter: 1.0's format toolbar region (#insertToolbar, the Bold
   and Italic buttons with 1.0's keys) above the page, and the editor on the
   chapter's fragment. Choosing another section unmounts this (the Desk keys
   it by section), which first normalises whatever is still pending, the
   block under the cursor included, then destroys the editor. */

type Props = { fragment: Y.XmlFragment; dir: 'ltr' | 'rtl'; lang: string; label: string; section: number };

export function ChapterEditor({ fragment, dir, lang, label, section }: Props) {
  const { t } = useLocale();
  const toast = useToast();
  const host = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  // 1.0's toolbar layout: whole groups on even rows, labels folding to icons when they would need more than two
  useEffect(() => (bar.current ? tbLayoutInit(bar.current) : undefined), []);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [marks, setMarks] = useState({ strong: false, em: false });
  const refuse = useRef(() => undefined as void);
  refuse.current = () => toast(t('next.markRefused'), 'Info');

  useEffect(() => {
    if (!host.current) return;
    const ed = createChapterEditor({ element: host.current, fragment, dir, lang, label, onRefuse: () => refuse.current() });
    // the pressed state changes rarely: re-render only when it does, never on every keystroke
    const sync = () => {
      const next = { strong: markActive(ed.state, 'strong'), em: markActive(ed.state, 'em') };
      setMarks((m) => (m.strong === next.strong && m.em === next.em ? m : next));
    };
    ed.on('selectionUpdate', sync);
    ed.on('transaction', ({ transaction }) => {
      if (transaction.storedMarksSet) sync();
    });
    setEditor(ed);
    setActiveEditor(ed, section);
    (host.current as HTMLDivElement & { beukEditor?: Editor }).beukEditor = ed; // e2e and latency probes reach it here
    return () => {
      clearActiveEditor(ed);
      flushNormalize(ed);
      ed.destroy();
      setEditor(null);
    };
    // label/dir/lang changes remount through the Desk's key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fragment]);

  const press = (name: 'strong' | 'em') => () => {
    if (!editor) return;
    toggleBookMark(editor, name, () => refuse.current());
    editor.commands.focus();
  };

  return (
    <>
      <div className="toolbar" id="insertToolbar" role="toolbar" aria-controls="manuscript" ref={bar}>
        <div className="tool-group" data-tg="format">
          <button type="button" className="tool-btn" data-collapse="1" data-insert="bold" title={t('tool.boldTitle')} aria-pressed={marks.strong} onMouseDown={(e) => e.preventDefault()} onClick={press('strong')}>
            <Icon name="Bold" />
            <span className="tl">{t('tool.bold')}</span>
          </button>
          <button type="button" className="tool-btn" data-collapse="1" data-insert="italic" title={t('tool.italicTitle')} aria-pressed={marks.em} onMouseDown={(e) => e.preventDefault()} onClick={press('em')}>
            <Icon name="Italic" />
            <span className="tl">{t('tool.italic')}</span>
          </button>
        </div>
      </div>
      <div className="ms-page ms-editing" id="manuscript" dir={dir} lang={lang} data-section={section} ref={host} />
    </>
  );
}
