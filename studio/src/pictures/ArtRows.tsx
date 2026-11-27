import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { observeSections } from '@book/editor/index.js';
import { closureIfLoaded, loadClosure, type BookImage, type Closure } from '../closure/index';
import { bookMeta } from '../book/store';
import { useLocale } from '../i18n/LocaleProvider';
import { useToast } from '../shell/Toasts';
import { addPicture, backdropSetAside, imageById, PICTURE_ACCEPT, PICTURE_ADDED, PICTURE_TYPE_REFUSED, pickerList, plateFitFor, readPictureFile, sectionKey, sectionMapById, setSectionKeys } from './pictures';

/* BEUK:images — 1.0's chapter-art rows (#bodyArtRows after the drop cap and
   small-caps rows: the opening plate, its alt text, the backdrop and its
   strength; renderPlateControls / renderBackdropControls and their change
   handlers in initEditor). The rest of 1.0's #editorMeta (chapter number,
   title, subtitle, running head, drop cap, small caps) and the rule of which
   section shows which rows (1.0's syncEditor: #editorMeta for a body section,
   #bodyArtRows not for a Part) are src/editor/EditorMeta.tsx, which places
   these rows inside its #bodyArtRows. The pickers list 1.0's pickerImages,
   then "upload", which joins the library and becomes this chapter's plate or
   backdrop in one step (one transaction, History repacked).

   Every write is a section key, as 1.0 sets it on the section: plateId (null
   for "No plate"), plateAlt (offered from the picture's name when empty,
   kept per keystroke as 1.0's "input" listener does), plateFit (BEUK:platefit:
   "fill", "whole" or "across"; written with every newly chosen picture by 1.0's own
   rule, plateFitFor, and by the Fit row, which shows only while a plate is
   set; a section without the key reads as "fill"), backdropId,
   backdropStrength ("whisper" when it is none of 1.0's four). */

/** 1.0's PRINT_BLEED_IN: the bleed on the top, bottom and outer edge when the book prints with it. */
const PRINT_BLEED_IN = 0.125;
const UPLOAD = '__upload__';

/** Pixels per inch the plate gives across both pages, as the press counts it (1.0's acrossCrop over the book's own trim,
 *  the bleed actually in effect — printBleedOn, 0.125 in — and its direction), when that is under 200; null when it is
 *  not, or when the picture's size cannot be read (no note, never a throw). Nothing here blocks. */
function acrossPpi(c: Closure, ydoc: Y.Doc, plateId: string): number | null {
  try {
    const im = imageById(ydoc, plateId);
    const px = im ? c.api.imagePixelSize(im) : null;
    if (!px || !(px.w > 0) || !(px.h > 0)) return null;
    const meta = ydoc.getMap<unknown>('meta');
    const trimId = meta.get('printTrim');
    const tr = c.api.trimSize(typeof trimId === 'string' && trimId ? trimId : String(c.api.bookPrintDefaults().printTrim));
    const bleed = meta.get('printBleed') === true ? PRINT_BLEED_IN : 0;
    const lang = bookMeta(ydoc).language;
    const ppi = c.api.acrossCrop(px.w, px.h, { w: tr.w, h: tr.h }, bleed, c.api.isRtlLang(typeof lang === 'string' && lang ? lang : 'en')).ppi;
    return ppi < 200 ? Math.round(ppi) : null;
  } catch {
    return null;
  }
}

export function ArtRows({ ydoc, section }: { ydoc: Y.Doc; section: Y.Map<unknown> }) {
  const { t } = useLocale();
  const toast = useToast();
  const [c, setC] = useState<Closure | null>(closureIfLoaded());
  const [, bump] = useState(0);
  const plateFile = useRef<HTMLInputElement>(null);
  const bdFile = useRef<HTMLInputElement>(null);
  const uploadFor = useRef<{ plate: unknown; bd: unknown }>({ plate: null, bd: null });

  useEffect(() => {
    if (!c) void loadClosure().then(setC);
  }, [c]);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    section.observe(on);
    const meta = ydoc.getMap<unknown>('meta');
    const onMeta = (e: Y.YMapEvent<unknown>) => {
      // the images, and what the soft-print note reads of the book: its trim, its bleed, its language (in 'meta')
      if (['images', 'printTrim', 'printBleed', 'meta'].some((k) => e.keysChanged.has(k))) on();
    };
    meta.observe(onMeta);
    // another section's plate, backdrop or scenes is in the pickers' list too
    // (only the list itself and the sections' own keys: a keystroke in a chapter's text redraws nothing here)
    const off = observeSections(ydoc, on);
    return () => {
      section.unobserve(on);
      meta.unobserve(onMeta);
      off();
    };
  }, [section, ydoc]);

  const get = (k: string) => sectionKey(section, k);
  if (!c) return null; // which sections show these rows is EditorMeta's (1.0's syncEditor)
  const id = get('id');
  const list = pickerList(c, ydoc);
  const plateId = (get('plateId') as string | null | undefined) || '';
  const backdropId = (get('backdropId') as string | null | undefined) || '';
  const strength = get('backdropStrength');
  const strengths = c.api.BACKDROP_STRENGTHS;
  const fitNow = c.api.plateFitOf({ plateFit: get('plateFit') });
  // Across both pages: the chapter's backdrop is set aside while it is chosen (disabled, never written: Fit away and it is back as it was),
  // by the output's own rule (acrossSetsBackdropAside): only while the plate is drawn — its picture in the library and
  // its alt text given — so the rows and the note never say "set aside" while the backdrop is in fact drawn
  const across = backdropSetAside(c, ydoc, section);
  const softPpi = across ? acrossPpi(c, ydoc, plateId) : null;

  const options = (none: string, upload: string) => (
    <>
    <option value="">{none}</option>
    {list.map((im, i) => (
      <option value={im.id} key={im.id + ':' + i}>
        {im.name || im.id}
      </option>
    ))}
    <option value={UPLOAD}>{upload}</option>
  </>
);

const nameOf = (pic: { name?: unknown } | null) => String((pic && pic.name) || '').replace(/\.[^.]+$/, '').replace(/[-_—]+/g, ' ').trim();

const onPlate = (v: string) => {
  if (v === UPLOAD) {
    uploadFor.current.plate = id;
    bump((n) => n + 1); // the select shows the chapter's own choice again (1.0's renderPlateControls)
    plateFile.current?.click();
    return;
  }
  const patch: Record<string, unknown> = { plateId: v || null };
  const im = v ? imageById(ydoc, v) : null;
  if (im && !String(get('plateAlt') || '').trim()) patch.plateAlt = nameOf(im);
  // BEUK:platefit — a newly chosen picture gets its fit chosen with it (1.0's chPlate handler): never cut unasked, and
  // never across for a chapter with a backdrop stored (it would set the backdrop aside unasked)
  if (v) patch.plateFit = plateFitFor(c, ydoc, im ?? ({ id: v } as BookImage), section);
  setSectionKeys(ydoc, id, patch);
};
const onBackdrop = (v: string) => {
  if (v === UPLOAD) {
    uploadFor.current.bd = id;
    bump((n) => n + 1);
    bdFile.current?.click();
    return;
  }
  const patch: Record<string, unknown> = { backdropId: v || null };
  if (v && !strengths.includes(strength as string)) patch.backdropStrength = 'whisper';
  setSectionKeys(ydoc, id, patch);
};

const onFile = async (which: 'plate' | 'bd', f: File | undefined) => {
  const forId = uploadFor.current[which];
  uploadFor.current[which] = null;
  if (!f) return;
  const up = await readPictureFile(f);
  if (!up.ok) {
    toast(up.why === 'type' ? PICTURE_TYPE_REFUSED : t('toast.coverReadFail'), 'TriangleAlert');
    return;
  }
  const im = { id: c.api.uid(), ...up.im } as BookImage;
  addPicture(c, ydoc, im, () => {
    const target = (forId == null ? null : sectionMapById(ydoc, forId)) ?? section;
    const tid = sectionKey(target, 'id');
    if (which === 'plate') {
      const patch: Record<string, unknown> = { plateId: im.id, plateFit: plateFitFor(c, ydoc, im, target) };
      if (!String(sectionKey(target, 'plateAlt') || '').trim()) patch.plateAlt = nameOf(im);
      setSectionKeys(ydoc, tid, patch);
    } else {
      const patch: Record<string, unknown> = { backdropId: im.id };
      if (!strengths.includes(sectionKey(target, 'backdropStrength') as string)) patch.backdropStrength = 'whisper';
      setSectionKeys(ydoc, tid, patch);
    }
  });
  toast(PICTURE_ADDED, 'Image');
};

return (
  <>
      <div className="switch-row">
        <div className="sw-txt">
          <b>{t('editor.plate')}</b>
          <span>{t('editor.plateDesc')}</span>
        </div>
        <select className="txt-input" id="chPlate" style={{ width: 200, flex: '0 1 200px' }} aria-label={t('editor.plate')} value={plateId} onChange={(e) => onPlate(e.target.value)}>
          {options(t('editor.plateNone'), t('editor.plateUpload'))}
        </select>
      </div>
      <div className="switch-row" id="plateFitRow" style={plateId ? undefined : { display: 'none' }}>
        <div className="sw-txt">
          <b>{t('editor.plateFit')}</b>
          <span>{t('editor.plateFitDesc')}</span>
        </div>
        <select
          className="txt-input"
          id="chPlateFit"
          style={{ width: 200, flex: '0 1 200px' }}
          aria-label={t('editor.plateFit')}
          value={fitNow}
          onChange={(e) => setSectionKeys(ydoc, id, { plateFit: c.api.plateFitOf({ plateFit: e.target.value }) })}
        >
          <option value="fill">{t('editor.plateFitFill')}</option>
          <option value="whole">{t('editor.plateFitWhole')}</option>
          <option value="across">{t('editor.plateFitAcross')}</option>
        </select>
      </div>
      {across && (
        <div id="plateAcrossLines" className="sw-txt" style={{ padding: '0 0 8px' }}>
          <span id="plateAcrossNote" style={{ display: 'block' }}>{t('editor.plateAcrossNote')}</span>
          {softPpi != null && <span id="plateAcrossSoft" style={{ display: 'block' }}>{t('editor.plateAcrossSoft', { ppi: softPpi })}</span>}
        </div>
      )}
      <div className="switch-row" id="plateAltRow" style={plateId ? undefined : { display: 'none' }}>
        <div className="sw-txt">
          <b>{t('editor.plateAlt')}</b>
          <span>{t('editor.plateAltDesc')}</span>
        </div>
        <input
          className="txt-input"
          id="chPlateAlt"
          type="text"
          style={{ width: 200, flex: '0 1 200px' }}
          placeholder={t('editor.plateAltPh')}
          value={String(get('plateAlt') ?? '')}
          onChange={(e) => setSectionKeys(ydoc, id, { plateAlt: e.target.value })}
        />
      </div>
      <div className="switch-row">
        <div className="sw-txt">
          <b>{t('editor.backdrop')}</b>
          <span>{t('editor.backdropDesc')}</span>
        </div>
        <select className="txt-input" id="chBackdrop" style={{ width: 200, flex: '0 1 200px' }} aria-label={t('editor.backdrop')} value={backdropId} disabled={across} onChange={(e) => onBackdrop(e.target.value)}>
          {options(t('editor.backdropNone'), t('editor.backdropUpload'))}
        </select>
      </div>
      <div className="switch-row" id="backdropStrengthRow" style={backdropId ? undefined : { display: 'none' }}>
        <div className="sw-txt">
          <b>{t('editor.backdropStrength')}</b>
          <span>{t('editor.backdropNote')}</span>
        </div>
        <select
          className="txt-input"
          id="chBackdropStrength"
          style={{ width: 200, flex: '0 1 200px' }}
          aria-label={t('editor.backdropStrength')}
          value={strengths.includes(strength as string) ? (strength as string) : 'whisper'}
          disabled={across}
          onChange={(e) => setSectionKeys(ydoc, id, { backdropStrength: e.target.value })}
        >
          <option value="whisper">{t('editor.bdWhisper')}</option>
          <option value="soft">{t('editor.bdSoft')}</option>
          <option value="strong">{t('editor.bdStrong')}</option>
          <option value="spread">{t('editor.bdSpread')}</option>
        </select>
      </div>
      <input type="file" id="plateFileInput" ref={plateFile} accept={PICTURE_ACCEPT} style={{ display: 'none' }} onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        void onFile('plate', f);
      }} />
      <input type="file" id="bdFileInput" ref={bdFile} accept={PICTURE_ACCEPT} style={{ display: 'none' }} onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        void onFile('bd', f);
      }} />
    </>
  );
}
