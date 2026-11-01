import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type * as Y from 'yjs';
import { closureIfLoaded, loadClosure, type Closure, type ImageToken } from '../closure/index';
import { applyTextEdit, editorText, textArea } from '../editor/insert';
import { useLocale } from '../i18n/LocaleProvider';
import { Icon } from '../shell/Icon';
import { useToast } from '../shell/Toasts';
import { imageById, pictureSrc } from './pictures';
import { keepCaret, removeToken, TOKEN_REMOVED, updateToken } from './scene';

/* BEUK:images — 1.0's "Images in this section" card (#sectionImages,
   renderSectionImages) below the editor: one row per picture marker in the
   section's text (1.0's imageTokensIn), with its thumbnail, its alt text and
   caption (kept on the field's change, as 1.0's "change" listener does),
   Standard / Full-bleed, and Remove (the marker line leaves the text; the
   picture stays in the library). Each edit is 1.0's rewriteImageToken /
   updateImageToken / removeImageToken on the section's text (scene.ts),
   written into the editor as one transaction with the caret kept (1.0
   writes "through the view guard"). The card's words are 1.0's own English
   literals (1.0 has keys only for the caption's placeholder). The markers
   are re-read 200 ms after the text changes, never per keystroke. */

const SEC_MS = 200;

export function SectionImages({ editor, ydoc, sectionType }: { editor: Editor | null; ydoc: Y.Doc; sectionType: () => unknown }) {
  const { t } = useLocale();
  const toast = useToast();
  const [c, setC] = useState<Closure | null>(closureIfLoaded());
  const [toks, setToks] = useState<ImageToken[]>([]);
  const [, bump] = useState(0);
  const sig = useRef('');

  useEffect(() => {
    if (!c) void loadClosure().then(setC);
  }, [c]);

  useEffect(() => {
    if (!editor || !c) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = () => {
      timer = null;
      if (editor.isDestroyed) return;
      const auto = c.api.AUTO_TYPES.includes(String(sectionType() ?? ''));
      const next = auto ? [] : c.api.imageTokensIn(editorText(editor).text);
      const s = JSON.stringify(next);
      if (s !== sig.current) {
        sig.current = s;
        setToks(next);
      }
    };
    read();
    const later = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(read, SEC_MS);
    };
    editor.on('update', later);
    // a thumbnail or a name changes with the library (an upload, a removal, an Undo)
    const onDoc = () => bump((n) => n + 1);
    const meta = ydoc.getMap<unknown>('meta');
    const onMeta = (e: Y.YMapEvent<unknown>) => {
      if (e.keysChanged.has('images')) onDoc();
    };
    meta.observe(onMeta);
    return () => {
      editor.off('update', later);
      meta.unobserve(onMeta);
      if (timer) clearTimeout(timer);
    };
  }, [editor, c, sectionType, ydoc]);

  if (!c || !toks.length) return <div id="sectionImages" style={{ display: 'none' }} />;

  const edit = (fn: (text: string) => string) => {
    const ed = editor && !editor.isDestroyed ? editor : null;
    if (!ed) return;
    const cur = editorText(ed);
    const ta = textArea(cur.text, cur.start, cur.end); // 1.0's textarea value: no "\r"
    const text = fn(ta.value);
    if (text !== ta.value) applyTextEdit(ed, keepCaret({ text: ta.value, start: ta.selectionStart, end: ta.selectionEnd }, text));
    sig.current = '';
    setToks(c.api.imageTokensIn(text));
  };
  const capPh = t('img.captionCardPh');

  return (
    <div id="sectionImages">
      <div className="sec-imgs">
        <h4>
          <Icon name="Images" />
          Images in this section
        </h4>
        {toks.map((tk, i) => {
          const im = imageById(ydoc, tk.id);
          const src = im ? pictureSrc(im) : null;
          return (
            <div className="sec-img-row" key={i + ':' + JSON.stringify(tk)}>
              {src ? <img src={src} alt="" /> : <span className="si-missing">missing</span>}
              <div className="si-main">
                <ChangeInput className="txt-input si-alt" data={{ 'data-tokalt': i }} value={tk.alt} placeholder="Alt text for this image" label="Alt text" onCommit={(v) => edit((x) => updateToken(c.api, x, i, { alt: c.api.cleanAlt(v) }))} />
                <ChangeInput className="txt-input si-alt si-cap" data={{ 'data-tokcap': i }} value={tk.caption || ''} placeholder={capPh} label={capPh} maxLength={300} onCommit={(v) => edit((x) => updateToken(c.api, x, i, { caption: c.api.cleanCaption(v) }))} />
                <div className="si-name">{im ? im.name + ' · ' + c.api.fmtBytes(Math.round(im.data.length * 3 / 4)) : 'Not in the image library'}</div>
              </div>
              <button
                type="button"
                className={'si-btn' + (tk.full ? ' on' : '')}
                data-tokdisp={i}
                title="Toggle full-bleed display"
                onClick={() => edit((x) => {
                  const now = c.api.imageTokensIn(x)[i];
                  return now ? updateToken(c.api, x, i, { full: !now.full }) : x;
                })}
              >
                <Icon name={tk.full ? 'Expand' : 'Shrink'} />
                {tk.full ? 'Full-bleed' : 'Standard'}
              </button>
              <button
                type="button"
                className="si-btn"
                data-tokdel={i}
                title="Remove image from this section"
                onClick={() => {
                  edit((x) => removeToken(c.api, x, i));
                  toast(TOKEN_REMOVED, 'Trash2');
                }}
              >
                <Icon name="Trash2" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A text field kept on its native "change" (on commit, as 1.0 listens), not on every keystroke. */
function ChangeInput({ className, data, value, placeholder, label, maxLength, onCommit }: {
  className: string;
  data: Record<string, number>;
  value: string;
  placeholder: string;
  label: string;
  maxLength?: number;
  onCommit: (v: string) => void;
}) {
  const el = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  useEffect(() => {
    const i = el.current;
    if (!i) return;
    i.onchange = () => commit.current(i.value);
    return () => {
      i.onchange = null;
    };
  }, []);
  return <input ref={el} className={className} {...data} type="text" defaultValue={value} placeholder={placeholder} aria-label={label} maxLength={maxLength} />;
}
