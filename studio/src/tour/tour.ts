import type { TourStep } from '../closure/index';

/* 1.0's first-run quick tour (client/index.html BEUK:tour, inventory I7),
   ported as the imperative module 1.0 runs: the card and its rings are
   built in the DOM exactly as tourBuild / tourPlace build them, with 1.0's
   ids, classes, keys and timing. The steps (TOUR_STEPS), the storage keys
   (TOUR_KEY "beuk.tour.v1", TOUR_DESK_KEY "beuk.desk") and the decision
   (tourDecide) are 1.0's own, from the browser closure; `beuk.tour.v1` is
   shared with 1.0 in 1.0's value shape ("done" / "skipped").

   What 2.0 supplies through the host (the rest is 1.0's code):
   - emptyDesk: 1.0's isEmptyDesk() — no book open, or the open book's desk
     empty by 1.0's own isEmptyDesk (the closure);
   - edits: 1.0's local.realEdits — the writer's own edits this session (a
     local Y transaction that changed the book), never a book arriving;
   - restoring: 1.0's data-local-restore (the book still opening);
   - the last step's three ways in: import (wave 6: while #btnImport is
     aria-disabled the button is not offered), the sample (hidden while the
     sample is on the desk, as 1.0), and "Start writing" (offered only while
     there is a page to type on; 2.0's empty phase has none, wave 1b ruling 14).

   Steps whose control 2.0 does not have yet are left out of the tour: a step
   is kept when the first selector of its anchor group is in the page —
   1.0's own test for a missing target (tour.targets-visible: "<g[0]> is
   missing from the page"). Today that keeps "Bring your book in" and
   "Export when the book is ready"; "Write here, see the book there" (the
   preview, wave 4) and "Give it a look" (Typography Studio, wave 4) come
   back by themselves once their controls exist. */

export type TourHost = {
  steps: TourStep[];
  decide: (d: TourDevice) => boolean;
  key: string;
  deskKey: string;
  t: (key: string, params?: Record<string, unknown>) => string;
  emptyDesk: () => boolean;
  edits: () => number;
  restoring: () => boolean;
  sampleLoaded: () => boolean;
  importReady: () => boolean;
  canWrite: () => boolean;
  loadSample: () => void;
  write: () => void;
  toast: (msg: string) => void;
};
export type TourDevice = { storage: boolean; stored: string | null; desk: string | null; empty: boolean };

type TourState = {
  active: boolean;
  dry: boolean;
  replay: boolean;
  step: number;
  timer: ReturnType<typeof setInterval> | null;
  autoTimer: ReturnType<typeof setInterval> | null;
  rings: HTMLDivElement[];
  lastFocus: Element | null;
  edits0: number;
  empty0: boolean;
  lastResult: string | null;
  wouldStore: string | null;
  steps: TourStep[];
};

const $ = (id: string) => document.getElementById(id);
const PHONE = 1023; // 1.0's phone layout breakpoint (#mobileTabs)

let host: TourHost | null = null;
export const tour: TourState = { active: false, dry: false, replay: false, step: 0, timer: null, autoTimer: null, rings: [], lastFocus: null, edits0: 0, empty0: false, lastResult: null, wouldStore: null, steps: [] };

/** The steps 2.0 can show: 1.0's TOUR_STEPS less those whose anchor control is not in the page. */
export function tourAvailable(steps: TourStep[]): TourStep[] {
  return steps.filter((s) => {
    const g = s.groups[s.anchor];
    return !!g && !!g[0] && !!document.querySelector(g[0]);
  });
}

export function tourReadDevice(): TourDevice {
  const h = host!;
  const d: TourDevice = { storage: false, stored: null, desk: null, empty: h.emptyDesk() };
  try {
    d.stored = localStorage.getItem(h.key);
    d.desk = localStorage.getItem(h.deskKey);
    d.storage = true;
  } catch {
    d.storage = false;
  }
  return d;
}
export const tourShouldOffer = (): boolean => !!host && host.decide(tourReadDevice());

/** A dialog open, Zen on or on its way, or the desk still being restored: the card steps aside. */
export function tourBlocked(): boolean {
  const b = document.body;
  if (document.querySelector('.modal-back.open')) return true;
  if (b.classList.contains('zen') || b.classList.contains('zen-fading') || b.classList.contains('zen-returning')) return true;
  if (document.documentElement.hasAttribute('data-local-restore') || (host && host.restoring())) return true;
  return false;
}
export function tourVisible(el: Element | null): el is HTMLElement {
  if (!el || !el.isConnected || !el.getClientRects().length) return false;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none') return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  return r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh;
}
/** One element (or null) per group of the step. */
export function tourTargets(i: number): (HTMLElement | null)[] {
  const s = tour.steps[i]!;
  return s.groups.map((g) => {
    for (const sel of g) {
      const el = document.querySelector(sel);
      if (tourVisible(el)) return el;
    }
    return null;
  });
}

const SKIP_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

function tourBuild(): void {
  if ($('tourCard')) return;
  const card = document.createElement('div');
  card.className = 'tour-card';
  card.id = 'tourCard';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'false');
  card.setAttribute('aria-describedby', 'tourBody');
  // 1.0's tourBuild markup, a fixed string: every text goes in by textContent (tourRender)
  card.innerHTML =
    '<div class="tour-top"><span class="tour-count" id="tourCount"></span>' +
    '<button type="button" class="tour-x" id="tourSkip">' + SKIP_SVG + '</button></div>' +
    '<h2 id="tourTitle" tabindex="-1"></h2><p id="tourBody"></p>' +
    '<div class="tour-acts" id="tourActs" hidden><p class="tour-q" id="tourQ"></p>' +
    '<button type="button" class="tb-btn primary" data-tour-act="import"></button>' +
    '<button type="button" class="tb-btn" data-tour-act="sample"></button>' +
    '<button type="button" class="tb-btn" data-tour-act="write"></button></div>' +
    '<div class="tour-nav"><button type="button" class="tb-btn" id="tourBack"></button><button type="button" class="tb-btn primary" id="tourNext"></button></div>';
  document.body.appendChild(card);
  const live = document.createElement('div');
  live.className = 'tour-live';
  live.id = 'tourLive';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  document.body.appendChild(live);
  $('tourSkip')!.addEventListener('click', () => tourEnd('skipped'));
  $('tourBack')!.addEventListener('click', () => tourGo(tour.step - 1, 'back'));
  $('tourNext')!.addEventListener('click', () => tourGo(tour.step + 1, 'next'));
  card.querySelectorAll('[data-tour-act]').forEach((b) => b.addEventListener('click', () => tourAct(b.getAttribute('data-tour-act') || '')));
}

export function tourRender(): void {
  const card = $('tourCard');
  if (!card || !host) return;
  const t = host.t;
  const n = tour.step, total = tour.steps.length, s = tour.steps[n]!;
  const phone = window.innerWidth <= PHONE;
  const names = { import: t('side.import'), studio: phone ? t('tabs.style') : t('tab.type'), export: t('top.export') };
  card.setAttribute('aria-label', t('tour.label') + ': ' + t(s.title));
  card.setAttribute('data-step', s.id);
  $('tourCount')!.textContent = t('tour.count', { step: String(n + 1), total: String(total) });
  $('tourTitle')!.textContent = t(s.title);
  $('tourBody')!.textContent = t(s.body, names);
  const skip = $('tourSkip')!;
  skip.setAttribute('aria-label', t('tour.skip'));
  skip.setAttribute('title', t('tour.skip'));
  $('tourBack')!.textContent = t('tour.back');
  $('tourNext')!.textContent = t('tour.next');
  $('tourBack')!.hidden = n === 0;
  $('tourNext')!.hidden = !!s.last;
  const acts = $('tourActs')!;
  acts.hidden = !s.last;
  $('tourQ')!.textContent = t('tour.s4q');
  const imp = acts.querySelector<HTMLElement>('[data-tour-act="import"]')!;
  imp.textContent = t('tour.actImport');
  imp.hidden = !host.importReady();
  const sample = acts.querySelector<HTMLElement>('[data-tour-act="sample"]')!;
  sample.textContent = t('tour.actSample');
  sample.hidden = host.sampleLoaded();
  const write = acts.querySelector<HTMLElement>('[data-tour-act="write"]')!;
  write.textContent = t('tour.actWrite');
  write.hidden = !host.canWrite();
  const live = $('tourLive');
  if (live) live.textContent = t('tour.live', { step: String(n + 1), total: String(total), title: t(s.title) });
}

export function tourStart(opts: { dry?: boolean; replay?: boolean; empty0?: boolean } = {}): void {
  if (!host) return;
  if (tour.active) {
    tourGo(0, 'title');
    return;
  }
  const steps = tourAvailable(host.steps);
  if (!steps.length) return;
  tour.steps = steps;
  tour.active = true;
  tour.dry = !!opts.dry;
  tour.replay = !!opts.replay;
  tour.step = 0;
  tour.lastResult = null;
  tour.wouldStore = null;
  tour.lastFocus = document.activeElement;
  tour.edits0 = host.edits();
  tour.empty0 = opts.empty0 !== undefined ? !!opts.empty0 : host.emptyDesk();
  tourBuild();
  const typing = document.activeElement && /^(TEXTAREA|INPUT|SELECT)$/.test(document.activeElement.tagName);
  tourGo(0, typing ? '' : 'title');
  if (!tour.dry) {
    tour.timer = setInterval(tourTick, 400);
    window.addEventListener('resize', tourOnResize);
    window.addEventListener('scroll', tourPlace, true);
  }
}

export function tourGo(i: number, how: string): void {
  if (!tour.active) return;
  tour.step = Math.max(0, Math.min(tour.steps.length - 1, i));
  tourRender();
  tourTick();
  const card = $('tourCard');
  if (!card || card.hidden) return;
  const focus = (el: HTMLElement | null) => {
    if (el && !el.hidden) {
      try {
        el.focus({ preventScroll: true });
      } catch {
        el.focus();
      }
      return true;
    }
    return false;
  };
  if (how === 'title') focus($('tourTitle'));
  else if (how === 'next') {
    if (!focus($('tourNext'))) focus(card.querySelector<HTMLElement>('[data-tour-act]:not([hidden])'));
  } else if (how === 'back') {
    if ($('tourBack')!.hidden) focus($('tourNext'));
    else focus($('tourBack'));
  }
}

/** The writer has begun: words typed, a book opened, the sample opened (whatever arrives on a desk that was empty).
 *  A replay opened on an empty desk ends the same way; a replay opened over a book ends only at a real edit. */
function tourWriterBegan(): boolean {
  const h = host!;
  if (h.edits() > tour.edits0) return true;
  return (!tour.replay || tour.empty0) && !h.emptyDesk();
}

export function tourTick(): void {
  if (!tour.active) return;
  if (!tour.dry && tourWriterBegan()) {
    tourEnd('done');
    return;
  }
  const card = $('tourCard');
  if (!card) return;
  const blocked = tourBlocked();
  if (blocked && card.contains(document.activeElement)) {
    try {
      (document.activeElement as HTMLElement).blur();
    } catch {
      /* nothing to blur */
    }
  }
  card.hidden = blocked;
  if (blocked) tour.rings.forEach((r) => (r.hidden = true));
  else tourPlace();
}

const px = (el: HTMLElement, prop: string, v: number) => el.style.setProperty(prop, Math.round(v) + 'px');

export function tourPlace(): void {
  if (!tour.active) return;
  const card = $('tourCard');
  if (!card || card.hidden) return;
  const els = tourTargets(tour.step);
  const vis = els.filter((e): e is HTMLElement => !!e);
  while (tour.rings.length < vis.length) {
    const r = document.createElement('div');
    r.className = 'tour-ring';
    r.setAttribute('aria-hidden', 'true');
    document.body.appendChild(r);
    tour.rings.push(r);
  }
  const vw = document.documentElement.clientWidth, vh = window.innerHeight, m = 12;
  tour.rings.forEach((ring, k) => {
    const el = vis[k];
    if (!el) {
      ring.hidden = true;
      return;
    }
    const r = el.getBoundingClientRect();
    const L = Math.max(4, r.left - 4), T = Math.max(4, r.top - 4), R = Math.min(vw - 4, r.right + 4), B = Math.min(vh - 4, r.bottom + 4);
    ring.hidden = false;
    px(ring, 'left', L);
    px(ring, 'top', T);
    px(ring, 'width', Math.max(0, R - L));
    px(ring, 'height', Math.max(0, B - T));
  });
  const narrow = vw < 640;
  px(card, 'width', Math.max(0, narrow ? vw - 2 * m : Math.min(340, vw - 2 * m)));
  px(card, 'max-height', Math.max(0, vh - 2 * m));
  const cw = card.offsetWidth, ch = card.offsetHeight;
  const step = tour.steps[tour.step]!;
  const anchor = els[step.anchor] || vis[0] || null;
  const rtl = document.documentElement.getAttribute('dir') === 'rtl';
  let left = (vw - cw) / 2, top = (vh - ch) / 2;
  if (anchor) {
    let r: { 'left': number; 'right': number; top: number; bottom: number } = anchor.getBoundingClientRect();
    // Beside: clear every ringed control of the step, not only the anchor.
    if (step.beside) {
      const rs = vis.map((e) => e.getBoundingClientRect());
      r = { 'left': Math.min(...rs.map((x) => x.left)), 'right': Math.max(...rs.map((x) => x.right)), top: Math.min(...rs.map((x) => x.top)), bottom: Math.max(...rs.map((x) => x.bottom)) };
    }
    const before = rtl ? r.right + 10 : r.left - 10 - cw, after = rtl ? r.left - 10 - cw : r.right + 10;
    const fits = (x: number) => x >= m && x + cw <= vw - m;
    if (narrow) {
      left = m;
      top = (r.top + r.bottom) / 2 > vh / 2 ? m : vh - ch - m;
    } else if (step.beside && (fits(after) || fits(before))) {
      top = r.top;
      left = fits(after) ? after : before;
    } else if (r.bottom + 10 + ch <= vh - m) {
      top = r.bottom + 10;
      left = rtl ? r.right - cw : r.left;
    } else if (r.top - 10 - ch >= m) {
      top = r.top - 10 - ch;
      left = rtl ? r.right - cw : r.left;
    } else {
      // Too tall a target to sit above or below: beside it, on the side with room (the reading side first).
      top = r.top;
      left = fits(after) ? after : fits(before) ? before : left;
    }
  }
  left = Math.max(m, Math.min(vw - cw - m, left));
  top = Math.max(m, Math.min(vh - ch - m, top));
  px(card, 'left', left);
  px(card, 'top', top);
}

export function tourTeardown(): void {
  if (tour.timer) {
    clearInterval(tour.timer);
    tour.timer = null;
  }
  window.removeEventListener('resize', tourOnResize);
  window.removeEventListener('scroll', tourPlace, true);
  $('tourCard')?.remove();
  $('tourLive')?.remove();
  tour.rings.forEach((r) => r.remove());
  tour.rings = [];
  tour.active = false;
}

export function tourEnd(reason: 'done' | 'skipped'): void {
  if (!tour.active || !host) return;
  tour.lastResult = reason;
  if (tour.dry) tour.wouldStore = reason;
  else {
    try {
      localStorage.setItem(host.key, reason);
    } catch {
      /* no storage: nothing could keep it from coming back, and 1.0 then never offers it */
    }
  }
  const card = $('tourCard');
  const hadFocus = !!(card && card.contains(document.activeElement));
  const dry = tour.dry;
  tourTeardown();
  if (hadFocus && reason === 'skipped') {
    const back = tour.lastFocus as HTMLElement | null, again = $('btnTourAgain');
    if (back && back.isConnected && back !== document.body && typeof back.focus === 'function' && tourVisible(back)) {
      try {
        back.focus();
      } catch {
        /* gone */
      }
    } else if (tourVisible(again)) again.focus();
  }
  if (reason === 'skipped' && !dry) host.toast(host.t('tour.skipped'));
}

/** The last step's three ways in. Each ends the tour first (it has done its job), then does the real thing. */
export function tourAct(what: string): void {
  if (!host) return;
  if (tour.dry) {
    tour.lastResult = 'act:' + what;
    return;
  }
  tourEnd('done');
  if (what === 'import') $('btnImport')?.click();
  else if (what === 'sample') host.loadSample();
  else if (what === 'write') host.write();
}

/** Esc ends the tour, unless it is closing something else first (a menu or popover open while focus is outside the
 *  card). Capture phase, so this runs before those menus close. */
export function tourOnKey(e: KeyboardEvent): void {
  if (!tour.active || e.key !== 'Escape') return;
  const card = $('tourCard');
  if (!card || card.hidden) return;
  if (!card.contains(document.activeElement)) {
    const open = ['uiLangMenu', 'localPop', 'raPop', 'dictPop', 'chopMenu'].some((id) => {
      const el = $(id);
      return !!(el && !el.hidden && el.getClientRects().length);
    });
    if (open) return;
  }
  tourEnd('skipped');
}

function tourOnResize(): void {
  if (tour.active) {
    tourRender();
    tourTick();
  }
}
export function tourOnLangChange(): void {
  if (!tour.active) return;
  tourRender();
  tourTick();
}

/** 1.0's tourInit, once the device's book is known: "Show the quick tour", Escape, /next#tour, and the offer on a
 *  fresh device at a quiet moment. Returns the teardown. */
export function tourInit(h: TourHost): () => void {
  host = h;
  const again = (e: Event) => {
    const el = e.target instanceof Element ? e.target.closest('#btnTourAgain') : null;
    if (el) tourStart({ replay: true });
  };
  document.addEventListener('click', again);
  document.addEventListener('keydown', tourOnKey, true);
  // 1.0's window.beukTour (its self-checks and the e2e drive the tour through it)
  const w = window as unknown as { beukTour?: unknown };
  w.beukTour = { start: tourStart, end: tourEnd, go: tourGo, decide: h.decide, device: tourReadDevice, shouldOffer: tourShouldOffer, steps: h.steps, state: tour, key: h.key, targets: tourTargets, visible: tourVisible };
  let replayTimer: ReturnType<typeof setTimeout> | null = null;
  const asked = /^#tour$/i.test(location.hash || '');
  if (asked) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch {
      /* not allowed here */
    }
    replayTimer = setTimeout(() => tourStart({ replay: true }), 300);
  } else if (tourShouldOffer()) {
    // Wait for a quiet moment: nothing open, not in Zen.
    let waited = 0;
    tour.autoTimer = setInterval(() => {
      waited += 1;
      if (tour.active || !tourShouldOffer()) {
        clearInterval(tour.autoTimer!);
        tour.autoTimer = null;
        return;
      }
      if (waited < 2 || tourBlocked()) return;
      clearInterval(tour.autoTimer!);
      tour.autoTimer = null;
      tourStart({});
    }, 400);
  }
  return () => {
    document.removeEventListener('click', again);
    document.removeEventListener('keydown', tourOnKey, true);
    if (replayTimer) clearTimeout(replayTimer);
    if (tour.autoTimer) {
      clearInterval(tour.autoTimer);
      tour.autoTimer = null;
    }
    tourTeardown();
    if (host === h) host = null;
    if (w.beukTour && (w.beukTour as { decide?: unknown }).decide === h.decide) delete w.beukTour;
  };
}

/** The host the module is driven by (tests swap fields in place). */
export const tourHost = (): TourHost | null => host;
