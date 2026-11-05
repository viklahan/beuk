import { useEffect, useState } from 'react';
import { useBook } from '../book/BookProvider';
import { Desk } from '../book/Desk';
import { Outline } from '../book/Outline';
import { SideStatus } from '../book/SideStatus';
import { useChapterOps } from '../chapters/ChapterOps';
import { useStructure } from '../structure/StructureUi';
import { OutlineBoard } from '../outline/OutlineBoard';
import { indexOfId } from '../structure/structure';
import { SampleBar } from '../sample/SampleBar';
import { HistoryDialog } from '../history/HistoryDialog';
import { InsightsDialog } from '../insights/InsightsDialog';
import { NotebookDialog } from '../notebook/NotebookDialog';
import { GoalsDialog } from '../goals/GoalsDialog';
import { CovenantHost, openCovenant } from '../covenant/CovenantDialog';
import { EnvironmentHost } from '../environment/EnvironmentHost';
import { cloudLoadStreak } from '../goals/goals';
import { probeCloud } from '../pictures/stock';
import { SettingsDialog } from '../settings/SettingsDialog';
import { useLocale } from '../i18n/LocaleProvider';
import { syncClosureLocale } from '../closure/index';
import { TourHost } from '../tour/TourHost';
import { StyleTab } from '../style/StyleTab';
import { PreviewPane } from '../preview/PreviewPane';
import { CoverMaker } from '../cover/CoverMaker';
import { EXPORT_BUILT_EVENT, ExportModal, exportBuilt, exportOpen } from '../export/ExportModal';
import { PrintModals } from '../print/PrintModals';
import { IMPORT_BUILT_EVENT, IMPORT_SLOT, ImportHost, importBuilt } from '../import/ImportHost';
import { exportEnv } from '../closure/index';
import { Icon } from './Icon';
import { LocalPill } from '../book/LocalPill';
import { CLOUD_SLOTS, CloudHost, CloudSlot } from '../cloud/CloudHost';
import { LangMenu } from './LangMenu';
import { ThemeButton } from './ThemeButton';

/* The studio's frame, with 1.0's structure and ids (client/index.html
   <div id="app">): the top bar, the phone tab row, and the three panes —
   the outline (left), the writing page (centre) and the reader (right).
   Part C: the outline lists the open book's sections, the centre is the
   desk (an empty desk opens a backup; an open book edits the chosen
   chapter); wave 5a: Export opens 1.0's export modal, and the backup file is in 1.0's
   local pill (src/book/LocalPill.tsx). The reader
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
  const [mobile, setMobile] = useState<MobilePane>('structure');
  // wave 3a: 1.0's cloudAfterSignIn → cloudLoadStreak — with a shelf and a writer signed in, the server's streak
  useEffect(() => {
    void probeCloud()
      .then(() => cloudLoadStreak())
      .catch(() => undefined);
  }, []);
  const [dialog, setDialog] = useState<'history' | 'settings' | 'insights' | 'notebook' | 'goals' | null>(null);
  const bookOpen = bk.phase === 'open';
  const ops = useChapterOps({ openHistory: () => setDialog('history') });
  const structure = useStructure();
  // 1.0's centre tabs: the chapter content, the Typography Studio (wave 4a) and the outline board
  const [center, setCenter] = useState<'content' | 'outline' | 'type'>('content');
  const showOutline = center === 'outline' && bookOpen;
  const showType = center === 'type' && bookOpen;
  const showContent = !showOutline && !showType;
  /** 1.0's olOpen: the desk, that section, the caret in its page. */
  const openOnDesk = (id: string) => {
    const y = bk.book?.ydoc;
    if (!y) return;
    const i = indexOfId(y, id);
    if (i === null) return;
    setCenter('content');
    bk.select(i);
    requestAnimationFrame(() => {
      const host = document.getElementById('manuscript') as (HTMLElement & { beukEditor?: { commands: { focus: () => unknown } } }) | null;
      host?.beukEditor?.commands.focus();
    });
  };
  const [mstyle, setMstyle] = useState(false);
  const tab = (pane: MobilePane, style: boolean) => () => {
    // 1.0: a centre tab on a phone is the Write or the Style tab (currentCenterTab "content" / "type")
    if (pane === 'center') setCenter(style ? 'type' : 'content');
    setMobile(pane);
    setMstyle(style);
  };
  const active = (pane: MobilePane, style: boolean) => (mobile === pane && mstyle === style ? 'active' : undefined);
  // wave 5a: 1.0's export modal opens once its markup is wired (src/export/ExportModal.tsx); 1.0's export code reaches
  // Project Settings (the audit's "Open Project Settings") and the phone's pane switch ("Take me there")
  const [exportReady, setExportReady] = useState(exportBuilt());
  useEffect(() => {
    const on = () => setExportReady(exportBuilt());
    window.addEventListener(EXPORT_BUILT_EVENT, on);
    on();
    return () => window.removeEventListener(EXPORT_BUILT_EVENT, on);
  }, []);
  const canExport = bookOpen && exportReady;
  // wave 6: 1.0's Import button works once 1.0's initImport has wired it (src/import/ImportHost.tsx)
  const [importReady, setImportReady] = useState(importBuilt());
  useEffect(() => {
    const on = () => setImportReady(importBuilt());
    window.addEventListener(IMPORT_BUILT_EVENT, on);
    on();
    return () => window.removeEventListener(IMPORT_BUILT_EVENT, on);
  }, []);
  exportEnv.openSettings = () => setDialog('settings');
  exportEnv.setMobilePane = (pane) => {
    if (pane === 'structure' || pane === 'center' || pane === 'preview') {
      setMobile(pane);
      setMstyle(false);
    }
  };

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
        {/* wave 7a: 1.0's offline pill, before the local pill; its account button, after the language menu (src/cloud/CloudHost.tsx) */}
        <CloudSlot id={CLOUD_SLOTS.net} />
        <LocalPill />
        <LangMenu />
        <CloudSlot id={CLOUD_SLOTS.account} />
        <ThemeButton />
        <button type="button" className="tb-btn" id="btnHomeport" data-tip="tips.homeport" aria-label={t('top.homeportAria')} onClick={() => openTab('/?home')}>
          <Icon name="Anchor" />
          <span className="tb-label lbl-collapse">{t('top.homeport')}</span>
        </button>
        <button type="button" className="tb-btn" id="btnHelp" data-tip="tips.help" aria-label={t('top.helpAria')} onClick={() => openTab('/help/')}>
          <Icon name="LifeBuoy" />
          <span className="tb-label lbl-collapse">{t('top.help')}</span>
        </button>
        {/* wave 5a, round 2: 1.0's #btnExport opens the export modal (its aria-label is 1.0's own English, with no key);
            the backup is in the local pill (src/book/LocalPill.tsx), where 1.0 keeps it */}
        <button
          type="button"
          className="tb-btn primary"
          id="btnExport"
          data-tip="tips.export"
          aria-label="Export book"
          aria-disabled={canExport ? undefined : 'true'}
          onClick={canExport ? () => exportOpen() : undefined}
        >
          <Icon name="Download" />
          <span className="tb-label">{t('top.export')}</span>
        </button>
      </header>
      {/* wave 7b: 1.0's update bar ("A new Beuk is ready"), under the header (src/cloud/CloudHost.tsx) */}
      <CloudSlot id={CLOUD_SLOTS.update} />


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
            {/* wave 6: 1.0's Import Document (#btnImport), wired by 1.0's own initImport (src/import/ImportHost.tsx): it opens
                1.0's #fileInput */}
            <button type="button" className="side-btn" id="btnImport" aria-disabled={importReady ? undefined : 'true'} title={t('side.importTitle')}>
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
          {/* wave 6: 1.0's "Recognised in your manuscript" summary and the import report's reopen button, under the Import
              button as in 1.0 (their markup is 1.0's, put in place by ImportHost) */}
          {/* wave 7b: 1.0's bulk import hint, right under the side actions (src/cloud/CloudHost.tsx; 1.0's renderBulkChrome shows it) */}
          <CloudSlot id={CLOUD_SLOTS.bulkHint} />
          <div id={IMPORT_SLOT} style={{ display: 'contents' }} />
          {bk.phase !== 'starting' && <SampleBar openHistory={() => setDialog('history')} />}
          {structure.matterLib}
          <div id="structureScroll">
            <Outline tools={ops.tools} structure={structure} />
          </div>
          {/* BEUK:sidebar — 1.0's book tools row: History (wave 1a), Insights and Notes (wave 1c); Goals (wave 3a); the Covenant (wave 3b) */}
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
              <button
                className="side-tool"
                id="btnGoals"
                data-tip="tips.goals"
                type="button"
                aria-label={t('goals.open')}
                aria-disabled={bookOpen ? undefined : 'true'}
                onClick={bookOpen ? () => setDialog('goals') : undefined}
              >
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
              <button
                className="side-tool"
                id="btnBible"
                data-tip="tips.bible"
                type="button"
                aria-label={t('bible.open')}
                aria-disabled={bookOpen ? undefined : 'true'}
                onClick={bookOpen ? () => openCovenant() : undefined}
              >
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
            {/* wave 7a: the shelf line (#syncRow), 1.0's own */}
            <CloudSlot id={CLOUD_SLOTS.sync} />
            {bookOpen && <SideStatus />}
          </div>
        </aside>

        <section id="pane-center" className="pane">
          <div className="center-tabs" role="tablist">
            <button type="button" className={'ctab' + (showContent ? ' active' : '')} id="tabBtnContent" role="tab" aria-selected={showContent ? 'true' : 'false'} onClick={() => setCenter('content')}>
              <Icon name="PenLine" />
              {t('tab.content')}
            </button>
            <button
              type="button"
              className={'ctab' + (showType ? ' active' : '')}
              id="tabBtnType"
              role="tab"
              aria-selected={showType ? 'true' : 'false'}
              aria-disabled={bookOpen ? undefined : 'true'}
              onClick={bookOpen ? () => setCenter('type') : undefined}
            >
              <Icon name="Type" />
              {t('tab.type')}
            </button>
            <button
              type="button"
              className={'ctab' + (showOutline ? ' active' : '')}
              id="tabBtnOutline"
              role="tab"
              aria-selected={showOutline ? 'true' : 'false'}
              aria-disabled={bookOpen ? undefined : 'true'}
              onClick={bookOpen ? () => setCenter('outline') : undefined}
            >
              <Icon name="LayoutGrid" />
              {t('ol.tab')}
            </button>
          </div>
          <div className="center-body" role="tabpanel">
            <div id="panelContent" className="center-inner" style={showContent ? undefined : { display: 'none' }}>
              <Desk />
            </div>
            {bookOpen ? <StyleTab key={bk.book!.id + ':' + bk.book!.epoch} shown={showType} /> : <div id="panelType" className="center-inner" style={{ display: 'none' }} />}
            <div id="panelOutline" className="center-inner ol-inner" style={showOutline ? undefined : { display: 'none' }}>
              <OutlineBoard shown={showOutline} onOpen={openOnDesk} />
            </div>
          </div>
        </section>

        <section id="pane-preview" className="pane" aria-label={t('tabs.preview')}>
          <PreviewPane mobile={mobile} />
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
      <GoalsDialog open={dialog === 'goals' && bookOpen} onClose={() => setDialog(null)} />
      <EnvironmentHost setCenter={setCenter} />
      <CovenantHost />
      {bookOpen ? <CoverMaker key={bk.book!.id + ':' + bk.book!.epoch} /> : null}
      {bookOpen ? <ExportModal key={'export:' + bk.book!.id + ':' + bk.book!.epoch} /> : null}
      {/* wave 5b: 1.0's print view and Print Interior View, in place before the preview starts (its full screen wires them) */}
      <PrintModals />
      {/* wave 6: 1.0's import and its report, outside the book's generations (an import opens a new one) */}
      <ImportHost />
      {/* wave 7a: 1.0's shelf, sign-in and account (src/cloud/CloudHost.tsx) */}
      <CloudHost />
    </div>
  );
}
