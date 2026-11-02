import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TextSelection } from '@tiptap/pm/state';
import { textOffsetToPos } from '@book/editor/index.js';
import { useBook } from '../book/BookProvider';
import { closureIfLoaded, loadClosure, type Closure } from '../closure/index';
import { useLocale } from '../i18n/LocaleProvider';
import { Dialog, useConfirm } from '../shell/Dialog';
import { Icon } from '../shell/Icon';
import { useToast } from '../shell/Toasts';
import { activeEditor } from '../editor/active';
import { toBook } from '../editor/bridge';
import { desk } from '../environment/page';
import { covEnv, covRun, covUi } from './covenant';
import { installSeriesNet } from './net';
import { covenantDesk } from './marks';
import { drawIcons } from '../insights/insights';

/* 1.0's Covenant room (client/index.html #modalBible: its markup, ids, classes and keys), drawn by 1.0's own renderers
   (bibleRender and the rest, lifted) and wired as 1.0's initBible wires it: native listeners on the same elements,
   each calling 1.0's handler code through covRun (src/covenant/covenant.ts), so an edit reaches the book only when
   1.0's code changed the Covenant. The inputs 1.0 draws are 1.0's; nothing here is controlled by React.

   The room opens from the sidebar's Covenant button, from a mark's card, a margin dot, a Notebook chip and the
   outline's Grid (1.0's openBible(id), covEnv.openBible). It stacks over the Notebook as 1.0's z-index 70 over 69. */

type Open = { id?: string; n: number } | null;
let setOpenNow: ((o: Open) => void) | null = null;
let pendingOpen: Open = null;
let openSeq = 0;
/** 1.0's openBible(id): the room, on that entry when it exists. */
export function openCovenant(id?: string): void {
  const o = { id, n: ++openSeq };
  if (setOpenNow) setOpenNow(o);
  else pendingOpen = o;
}
covEnv.openBible = (id?: string) => openCovenant(id);

/** The room and what 1.0's Covenant does around the whole studio (the card's toast and confirm, a book arriving). */
export function CovenantHost() {
  const [open, setOpen] = useState<Open>(pendingOpen);
  const bk = useBook();
  const toast = useToast();
  const confirm = useConfirm();
  const ydoc = bk.book?.ydoc ?? null;
  const bookOpen = bk.phase === 'open';
  covUi.toast = (msg, icon, action) => toast(msg, (icon ? pascal(icon) : undefined) as never, action);
  covUi.confirm = (o) => confirm(o as never);
  useEffect(() => {
    setOpenNow = setOpen;
    pendingOpen = null;
    return () => {
      setOpenNow = null;
    };
  }, []);
  // 1.0's bibleBookArrived: a whole book arrived (opened, replaced, restored), its Covenant is its own
  useEffect(() => {
    if (!ydoc) return;
    let alive = true;
    void loadClosure()
      .then((c) => {
        if (!alive) return;
        installSeriesNet(c);
        covRun((cc) => cc.api.bibleBookArrived());
        covenantDesk.refresh();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      setOpen(null);
    };
  }, [ydoc]);
  return <CovenantDialog open={!!open && bookOpen} openId={open?.id} openN={open?.n ?? 0} onClose={() => setOpen(null)} />;
}

const pascal = (name: string) => name.replace(/(^|-)([a-z0-9])/g, (_m, _a, ch: string) => ch.toUpperCase());

type Props = { open: boolean; openId?: string; openN: number; onClose: () => void };

export function CovenantDialog({ open, openId, openN, onClose }: Props) {
  const { t } = useLocale();
  return (
    <Dialog open={open} onClose={onClose} id="modalBible" z={70} labelledBy="bibH" className="wide bib-modal">
      <h2 id="bibH">
        <Icon name="BookMarked" />
        {t('bible.title')}
      </h2>
      <p className="m-sub">{t('bible.sub')}</p>
      <div className="bib-bar">
        <button className="tb-btn" id="btnBibNew" type="button">
          <Icon name="Plus" />
          {t('bible.new')}
        </button>
        <button className="tb-btn" id="btnBibSeed" type="button">
          <Icon name="Sparkles" />
          {t('bible.seed')}
        </button>
        <button className="tb-btn" id="btnBibFields" type="button">
          <Icon name="ListPlus" />
          {t('bible.fieldsBtn')}
        </button>
        <span className="bib-bar-gap" />
        <button className="tb-btn" id="btnBibExport" type="button">
          <Icon name="Download" />
          {t('bible.export')}
        </button>
        <button className="tb-btn" id="btnBibImport" type="button">
          <Icon name="Upload" />
          {t('bible.import')}
        </button>
        <input type="file" id="bibFile" accept=".json,application/json" hidden />
      </div>
      <div className="switch-row bib-marks-row">
        <div className="sw-txt">
          <b>{t('bible.marks')}</b>
          <span>{t('bible.marksDesc')}</span>
        </div>
        <button className="switch" id="tglBibMarks" type="button" aria-pressed="true" aria-label={t('bible.marks')} />
      </div>
      <p className="bib-hint" id="bibSeriesLine" hidden />
      <div className="bib-join" id="bibJoin" hidden />
      <p className="bib-status" id="bibStatus" role="status" aria-live="polite" hidden />
      <div className="bib-main" id="bibMain">
        <div className="bib-side">
          <input className="txt-input bib-search" id="bibSearch" type="search" placeholder={t('bible.search')} aria-label={t('bible.search')} />
          <div id="bibList" />
        </div>
        <div className="bib-detail" id="bibDetail" />
      </div>
      <div className="modal-actions">
        <button className="tb-btn" id="btnCloseBible" type="button" onClick={onClose}>
          {t('bible.close')}
        </button>
      </div>
      <CovenantWiring openId={openId} openN={openN} onClose={onClose} />
    </Dialog>
  );
}

const $ = (id: string) => document.getElementById(id);
const closestIn = (e: Event, sel: string) => {
  const el = e.target as Element | null;
  return el && el.closest ? (el.closest(sel) as HTMLElement | null) : null;
};

/** 1.0's bibleJump: the room closes, that section is on the desk, the passage selected and brought into view. */
export function covJump(c: Closure, secId: string, s: number, e: number, close: () => void): void {
  const st = c.getState() as { sections: { id?: unknown }[] };
  const i = st.sections.findIndex((x) => x.id === secId);
  if (i < 0) return;
  close();
  desk.setCenter('content');
  desk.select(i);
  let tries = 0;
  const place = () => {
    const a = activeEditor();
    if (!a || a.editor.isDestroyed || a.section !== i) {
      if (++tries < 30) requestAnimationFrame(place);
      return;
    }
    const ed = a.editor;
    const d = toBook(ed.state.doc);
    const len = ed.state.doc.content.size;
    const from = Math.min(len, textOffsetToPos(d, Math.max(0, s)));
    const to = Math.min(len, Math.max(from, textOffsetToPos(d, Math.max(s, e))));
    ed.view.focus();
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from, to)).scrollIntoView());
    covenantDesk.refresh();
  };
  requestAnimationFrame(place);
}

/** 1.0's openBible and initBible, on the room just drawn. */
function CovenantWiring({ openId, openN, onClose }: { openId?: string; openN: number; onClose: () => void }) {
  const { lang } = useLocale();
  const bk = useBook();
  const ydoc = bk.book?.ydoc ?? null;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    if (!ydoc) return;
    let alive = true;
    const off: (() => void)[] = [];
    const on = (el: EventTarget | null, type: string, fn: (e: Event) => void) => {
      if (!el) return;
      el.addEventListener(type, fn);
      off.push(() => el.removeEventListener(type, fn));
    };
    const wire = (c: Closure) => {
      if (!alive) return;
      installSeriesNet(c);
      const a = c.api;
      const run = <T,>(fn: () => T) => covRun(() => fn());
      // openBible
      run(() => {
        const ui = a.bibleUi;
        covEnv.cardHide();
        if (openId && a.bibleById(openId)) {
          ui.sel = openId;
          ui.mode = 'entry';
          ui.detail = true;
        } else if (!a.bibleById(ui.sel)) {
          const all = a.bibleAllEntries();
          ui.sel = all.length ? all[0]!.id : null;
          ui.detail = false;
        }
        a.bibleStatus('');
        a.bibleShelfScan(); // the other books of the series: the join offer and the series-wide counts
        const sw = $('tglBibMarks');
        if (sw) sw.setAttribute('aria-pressed', String(a.bibleMarksOn()));
        a.bibleRender();
      });
      const box = $('modalBible')?.querySelector('.modal');
      if (box) box.scrollTop = 0;
      // initBible
      on($('btnBibNew'), 'click', () => run(() => a.bibleNewEntry()));
      on($('btnBibSeed'), 'click', () =>
        run(() => {
          a.bibleUi.mode = 'seed';
          a.bibleUi.detail = true;
          a.bibleStatus('');
          a.bibleRender();
        }),
      );
      on($('btnBibFields'), 'click', () =>
        run(() => {
          a.bibleUi.mode = 'fields';
          a.bibleUi.detail = true;
          a.bibleStatus('');
          a.bibleRender();
        }),
      );
      on($('btnBibExport'), 'click', () => run(() => a.bibleExport()));
      on($('btnBibImport'), 'click', () => ($('bibFile') as HTMLInputElement | null)?.click());
      on($('bibFile'), 'change', () => {
        const inp = $('bibFile') as HTMLInputElement;
        const f = inp.files && inp.files[0];
        inp.value = '';
        if (f) covImportFile(f);
      });
      on($('tglBibMarks'), 'click', () => run(() => a.bibleSetMarks(!a.bibleMarksOn())));
      on($('bibSearch'), 'input', (e) =>
        run(() => {
          a.bibleUi.query = (e.target as HTMLInputElement).value || '';
          a.bibleRenderList();
        }),
      );
      on($('bibJoin'), 'click', (e) => {
        const b = closestIn(e, 'button');
        if (!b) return;
        if (b.id === 'btnBibJoin') run(() => a.bibleJoinStart());
        else if (b.id === 'btnBibJoinNo') run(() => a.bibleJoinDismiss());
      });
      on($('bibList'), 'click', (e) => {
        const fb = closestIn(e, '[data-bib-filter]');
        if (fb) {
          run(() => {
            a.bibleUi.filter = fb.getAttribute('data-bib-filter') || 'all';
            a.bibleRenderList();
          });
          return;
        }
        const b = closestIn(e, '[data-bib-id]');
        if (!b) return;
        run(() => {
          a.bibleUi.sel = b.getAttribute('data-bib-id');
          a.bibleUi.mode = 'entry';
          a.bibleUi.detail = true;
          a.bibleRender();
        });
        const back = $('btnBibBack');
        if (back && back.offsetParent !== null) back.focus();
      });
      const det = $('bibDetail');
      on(det, 'input', (e) => {
        const el = e.target as HTMLElement | null;
        if (!el || !el.getAttribute) return;
        run(() => {
          if (el.hasAttribute('data-fact')) a.bibleOnFact(el);
          else if (el.hasAttribute('data-fld-id')) a.bibleRenameField(el.getAttribute('data-fld-type'), el.getAttribute('data-fld-id'), (el as HTMLInputElement).value);
          else if (el.getAttribute('data-f') && el.tagName !== 'SELECT') a.bibleOnField(el);
        });
      });
      // Enter in a small add row presses its Add button (an IME composition's Enter picks the word)
      on(det, 'keydown', (ev) => {
        const e = ev as KeyboardEvent;
        const el = e.target as HTMLElement | null;
        if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || !el || !el.getAttribute || !det) return;
        const btn = el.id === 'bibNewField' ? $('btnBibAddField') : el.id === 'bibLinkLabel' ? $('btnBibAddLink') : el.hasAttribute('data-fld-new') ? det.querySelector<HTMLElement>('[data-fld-add="' + el.getAttribute('data-fld-new') + '"]') : null;
        if (btn) {
          e.preventDefault();
          btn.click();
        }
      });
      on(det, 'change', (e) => {
        const el = e.target as HTMLInputElement | null;
        if (!el || !el.getAttribute) return;
        run(() => {
          // a field name left empty (or the same as another) snaps back to what it is
          if (el.hasAttribute('data-fld-id')) {
            const f = a.bibleFieldDefs(el.getAttribute('data-fld-type') || '').find((x) => x.id === el.getAttribute('data-fld-id'));
            if (f) el.value = f.label;
            return;
          }
          if (el.hasAttribute('data-seed-name')) {
            a.bibleSeedSync();
            return;
          }
          if (el.tagName === 'SELECT' && el.getAttribute('data-f')) a.bibleOnField(el);
        });
      });
      on(det, 'click', (e) => {
        const tg = e.target as HTMLElement | null;
        if (!tg || !tg.closest || !det) return;
        run(() => {
          const ui = a.bibleUi;
          const jump = tg.closest('.bib-jump');
          if (jump) {
            covJump(c, jump.getAttribute('data-sec') || '', Number(jump.getAttribute('data-s')), Number(jump.getAttribute('data-e')), () => closeRef.current());
            return;
          }
          const cell = tg.closest('.bib-cell');
          if (cell) {
            const ent = a.bibleById(ui.sel);
            const p = ent && a.bibleMentions().per[ent.id];
            const h = p && p.hits.find((x) => x.sec === cell.getAttribute('data-sec'));
            if (h) covJump(c, h.sec, h.s, h.e, () => closeRef.current());
            return;
          }
          const go = tg.closest('[data-bib-goto]');
          if (go && a.bibleById(go.getAttribute('data-bib-goto'))) {
            ui.sel = go.getAttribute('data-bib-goto');
            ui.mode = 'entry';
            a.bibleRender();
            return;
          }
          if (tg.closest('#btnBibBack')) {
            ui.detail = false;
            ui.mode = 'entry';
            a.bibleRender();
            return;
          }
          if (tg.closest('#btnBibDelete')) {
            a.bibleDelete(ui.sel);
            return;
          }
          const cdel = tg.closest('[data-bib-chg-del]');
          if (cdel) {
            if (a.bibleRemoveChange(ui.sel, cdel.getAttribute('data-bib-chg-del'))) {
              const s = document.querySelector<HTMLElement>('#bibStory summary') || $('btnBibBack');
              if (s) s.focus();
            }
            return;
          }
          const mg = tg.closest('[data-mg-v]');
          const merge = ui.merge as { asks: { answer?: string; onlyDiff?: boolean }[] } | null;
          if (mg && merge) {
            const ask = merge.asks[Number(mg.getAttribute('data-mg-i'))], v = mg.getAttribute('data-mg-v') || '';
            if (ask && !(ask.onlyDiff && v === 'same')) {
              ask.answer = v;
              a.bibleRenderMerge();
              drawRoomIcons();
            }
            return;
          }
          if (tg.closest('#btnBibMergeSave')) {
            void a.bibleMergeSave();
            return;
          }
          if (tg.closest('#btnBibMergeCancel')) {
            ui.merge = null;
            ui.mode = 'entry';
            ui.detail = false;
            a.bibleRender();
            return;
          }
          if (tg.closest('#tglBibOnly') && a.bibleById(ui.sel)) {
            void a.bibleSetOnlyBook(ui.sel!, a.bibleListOf(ui.sel!) !== a.bibleEntries());
            return;
          }
          const ent = a.bibleById(ui.sel);
          if (tg.closest('#btnBibAddField') && ent) {
            const inp = $('bibNewField') as HTMLInputElement;
            const id = a.bibleAddField(ent.type, inp.value);
            if (id) a.bibleRefreshMore(ent, '[data-fact="' + id + '"]');
            else inp.focus();
            return;
          }
          if (tg.closest('#btnBibAddLink') && ent) {
            if (a.bibleAddLink(ent.id, ($('bibLinkTo') as HTMLSelectElement).value, ($('bibLinkLabel') as HTMLInputElement).value)) {
              a.bibleRefreshCard(ent);
              a.bibleRefreshMore(ent, '#bibLinkTo');
            } else $('bibLinkLabel')?.focus();
            return;
          }
          const unl = tg.closest('[data-bib-unlink]');
          if (unl && ent) {
            if (a.bibleRemoveLink(ent.id, Number(unl.getAttribute('data-bib-unlink')))) {
              a.bibleRefreshCard(ent);
              a.bibleRefreshMore(ent, '#bibLinkTo');
            }
            return;
          }
          const tpl = tg.closest('[data-bib-tpl]');
          if (tpl) {
            a.bibleApplyTemplate(tpl.getAttribute('data-bib-tpl'));
            return;
          }
          const fadd = tg.closest('[data-fld-add]');
          if (fadd) {
            const ty = fadd.getAttribute('data-fld-add') || '';
            const inp = det.querySelector<HTMLInputElement>('[data-fld-new="' + ty + '"]');
            if (a.bibleAddField(ty, inp ? inp.value : '')) {
              a.bibleRenderFields();
              drawRoomIcons();
              det.querySelector<HTMLElement>('[data-fld-new="' + ty + '"]')?.focus();
            } else if (inp) inp.focus();
            return;
          }
          const fdel = tg.closest('[data-fld-del]');
          if (fdel) {
            if (a.bibleRemoveFieldUndoable(fdel.getAttribute('data-fld-type'), fdel.getAttribute('data-fld-del'))) {
              a.bibleRenderFields();
              drawRoomIcons();
            }
            return;
          }
          if (tg.closest('#tglBibExact')) {
            if (!ent) return;
            ent.exactCase = !ent.exactCase;
            $('tglBibExact')?.setAttribute('aria-pressed', String(ent.exactCase));
            a.bibleTouched(true);
            return;
          }
          if (tg.closest('#btnBibSeedCancel')) {
            ui.mode = 'entry';
            ui.detail = false;
            a.bibleRender();
            return;
          }
          if (tg.closest('#btnBibSeedAdd')) a.bibleSeedAdd();
        });
      });
    };
    const now = closureIfLoaded();
    if (now) wire(now);
    else void loadClosure().then(wire).catch(() => undefined);
    return () => {
      alive = false;
      off.forEach((f) => f());
      // 1.0's bibleClose (its olOnStructure is the Outline's own re-render from the book); the desk redraws its marks
      covenantDesk.refresh();
    };
    // a new open (another entry asked for) wires the room afresh
  }, [ydoc, openN]); // eslint-disable-line react-hooks/exhaustive-deps

  // 1.0's bibleOnLangChange: the room in the new language
  const first = useRef(lang);
  useEffect(() => {
    if (first.current === lang) return;
    first.current = lang;
    covRun((c) => c.api.bibleOnLangChange());
  }, [lang]);
  return null;
}

/** 1.0's icons() after a partial redraw of the room. */
function drawRoomIcons(): void {
  drawIcons(document);
}

/** 1.0's bibleImportFile: the file read as text, then 1.0's bibleImportDoc, its save, the room and the report. */
export function covImportFile(file: Blob): Promise<void> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      covRun((c) => {
        const a = c.api;
        let doc: unknown = null;
        try {
          doc = JSON.parse(String(reader.result || ''));
        } catch {
          doc = null;
        }
        const r = a.bibleImportDoc(doc);
        if (r.ok && (r.added.length || r.pics)) {
          if (r.added.length) {
            a.bibleUi.sel = r.added[0]!.id;
            a.bibleUi.mode = 'entry';
          }
          a.bibleTouched(false);
        }
        a.bibleRender();
        a.bibleStatus(a.bibleImportReport(r));
      });
      resolve();
    };
    reader.onerror = () => {
      covRun((c) => c.api.bibleStatus(c.api.bibleImportReport({ ok: false })));
      resolve();
    };
    reader.readAsText(file);
  });
}
