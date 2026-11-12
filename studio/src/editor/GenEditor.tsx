import { useEffect, useRef, useState, type ReactNode } from 'react';
import type * as Y from 'yjs';
import { escKey, getMetaValue, observeSections } from '@book/editor/index.js';
import { closureIfLoaded, loadClosure, type Closure } from '../closure/index';
import { getMeta, sectionsPlain, setMeta } from '../book/hooks';
import { useLocale } from '../i18n/LocaleProvider';
import { Icon } from '../shell/Icon';
import { useToast } from '../shell/Toasts';
import { toastIcon } from '../style/StyleTab';
import { pictureSrc, sectionKey } from '../pictures/pictures';
import { coverClear, coverReady, coverUpload } from '../cover/cover';
import { COVER_BUILT_EVENT, coverMakerBuilt, coverOpen } from '../cover/CoverMaker';

/* 1.0's generated-page editor, #genEditor (client/index.html: the empty <div> between #starterBar and #editorArea,
   filled by renderGenEditor for the AUTO_TYPES: the cover, the half title, the title page, the copyright page and
   the contents). Same ids, classes, string keys and order as renderGenEditor's markup (genFieldHtml's
   <div [class="wide"]><label class="field-lab" for>…<input class="txt-input" type="text"> rows inside
   .gen-panel > .meta-grid).

   renderGenEditor is NOT lifted, it is mirrored here: it rebuilds its host's innerHTML and its listeners write 1.0's
   in-memory section object (s.htLine1 = …) and state.meta in place, then lean on 1.0's own redraw loop (genRefresh:
   noteBookEdited, updateStats, refreshExportTree, a renderPreview 220 ms later; syncEditor after the reset). 2.0's
   book is the Y.Doc and React owns the desk: every write below is a new value set in one Y transaction, and the
   sidebar, preview, export and print follow the Y.Doc as they do for every other edit. The values the fields show
   are 1.0's own functions, lifted (halfTitleLine1, halfTitleLine2, tocHeadingOf, rightsModeOf, CC_LICENCES, inBook,
   sectionLabel, normalizeSection, imIsPlaceholderTitle, fmtBytes), run against a state holding the book's meta (the
   closure's state is put back after each read).

   Each handler mirrors one of renderGenEditor's:
   - genHt1 "input": htLine1 = null when the value is the book title itself (the line stays derived: a later retitle
     flows through), else the value; genHt2 "input": htLine2 = the value; genHtReset: htLine1 = null, htLine2 = "".
   - bindGenMeta (the title page's and the copyright page's fields): state.meta[key] = the value as typed (no trim),
     and for title / subtitle / author imSetSource(key, imMetaValue(key) ? "writer" : "") (BEUK:importmeta).
   - genTocHeading "input": tocHeading = null when the value is "Contents", else the value.
   - the cover: genCoverUpload / genCoverMake / genCoverRemove press Project Settings' cover controls in 1.0
     (btnCoverUpload → #coverInput, btnCoverMake, btnCoverRemove). 2.0's Settings row is not on the page while the
     dialog is closed, so the section calls the very handlers that row calls (src/cover/CoverRow.tsx): coverUpload
     (1.0's #coverInput handler) on a file from a JPEG / PNG picker of its own (#coverInput's accept), coverOpen
     (openCoverMaker, disabled until the maker is built, as the row's) and coverClear (clearCover). One upload path,
     one Remove, one maker, one cover state.
   Inputs are controlled; where 1.0's uncontrolled field keeps a typed value that the page derives away (a cleared
   half-title line shows the book title on the page, a blank contents heading reads "Contents"), the field keeps what
   was typed until the reset or another section (1.0's field keeps it until syncEditor redraws). */

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Run one of 1.0's readers against a state holding `meta` (and `sections`); the closure's own state is put back. */
function withState<T>(c: Closure, st: Rec, fn: () => T): T {
  const prev = c.getState();
  c.setState(st as never);
  try {
    return fn();
  } finally {
    c.setState(prev);
  }
}

/** genFieldHtml: a labelled text field (wide: the whole row). */
function Field({ id, label, value, wide, onInput }: { id: string; label: string; value: unknown; wide?: boolean; onInput: (v: string) => void }) {
  return (
    <div className={wide ? 'wide' : ''}>
      <label className="field-lab" htmlFor={id}>
        {label}
      </label>
      <input className="txt-input" id={id} type="text" value={value == null ? '' : String(value)} onChange={(e) => onInput(e.target.value)} />
    </div>
  );
}

export function GenEditor({ ydoc, section }: { ydoc: Y.Doc; section: Y.Map<unknown> }) {
  const { t } = useLocale();
  const toast = useToast();
  const say = (msg: string, icon?: string) => toast(msg, toastIcon(icon));
  const [c, setC] = useState<Closure | null>(() => closureIfLoaded());
  const [, bump] = useState(0);
  const [makeReady, setMakeReady] = useState(coverMakerBuilt);
  /** What a field shows instead of the section's value while the page derives that value away (by field id). */
  const [typed, setTyped] = useState<Record<string, string>>({});
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (c) return;
    let alive = true;
    void loadClosure().then((cc) => alive && setC(cc));
    return () => {
      alive = false;
    };
  }, [c]);
  // the section's own fields, the book's meta and cover, and (for the contents' entries) the sections
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    const meta = ydoc.getMap('meta');
    const onMeta = (e: Y.YMapEvent<unknown>) => {
      if (e.keysChanged.has('meta') || e.keysChanged.has('cover')) on();
    };
    section.observe(on);
    meta.observe(onMeta);
    const offSecs = observeSections(ydoc, on);
    const ready = () => setMakeReady(coverMakerBuilt());
    window.addEventListener(COVER_BUILT_EVENT, ready);
    return () => {
      section.unobserve(on);
      meta.unobserve(onMeta);
      offSecs();
      window.removeEventListener(COVER_BUILT_EVENT, ready);
    };
  }, [ydoc, section]);
  // a different section, or the section changed elsewhere: the fields show the book again
  useEffect(() => setTyped({}), [section]);

  const type = String(section.get(escKey('type')) ?? 'chapter');
  if (!c || !c.api.AUTO_TYPES.includes(type)) return <div id="genEditor" style={{ display: 'none' }} />;

  const m = (isRec(getMeta(ydoc, 'meta')) ? getMeta(ydoc, 'meta') : {}) as Rec;
  const get = (k: string) => sectionKey(section, k);
  const s: Rec = { type, htLine1: get('htLine1'), htLine2: get('htLine2'), tocHeading: get('tocHeading') };
  const read = <T,>(fn: () => T): T => withState(c, { meta: m, sections: [] }, fn);
  const writeSec = (patch: Rec) => {
    ydoc.transact(() => {
      for (const [k, v] of Object.entries(patch)) section.set(escKey(k), v);
    });
  };
  const keepTyped = (id: string, v: string, shownAfter: string) => setTyped((x) => {
    const next = { ...x };
    if (shownAfter !== v) next[id] = v;
    else delete next[id];
    return next;
  });
  const shownOr = (id: string, v: string) => (id in typed ? typed[id]! : v);
  /** bindGenMeta: the book's own value edited in place (Project Settings' very state). */
  const bindMeta = (key: string) => (v: string) => {
    const next: Rec = { ...m, [key]: v };
    if (key === 'title' || key === 'subtitle' || key === 'author') {
      // imSetSource(key, imMetaValue(key) ? "writer" : "")
      const real = String(v || '').trim();
      const has = key === 'title' ? real !== '' && !c.api.imIsPlaceholderTitle(real) : real !== '';
      if (has) next[key + 'Source'] = 'writer';
      else delete next[key + 'Source'];
    }
    setMeta(ydoc, 'meta', next as never);
  };

  let body: ReactNode = null;
  if (type === 'halftitle') {
    const title = String(m.title || '');
    const l1 = read(() => c.api.halfTitleLine1(s));
    const l2 = read(() => c.api.halfTitleLine2(s));
    const overridden = (typeof s.htLine1 === 'string' && s.htLine1 !== '' && s.htLine1 !== title) || l2 !== '';
    body = (
      <div className="gen-panel">
        <div className="meta-grid">
          <Field
            id="genHt1"
            label={t('gen.htLine1')}
            value={shownOr('genHt1', l1)}
            wide
            onInput={(v) => {
              // writing the book title itself is not an override: the line stays derived
              const next = v === title ? null : v;
              writeSec({ htLine1: next });
              keepTyped('genHt1', v, read(() => c.api.halfTitleLine1({ ...s, htLine1: next })));
            }}
          />
          <Field id="genHt2" label={t('gen.htLine2')} value={l2} wide onInput={(v) => writeSec({ htLine2: v })} />
        </div>
        <button
          className="gen-quiet"
          id="genHtReset"
          type="button"
          style={{ display: overridden ? '' : 'none' }}
          onClick={() => {
            writeSec({ htLine1: null, htLine2: '' });
            setTyped({});
          }}
        >
          {t('gen.htUseBookTitle')}
        </button>
      </div>
    );
  } else if (type === 'cover') {
    const cov = getMetaValue(ydoc, 'cover');
    const covRec = isRec(cov) && typeof cov.data === 'string' ? cov : null;
    const src = covRec ? pictureSrc(covRec) : null;
    body = (
      <div className="gen-panel">
        <div className="cover-row">
          <div className="cover-thumb" id="genCoverThumb">
            {covRec ? src ? <img src={src} alt="" /> : null : <span>{t('set.noCover')}</span>}
          </div>
          <div className="cover-actions">
            <div className="gen-actions">
              <button className="tb-btn" id="genCoverUpload" type="button" onClick={() => picker.current?.click()}>
                <Icon name="ImagePlus" />
                {covRec ? t('gen.coverReplace') : t('set.uploadCover')}
              </button>
              <button className="tb-btn" id="genCoverMake" type="button" disabled={!makeReady} onClick={() => coverOpen()}>
                <Icon name="Palette" />
                {t('covermk.make')}
              </button>
              {covRec && (
                <button className="tb-btn" id="genCoverRemove" type="button" onClick={() => coverClear(say)}>
                  <Icon name="Trash2" />
                  {t('set.remove')}
                </button>
              )}
            </div>
            {covRec && (
              <p className="cover-note" style={{ marginTop: 8 }}>
                {String(covRec.name || 'cover') + ' · ' + c.api.fmtBytes(Math.round((covRec.data as string).length * 3 / 4))}
              </p>
            )}
          </div>
        </div>
        {/* 1.0's #coverInput (Project Settings), which genCoverUpload reaches through btnCoverUpload */}
        <input
          ref={picker}
          type="file"
          accept="image/jpeg,image/png,.jpg,.jpeg,.png"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files && e.target.files[0];
            e.target.value = '';
            if (file) {
              coverReady(c);
              void coverUpload(file, say);
            }
          }}
        />
      </div>
    );
  } else if (type === 'titlepage') {
    body = (
      <div className="gen-panel">
        <div className="meta-grid">
          <Field id="genTpTitle" label={t('set.bookTitle')} value={m.title} wide onInput={bindMeta('title')} />
          <Field id="genTpSubtitle" label={t('set.subtitle')} value={m.subtitle} wide onInput={bindMeta('subtitle')} />
          <Field id="genTpAuthor" label={t('set.author')} value={m.author} onInput={bindMeta('author')} />
          <Field id="genTpPublisher" label={t('set.publisher')} value={m.publisher} onInput={bindMeta('publisher')} />
        </div>
      </div>
    );
  } else if (type === 'copyright') {
    const mode = c.api.rightsModeOf(m);
    const licence = c.api.CC_LICENCES[String(m.ccLicence)];
    body = (
      <div className="gen-panel">
        <div className="meta-grid">
          <Field id="genCpAuthor" label={t('set.author')} value={m.author} onInput={bindMeta('author')} />
          <Field id="genCpPublisher" label={t('set.publisher')} value={m.publisher} onInput={bindMeta('publisher')} />
          <Field id="genCpIsbn" label={t('set.isbn')} value={m.isbn} onInput={bindMeta('isbn')} />
          <Field id="genCpYear" label={t('set.year')} value={m.year} onInput={bindMeta('year')} />
          {mode === 'pd' || mode === 'cc' ? (
            /* BEUK:rights — a chosen licence is set in Project Settings, not typed here */
            <div className="wide">
              <p className="cover-note" id="genCpRightsNote" style={{ marginTop: 0 }}>
                {t('rights.inDetails', { choice: mode === 'pd' ? t('rights.pd') : (licence?.short ?? ''), where: t('set.title') })}
              </p>
            </div>
          ) : (
            <Field id="genCpRights" label={t('set.rights')} value={m.rights} wide onInput={bindMeta('rights')} />
          )}
        </div>
      </div>
    );
  } else if (type === 'toc') {
    const items = read(() => {
      const all = sectionsPlain(ydoc).map((x) => c.api.normalizeSection(structuredClone(x)));
      return all
        .filter((x) => c.api.inBook(x) && x.type !== 'toc' && x.type !== 'halftitle' && x.type !== 'cover' && x.type !== 'frontispiece')
        .map((x) => c.api.sectionLabel(x));
    });
    body = (
      <div className="gen-panel">
        <div className="meta-grid">
          <Field
            id="genTocHeading"
            label={t('gen.tocHeading')}
            value={shownOr('genTocHeading', read(() => c.api.tocHeadingOf(s)))}
            wide
            onInput={(v) => {
              const next = v === 'Contents' ? null : v;
              writeSec({ tocHeading: next });
              keepTyped('genTocHeading', v, read(() => c.api.tocHeadingOf({ ...s, tocHeading: next })));
            }}
          />
        </div>
        <div>
          <span className="field-lab">{t('gen.tocEntries')}</span>
          <ol className="gen-toc-list">
            {items.map((label, i) => (
              <li key={i}>{label}</li>
            ))}
          </ol>
        </div>
      </div>
    );
  }
  return <div id="genEditor">{body}</div>;
}
