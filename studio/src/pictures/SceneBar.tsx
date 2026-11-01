import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type * as Y from 'yjs';
import { closureIfLoaded, loadClosure, type Closure, type SceneEntry } from '../closure/index';
import { editorText } from '../editor/insert';
import { useLocale } from '../i18n/LocaleProvider';
import { Icon } from '../shell/Icon';
import { useToast } from '../shell/Toasts';
import { imageById, pictureSrc, sectionKey, sectionMapById, setSectionKeys } from './pictures';
import { maybeOnBreak, sceneBreakAt, sceneCaret, scenesWithout, type SceneAt } from './scene';
import { SceneDialog } from './SceneDialog';

/* BEUK:sceneimages — 1.0's scene bar (#sceneBar, updateSceneBar): while the
   cursor stands on a scene break in the editor, it names the break ("Scene
   break 2 of 3"), shows its picture if it has one, and offers Add / Replace
   / Remove; Add and Replace open the scene picker (SceneDialog). The break
   is 1.0's sceneBreakAtCursor (scene.ts sceneBreakAt) on the section's text
   and caret; the whole text is read only when the caret could stand on a
   break (scene.ts maybeOnBreak), so typing in a paragraph costs nothing. */

type Props = { editor: Editor | null; ydoc: Y.Doc; sectionId: unknown; sectionType: () => unknown };

export function SceneBar({ editor, ydoc, sectionId, sectionType }: Props) {
  const { t } = useLocale();
  const toast = useToast();
  const [c, setC] = useState<Closure | null>(closureIfLoaded());
  const [info, setInfo] = useState<SceneAt | null>(null);
  const [, bump] = useState(0);
  const [picker, setPicker] = useState<number | null>(null);
  const infoRef = useRef(info);
  infoRef.current = info;

  useEffect(() => {
    if (!c) void loadClosure().then(setC);
  }, [c]);

  const read = useCallback((): SceneAt | null => {
    const ed = editor && !editor.isDestroyed ? editor : null;
    if (!c || !ed) return null;
    if (c.api.AUTO_TYPES.includes(String(sectionType() ?? ''))) return null;
    if (!maybeOnBreak(ed, c.api.SCENE_BREAK_BLOCK_RE)) return null;
    const cur = editorText(ed);
    return sceneBreakAt(c.api, cur.text, sceneCaret(ed, cur));
  }, [c, editor, sectionType]);

  useEffect(() => {
    if (!editor || !c) return;
    const on = () => {
      const next = read();
      const was = infoRef.current;
      if (!next !== !was || (next && was && (next.at !== was.at || next.total !== was.total))) setInfo(next);
    };
    on();
    // read after the change has settled: a toolbar edit records 1.0's own caret (insert.ts) right after its dispatch
    const later = () => void Promise.resolve().then(on);
    editor.on('selectionUpdate', later);
    editor.on('update', later);
    // the break's picture can change from elsewhere (the picker, the library, another tab): redraw while the bar is up
    const onDoc = () => {
      if (infoRef.current) bump((n) => n + 1);
    };
    ydoc.on('update', onDoc);
    return () => {
      editor.off('selectionUpdate', later);
      editor.off('update', later);
      ydoc.off('update', onDoc);
    };
  }, [editor, c, read, ydoc]);

  const section = (): Record<string, unknown> => {
    const m = sectionMapById(ydoc, sectionId);
    return { id: sectionId, scenes: sectionKey(m, 'scenes'), title: sectionKey(m, 'title') };
  };
  const s = info ? section() : null;
  const entry: SceneEntry | null = c && s && info ? c.api.sceneEntryAt(s, info.at) : null;
  const im = entry ? imageById(ydoc, entry.imageId) : null;
  const thumb = im ? pictureSrc(im) : null;

  const remove = () => {
    // 1.0's removeSceneAtCursor: the break at the cursor, read again now
    const now = read();
    if (!c || !now) return;
    const list = scenesWithout(c.api, section(), now.at);
    if (!list) return;
    setSectionKeys(ydoc, sectionId, { scenes: list });
    toast(t('scene.removed'), 'Trash2');
  };

  return (
    <>
      <div id="sceneBar" className={info ? 'open' : undefined}>
        <span className="scene-ic">
          <Icon name="Sparkle" />
        </span>
        <img id="sceneBarThumb" alt="" src={thumb ?? undefined} style={thumb ? undefined : { display: 'none' }} />
        <span id="sceneBarLabel">
          {info ? (
            <>
              <b>{t('scene.barLabel', { n: info.at + 1, total: info.total })}</b>
              {im ? ' · ' + im.name : entry ? ' · ' + t('scene.missing') : ''}
            </>
          ) : null}
        </span>
        <button
          className="tb-btn"
          id="btnSceneAdd"
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const now = read();
            if (now) setPicker(now.at);
          }}
        >
          <Icon name="ImagePlus" />
          <span id="sceneAddLabel">{entry ? t('scene.replace') : t('scene.add')}</span>
        </button>
        <button className="tb-btn" id="btnSceneRemove" type="button" style={entry ? undefined : { display: 'none' }} onMouseDown={(e) => e.preventDefault()} onClick={remove}>
          <Icon name="Trash2" />
          <span>{t('scene.remove')}</span>
        </button>
      </div>
      {picker !== null && c && (
        <SceneDialog
          c={c}
          ydoc={ydoc}
          sectionId={sectionId}
          at={picker}
          onClose={() => {
            setPicker(null);
            editor?.view.focus();
          }}
        />
      )}
    </>
  );
}
