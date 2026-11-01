import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type * as Y from 'yjs';
import { TextSelection } from '@tiptap/pm/state';
import { textOffsetToPos } from '@book/editor/index.js';
import { toBook } from './bridge';
import { editorText } from './insert';
import { useLocale } from '../i18n/LocaleProvider';
import { useToast } from '../shell/Toasts';
import { clearActiveEditor, setActiveEditor } from './active';
import { flushNormalize, markActive, toggleBookMark } from './behaviour';
import { createChapterEditor } from './createEditor';
import { EditorToolbar } from './EditorToolbar';
import { tbLayoutInit } from './toolbarLayout';

/* The open chapter: 1.0's insert toolbar (#insertToolbar, EditorToolbar:
   Bold and Italic as the editor's marks, every other button 1.0's own text
   edit) above the page, and the editor on the chapter's fragment. Choosing
   another section unmounts this (the Desk keys it by section), which first
   normalises whatever is still pending, the block under the cursor
   included, then destroys the editor. */

type Props = {
  fragment: Y.XmlFragment;
  dir: 'ltr' | 'rtl';
  lang: string;
  label: string;
  section: number;
  /** The open section's `type`, read when a tool asks (1.0's AUTO_TYPES refuse some). */
  sectionType?: () => unknown;
  /** Every section's text, in book order, read when the margin dialog opens. */
  sectionTexts?: () => string[];
};

export function ChapterEditor({ fragment, dir, lang, label, section, sectionType = () => undefined, sectionTexts = () => [] }: Props) {
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
    // and the section's text with the selection as text offsets (wave 2a e2e: the toolbar against 1.0's own page)
    (host.current as HTMLDivElement & { beukText?: unknown }).beukText = {
      read: () => editorText(ed),
      select: (s: number, e: number) => {
        const d = toBook(ed.state.doc);
        ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, textOffsetToPos(d, s), textOffsetToPos(d, e))));
        return editorText(ed);
      },
    };
    return () => {
      clearActiveEditor(ed);
      flushNormalize(ed);
      ed.destroy();
      setEditor(null);
    };
    // label/dir/lang changes remount through the Desk's key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fragment]);

  const press = (name: 'strong' | 'em') => {
    if (!editor) return;
    toggleBookMark(editor, name, () => refuse.current());
    editor.commands.focus();
  };

  return (
    <>
      <EditorToolbar ref={bar} editor={editor} marks={marks} onMark={press} sectionType={sectionType} sectionTexts={sectionTexts} ydoc={fragment.doc} />
      <div className="ms-page ms-editing" id="manuscript" dir={dir} lang={lang} data-section={section} ref={host} />
    </>
  );
}
