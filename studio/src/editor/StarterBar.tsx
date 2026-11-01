import { Fragment, useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { exportBook, META } from '@book/editor/index.js';
import { closureIfLoaded, loadClosure, stateFromBook, type Closure } from '../closure/index';
import { useLocale } from '../i18n/LocaleProvider';
import { Icon } from '../shell/Icon';
import { applyTextEdit, editorText } from './insert';

/* BEUK:starters — back-matter starters and empty pages left out of the
   book (inventory B4; client/index.html renderStarterBar, starterUse,
   starterSelectBlank). Markup, classes and keys are 1.0's:
   - #starterBar.starter-bar (aria-live polite), hidden on a body section
     and on a written page with no [[blank]] left;
   - an empty page (1.0's emptyOut): p.starter-out "starter.emptyOut", and
     when 1.0 offers starters for its type (starterIds) the head
     (starter.heading / starter.hint) and a button per starter
     (data-starter, aria-pressed, starter.k.<id>); a picked one shows
     #starterPreview in the BOOK's language and direction (bookLang), each
     [[blank]] marked, with #starterUse and #starterCancel. Nothing reaches
     the page until Use;
   - a written page with blanks: p.starter-blanks "starter.blanks" and
     #starterNext, which selects the next blank (1.0's starterSelectBlank).
   ONE SOURCE (constraint 17): the texts are 1.0's STARTER_TEXT through
   starterText (the book's author, title, series place and typefaces filled
   in; what only the writer knows a [[blank]]), the offer is starterIds, the
   blanks starterBlanks / STARTER_BLANK_RE, the empty rule emptyOut.
   Use reads the page at the click (still empty, still this section, as
   1.0's starterUse) and writes the starter as one editor transaction (one
   undo step), then selects the first blank. */

type Rec = Record<string, unknown>;
type Pending = { secId: string; id: string } | null;

/** The open section as 1.0's emptyOut / starterIds read it (normalizeSection's defaults for kind and type). */
function sectionNow(map: Y.Map<unknown>, text: string): Rec {
  return {
    id: map.get('id'), kind: map.get('kind') || 'body', type: map.get('type') || 'chapter', content: text,
    plateId: typeof map.get('plateId') === 'string' ? map.get('plateId') : null, backdropId: typeof map.get('backdropId') === 'string' ? map.get('backdropId') : null,
  };
}

/** A light 1.0 state for the offer (starterIds reads only state.meta.series). */
function metaState(c: Closure, ydoc: Y.Doc): void {
  const meta = ydoc.getMap<unknown>(META).get('meta');
  c.setState({ meta: meta && typeof meta === 'object' ? (meta as Rec) : {}, sections: [] });
}

/** 1.0's starterSelectBlank: the first blank at or after the selection's end, else the first. */
function selectBlank(c: Closure, editor: Editor): void {
  const cur = editorText(editor);
  const re = new RegExp(c.api.STARTER_BLANK_RE.source, 'g');
  let m: RegExpExecArray | null, first: RegExpExecArray | null = null, after: RegExpExecArray | null = null;
  while ((m = re.exec(cur.text))) {
    if (!first) first = m;
    if (!after && m.index >= (cur.end || 0)) after = m;
  }
  const hit = after || first;
  if (!hit) return;
  editor.commands.focus();
  applyTextEdit(editor, { text: cur.text, start: hit.index, end: hit.index + hit[0].length });
}

export function StarterBar({ editor, ydoc, section }: { editor: Editor | null; ydoc: Y.Doc; section: Y.Map<unknown> }) {
  const { t } = useLocale();
  const [c, setC] = useState<Closure | null>(() => closureIfLoaded());
  const [text, setText] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const isBody = (section.get('kind') || 'body') === 'body';
  // what 1.0's starterIds offers and the picked starter's text: they read 1.0's state (the series, the author, the
  // typefaces, the book's language), so they are computed here, after render, never while rendering
  const [offer, setOffer] = useState<{ key: string; idsKey: string; ids: string[]; preview: { lang: string; dir: 'ltr' | 'rtl'; text: string } | null }>({ key: '', idsKey: '', ids: [], preview: null });
  const [metaRev, setMetaRev] = useState(0);
  useEffect(() => {
    const m = ydoc.getMap<unknown>(META);
    const on = () => setMetaRev((n) => n + 1);
    m.observe(on);
    return () => m.unobserve(on);
  }, [ydoc]);

  useEffect(() => {
    if (!c) void loadClosure().then(setC).catch(() => undefined);
  }, [c]);
  // the page's text, re-read after each change (only off the body: a chapter never shows the strip)
  useEffect(() => {
    if (!editor || isBody) return;
    let raf = 0;
    const read = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setText(editorText(editor).text));
    };
    setText(editorText(editor).text);
    editor.on('update', read);
    return () => {
      cancelAnimationFrame(raf);
      editor.off('update', read);
    };
  }, [editor, isBody]);

  const empty = !!c && text !== null && !isBody && c.api.emptyOut(sectionNow(section, text));
  // the offer depends on the page and the book's meta; the preview on those and the pick (a pick never hides the offer)
  const idsKey = [String(section.get('id')), String(section.get('type')), empty, metaRev].join('|');
  const offerKey = idsKey + '|' + (pending ? pending.secId + ':' + pending.id : '');
  useEffect(() => {
    if (!c || !empty) {
      setOffer((o) => (o.ids.length || o.preview ? { key: offerKey, idsKey, ids: [], preview: null } : o));
      return;
    }
    metaState(c, ydoc);
    const ids = c.api.starterIds(sectionNow(section, ''));
    let preview: { lang: string; dir: 'ltr' | 'rtl'; text: string } | null = null;
    if (pending && pending.secId === section.get('id') && ids.includes(pending.id)) {
      c.setState(stateFromBook(c, exportBook(ydoc)));
      const lang = c.api.bookLang();
      preview = { lang, dir: c.api.isRtlLang(lang) ? 'rtl' : 'ltr', text: c.api.starterText(pending.id, lang) };
    }
    setOffer({ key: offerKey, idsKey, ids, preview });
    // offerKey holds every input
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, ydoc, offerKey]);

  const hidden = <div id="starterBar" className="starter-bar" style={{ display: 'none' }} aria-live="polite" />;
  if (!c || !editor || isBody || text === null) return hidden;
  const s = sectionNow(section, text);
  const blanks = empty ? [] : c.api.starterBlanks(s.content);
  const ids = empty && offer.idsKey === idsKey ? offer.ids : [];
  if (!empty && !blanks.length) return hidden;
  // 1.0: a pick for another section, or one no longer offered, is forgotten
  const pick = pending && pending.secId === s.id && ids.includes(pending.id) ? pending : null;

  const use = () => {
    // 1.0's starterUse, at the click: still this section, still empty
    const now = sectionNow(section, editorText(editor).text);
    if (!pick || pick.secId !== now.id || !c.api.emptyOut(now)) return;
    c.setState(stateFromBook(c, exportBook(ydoc)));
    const content = c.api.starterText(pick.id, c.api.bookLang());
    setPending(null);
    applyTextEdit(editor, { text: content, start: content.length, end: content.length });
    selectBlank(c, editor);
  };

  const preview = pick && offer.key === offerKey ? offer.preview : null;
  const marked = (line: string) =>
    line.split(/(\[\[[^[\]\n]{1,120}\]\])/).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>));

  return (
    <div id="starterBar" className="starter-bar" aria-live="polite">
      {empty ? (
        <>
          <p className="starter-out">
            <Icon name="EyeOff" />
            <span>{t('starter.emptyOut')}</span>
          </p>
          {ids.length > 0 && (
            <>
              <div className="starter-head">
                <b>{t('starter.heading')}</b> <span>{t('starter.hint')}</span>
              </div>
              <div className="gen-actions" role="group" aria-label={t('starter.heading')}>
                {ids.map((id) => (
                  <button
                    type="button"
                    className="tb-btn"
                    key={id}
                    data-starter={id}
                    aria-pressed={pick?.id === id ? 'true' : 'false'}
                    onClick={() => setPending(pick?.id === id ? null : { secId: String(s.id), id })}
                  >
                    {t(('starter.k.' + id) as never)}
                  </button>
                ))}
              </div>
              {preview && (
                <>
                  <div className="starter-preview" id="starterPreview" lang={preview.lang} dir={preview.dir}>
                    {preview.text.split('\n').map((line, i) => (
                      <Fragment key={i}>
                        {i > 0 && <br />}
                        {marked(line)}
                      </Fragment>
                    ))}
                  </div>
                  <div className="gen-actions">
                    <button type="button" className="tb-btn" id="starterUse" onClick={use}>
                      <Icon name="Check" />
                      {t('starter.use')}
                    </button>
                    <button type="button" className="gen-quiet" id="starterCancel" onClick={() => setPending(null)}>
                      {t('starter.cancel')}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </>
      ) : (
        <p className="starter-blanks">
          <Icon name="PencilLine" />
          <span>{t('starter.blanks', { n: blanks.length, list: blanks.join(', ') })}</span>{' '}
          <button type="button" className="gen-quiet" id="starterNext" onClick={() => selectBlank(c, editor)}>
            {t('starter.next')}
          </button>
        </p>
      )}
    </div>
  );
}
