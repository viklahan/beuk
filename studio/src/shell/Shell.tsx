import { useState } from 'react';
import { useBook } from '../book/BookProvider';
import { Desk } from '../book/Desk';
import { Outline } from '../book/Outline';
import { SideStatus } from '../book/SideStatus';
import { useChapterOps } from '../chapters/ChapterOps';
import { SampleBar } from '../sample/SampleBar';
import { HistoryDialog } from '../history/HistoryDialog';
import { InsightsDialog } from '../insights/InsightsDialog';
import { NotebookDialog } from '../notebook/NotebookDialog';
import { SettingsDialog } from '../settings/SettingsDialog';
import { useLocale } from '../i18n/LocaleProvider';
import { syncClosureLocale } from '../closure/index';
import { TourHost } from '../tour/TourHost';
import { Icon } from './Icon';
import { LangMenu } from './LangMenu';
import { ThemeButton } from './ThemeButton';

/* The studio's frame, with 1.0's structure and ids (client/index.html
   <div id="app">): the top bar, the phone tab row, and the three panes —
   the outline (left), the writing page (centre) and the reader (right).
   Part C: the outline lists the open book's sections, the centre is the
   desk (an empty desk opens a backup; an open book edits the chosen
   chapter), and Export downloads the book as a 1.0 backup file. The reader
   stays bare. Step 5 wave 1a wires Project Settings and History (the book
   tools row); Import keeps its place and look, aria-disabled until its
   wave. Every label is an existing 1.0 string key. */
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
  // 1.0's code in the closure reads t() and the interface language at call time
  syncClosureLocale(t as (k: string, p?: Record<string, unknown>) => string, lang);
  const bk = useBook();
  const canExport = bk.phase === 'open';
  const [mobile, setMobile] = useState<MobilePane>('structure');
  const [dialog, setDialog] = useState<'history' | 'settings' | 'insights' | 'notebook' | null>(null);
  const bookOpen = bk.phase === 'open';
  const ops = useChapterOps({ openHistory: () => setDialog('history') });
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
            {bk.title || t('misc.untitledBook')}
          </div>
          <div className="book-author" id="projectAuthorDisplay">
            {bk.author}
          </div>
        </div>
        <LangMenu />
        <ThemeButton />
        <button type="button" className="tb-btn" id="btnHomeport" data-tip="tips.homeport" aria-label={t('top.homeportAria')} onClick={() => openTab('/?home')}>
          <Icon name="Anchor" />
          <span className="tb-label lbl-collapse">{t('top.homeport')}</span>
        </button>
        <button type="button" className="tb-btn" id="btnHelp" data-tip="tips.help" aria-label={t('top.helpAria')} onClick={() => openTab('/help/')}>
          <Icon name="LifeBuoy" />
          <span className="tb-label lbl-collapse">{t('top.help')}</span>
        </button>
        <button
          type="button"
          className="tb-btn primary"
          id="btnExport"
          aria-label={t('top.export')}
          aria-disabled={canExport ? undefined : 'true'}
          title={canExport ? t('local.backup') : undefined}
          onClick={canExport ? bk.exportBackup : undefined}
        >
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
            <button
              type="button"
              className="side-btn"
              id="btnSettings2"
              aria-disabled={bookOpen ? undefined : 'true'}
              onClick={bookOpen ? () => setDialog('settings') : undefined}
            >
              <Icon name="SlidersHorizontal" />
              {t('side.settings')}
            </button>
          </div>
          {bk.phase !== 'starting' && <SampleBar />}
          {/* the matter library (#matterLib): wave 2 (B3) */}
          <div id="structureScroll">
            <Outline tools={ops.tools} />
          </div>
          {/* BEUK:sidebar — 1.0's book tools row: History (wave 1a), Insights and Notes (wave 1c); Goals and the Covenant keep their place until wave 3 */}
          <div className="side-dock">
            <div className="side-tools" id="sideTools" role="group" aria-label={t('side.toolsAria')}>
              <button
                className="side-tool"
                id="btnInsights"
                data-tip="tips.insights"
                type="button"
                aria-label={t('insights.open')}
                aria-disabled={bookOpen ? undefined : 'true'}
                onClick={bookOpen ? () => setDialog('insights') : undefined}
              >
                <Icon name="Activity" />
                <span className="side-tool-lab">{t('side.toolInsights')}</span>
              </button>
              <button className="side-tool" id="btnGoals" data-tip="tips.goals" type="button" aria-label={t('goals.open')} aria-disabled="true">
                <Icon name="Target" />
                <span className="side-tool-lab">{t('side.toolGoals')}</span>
              </button>
              <button
                className="side-tool"
                id="btnHistory"
                data-tip="tips.history"
                type="button"
                aria-label={t('history.open')}
                aria-disabled={bookOpen ? undefined : 'true'}
                onClick={bookOpen ? () => setDialog('history') : undefined}
              >
                <Icon name="History" />
                <span className="side-tool-lab">{t('side.toolHistory')}</span>
              </button>
              <button className="side-tool" id="btnBible" data-tip="tips.bible" type="button" aria-label={t('bible.open')} aria-disabled="true">
                <Icon name="BookMarked" />
                <span className="side-tool-lab">{t('side.toolBible')}</span>
              </button>
              <button
                className="side-tool"
                id="btnNotebook"
                data-tip="tips.notebook"
                type="button"
                aria-label={t('nb.open')}
                aria-disabled={bookOpen ? undefined : 'true'}
                onClick={bookOpen ? () => setDialog('notebook') : undefined}
              >
                <Icon name="NotebookPen" />
                <span className="side-tool-lab">{t('side.toolNotebook')}</span>
              </button>
            </div>
            {/* the shelf line (#syncRow): wave 7 */}
            {bookOpen && <SideStatus />}
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
              <Desk />
            </div>
          </div>
        </section>

        <section id="pane-preview" className="pane" aria-label={t('tabs.preview')}>
          <div id="previewStage" />
        </section>
      </main>
      {ops.menu}
      <TourHost
        onWrite={() => {
          // 1.0's tourAct("write"): the page, the Write tab on a phone, the caret in the chapter
          setMobile('center');
          setMstyle(false);
          const host = document.getElementById('manuscript') as (HTMLElement & { beukEditor?: { commands: { focus: () => unknown } } }) | null;
          if (host?.beukEditor) host.beukEditor.commands.focus();
          else host?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
        }}
      />
      <HistoryDialog open={dialog === 'history' && bookOpen} onClose={() => setDialog(null)} />
      <SettingsDialog open={dialog === 'settings' && bookOpen} onClose={() => setDialog(null)} />
      <InsightsDialog open={dialog === 'insights' && bookOpen} onClose={() => setDialog(null)} />
      <NotebookDialog open={dialog === 'notebook' && bookOpen} onClose={() => setDialog(null)} />
    </div>
  );
}
