import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useBook } from '../book/BookProvider';
import { setMeta } from '../book/hooks';
import { bookMeta } from '../book/store';
import { bookState, loadClosure, type Closure } from '../closure/index';
import { useLocale } from '../i18n/LocaleProvider';
import { Dialog } from '../shell/Dialog';
import { Icon } from '../shell/Icon';
import { useToast } from '../shell/Toasts';
import { bookLanguages, formFromMeta, langHint, rightsPreviewLine, settingsChange, supportEmailFrom, type SettingsForm } from './settings';

/* Project Settings (1.0 #modalSettings), with 1.0's markup, ids and keys:
   the interface language, the book's metadata, the Rights choice (F11)
   with its live preview line, the book language, the blurb and the
   accessibility summary, and the "Beuk on this device" box with the legal
   links (shown only when this studio's server answers /api/health, as
   1.0's cloud.available) and the support address (/api/config/public,
   1.0's beukSupportLoad).

   Not here yet, each in its own wave (their places are marked below):
   "Detect from my text" (language detection, wave 3), the cover row (the
   cover maker, wave 4), the install button (wave 7 with the app shell) and
   the error-report toggle (error reporting, wave 7).

   Save writes the book's `meta` once, through Yjs, and only when it
   changes (settings.ts settingsChange). Cancel, Escape and the backdrop
   write nothing. */

type Rec = Record<string, unknown>;

/** 1.0's server probes, once per page: /api/health (legal links) and /api/config/public (support address). */
let probes: Promise<{ server: boolean; support: string | null }> | null = null;
function serverFacts(): Promise<{ server: boolean; support: string | null }> {
  if (!probes) {
    const health = fetch('/api/health', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json().catch(() => null) : null))
      .then((j: { ok?: unknown } | null) => !!(j && j.ok))
      .catch(() => false);
    const support = fetch('/api/config/public', { credentials: 'omit' })
      .then((r) => (r.ok ? r.json() : null))
      .then(supportEmailFrom)
      .catch(() => null);
    probes = Promise.all([health, support]).then(([server, s]) => ({ server, support: s }));
  }
  return probes;
}
/** Tests only: forget the probes. */
export function resetServerFacts(): void {
  probes = null;
}

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang, order, names, setLang } = useLocale();
  const bk = useBook();
  const toast = useToast();
  const [c, setC] = useState<Closure | null>(null);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [facts, setFacts] = useState<{ server: boolean; support: string | null }>({ server: false, support: null });
  const ydoc = bk.book?.ydoc ?? null;

  useEffect(() => {
    if (!open || !ydoc) return;
    let gone = false;
    setForm(null);
    void loadClosure().then((x) => {
      if (gone) return;
      setC(x);
      setForm(formFromMeta(x, bookMeta(ydoc)));
    });
    void serverFacts().then((f) => {
      if (!gone) setFacts(f);
    });
    return () => {
      gone = true;
    };
  }, [open, ydoc]);

  const meta: Rec = ydoc ? bookMeta(ydoc) : {};
  const a11yPh = useMemo(() => {
    if (!c || !ydoc || !open) return '';
    bookState(c, ydoc); // 1.0's state for this book: the default summary depends on its pictures
    return (c.api as unknown as { a11ySummaryDefault: () => string }).a11ySummaryDefault();
  }, [c, ydoc, open, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const languages = useMemo(() => (c ? bookLanguages(c) : []), [c]);

  const set = (k: keyof SettingsForm) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const v = e.target.value;
    setForm((f) => (f ? { ...f, [k]: v } : f));
  };
  const save = () => {
    if (!c || !ydoc || !form) return;
    const next = settingsChange(c, bookMeta(ydoc), form);
    if (next) setMeta(ydoc, 'meta', next as never);
    onClose();
    toast(t('toast.settingsSaved'), 'Check');
  };

  const hint = c ? langHint(c, meta) : null;
  const mode = form?.rightsMode ?? 'reserved';
  const ccs = c ? Object.entries(c.api.CC_LICENCES) : [];
  const supportParts = t('support.settingsLine').split('{email}');

  return (
    <Dialog open={open} onClose={onClose} id="modalSettings" labelledBy="setH">
      <h2 id="setH">
        <Icon name="BookType" />
        {t('set.title')}
      </h2>
      {/* 1.0's set.subHtml carries one <span> of its own markup; it is drawn from the key's text only, never as HTML */}
      <p className="m-sub">{t('set.subHtml').replace(/<[^>]*>/g, '')}</p>
      {form && c ? (
        <div className="form-grid">
          <div className="full">
            <label className="field-lab" htmlFor="uiLangSelect">
              {t('set.uiLanguage')}
            </label>
            <select className="txt-input" id="uiLangSelect" value={lang} onChange={(e) => void setLang(e.target.value).catch(() => undefined)}>
              {order.map((code) => (
                <option value={code} key={code}>
                  {names[code]}
                </option>
              ))}
            </select>
            <p className="cover-note" style={{ marginTop: 6 }}>
              {t('set.uiLanguageNote')}
            </p>
          </div>
          <div className="full">
            <label className="field-lab" htmlFor="setTitle">
              {t('set.bookTitle')}
            </label>
            <input className="txt-input" id="setTitle" type="text" placeholder={t('misc.untitledBook')} value={form.title} onChange={set('title')} />
          </div>
          <div className="full">
            <label className="field-lab" htmlFor="setSubtitle">
              {t('set.subtitle')}
            </label>
            <input className="txt-input" id="setSubtitle" type="text" placeholder="A novel of the eastern channel" value={form.subtitle} onChange={set('subtitle')} />
          </div>
          <div>
            <label className="field-lab" htmlFor="setAuthor">
              {t('set.author')}
            </label>
            <input className="txt-input" id="setAuthor" type="text" value={form.author} onChange={set('author')} />
          </div>
          <div>
            <label className="field-lab" htmlFor="setPublisher">
              {t('set.publisher')}
            </label>
            <input className="txt-input" id="setPublisher" type="text" value={form.publisher} onChange={set('publisher')} />
          </div>
          <div className="full" style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label className="field-lab" htmlFor="setSeries">
                {t('set.series')}
              </label>
              <input className="txt-input" id="setSeries" type="text" maxLength={120} placeholder={t('set.seriesPh')} value={form.series} onChange={set('series')} />
            </div>
            <div style={{ flex: '0 0 10em' }}>
              <label className="field-lab" htmlFor="setSeriesNumber">
                {t('set.seriesNumber')}
              </label>
              <input className="txt-input" id="setSeriesNumber" type="text" inputMode="numeric" maxLength={3} placeholder="1" value={form.seriesNumber} onChange={set('seriesNumber')} />
            </div>
          </div>
          <div>
            <label className="field-lab" htmlFor="setIsbn">
              {t('set.isbn')}
            </label>
            <input className="txt-input" id="setIsbn" type="text" placeholder="978-1-23456-789-0" value={form.isbn} onChange={set('isbn')} />
          </div>
          <div>
            <label className="field-lab" htmlFor="setYear">
              {t('set.year')}
            </label>
            <input className="txt-input" id="setYear" type="text" inputMode="numeric" placeholder="2026" value={form.year} onChange={set('year')} />
          </div>
          {/* BEUK:rights — the rows that belong to the choice, and a live line of what the book will say */}
          <div className="full">
            <label className="field-lab" htmlFor="setRightsMode">
              {t('rights.label')}
            </label>
            <select className="txt-input" id="setRightsMode" value={mode} onChange={set('rightsMode')}>
              <option value="reserved">{t('rights.reserved')}</option>
              <option value="pd">{t('rights.pd')}</option>
              <option value="cc">{t('rights.cc')}</option>
              <option value="custom">{t('rights.custom')}</option>
            </select>
          </div>
          <div className="full" id="rowRightsCustom" hidden={mode !== 'custom'}>
            <label className="field-lab" htmlFor="setRights">
              {t('rights.customText')}
            </label>
            <input className="txt-input" id="setRights" type="text" placeholder={t('rights.customPh')} value={form.rights} onChange={set('rights')} />
          </div>
          <div className="full" id="rowRightsCc" hidden={mode !== 'cc'}>
            <label className="field-lab" htmlFor="setCcLicence">
              {t('rights.licence')}
            </label>
            <select className="txt-input" id="setCcLicence" value={form.ccLicence} onChange={set('ccLicence')}>
              {ccs.map(([k, v]) => (
                <option value={k} key={k}>
                  {v.short}
                </option>
              ))}
            </select>
          </div>
          <div id="rowRightsPdYear" hidden={mode !== 'pd'}>
            <label className="field-lab" htmlFor="setFirstPublished">
              {t('rights.firstPublished')}
            </label>
            <input className="txt-input" id="setFirstPublished" type="text" inputMode="numeric" placeholder="1844" value={form.firstPublished} onChange={set('firstPublished')} />
          </div>
          <div id="rowRightsPdEd" hidden={mode !== 'pd'}>
            <label className="field-lab" htmlFor="setEditionHolder">
              {t('rights.editionHolder')}
            </label>
            <input className="txt-input" id="setEditionHolder" type="text" placeholder={t('rights.editionPh')} value={form.editionHolder} onChange={set('editionHolder')} />
          </div>
          <div className="full" id="rowRightsPdNote" hidden={mode !== 'pd'}>
            <p className="cover-note" style={{ marginTop: 0 }}>
              {t('rights.editionNote')}
            </p>
          </div>
          <div className="full">
            <p className="cover-note" id="rightsPreview" style={{ marginTop: 0 }}>
              {t('rights.preview', { line: rightsPreviewLine(c, form) })}
            </p>
          </div>
          <div>
            <label className="field-lab" htmlFor="setLang">
              {t('set.bookLanguage')}
            </label>
            <select className="txt-input" id="setLang" value={form.language} onChange={set('language')}>
              {languages.map((l) => (
                <option value={l.code} key={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div className="full lang-detect-row">
            {/* "Detect from my text" (#btnDetectLang): language detection comes with wave 3 */}
            <p className="cover-note" id="langHint" style={{ marginTop: 8 }}>
              {hint ? (t as (k: string, p?: Rec) => string)(hint.key, hint.lang ? { lang: hint.lang } : undefined) : ''}
            </p>
          </div>
          <div className="full">
            <label className="field-lab" htmlFor="setDesc">
              {t('set.description')}
            </label>
            <textarea className="txt-input" id="setDesc" rows={3} style={{ resize: 'vertical' }} value={form.description} onChange={set('description')} />
          </div>
          <div className="full">
            <label className="field-lab" htmlFor="setA11ySummary">
              {t('set.a11ySummary')}
            </label>
            <textarea className="txt-input" id="setA11ySummary" rows={2} style={{ resize: 'vertical' }} placeholder={a11yPh} value={form.a11ySummary} onChange={set('a11ySummary')} />
            <p className="cover-note" style={{ marginTop: 6 }}>
              {t('set.a11ySummaryNote')}
            </p>
          </div>
          {/* the cover row (Upload / Make a Cover / Remove) comes with the cover maker, wave 4 */}
        </div>
      ) : null}
      <div className="about-box">
        <h3>{t('about.title')}</h3>
        <p className="cover-note">{t('about.offlineLine')}</p>
        {/* #errReportsRow, the error-report toggle: error reporting is wave 7 */}
        <p className="cover-note" id="installHint">
          {t('about.installHint')}
        </p>
        {/* ==== BEUK:legal ==== the legal pages live on the studio's server: no server, no links to pages that aren't there */}
        <p className="cover-note legal-line" id="legalLinksSettings" hidden={!facts.server}>
          <span>{t('legal.settingsLine')}</span>{' '}
          <a href="/privacy" target="_blank" rel="noopener">
            {t('legal.privacy')}
          </a>{' '}
          ·{' '}
          <a href="/terms" target="_blank" rel="noopener">
            {t('legal.terms')}
          </a>
        </p>
        {/* ==== BEUK:support ==== shown only when this studio's server has SUPPORT_EMAIL */}
        <p className="cover-note" id="supportLineSettings" hidden={!facts.support}>
          {facts.support ? (
            <>
              {supportParts[0] || ''}
              <a href={'mailto:' + facts.support} data-support-email="">
                {facts.support}
              </a>
              {supportParts.slice(1).join('{email}')}
            </>
          ) : null}
        </p>
      </div>
      <div className="modal-actions">
        <button type="button" className="tb-btn" id="btnCloseSettings" onClick={onClose}>
          {t('set.cancel')}
        </button>
        <button type="button" className="tb-btn primary" id="btnSaveSettings" onClick={save} disabled={!form}>
          <Icon name="Check" />
          {t('set.save')}
        </button>
      </div>
    </Dialog>
  );
}
