import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { observeSections } from '@book/editor/index.js';
import { closureIfLoaded, loadClosure, type BookImage, type Closure } from '../closure/index';
import { useLocale } from '../i18n/LocaleProvider';
import { useToast } from '../shell/Toasts';
import { addPicture, imageById, PICTURE_ACCEPT, PICTURE_ADDED, PICTURE_TYPE_REFUSED, pickerList, readPictureFile, sectionKey, sectionMapById, setSectionKeys } from './pictures';

/* BEUK:images — 1.0's chapter-art rows (#editorMeta #bodyArtRows: the
   opening plate, its alt text, the backdrop and its strength;
   renderPlateControls / renderBackdropControls and their change handlers in
   initEditor). Shown for a body section that is not a Part (1.0's
   syncEditor). The pickers list 1.0's pickerImages, then "upload", which
   joins the library and becomes this chapter's plate or backdrop in one
   step (one transaction, History repacked). The rest of 1.0's #editorMeta
   (chapter number, title, subtitle, running head, drop cap, small caps) is
   not part of this wave: those rows are left out, not drawn disabled.

   Every write is a section key, as 1.0 sets it on the section: plateId (null
   for "No plate"), plateAlt (offered from the picture's name when empty,
   kept per keystroke as 1.0's "input" listener does), backdropId,
   backdropStrength ("whisper" when it is none of 1.0's four). */

const UPLOAD = '__upload__';

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
      if (e.keysChanged.has('images')) on();
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
  const kind = get('kind');
  const type = get('type');
  if (!c || kind !== 'body' || type === 'part') return null;
  const id = get('id');
  const list = pickerList(c, ydoc);
  const plateId = (get('plateId') as string | null | undefined) || '';
  const backdropId = (get('backdropId') as string | null | undefined) || '';
  const strength = get('backdropStrength');
  const strengths = c.api.BACKDROP_STRENGTHS;

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
    if (v && !String(get('plateAlt') || '').trim()) {
      const im = imageById(ydoc, v);
      if (im) patch.plateAlt = nameOf(im);
    }
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
        const patch: Record<string, unknown> = { plateId: im.id };
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
    <div id="editorMeta">
      <div id="bodyArtRows" style={{ marginTop: 6 }}>
        <div className="switch-row">
          <div className="sw-txt">
            <b>{t('editor.plate')}</b>
            <span>{t('editor.plateDesc')}</span>
          </div>
          <select className="txt-input" id="chPlate" style={{ width: 200, flex: '0 1 200px' }} aria-label={t('editor.plate')} value={plateId} onChange={(e) => onPlate(e.target.value)}>
            {options(t('editor.plateNone'), t('editor.plateUpload'))}
          </select>
        </div>
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
          <select className="txt-input" id="chBackdrop" style={{ width: 200, flex: '0 1 200px' }} aria-label={t('editor.backdrop')} value={backdropId} onChange={(e) => onBackdrop(e.target.value)}>
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
            onChange={(e) => setSectionKeys(ydoc, id, { backdropStrength: e.target.value })}
          >
            <option value="whisper">{t('editor.bdWhisper')}</option>
            <option value="soft">{t('editor.bdSoft')}</option>
            <option value="strong">{t('editor.bdStrong')}</option>
            <option value="spread">{t('editor.bdSpread')}</option>
          </select>
        </div>
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
    </div>
  );
}
