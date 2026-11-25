import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type * as Y from 'yjs';
import { TextSelection } from '@tiptap/pm/state';
import { escKey, fragmentText, textOffsetToPos } from '@book/editor/index.js';
import { toBook } from './bridge';
import { editorText } from './insert';
import { useLocale } from '../i18n/LocaleProvider';
import { useToast } from '../shell/Toasts';
import { clearActiveEditor, setActiveEditor } from './active';
import { flushNormalize, markActive, toggleBookMark } from './behaviour';
import { createChapterEditor } from './createEditor';
import { EditorToolbar } from './EditorToolbar';
import { tbLayoutInit } from './toolbarLayout';
import { EditorMeta } from './EditorMeta';
import { GenEditor } from './GenEditor';
import { closureIfLoaded, loadClosure } from '../closure/index';
import { SceneBar } from '../pictures/SceneBar';
import { SectionImages } from '../pictures/SectionImages';
import { StarterBar } from './StarterBar';
import { PoemStrip, usePoem } from './PoemMode';
import { setEditorPoem } from './poem';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { noteWriting } from '../goals/goals';
import { afterLocalEdit, LangBar, leaveSection, WordBar } from '../environment/EditorEnv';

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
  /** The section's own Y map (wave 2b: its plate, backdrop and scene pictures). */
  sectionMap?: Y.Map<unknown> | null;
};

export function ChapterEditor({ fragment, dir, lang, label, section, sectionType = () => undefined, sectionTexts = () => [], sectionMap = null }: Props) {
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
  const showArea = useShowArea(fragment, sectionMap);
  const showAreaRef = useRef(showArea);
  showAreaRef.current = showArea;
  /* BEUK:poemmode — the chapter's Poem Mode, as its section stores it. The page takes a class for the layout (the
     stylesheet does the rest: the paragraph's new lines are already lines here), and the editor is told, so that
     Shift-Enter writes a plain new line and an empty poem shows its starter lines (poem.ts). */
  const poem = usePoem(sectionMap);
  const ghost = poem.on ? [t('poem.ghost1'), t('poem.ghost2'), t('poem.ghost3')].join('\n') : '';
  useEffect(() => {
    if (editor) setEditorPoem(editor, { on: poem.on, ghost });
  }, [editor, poem.on, ghost]);

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
      // wave 3a: 1.0's editor input handler — a local edit of the page is writing activity (the streak, the shelf's
      // heartbeat); a change arriving from Yjs (another tab, an undo of a remote change) is not
      if (transaction.docChanged && transaction.getMeta(ySyncPluginKey) === undefined) {
        noteWriting();
        afterLocalEdit();
      }
    });
    setEditor(ed);
    setActiveEditor(ed, section, sectionMap);
    ed.setEditable(showAreaRef.current);
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
      // 1.0's selectSection: reading stops and the dictation session leaves NOW, into this section, before it goes
      leaveSection();
      clearActiveEditor(ed);
      flushNormalize(ed);
      ed.destroy();
      setEditor(null);
    };
    // label/dir/lang changes remount through the Desk's key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fragment]);

  // 1.0's syncEditor: a generated page hides the manuscript editor (area.disabled, display none; the insert toolbar and
  // the word bar with it), except a copyright page that brought its own words
  useEffect(() => {
    if (editor && editor.isEditable !== showArea) editor.setEditable(showArea);
    if (bar.current) bar.current.style.display = showArea ? '' : 'none';
  }, [editor, showArea]);

  const press = (name: 'strong' | 'em') => {
    if (!editor) return;
    toggleBookMark(editor, name, () => refuse.current());
    editor.commands.focus();
  };

  const ydoc = fragment.doc;
  // 1.0's centre column: #editorMeta (the chapter heading block and its art rows), #insertToolbar, #sceneBar, #starterBar, the page, #sectionImages
  return (
    <>
      {ydoc && sectionMap && <EditorMeta ydoc={ydoc} section={sectionMap} />}
      <EditorToolbar ref={bar} editor={editor} marks={marks} onMark={press} sectionType={sectionType} sectionTexts={sectionTexts} ydoc={ydoc} sectionMap={sectionMap} poem={poem} />
      {ydoc && sectionMap && showArea && <PoemStrip ydoc={ydoc} section={sectionMap} poem={poem} dir={dir} />}
      {ydoc && sectionMap && <SceneBar editor={editor} ydoc={ydoc} sectionId={sectionMap.get('id')} sectionType={sectionType} />}
      <LangBar />
      <WordBar sectionId={sectionMap ? sectionMap.get('id') : undefined} hidden={!showArea} />
      {ydoc && sectionMap && <StarterBar editor={editor} ydoc={ydoc} section={sectionMap} />}
      {ydoc && sectionMap && <GenEditor ydoc={ydoc} section={sectionMap} />}
      <div className={'ms-page ms-editing' + (poem.on ? ' ms-poem ms-poem-' + poem.align : '')} id="manuscript" dir={dir} lang={lang} data-section={section} ref={host} style={showArea ? undefined : { display: 'none' }} />
      {ydoc && <SectionImages editor={editor} ydoc={ydoc} sectionType={sectionType} />}
    </>
  );
}

/** 1.0's syncEditor `showArea`: `!isAuto || (s.type === "copyright" && String(s.content || "").trim().length > 0)`,
 *  AUTO_TYPES 1.0's own (lifted). Read when the section opens and again when its type changes (a retype: 1.0 runs
 *  syncEditor after it), never on typing: the page that brought its words keeps its editor while they are edited. */
function useShowArea(fragment: Y.XmlFragment, sectionMap: Y.Map<unknown> | null): boolean {
  const [c, setC] = useState(() => closureIfLoaded());
  useEffect(() => {
    if (c) return;
    let alive = true;
    void loadClosure().then((cc) => alive && setC(cc));
    return () => {
      alive = false;
    };
  }, [c]);
  const typeOf = () => (sectionMap ? String(sectionMap.get(escKey('type')) ?? 'chapter') : 'chapter');
  const [type, setType] = useState(typeOf);
  useEffect(() => {
    if (!sectionMap) return;
    const on = (e: Y.YMapEvent<unknown>) => {
      if (e.keysChanged.has(escKey('type'))) setType(typeOf());
    };
    sectionMap.observe(on);
    return () => sectionMap.unobserve(on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionMap]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const words = useMemo(() => fragmentText(fragment).trim().length > 0, [fragment, type]);
  if (!c || !c.api.AUTO_TYPES.includes(type)) return true;
  return type === 'copyright' && words;
}
