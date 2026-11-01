import { useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type * as Y from 'yjs';
import type { BookImage } from '../closure/index';
import { applyTextEdit, editorText, runOnText } from '../editor/insert';
import { useLocale } from '../i18n/LocaleProvider';
import { Dialog } from '../shell/Dialog';
import { Icon } from '../shell/Icon';
import { useToast } from '../shell/Toasts';
import { LibraryGrid, LibraryTools, useLibrary, useLibraryActions } from './Library';
import { addPicture, PICTURE_ACCEPT, PICTURE_ADDED, PICTURE_TYPE_REFUSED, readPictureFile } from './pictures';
import { IMG_PICK_FIRST, IMG_PLACED, IMG_PLACED_FULL, imageInsertText, libAltOffer } from './scene';

/* BEUK:images — 1.0's Insert Image dialog (#modalImage, z-index 65): the
   book's library (with the image library's delete controls and cleanup
   row), Upload Image, the alt text, the caption, Standard / Full-bleed, and
   Insert, which places 1.0's marker line at the cursor with 1.0's own
   insertAtCursor (one transaction, one undo step: insert.ts). 1.0's own
   English literals (the sub-line, the empty library, the note, the toasts)
   are kept as 1.0 shows them: 1.0 has no keys for them.

   Like 1.0's module variables, the chosen picture, the alt text and the
   display choice outlive the dialog (per book); the caption belongs to one
   placement and is cleared after Insert, as 1.0 does. */

type Form = { sel: string | null; alt: string; altPh: string | null; caption: string; full: boolean };
const forms = new WeakMap<Y.Doc, Form>();
const formOf = (ydoc: Y.Doc): Form => {
  let f = forms.get(ydoc);
  if (!f) forms.set(ydoc, (f = { sel: null, alt: '', altPh: null, caption: '', full: false }));
  return f;
};

const fmtSize = (c: { fmtBytes: (n: number) => string }, im: BookImage) => c.fmtBytes(Math.round(im.data.length * 3 / 4));

export function ImageDialog({ ydoc, editor, onClose }: { ydoc: Y.Doc; editor: Editor | null; onClose: () => void }) {
  const { t } = useLocale();
  const toast = useToast();
  const lib = useLibrary(ydoc, true);
  const grid = useRef<HTMLDivElement>(null);
  const upload = useRef<HTMLButtonElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const form = formOf(ydoc);
  const [, bump] = useState(0);
  const set = (patch: Partial<Form>) => {
    Object.assign(form, patch);
    bump((n) => n + 1);
  };
  // 1.0's imglibRemove: a removed picture that was the choice leaves no choice (imgSelId = null), Insert disabled
  const actions = useLibraryActions(ydoc, lib, () => grid.current?.querySelector<HTMLElement>('.img-cell') ?? upload.current, (ids) => {
    if (form.sel && ids.includes(form.sel)) set({ sel: null });
  });
  const opened = useRef(false);

  const c = lib.c;
  const view = lib.view;
  const images = view?.images ?? [];
  const byId = (id: string | null) => images.find((im) => im.id === id) ?? null;
  // 1.0's openImageModal, ONCE as the dialog opens (fix round 1): a chosen picture that left the library gives way to
  // the newest one. Never again while it stays open: after a removal the choice stays empty (1.0), and an upload's
  // choice holds until the library re-read shows its picture.
  if (view && !opened.current) {
    opened.current = true;
    if (!byId(form.sel)) form.sel = images.length ? images[images.length - 1]!.id : null;
  }
  const sel = byId(form.sel);

  const pick = (id: string) => {
    const im = byId(id);
    const patch: Partial<Form> = { sel: id };
    if (im && !form.alt) patch.altPh = libAltOffer(im.name); // 1.0's selectLibImage: the name, as the alt's placeholder
    set(patch);
  };

  const onFile = async (f: File | undefined) => {
    if (!f || !c) return;
    const up = await readPictureFile(f);
    if (!up.ok) {
      toast(up.why === 'type' ? PICTURE_TYPE_REFUSED : t('toast.coverReadFail'), 'TriangleAlert');
      return;
    }
    const im = { id: c.api.uid(), ...up.im } as BookImage;
    addPicture(c, ydoc, im);
    set({ sel: im.id, alt: '', altPh: libAltOffer(f.name) });
    lib.refresh();
    toast(PICTURE_ADDED, 'Image');
  };

  const insert = () => {
    if (!c) return;
    const im = sel;
    if (!im) {
      toast(IMG_PICK_FIRST, 'Image');
      return;
    }
    const ed = editor && !editor.isDestroyed ? editor : null;
    if (ed) {
      const text = imageInsertText(c.api, im, { alt: form.alt, caption: form.caption, full: form.full });
      const next = runOnText(editorText(ed), (ta) => c.api.insertAtCursor(ta, text));
      if (next) applyTextEdit(ed, next);
    }
    const full = form.full;
    form.caption = ''; // a caption belongs to one placement
    onClose();
    ed?.view.focus();
    toast(full ? IMG_PLACED_FULL : IMG_PLACED, 'Image');
  };

  return (
    <>
      <Dialog open onClose={onClose} id="modalImage" z={65} labelledBy="imgH">
        <h2 id="imgH">
          <Icon name="ImagePlus" />
          {t('img.title')}
        </h2>
        <p className="m-sub">
          The picture lives in the book's image library; the editor places a one-line marker where it belongs. In the EPUB the image ships in the <span style={{ fontFamily: 'var(--mono-font)' }}>Images</span> folder with a manifest entry and its alt text. JPG or PNG.
        </p>
        <div className="img-lib" id="imgLib" ref={grid}>
          {view && (
            <LibraryGrid
              view={view}
              attr="data-libimg"
              selected={form.sel}
              empty={
                <>
                  No images in this book yet.
                  <br />
                  Upload one and it can be placed in any section.
                </>
              }
              onPick={pick}
              onDelete={actions.requestDelete}
            />
          )}
        </div>
        <div className="fmt-actions" style={{ margin: '10px 0 16px' }}>
          <button type="button" className="tb-btn" id="btnImgUpload" ref={upload} onClick={() => file.current?.click()}>
            <Icon name="Upload" />
            {t('img.upload')}
          </button>
          <span className="img-lib-note" id="imgLibNote">
            {c && sel ? sel.name + ' · ' + fmtSize(c.api, sel) : images.length ? 'Pick an image above, or upload a new one.' : ''}
          </span>
        </div>
        {c && view ? <LibraryTools c={c} view={view} onCleanup={() => actions.cleanup()} /> : <div className="imglib-tools" id="imgLibTools" hidden />}
        <div className="form-grid">
          <div className="full">
            <label className="field-lab" htmlFor="imgAlt">
              {t('img.altLabel')}
            </label>
            <input className="txt-input" id="imgAlt" type="text" placeholder={form.altPh ?? t('img.altPh')} value={form.alt} onChange={(e) => set({ alt: e.target.value })} />
          </div>
          <div className="full">
            <label className="field-lab" htmlFor="imgCaption">
              {t('img.captionLabel')}
            </label>
            <input className="txt-input" id="imgCaption" type="text" maxLength={300} placeholder={t('img.captionPh')} value={form.caption} onChange={(e) => set({ caption: e.target.value })} />
          </div>
          <div className="full">
            <label className="field-lab">{t('img.display')}</label>
            <div className="seg" id="segImgDisplay">
              <button type="button" data-imgdisp="standard" className={form.full ? '' : 'active'} onClick={() => set({ full: false })}>
                {t('img.standard')}
              </button>
              <button type="button" data-imgdisp="full" className={form.full ? 'active' : ''} onClick={() => set({ full: true })}>
                {t('img.fullBleed')}
              </button>
            </div>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="tb-btn" id="btnCloseImage" onClick={onClose}>
            {t('img.cancel')}
          </button>
          <button type="button" className="tb-btn primary" id="btnDoInsertImage" disabled={!sel} style={sel ? undefined : { opacity: 0.5 }} onClick={insert}>
            <Icon name="Check" />
            {t('img.insert')}
          </button>
        </div>
        <input
          type="file"
          id="imgFileInput"
          ref={file}
          accept={PICTURE_ACCEPT}
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            void onFile(f);
          }}
        />
      </Dialog>
      {actions.confirm}
    </>
  );
}
