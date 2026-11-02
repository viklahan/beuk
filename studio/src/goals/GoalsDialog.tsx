import { useEffect, useLayoutEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { useBook } from '../book/BookProvider';
import { closureIfLoaded, loadClosure, structEnv, writeEnv, type Closure } from '../closure/index';
import { useLocale } from '../i18n/LocaleProvider';
import { Dialog, useConfirm } from '../shell/Dialog';
import { Icon } from '../shell/Icon';
import { useToast } from '../shell/Toasts';
import { goalsRun } from './goals';

/* 1.0's Goals room (client/index.html #modalGoals: its markup, ids, classes and keys), drawn by 1.0's own renderers
   (goalsRenderRoom, renderGoalsProgress, renderGoalKept, renderGoalRoad, renderGoalCalendar, syncGoalInputs) and wired
   as 1.0's initGoals / initGoalRoad wire it: native listeners on the same elements, each calling 1.0's handler code
   through goalsRun (src/goals/goals.ts), so an edit reaches the book only when 1.0 itself saves. The inputs are
   uncontrolled: 1.0 sets their values. */

type Props = { open: boolean; onClose: () => void };

export function GoalsDialog({ open, onClose }: Props) {
  const { t } = useLocale();
  return (
    <Dialog open={open} onClose={onClose} id="modalGoals" z={70} labelledBy="goalsH" className="wide ins-modal">
      <h2 id="goalsH">
        <Icon name="Target" />
        {t('goals.title')}
      </h2>
      <p className="m-sub">{t('goals.sub')}</p>
      <p className="goal-jw-note" id="goalJwNote" hidden>
        {t('goals.justWriteOn')}
      </p>
      <div id="goalsProgress" />
      <section className="ins-sec" id="goalKeptSec">
        <h3 className="ins-h">{t('goals.keptH')}</h3>
        <p className="ins-sub">{t('goals.keptSub')}</p>
        <div id="goalKept" />
      </section>
      <section className="ins-sec" id="goalRoadSec" hidden>
        <h3 className="ins-h">{t('goals.roadH')}</h3>
        <p className="ins-sub">{t('goals.roadSub')}</p>
        <div id="goalRoad" />
      </section>
      <section className="ins-sec" id="goalCalSec">
        <h3 className="ins-h">{t('goals.calH')}</h3>
        <p className="ins-sub">{t('goals.calSub')}</p>
        <div id="goalCal" />
      </section>
      <section className="ins-sec">
        <h3 className="ins-h">{t('goals.setH')}</h3>
        <p className="ins-sub">{t('goals.setSub')}</p>
        <div className="goal-form">
          <div className="goal-field">
            <div className="goal-field-txt">
              <b>{t('goals.daily')}</b>
              <span id="goalDailyHint">{t('goals.dailyHint')}</span>
            </div>
            <input className="txt-input goal-num" id="goalDailyInput" type="number" min="0" step="50" inputMode="numeric" placeholder={t('goals.wordsPh')} aria-label={t('goals.daily')} />
            <button type="button" className="linkish" data-gclear="daily">
              {t('goals.clear')}
            </button>
          </div>
          <div className="goal-field">
            <div className="goal-field-txt">
              <b>{t('goals.project')}</b>
              <span>{t('goals.projectHint')}</span>
            </div>
            <input className="txt-input goal-num" id="goalProjectInput" type="number" min="0" step="500" inputMode="numeric" placeholder={t('goals.wordsPh')} aria-label={t('goals.project')} />
            <button type="button" className="linkish" data-gclear="project">
              {t('goals.clear')}
            </button>
          </div>
          <div className="goal-field">
            <div className="goal-field-txt">
              <b>{t('goals.deadline')}</b>
              <span>{t('goals.deadlineHint')}</span>
            </div>
            <input className="txt-input goal-date" id="goalDeadlineInput" type="date" aria-label={t('goals.deadline')} />
            <button type="button" className="linkish" data-gclear="deadline">
              {t('goals.clear')}
            </button>
          </div>
          <div className="goal-field goal-days-field">
            <div className="goal-field-txt">
              <b id="goalDaysLab">{t('goals.days')}</b>
              <span>{t('goals.daysHint')}</span>
            </div>
            <div className="goal-days" id="goalDays" role="group" aria-labelledby="goalDaysLab" />
          </div>
          <div className="switch-row goal-switch">
            <div className="sw-txt">
              <b>{t('goals.dlDay')}</b>
              <span>{t('goals.dlDayHint')}</span>
            </div>
            <button className="switch" id="tglGoalDlDay" type="button" aria-pressed="false" aria-label={t('goals.dlDay')} />
          </div>
          <div className="switch-row goal-switch">
            <div className="sw-txt">
              <b>{t('goals.auto')}</b>
              <span id="goalAutoHint">{t('goals.autoHint')}</span>
            </div>
            <button className="switch" id="tglGoalAuto" type="button" aria-pressed="false" aria-label={t('goals.auto')} />
          </div>
        </div>
      </section>
      <section className="ins-sec">
        <h3 className="ins-h">{t('goals.trackH')}</h3>
        <div className="switch-row goal-switch">
          <div className="sw-txt">
            <b>{t('goals.justWrite')}</b>
            <span>{t('goals.justWriteHint')}</span>
          </div>
          <button className="switch" id="tglGoalJustWrite" type="button" aria-pressed="false" aria-label={t('goals.justWrite')} />
        </div>
        <div className="switch-row goal-switch">
          <div className="sw-txt">
            <b>{t('goals.clearData')}</b>
            <span>{t('goals.clearDataHint')}</span>
          </div>
          <button className="tb-btn" id="btnGoalClearData" type="button">
            {t('goals.clearDataBtn')}
          </button>
        </div>
      </section>
      <div className="modal-actions">
        <button className="tb-btn" id="btnCloseGoals" type="button" onClick={onClose}>
          {t('goals.close')}
        </button>
      </div>
      <GoalsWiring />
    </Dialog>
  );
}

const $ = (id: string) => document.getElementById(id);
const closestIn = (e: Event, sel: string) => {
  const el = e.target as Element | null;
  return el && el.closest ? (el.closest(sel) as HTMLElement | null) : null;
};

/** 1.0's openGoals and initGoals / initGoalRoad, on the room just drawn. */
function GoalsWiring() {
  const { lang } = useLocale();
  const bk = useBook();
  const ydoc = bk.book?.ydoc ?? null;
  const confirm = useConfirm();
  const toast = useToast();
  const live = useRef({ confirm, toast });
  live.current = { confirm, toast };

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
      const y: Y.Doc = ydoc;
      const run = <T,>(fn: () => T): T => goalsRun(c, y, fn);
      // 1.0's calm confirm and toast for Clear tracking data
      writeEnv.confirm = (o) => live.current.confirm(o as never);
      const a = c.api;
      // openGoals
      c.vars.goalCalCursor = null;
      run(() => {
        a.goalEnsureStart();
        a.syncGoalInputs();
        a.renderGoalCalendar();
        a.goalsRenderRoom();
      });
      const box = $('modalGoals')?.querySelector('.modal');
      if (box) box.scrollTop = 0;
      // initGoals
      ['goalDailyInput', 'goalProjectInput', 'goalDeadlineInput'].forEach((id) => on($(id), 'change', () => run(() => a.commitGoals())));
      on(document.querySelector('#modalGoals .goal-form'), 'click', (e) => {
        const b = closestIn(e, '[data-gclear]');
        if (!b) return;
        const which = b.getAttribute('data-gclear');
        const el = $(which === 'daily' ? 'goalDailyInput' : which === 'project' ? 'goalProjectInput' : 'goalDeadlineInput') as HTMLInputElement | null;
        if (el) {
          el.value = '';
          run(() => a.commitGoals());
        }
      });
      const daysWrap = $('goalDays');
      on(daysWrap, 'click', (e) => {
        const b = closestIn(e, '[data-gday]');
        if (!b || !daysWrap) return;
        const dow = parseInt(b.getAttribute('data-gday') || '', 10);
        run(() => {
          const days = a.goalDays(a.normalizeGoals(c.getState().goals)).slice();
          days[dow] = days[dow] ? 0 : 1;
          if (!days.some(Boolean)) return; // at least one writing day stays
          a.goalsApply({ days });
        });
        (daysWrap.querySelector('[data-gday="' + dow + '"]') as HTMLElement | null)?.focus();
      });
      on($('tglGoalDlDay'), 'click', () => run(() => a.goalsApply({ dlDay: !a.normalizeGoals(c.getState().goals).dlDay })));
      on($('tglGoalAuto'), 'click', () =>
        run(() => {
          const g = a.normalizeGoals(c.getState().goals);
          if (!g.project || !g.deadline) return;
          a.goalsApply({ auto: !g.auto });
        }),
      );
      on($('tglGoalJustWrite'), 'click', () => run(() => a.goalSetJustWrite(!a.goalJustWrite())));
      on($('btnGoalClearData'), 'click', () => {
        // 1.0's goalAskClearTracking: its calm confirm, then its toast (goals.cleared, the target icon)
        const keep = structEnv.toast;
        structEnv.toast = (msg) => live.current.toast(msg, 'Target');
        void Promise.resolve(run(() => a.goalAskClearTracking())).finally(() => {
          structEnv.toast = keep;
        });
      });
      const kept = $('goalKept');
      on(kept, 'click', (e) => {
        const b = closestIn(e, '[data-kperiod]');
        if (!b || !kept) return;
        c.vars.goalKeptPeriod = b.getAttribute('data-kperiod') || 'today';
        run(() => a.renderGoalKept());
        (kept.querySelector('[data-kperiod="' + c.vars.goalKeptPeriod + '"]') as HTMLElement | null)?.focus();
      });
      const cal = $('goalCal');
      on(cal, 'click', (e) => {
        const b = closestIn(e, '[data-calnav]');
        if (!b) return;
        const step = parseInt(b.getAttribute('data-calnav') || '', 10) || 0;
        let cur = c.vars.goalCalCursor;
        if (!cur) {
          const n = new Date();
          cur = new Date(n.getFullYear(), n.getMonth(), 1);
        }
        c.vars.goalCalCursor = new Date(cur.getFullYear(), cur.getMonth() + step, 1);
        run(() => a.renderGoalCalendar());
      });
      // initGoalRoad
      const host = $('goalRoad');
      if (host) {
        const rs = () => c.vars.roadState as { model: { points: unknown[] } | null; idx: number; width: number };
        const nearest = (e: Event) => {
          if (closestIn(e, '.road-wrap')) {
            const i = a.roadNearest((e as PointerEvent).clientX);
            if (i >= 0) a.roadShow(i, false);
          }
        };
        on(host, 'pointermove', nearest);
        on(host, 'pointerdown', nearest);
        on(host, 'pointerleave', () => {
          const w = host.querySelector('.road-wrap');
          if (!w || document.activeElement !== w) a.roadHide();
        });
        on(host, 'focusin', (e) => {
          const el = e.target as HTMLElement;
          const s = rs();
          if (el.classList && el.classList.contains('road-wrap') && s.model) a.roadShow(s.idx >= 0 ? s.idx : s.model.points.length - 1, true);
        });
        on(host, 'focusout', (e) => {
          const el = e.target as HTMLElement;
          if (el.classList && el.classList.contains('road-wrap')) a.roadHide();
        });
        on(host, 'keydown', (ev) => {
          const e = ev as KeyboardEvent;
          const el = e.target as HTMLElement;
          const s = rs();
          if (!el.classList || !el.classList.contains('road-wrap') || !s.model) return;
          const n = s.model.points.length;
          let i = s.idx >= 0 ? s.idx : n - 1;
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') i = Math.max(0, i - 1);
          else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') i = Math.min(n - 1, i + 1);
          else if (e.key === 'Home') i = 0;
          else if (e.key === 'End') i = n - 1;
          else if (e.key === 'Escape') {
            if (s.idx >= 0) {
              e.preventDefault();
              e.stopPropagation();
              a.roadHide();
            }
            return;
          } else return;
          e.preventDefault();
          a.roadShow(i, true);
        });
        if (typeof ResizeObserver === 'function') {
          const ro = new ResizeObserver(() => {
            const s = rs();
            if (!s.model) return;
            const w = host.clientWidth;
            if (w && Math.abs(w - s.width) > 4) run(() => a.renderGoalRoad());
          });
          ro.observe(host);
          off.push(() => ro.disconnect());
        }
      }
    };
    const now = closureIfLoaded();
    if (now) wire(now);
    else void loadClosure().then(wire).catch(() => undefined);
    return () => {
      alive = false;
      off.forEach((f) => f());
    };
  }, [ydoc]);

  // 1.0's goalsOnLangChange (the room half; renderGoalLines is the sidebar's)
  const first = useRef(lang);
  useEffect(() => {
    if (first.current === lang) return;
    first.current = lang;
    const c = closureIfLoaded();
    if (!c || !ydoc) return;
    goalsRun(c, ydoc, () => {
      c.api.syncGoalInputs();
      c.api.goalsRenderRoom();
      c.api.renderGoalCalendar();
    });
  }, [lang, ydoc]);
  return null;
}
