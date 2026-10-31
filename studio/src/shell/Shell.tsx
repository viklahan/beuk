import { useState } from 'react';
import { useLocale } from '../i18n/LocaleProvider';
import { Icon } from './Icon';
import { LangMenu } from './LangMenu';
import { ThemeButton } from './ThemeButton';

/* The studio's frame, with 1.0's structure and ids (client/index.html
   <div id="app">): the top bar, the phone tab row, and the three panes —
   the outline (left), the writing page (centre) and the reader (right).
   Part A: no book yet, so the outline is empty, the page is a
   placeholder and the reader is bare. Import, Project Settings and Export
   keep their place and look but are not wired (aria-disabled) until
   part C / step 5. Every label is an existing 1.0 string key. */
type MobilePane = 'structure' | 'center' | 'preview';

const openTab = (url: string) => {
  try {
    window.open(url, '_blank', 'noopener');
  } catch {
    /* blocked pop-up: nothing to do */
  }
};

export function Shell() {
  const { t, dir, lang } = useLocale();
  const [mobile, setMobile] = useState<MobilePane>('structure');
  const [mstyle, setMstyle] = useState(false);
  const tab = (pane: MobilePane, style: boolean) => () => {
    setMobile(pane);
    setMstyle(style);
  };
  const active = (pane: MobilePane, style: boolean) => (mobile === pane && mstyle === style ? 'active' : undefined);

  return (
    <div id="app" dir={dir}>
      <header id="topbar">
        <div className="brand">
          <svg className="brand-mark" width="26" height="31" viewBox="0 0 44 52" aria-hidden="true" focusable="false">
            <rect x="7" y="3" width="9" height="46" rx="2.5" fill="currentColor" />
            <rect className="bm-band" x="7" y="13" width="9" height="2.4" />
            <rect className="bm-band" x="7" y="36" width="9" height="2.4" />
            <circle cx="27" cy="35" r="12.5" fill="currentColor" />
            <circle className="bm-eye" cx="27" cy="35" r="6" />
          </svg>
          <div className="brand-txt">
            <div className="brand-name">beuk</div>
            <div className="brand-sub">beuk.studio</div>
          </div>
          <span className="brand-tagline" id="brandTagline">
            {t('brand.tagline')}
          </span>
        </div>
        <div className="brand-div" aria-hidden="true" />
        <div className="book-id">
          <div className="book-title" id="projectTitleDisplay">
            {t('misc.untitledBook')}
          </div>
          <div className="book-author" id="projectAuthorDisplay" />
        </div>
        <LangMenu />
        <ThemeButton />
        <button type="button" className="tb-btn" id="btnHomeport" aria-label={t('top.homeportAria')} onClick={() => openTab('/?home')}>
          <Icon name="Anchor" />
          <span className="tb-label lbl-collapse">{t('top.homeport')}</span>
        </button>
        <button type="button" className="tb-btn" id="btnHelp" aria-label={t('top.helpAria')} onClick={() => openTab('/help/')}>
          <Icon name="LifeBuoy" />
          <span className="tb-label lbl-collapse">{t('top.help')}</span>
        </button>
        <button type="button" className="tb-btn primary" id="btnExport" aria-label={t('top.export')} aria-disabled="true">
          <Icon name="Download" />
          <span className="tb-label">{t('top.export')}</span>
        </button>
      </header>

      <nav id="mobileTabs">
        <button type="button" data-mpane="structure" className={active('structure', false)} onClick={tab('structure', false)}>
          <Icon name="ListTree" />
          {t('tabs.structure')}
        </button>
        <button type="button" data-mpane="center" className={active('center', false)} onClick={tab('center', false)}>
          <Icon name="PenLine" />
          {t('tabs.write')}
        </button>
        <button type="button" data-mpane="center" data-mstyle="1" className={active('center', true)} onClick={tab('center', true)}>
          <Icon name="Type" />
          {t('tabs.style')}
        </button>
        <button type="button" data-mpane="preview" className={active('preview', false)} onClick={tab('preview', false)}>
          <Icon name="TabletSmartphone" />
          {t('tabs.preview')}
        </button>
      </nav>

      <main id="panes" data-mobile={mobile}>
        <aside id="pane-structure" className="pane">
          <div className="side-actions">
            <button type="button" className="side-btn" id="btnImport" aria-disabled="true" title={t('side.importTitle')}>
              <Icon name="FileUp" />
              {t('side.import')}
            </button>
            <button type="button" className="side-btn" id="btnSettings2" aria-disabled="true">
              <Icon name="SlidersHorizontal" />
              {t('side.settings')}
            </button>
          </div>
          <div id="structureScroll">
            {/* The outline: the book's sections (part C fills it). */}
            <ul id="structureList" aria-label={t('tabs.structure')} />
          </div>
        </aside>

        <section id="pane-center" className="pane">
          <div className="center-tabs" role="tablist">
            <button type="button" className="ctab active" id="tabBtnContent" role="tab" aria-selected="true">
              <Icon name="PenLine" />
              {t('tab.content')}
            </button>
          </div>
          <div className="center-body" role="tabpanel">
            <div className="center-inner">
              {/* The manuscript keeps the BOOK's direction and language, not
                  the interface's (an Arabic chrome around an English book). */}
              <div className="ms-page" id="manuscript" dir="ltr" lang="en">
                <p className="ms-placeholder" lang={lang}>
                  {t('editor.placeholder')}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="pane-preview" className="pane" aria-label={t('tabs.preview')}>
          <div id="previewStage" />
        </section>
      </main>
    </div>
  );
}
