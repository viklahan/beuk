import { memo, useEffect } from 'react';
import { useBook } from '../book/BookProvider';
import { loadClosure } from '../closure/index';
import { useLocale } from '../i18n/LocaleProvider';
import { Icon } from '../shell/Icon';
import { loadPreview, previewIfLoaded, setPreviewMounted, previewStarted, startPreview, stopPreview, renderNow, queueTyped, pvMobile } from './preview';

/* Step 5 wave 4b (inventory E1, E2): 1.0's preview pane — its markup, ids, classes and keys (client/index.html
   "PANE 3 : PREVIEW"): the device bar, the device frame and its screen (the running head, the page flow, the
   footer), the hardcover's stage, the truth note, the page controls and full screen, the hardcover's bar and facts,
   the section line, the reading desk and its hidden measurer. React draws this frame once (its words again on
   a language change); everything inside it that moves is 1.0's own code (src/preview/preview.ts), wired by 1.0's own
   initPreview, hcInit and fsInit. */

/** The device menu's choices: 1.0's own words, untranslated, as in 1.0 (the hardcover's is translated, hcp.device). */
const DEVICES: { id: string; label: string }[] = [
  { id: 'kindle', label: 'Kindle Paperwhite' },
  { id: 'ipad', label: 'Apple Books · iPad' },
  { id: 'kobo', label: 'Kobo Clara BW' },
  { id: 'phone', label: 'Phone · OLED' },
  { id: 'oasis', label: 'Kindle Oasis' },
  { id: 'basic', label: 'Kindle' },
  { id: 'colorsoft', label: 'Kindle Colorsoft' },
  { id: 'iphone', label: 'iPhone' },
  { id: 'forma', label: 'Kobo Forma' },
  { id: 'android', label: 'Android Tablet' },
];

/** 1.0's static markup (the device names are 1.0's own words, untranslated, as in 1.0). */
const Frame = memo(function Frame({ t }: { t: (k: string, p?: Record<string, unknown>) => string }) {
  return (
    <>
      {/* One native menu at every width (2026-11-27): eleven buttons wrapped into five or six rows over the reader on a
          phone. Uncontrolled: 1.0's setDevice sets its value and its change event calls setDevice (initPreview). The
          arrow-keys tip is its tooltip. */}
      <div className="device-bar">
        <select className="dev-select" id="deviceBar" defaultValue="kindle" aria-label={t('preview.deviceLabel')} data-tip="preview.tip">
          {DEVICES.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
          <option value="hardcover">{t('hcp.device')}</option>
        </select>
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
        <div id="previewDesk">
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
