import { memo, useEffect } from 'react';
import { useBook } from '../book/BookProvider';
import { loadClosure } from '../closure/index';
import { useLocale } from '../i18n/LocaleProvider';
import { Icon, type IconName } from '../shell/Icon';
import { loadPreview, previewIfLoaded, setPreviewMounted, previewStarted, startPreview, stopPreview, renderNow, queueTyped, pvMobile } from './preview';

/* Step 5 wave 4b (inventory E1, E2): 1.0's preview pane — its markup, ids, classes and keys (client/index.html
   "PANE 3 : PREVIEW"): the device bar, the device frame and its screen (the running head, the page flow, the
   footer), the hardcover's stage, the truth note, the page controls and full screen, the hardcover's bar and facts,
   the section line, the tip, the reading desk and its hidden measurer. React draws this frame once (its words again on
   a language change); everything inside it that moves is 1.0's own code (src/preview/preview.ts), wired by 1.0's own
   initPreview, hcInit and fsInit. */

const DEVICES: { id: string; icon: IconName; label: string }[] = [
  { id: 'kindle', icon: 'BookOpen', label: 'Kindle Paperwhite' },
  { id: 'ipad', icon: 'Tablet', label: 'Apple Books · iPad' },
  { id: 'kobo', icon: 'BookMarked', label: 'Kobo Clara BW' },
  { id: 'phone', icon: 'Smartphone', label: 'Phone · OLED' },
  { id: 'oasis', icon: 'BookOpen', label: 'Kindle Oasis' },
  { id: 'basic', icon: 'Book', label: 'Kindle' },
  { id: 'colorsoft', icon: 'BookOpen', label: 'Kindle Colorsoft' },
  { id: 'iphone', icon: 'Smartphone', label: 'iPhone' },
  { id: 'forma', icon: 'BookMarked', label: 'Kobo Forma' },
  { id: 'android', icon: 'Tablet', label: 'Android Tablet' },
];

/** 1.0's static markup (the device names are 1.0's own words, untranslated, as in 1.0). */
const Frame = memo(function Frame({ t }: { t: (k: string, p?: Record<string, unknown>) => string }) {
  return (
    <>
      <div className="device-bar" id="deviceBar">
        {DEVICES.map((d) => (
          <button key={d.id} type="button" className={'dev-btn' + (d.id === 'kindle' ? ' active' : '')} data-device={d.id}>
            <Icon name={d.icon} />
            {d.label}
          </button>
        ))}
        <button type="button" className="dev-btn" data-device="hardcover">
          <Icon name="BookText" />
          {t('hcp.device')}
        </button>
      </div>
      <div id="previewStage">
        <div id="frameZone">
          <div id="deviceFrame" className="frame-kindle" data-display="eink-mono">
            <div className="screen" id="deviceScreen">
              <div className="notch" />
              <div className="run-head">
                <span id="rhBook" />
                <span id="rhChapter" />
              </div>
              <div id="flowWrap">
                <div id="pageFlow" className="fc-page" lang="en" />
              </div>
              <div className="run-foot">
                <span id="footDevice">Kindle Paperwhite · 300 ppi</span>
              </div>
              <div className="home-bar" />
            </div>
          </div>
          <div id="hcStage" className="hc-stage" hidden tabIndex={0} />
        </div>
        <p className="device-display-note" id="deviceDisplayNote" aria-live="polite" hidden />
        <div className="page-controls">
          <button type="button" className="page-btn" id="btnPrevPage">
            <Icon name="ChevronLeft" />
            {t('preview.prev')}
          </button>
          <span id="pageCounter" />
          <button type="button" className="page-btn" id="btnNextPage">
            {t('preview.next')}
            <Icon name="ChevronRight" />
          </button>
          <button className="page-btn pv-full fs-btn" id="pvFull" type="button" aria-pressed="false" aria-keyshortcuts="F" title={t('fs.enter')} aria-label={t('fs.enter')}>
            <Icon name="Maximize2" />
          </button>
        </div>
        <div className="hc-bar" id="hcBar" hidden>
          <button className="page-btn" id="hcPrev" type="button">
            <Icon name="ChevronLeft" />
            <span>{t('hcp.prev')}</span>
          </button>
          <button className="page-btn hc-toggle" id="hcToggle" type="button">
            <Icon name="BookOpen" />
            <span id="hcToggleLabel">{t('hcp.open')}</span>
          </button>
          <button className="page-btn" id="hcNext" type="button">
            <span>{t('hcp.next')}</span>
            <Icon name="ChevronRight" />
          </button>
          <button className="page-btn hc-full fs-btn" id="hcFull" type="button" aria-pressed="false" aria-keyshortcuts="F" title={t('fs.enter')} aria-label={t('fs.enter')}>
            <Icon name="Maximize2" />
          </button>
        </div>
        <div className="hc-meta" id="hcMeta" hidden>
          <div className="hc-counter" id="hcCounter" aria-live="polite" />
          <div className="hc-facts" id="hcFacts" />
          <button className="hc-link" id="hcToChapter" type="button">
            {t('hcp.toChapter')}
          </button>
          <p className="hc-hint">{t('hcp.hint')}</p>
        </div>
        <div id="previewSectionName" />
        <p data-i18n="preview.tip" style={{ textAlign: 'center', fontSize: '11.5px', color: 'var(--muted)', margin: '2px 0 10px' }}>{t('preview.tip')}</p>
        <div id="previewDesk">
          <div className="desk-facts" id="deskFacts" />
          <div className="desk-total" id="deskTotal" />
          <div className="desk-basis" id="deskBasis" />
          <div className="desk-rail" id="deskRail" role="list" />
        </div>
        <div id="deskMeasure" aria-hidden="true">
          <div id="deskFlow" className="fc-page" lang="en" />
        </div>
      </div>
    </>
  );
});

export function PreviewPane({ mobile }: { mobile: string }) {
  const { t, lang } = useLocale();
  const bk = useBook();
  const ydoc = bk.phase === 'open' ? (bk.book?.ydoc ?? null) : null;
  // once: 1.0's initPreview / hcInit / fsInit on this markup, then the first render
  useEffect(() => {
    setPreviewMounted(true);
    let gone = false;
    void loadClosure()
      .then(() => loadPreview())
      .then(() => {
        if (!gone && !previewStarted()) startPreview();
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      setPreviewMounted(false);
      stopPreview();
    };
  }, []);
  // the book, its open section, the language: drawn again (1.0's renderPreview on selectSection / applyBookDoc / a
  // language change); the book's edits follow (src/preview/preview.ts watches the Y.Doc)
  useEffect(() => {
    if (previewIfLoaded() && previewStarted()) renderNow();
  }, [ydoc, bk.active, bk.book?.epoch, lang]);
  useEffect(() => {
    if (!ydoc) return;
    return queueTyped(ydoc);
  }, [ydoc]);
  // the phone's pane: 1.0's setMobilePane (the reader's owed turn, BEUK:reader)
  useEffect(() => {
    pvMobile(mobile === 'preview');
  }, [mobile]);
  return <Frame t={t as (k: string, p?: Record<string, unknown>) => string} />;
}
