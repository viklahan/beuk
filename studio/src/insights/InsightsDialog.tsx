import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useBook } from '../book/BookProvider';
import { loadClosure, type Closure, type CastRow, type CastData, type InsightsData } from '../closure/index';
import { useLocale } from '../i18n/LocaleProvider';
import { Dialog } from '../shell/Dialog';
import { Icon } from '../shell/Icon';
import { castHide, castSection, castUnhide, chartWidth, drawIcons, insightsState, selectNameIn } from './insights';

/* 1.0's Story Insights room (client/index.html #modalInsights,
   renderInsights / initInsights, and Names on stage's castBindOnce),
   inventory C4 + C5. The room's content is 1.0's own HTML from the closure
   (insights.ts); this component is 1.0's frame and its event layer, ported:

   - one tooltip (#insTip, appended to <body> as 1.0's insTipEl), values
     first: a mark's data-tip lines, or its chapter's facts (1.0's
     insFactValues) led by the chart's own measure (data-lead); hover, focus,
     and the scroll that moves the marks; Escape first puts the tooltip away
     (WCAG 1.4.13) and only a second Escape closes the room;
   - roving focus through a chart's marks (insRovingKey: arrows, mirrored for
     the horizontal keys in a right-to-left interface, Home/End, Enter/Space
     opens the chapter); the heatmap's cells (castBindOnce: arrows in both
     directions, Home/End along the row);
   - a click on anything carrying data-sec closes the room and opens that
     chapter (insJump); a heatmap cell opens its section and selects the
     name there (castJump);
   - the variety picker (insVarSel → insVarPick, the histogram redrawn);
   - Refresh, and a redraw when the room's width changes by more than 24 px
     (1.0's resize handler, 160 ms);
   - hiding / showing a name (written to meta.castHidden), focus moved as
     1.0 moves it.
   Everything it adds to the page (listeners on window and the tooltip) goes
   when the room closes. */

type Props = { open: boolean; onClose: () => void };

export function InsightsDialog({ open, onClose }: Props) {
  const { t } = useLocale();
  return (
    <Dialog open={open} onClose={onClose} id="modalInsights" z={70} labelledBy="insH" className="wide ins-modal">
      <h2 id="insH">
        <Icon name="Activity" />
        {t('insights.title')}
      </h2>
      <p className="m-sub">{t('insights.local')}</p>
      <InsightsBody onClose={onClose} />
    </Dialog>
  );
}

const cssEscape = (s: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));

function InsightsBody({ onClose }: { onClose: () => void }) {
  const { t, lang } = useLocale();
  const bk = useBook();
  const body = useRef<HTMLDivElement>(null);
  const [c, setC] = useState<Closure | null>(null);
  const ydoc = bk.book?.ydoc ?? null;
  const tt = t as (k: string, p?: Record<string, unknown>) => string;
  const live = useRef({ bk, t: tt, lang, onClose });
  live.current = { bk, t: tt, lang, onClose };
  const cast = useRef<{ rows: CastRow[]; data: CastData | null; openHidden: boolean }>({ rows: [], data: null, openHidden: false });
  const facts = useRef<InsightsData['facts']>({});

  useEffect(() => {
    let alive = true;
    void loadClosure().then((cl) => alive && setC(cl)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  /* ---- the tooltip (1.0's insTipEl / insTipHide / insTipShow) ---- */
  const tipEl = useCallback((): HTMLDivElement => {
    let el = document.getElementById('insTip') as HTMLDivElement | null;
    if (!el) {
      el = document.createElement('div');
      el.id = 'insTip';
      el.className = 'ins-tip';
      el.setAttribute('role', 'tooltip');
      el.hidden = true;
      document.body.appendChild(el);
    }
    return el;
  }, []);
  const tipHide = useCallback(() => {
    const el = document.getElementById('insTip');
    if (el) el.hidden = true;
    body.current?.querySelectorAll('.is-hot').forEach((n) => n.classList.remove('is-hot'));
  }, []);
  const tipShow = useCallback(
    (mark: Element) => {
      if (!c) return;
      const el = tipEl();
      el.textContent = '';
      const sec = mark.getAttribute('data-sec');
      const tip = mark.getAttribute('data-tip');
      const add = (cls: string, txt: string) => {
        const s = document.createElement('span');
        s.className = cls;
        s.textContent = txt;
        el.appendChild(s);
      };
      const f = sec ? facts.current[sec] : undefined;
      if (tip) {
        const lines = tip.split('\n');
        add('ins-tip-v', lines[0]!);
        lines.slice(1).forEach((l, i) => add(i === 0 ? 'ins-tip-n' : 'ins-tip-m', l));
      } else if (sec && f) {
        const v = c.api.insFactValues(f);
        const lead = (mark.getAttribute('data-lead') || 'words') as keyof typeof v;
        add('ins-tip-v', v[lead] || v.words);
        add('ins-tip-n', f.name);
        (['words', 'avg', 'dlg', 'ease'] as const).filter((k) => k !== lead && v[k]).forEach((k) => add('ins-tip-m', v[k]!));
      } else return;
      if (sec) add('ins-tip-h', live.current.t('insights.tipOpen'));
      const b = body.current;
      if (b) {
        b.querySelectorAll('.is-hot').forEach((n) => n.classList.remove('is-hot'));
        if (sec)
          b.querySelectorAll('[data-sec="' + cssEscape(sec) + '"]').forEach((n) => {
            if (!n.classList.contains('ins-echo') && !n.classList.contains('ins-chip')) n.classList.add('is-hot');
          });
        mark.classList.add('is-hot');
      }
      el.hidden = false;
      const anchor = mark.querySelector('.ins-bar, .ins-dot') || mark;
      const r = anchor.getBoundingClientRect();
      const tw = el.offsetWidth, th = el.offsetHeight;
      let left = r.left + r.width / 2 - tw / 2;
      left = Math.max(8, Math.min(window.innerWidth - tw - 8, left));
      let top = r.top - th - 10;
      if (top < 8) top = r.bottom + 10;
      el.style.setProperty('left', Math.round(left) + 'px');
      el.style.setProperty('top', Math.round(top) + 'px');
    },
    [c, tipEl],
  );

  /* ---- drawing (1.0's renderInsights, with Names on stage spliced in last as 1.0's INS_RENDERERS.push) ---- */
  const render = useCallback(() => {
    const b = body.current;
    const L = live.current;
    const y = L.bk.book?.ydoc;
    if (!b || !c || !y) return;
    tipHide();
    const state = insightsState(c, y);
    const d = c.api.computeInsights();
    if (!d.totalWords) {
      facts.current = {};
      b.innerHTML = '<p class="ins-empty">' + c.api.esc(L.t('insights.empty')) + '</p>';
      return;
    }
    const W = chartWidth(b);
    let html = c.api.insBuildHtml(d, { W });
    facts.current = c.vars.insFacts;
    const cs = castSection(c, state, L.t, L.lang, cast.current.openHidden);
    cast.current.rows = cs.rows;
    cast.current.data = cs.data;
    html += cs.html;
    b.innerHTML = html; // 1.0's own markup, every book string escaped by 1.0's esc (insights.ts)
    drawIcons(b);
    b.setAttribute('data-w', String(W));
  }, [c, tipHide]);

  /** 1.0's castRerender: only the Names on stage section, then the focus 1.0 moves. */
  const castRerender = useCallback(
    (focus: (b: HTMLElement) => HTMLElement | null) => {
      const b = body.current;
      const L = live.current;
      const y = L.bk.book?.ydoc;
      if (!b || !c || !y) return;
      const old = b.querySelector('.cast-sec');
      if (!old) return;
      const state = insightsState(c, y);
      const cs = castSection(c, state, L.t, L.lang, true);
      cast.current.rows = cs.rows;
      cast.current.data = cs.data;
      const tpl = document.createElement('template');
      tpl.innerHTML = cs.html; // 1.0's castInsightsSection markup (escaped)
      drawIcons(tpl.content);
      old.replaceWith(tpl.content);
      focus(b)?.focus();
    },
    [c],
  );

  // first draw once the room is open (1.0 opens first, so the charts are drawn at the width they will have)
  useLayoutEffect(() => {
    if (!c || !ydoc) return;
    cast.current.openHidden = false; // a fresh Insights opens with the hidden list folded
    render();
    const box = body.current?.closest('.modal');
    if (box) box.scrollTop = 0;
  }, [c, ydoc, render]);

  // the interface language changed: 1.0's insOnLangChange
  const firstLang = useRef(lang);
  useEffect(() => {
    if (firstLang.current === lang) return;
    firstLang.current = lang;
    render();
  }, [lang, render]);

  /* ---- 1.0's event layer (a layout effect: it is in place in the same commit as the first drawing) ---- */
  useLayoutEffect(() => {
    const b = body.current;
    if (!b || !c) return;
    const jump = (id: string) => {
      const row = live.current.bk.rows.find((r) => r.id === id);
      tipHide();
      live.current.onClose();
      if (row) live.current.bk.select(row.index);
      return row;
    };
    const castOpen = (cell: Element) => {
      const r = cast.current.rows[+(cell.getAttribute('data-cast-r') || 0)];
      const col = cast.current.data && cast.current.data.cols[+(cell.getAttribute('data-cast-c') || 0)];
      if (!r || !col) return;
      const row = jump(col.id);
      if (!row) return;
      // 1.0's castJump: the name selected in the chapter once its editor is open
      let tries = 0;
      const look = () => {
        if (selectNameIn(row.index, r.name) || ++tries > 60) return;
        requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    };
    const roving = (e: KeyboardEvent): boolean => {
      const mark = e.target instanceof Element ? e.target.closest('.ins-mark') : null;
      if (!mark) return false;
      const svg = mark.closest('svg')!;
      const marks = Array.from(svg.querySelectorAll<SVGElement>('.ins-mark'));
      const i = marks.indexOf(mark as SVGElement);
      const rtl = c.api.insRtl();
      let j = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = e.key === 'ArrowRight' && rtl ? i - 1 : i + 1;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = e.key === 'ArrowLeft' && rtl ? i + 1 : i - 1;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = marks.length - 1;
      else if ((e.key === 'Enter' || e.key === ' ') && mark.getAttribute('data-sec')) {
        e.preventDefault();
        jump(mark.getAttribute('data-sec')!);
        return true;
      } else return false;
      e.preventDefault();
      j = Math.max(0, Math.min(marks.length - 1, j));
      marks.forEach((m, k) => m.setAttribute('tabindex', k === j ? '0' : '-1'));
      marks[j]!.focus();
      return true;
    };
    const castKey = (e: KeyboardEvent) => {
      const cell = e.target as Element;
      if (!cell || !cell.classList || !cell.classList.contains('cast-cell')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        castOpen(cell);
        return;
      }
      const rtl = document.documentElement.getAttribute('dir') === 'rtl';
      const R = cast.current.rows.length, C = cast.current.data ? cast.current.data.cols.length : 0;
      let r = +(cell.getAttribute('data-cast-r') || 0), col = +(cell.getAttribute('data-cast-c') || 0);
      if (e.key === 'ArrowRight') col += rtl ? -1 : 1;
      else if (e.key === 'ArrowLeft') col += rtl ? 1 : -1;
      else if (e.key === 'ArrowDown') r++;
      else if (e.key === 'ArrowUp') r--;
      else if (e.key === 'Home') col = 0;
      else if (e.key === 'End') col = C - 1;
      else return;
      e.preventDefault();
      r = Math.max(0, Math.min(R - 1, r));
      col = Math.max(0, Math.min(C - 1, col));
      const next = (cell as SVGElement).ownerSVGElement?.querySelector<SVGElement>('.cast-cell[data-cast-r="' + r + '"][data-cast-c="' + col + '"]');
      if (next && next !== cell) {
        cell.setAttribute('tabindex', '-1');
        next.setAttribute('tabindex', '0');
        next.focus();
      }
    };
    const castTipShow = (cell: Element) => {
      const wrap = cell.closest('.cast-wrap');
      if (!wrap) return;
      const tip = wrap.querySelector<HTMLElement>('.cast-tip'), hl = wrap.querySelector('.cast-hl');
      if (hl) {
        hl.setAttribute('x', cell.getAttribute('x') || '0');
        hl.setAttribute('y', cell.getAttribute('y') || '0');
        hl.setAttribute('visibility', 'visible');
      }
      if (!tip) return;
      tip.textContent = cell.getAttribute('aria-label') || '';
      tip.hidden = false;
      const wr = wrap.getBoundingClientRect(), cr = cell.getBoundingClientRect();
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = cr.left - wr.left + cr.width / 2 - tw / 2;
      left = Math.max(0, Math.min(wr.width - tw, left));
      let top = cr.top - wr.top - th - 6;
      if (top < 0) top = cr.bottom - wr.top + 6;
      tip.style.setProperty('left', left + 'px');
      tip.style.setProperty('top', top + 'px');
    };
    const castTipHide = (wrap: Element | null) => {
      if (!wrap) return;
      const tip = wrap.querySelector<HTMLElement>('.cast-tip'), hl = wrap.querySelector('.cast-hl');
      if (tip) tip.hidden = true;
      if (hl) hl.setAttribute('visibility', 'hidden');
    };
    const hide = (name: string) => {
      const y = live.current.bk.book?.ydoc;
      if (!y) return;
      const idx = cast.current.rows.findIndex((r) => r.name === name);
      castHide(c, y, insightsState(c, y), name);
      castRerender((root) => {
        const btns = root.querySelectorAll<HTMLElement>('.cast-hide');
        return btns[Math.min(idx, btns.length - 1)] || root.querySelector<HTMLElement>('.cast-hidden summary');
      });
    };
    const unhide = (name: string) => {
      const y = live.current.bk.book?.ydoc;
      if (!y) return;
      castUnhide(c, y, insightsState(c, y), name);
      cast.current.openHidden = true;
      castRerender((root) => {
        const s = root.querySelector<HTMLElement>('.cast-hidden summary');
        if (s) return s;
        const h = root.querySelector<HTMLElement>('#insCastH');
        h?.setAttribute('tabindex', '-1');
        return h;
      });
    };
    const tipTarget = (e: Event) => (e.target instanceof Element ? e.target.closest('.ins-mark, .ins-w, .ins-dlg-row, .ins-chip') : null);

    const onClick = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (!el) return;
      const castEl = el.closest('[data-cast-hide],[data-cast-show],.cast-cell');
      if (castEl) {
        if (castEl.hasAttribute('data-cast-hide')) hide(castEl.getAttribute('data-cast-hide')!);
        else if (castEl.hasAttribute('data-cast-show')) unhide(castEl.getAttribute('data-cast-show')!);
        else castOpen(castEl);
        return;
      }
      const sec = el.closest('[data-sec]');
      if (sec) jump(sec.getAttribute('data-sec')!);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const tip = document.getElementById('insTip');
        if (tip && !tip.hidden) {
          tipHide();
          e.stopPropagation();
          e.preventDefault();
        }
        return;
      }
      if (!roving(e)) castKey(e);
    };
    const onOver = (e: PointerEvent) => {
      const m = tipTarget(e);
      if (m) tipShow(m);
      const cell = e.target instanceof Element ? e.target.closest('.cast-cell') : null;
      if (cell) castTipShow(cell);
    };
    const onOut = (e: PointerEvent) => {
      const m = tipTarget(e);
      if (m && !(e.relatedTarget instanceof Node && m.contains(e.relatedTarget))) tipHide();
      const cell = e.target instanceof Element ? e.target.closest('.cast-cell') : null;
      if (cell && cell !== document.activeElement) castTipHide(cell.closest('.cast-wrap'));
    };
    const onFocusIn = (e: FocusEvent) => {
      const m = tipTarget(e);
      if (m) tipShow(m);
      if (e.target instanceof Element && e.target.classList.contains('cast-cell')) castTipShow(e.target);
    };
    const onFocusOut = (e: FocusEvent) => {
      tipHide();
      if (e.target instanceof Element && e.target.classList.contains('cast-cell')) castTipHide(e.target.closest('.cast-wrap'));
    };
    const onChange = (e: Event) => {
      const sel = e.target as HTMLSelectElement;
      if (!sel || sel.id !== 'insVarSel') return;
      c.vars.insVarPick = sel.value || '';
      const wrap = document.getElementById('insVarWrap');
      const d = c.vars.insCache.d;
      if (wrap && d) wrap.innerHTML = c.api.insVarietyInner(d, { W: chartWidth(b) }); // 1.0's markup, escaped by 1.0
    };
    const onToggle = (e: Event) => {
      const el = e.target as HTMLDetailsElement;
      if (el && el.classList && el.classList.contains('cast-hidden')) cast.current.openHidden = el.open;
    };
    const box = b.closest('.modal');
    // scrolling moves the marks: a focused mark keeps its tooltip (re-placed beside it); a hover tooltip is put away
    const onScroll = () => {
      const a = document.activeElement;
      const tgt = a && b.contains(a) ? a.closest('.ins-mark, .ins-dlg-row, .ins-chip') : null;
      if (tgt) tipShow(tgt);
      else tipHide();
    };
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (Math.abs(chartWidth(b) - Number(b.getAttribute('data-w') || 0)) > 24) render();
      }, 160);
    };
    b.addEventListener('click', onClick);
    b.addEventListener('keydown', onKey);
    b.addEventListener('pointerover', onOver);
    b.addEventListener('pointerout', onOut);
    b.addEventListener('focusin', onFocusIn);
    b.addEventListener('focusout', onFocusOut);
    b.addEventListener('change', onChange);
    b.addEventListener('toggle', onToggle, true);
    box?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      b.removeEventListener('click', onClick);
      b.removeEventListener('keydown', onKey);
      b.removeEventListener('pointerover', onOver);
      b.removeEventListener('pointerout', onOut);
      b.removeEventListener('focusin', onFocusIn);
      b.removeEventListener('focusout', onFocusOut);
      b.removeEventListener('change', onChange);
      b.removeEventListener('toggle', onToggle, true);
      box?.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (resizeTimer) clearTimeout(resizeTimer);
      // however the room closes (button, backdrop, Escape, a jump), the tooltip goes with it
      document.getElementById('insTip')?.remove();
    };
  }, [c, render, castRerender, tipHide, tipShow]);

  return (
    <>
      <div id="insBody" ref={body} />
      <div className="modal-actions">
        <button className="tb-btn" id="btnInsRefresh" type="button" onClick={render}>
          <Icon name="RefreshCcw" />
          {t('insights.refresh')}
        </button>
        <button className="tb-btn" id="btnCloseInsights" type="button" onClick={onClose}>
          {t('insights.close')}
        </button>
      </div>
    </>
  );
}
