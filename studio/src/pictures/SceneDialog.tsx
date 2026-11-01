import { useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { BookImage, Closure, StockPhoto } from '../closure/index';
import { useLocale } from '../i18n/LocaleProvider';
import { Dialog } from '../shell/Dialog';
import { Icon } from '../shell/Icon';
import { useToast } from '../shell/Toasts';
import { LibraryGrid, useLibrary, useLibraryActions } from './Library';
import { addPicture, PICTURE_ACCEPT, PICTURE_ADDED, PICTURE_TYPE_REFUSED, readPictureFile, sectionKey, sectionMapById, setSectionKeys } from './pictures';
import { sceneAltOffer, sceneEntry, scenesWith, scenesWithout, stockPicture, suggestVerdict } from './scene';
import { stockDownload, stockSearch, stockThumb } from './stock';

/* BEUK:sceneimages — 1.0's scene picker (#modalScene, z-index 67): art at
   one scene break, from the book's library (with the image library's delete
   controls), an upload, or Suggest by name (the stock search, stock.ts);
   the scene's optional name (steers suggestions, never printed), its
   required alt text and optional caption. Nothing attaches until Attach;
   Cancel, Escape and the backdrop change nothing (an upload or a stock pick
   joins the library at once, as in 1.0). The scene entry is 1.0's
   { at, imageId, name, caption, alt } in the section's `scenes`. */

type Props = { c: Closure; ydoc: Y.Doc; sectionId: unknown; at: number; onClose: () => void };

export function SceneDialog({ c, ydoc, sectionId, at, onClose }: Props) {
  const { t } = useLocale();
  const toast = useToast();
  const lib = useLibrary(ydoc, true);
  const grid = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const altEl = useRef<HTMLInputElement>(null);
  const queryEl = useRef<HTMLInputElement>(null);
  const actions = useLibraryActions(ydoc, lib);
  // 1.0's openScenePicker: scenePending and the fields from the break's entry
  const [init] = useState(() => {
    const s = { scenes: sectionKey(sectionMapById(ydoc, sectionId), 'scenes') };
    return c.api.sceneEntryAt(s, at);
  });
  const [imageId, setImageId] = useState<string | null>(init ? init.imageId : null);
  const [name, setName] = useState(init ? init.name || '' : '');
  const [alt, setAlt] = useState(init ? init.alt || '' : '');
  const [caption, setCaption] = useState(init ? init.caption || '' : '');
  const [suggest, setSuggest] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [photos, setPhotos] = useState<StockPhoto[]>([]);

  const view = lib.view;
  const images = view?.images ?? [];
  const sel: BookImage | null = images.find((im) => im.id === imageId) ?? null;

  // 1.0's sceneSelectImage: the alt text offered from the picture (or a stock photo's own words) when it is empty
  const select = (id: string, hint?: string, im?: BookImage) => {
    setImageId(id);
    const pic = im ?? images.find((x) => x.id === id);
    if (pic && !alt.trim()) setAlt(sceneAltOffer(c.api, pic.name, hint));
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const up = await readPictureFile(f);
    if (!up.ok) {
      toast(up.why === 'type' ? PICTURE_TYPE_REFUSED : t('toast.coverReadFail'), 'TriangleAlert');
      return;
    }
    const im = { id: c.api.uid(), ...up.im } as BookImage;
    addPicture(c, ydoc, im);
    select(im.id, undefined, im);
    lib.refresh();
    toast(PICTURE_ADDED, 'Image');
  };

  const confirm = () => {
    const m = sectionMapById(ydoc, sectionId);
    const im = sel;
    if (!m || !im) {
      toast(t('scene.pickFirst'), 'Image');
      return;
    }
    const entry = sceneEntry(c.api, at, im.id, { name, alt, caption });
    if (!entry) {
      toast(t('scene.altNeeded'), 'TriangleAlert');
      altEl.current?.focus();
      return;
    }
    setSectionKeys(ydoc, sectionId, { scenes: scenesWith(sectionKey(m, 'scenes'), entry) });
    onClose();
    toast(t('scene.attached'), 'Image');
  };

  const detach = () => {
    const m = sectionMapById(ydoc, sectionId);
    const list = m ? scenesWithout(c.api, { scenes: sectionKey(m, 'scenes') }, at) : null;
    if (list) setSectionKeys(ydoc, sectionId, { scenes: list });
    onClose();
    toast(t('scene.removed'), 'Trash2');
  };

  const toggleSuggest = () => {
    const show = !suggest;
    setSuggest(show);
    if (show) {
      if (!query.trim()) {
        const title = String(sectionKey(sectionMapById(ydoc, sectionId), 'title') ?? '');
        setQuery([title, name.trim()].filter(Boolean).join(' ').trim());
      }
      requestAnimationFrame(() => queryEl.current?.focus());
    }
  };

  const find = async () => {
    setStatus('…');
    const out = await stockSearch(c.api, query);
    if ('gated' in out) {
      setStatus(t(out.gated === 'account' ? 'covermk.photoNeedAccount' : 'covermk.photoNone'));
      return;
    }
    const v = suggestVerdict(out.res);
    setPhotos(v.photos);
    setStatus(v.statusKey ? t(v.statusKey as never) : '');
  };

  const pickStock = async (ph: StockPhoto) => {
    setStatus('…');
    const got = await stockDownload(ph);
    if (!got) {
      setStatus(t('covermk.photoFail'));
      return;
    }
    const im = stockPicture(c.api.uid(), ph, got.type, got.data) as BookImage;
    addPicture(c, ydoc, im);
    select(im.id, ph.alt || '', im);
    lib.refresh();
    setStatus('');
    toast(t('covermk.photoUse'), 'Image');
  };

  return (
    <>
      <Dialog open onClose={onClose} id="modalScene" z={67} labelledBy="sceneH">
        <h2 id="sceneH">
          <Icon name="Image" />
          <span>{t('scene.title')}</span>
        </h2>
        <p className="m-sub">{t('scene.sub')}</p>
        <div className="form-grid" style={{ marginTop: 14 }}>
          <div className="full">
            <label className="field-lab" htmlFor="sceneName">
              {t('scene.nameLabel')}
            </label>
            <input className="txt-input" id="sceneName" type="text" placeholder={t('scene.namePh')} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <label className="field-lab" style={{ marginTop: 16, display: 'block' }}>
          {t('scene.libraryLabel')}
        </label>
        <div className="img-lib" id="sceneLib" style={{ marginTop: 8 }} ref={grid}>
          {view && <LibraryGrid view={view} attr="data-sceneimg" selected={imageId} empty={t('scene.noLibrary')} onPick={(id) => select(id)} onDelete={actions.requestDelete} />}
        </div>
        <div className="fmt-actions" style={{ margin: '10px 0 4px' }}>
          <button className="tb-btn" id="btnSceneUpload" type="button" onClick={() => file.current?.click()}>
            <Icon name="Upload" />
            <span>{t('scene.upload')}</span>
          </button>
          <button className="tb-btn" id="btnSceneSuggest" type="button" aria-expanded={suggest} onClick={toggleSuggest}>
            <Icon name="Sparkles" />
            <span>{t('scene.suggest')}</span>
          </button>
          <span className="img-lib-note" id="sceneLibNote">
            {sel ? sel.name + ' · ' + c.api.fmtBytes(Math.round(sel.data.length * 3 / 4)) : images.length ? t('scene.pickFirst') : ''}
          </span>
        </div>
        <div id="sceneSuggestBox" style={suggest ? { marginTop: 8 } : { display: 'none', marginTop: 8 }}>
          <p className="m-sub">{t('scene.suggestHint')}</p>
          <div className="fmt-actions" style={{ margin: '8px 0' }}>
            <input
              className="txt-input"
              id="sceneSuggestQuery"
              type="text"
              style={{ flex: '1 1 220px' }}
              aria-label="Suggestion search words"
              ref={queryEl}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void find();
                }
              }}
            />
            <button className="tb-btn" id="btnSceneFind" type="button" onClick={() => void find()}>
              <Icon name="Search" />
              <span>{t('scene.find')}</span>
            </button>
          </div>
          <p className="img-lib-note" id="sceneSuggestStatus" aria-live="polite">
            {status}
          </p>
          <div className="scene-suggest-grid" id="sceneSuggestGrid">
            {photos.map((ph, i) => {
              const src = stockThumb(ph);
              return (
                <button
                  type="button"
                  className="cm-photo-cell"
                  key={i}
                  title={t(ph.provider === 'Openverse' ? 'covermk.photoByOpenverse' : 'covermk.photoBy', { name: ph.photographer || 'Pexels' })}
                  onClick={() => void pickStock(ph)}
                >
                  {src ? <img src={src} alt={ph.alt || ''} loading="lazy" /> : null}
                </button>
              );
            })}
          </div>
        </div>
        <div className="form-grid" style={{ marginTop: 16 }}>
          <div className="full">
            <label className="field-lab" htmlFor="sceneAlt">
              {t('scene.altLabel')}
            </label>
            <input className="txt-input" id="sceneAlt" type="text" placeholder={t('scene.altPh')} value={alt} ref={altEl} onChange={(e) => setAlt(e.target.value)} />
          </div>
          <div className="full">
            <label className="field-lab" htmlFor="sceneCaption">
              {t('scene.captionLabel')}
            </label>
            <input className="txt-input" id="sceneCaption" type="text" placeholder={t('scene.captionPh')} value={caption} onChange={(e) => setCaption(e.target.value)} />
          </div>
        </div>
        <div className="modal-actions">
          <button className="tb-btn" id="btnSceneDetach" type="button" style={init ? { marginInlineEnd: 'auto' } : { display: 'none', marginInlineEnd: 'auto' }} onClick={detach}>
            <Icon name="Trash2" />
            <span>{t('scene.remove')}</span>
          </button>
          <button className="tb-btn" id="btnCloseScene" type="button" onClick={onClose}>
            {t('scene.cancel')}
          </button>
          <button className="tb-btn primary" id="btnDoScene" type="button" disabled={!sel} style={sel ? undefined : { opacity: 0.5 }} onClick={confirm}>
            <Icon name="Check" />
            <span>{t('scene.attach')}</span>
          </button>
        </div>
        <input
          type="file"
          id="sceneFileInput"
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
