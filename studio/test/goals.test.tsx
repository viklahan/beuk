import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { exportBook, importBook } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { importToDevice } from '../src/book/store';
import { cloudFacts, fmtDateIntl, loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { cloudHeartbeat, cloudLoadStreak, goalsRun, setStreakFetch } from '../src/goals/goals';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { fixtures } from './fixtures';

/* Wave 3a, task 1: goals, the streak, the writing log, the Road so far and just-write (inventory C2), run as 1.0's
   own code (the browser closure). 1.0's self-checks re-expressed here: goals.targets, habit.calendar,
   goals.road.only-logged-days, goals.road.pace-line, goals.deadline.daily, goals.pace, goals.kept,
   goals.restdays.streak, goals.justwrite.clear. Review focus 1 (1.0's book and log give 1.0's numbers: the numbers
   ARE 1.0's functions on 1.0's log key) and 2 (the streak's server calls). */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
const WLOG = 'beuk.writelog.v1';
const words = (n: number) => Array(n).fill('word').join(' ');
const dayStr = (d: Date) => c.api.dayStr(d);
const plus = (n: number, from = new Date()) => new Date(from.getFullYear(), from.getMonth(), from.getDate() + n);

beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
  setClosureLang('en');
});
const freshLog = () => {
  localStorage.removeItem(WLOG);
  c.api.streakState.streak = 0;
  c.api.streakState.lastDay = '';
  c.vars.wlog = c.api.wlogLoad();
  c.vars.goalJustWriteCache = undefined;
};
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('beuk.tour.v1', 'done');
  resetSidePrefsCache();
  freshLog();
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  setStreakFetch(null);
  Object.assign(cloudFacts, { available: false, user: null, serverStreak: null, lastHeartbeatAt: 0 });
  localStorage.clear();
  for (const d of await indexedDB.databases()) {
    if (!d.name) continue;
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase(d.name!);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  }
});

/** 1.0's state for a one-chapter book of `n` words (the self-checks' own fixture: mkSection, buildEmptyBook). */
const oneChapter = (n: number, goals: Rec = {}) => {
  const b = c.api.buildEmptyBook();
  b.sections = [c.api.mkSection('body', 'chapter', 'Goals Chapter', { number: '1', content: words(n) })];
  (b.meta as Rec).bookId = 'goals-test-book';
  b.goals = c.api.normalizeGoals(goals);
  c.setState(b as never);
  return b;
};

describe('the math (1.0\'s own functions)', () => {
  it('goals.deadline.daily: 85k of 100k with 10 writing days → 1,500 a day; today\'s words hold it still; the states', () => {
    const now = new Date();
    const dl = dayStr(plus(10));
    const p = c.api.goalPlan({ project: 100000, deadline: dl }, 85000, 0, now);
    expect(p).toMatchObject({ state: 'ok', left: 15000, days: 10, daily: 1500 });
    // today's 500 words count toward today: the figure is set from where the day began
    expect(c.api.goalPlan({ project: 100000, deadline: dl }, 85500, 500, now)).toMatchObject({ daily: 1500 });
    // the deadline day counts: 11 days
    expect(c.api.goalPlan({ project: 100000, deadline: dl, dlDay: true }, 85000, 0, now)).toMatchObject({ days: 11, daily: Math.ceil(15000 / 11) });
    expect(c.api.goalPlan({ project: 100000, deadline: dayStr(plus(-1)) }, 85000, 0, now).state).toBe('past');
    expect(c.api.goalPlan({ project: 100000, deadline: dl }, 100000, 0, now).state).toBe('reached');
    expect(c.api.goalPlan({ project: 100000 }, 85000, 0, now).state).toBe('needs');
    expect(c.api.goalPlan({ project: 100000, deadline: dayStr(now) }, 85000, 0, now).state).toBe('nodays');
    // weekdays only: the plan counts only the writing days
    const wd = [0, 1, 1, 1, 1, 1, 0];
    const p2 = c.api.goalPlan({ project: 100000, deadline: dl, days: wd }, 85000, 0, now);
    expect(p2.days).toBe(c.api.goalWritingDaysBetween({ days: wd }, now, plus(10), false));
    // the room's line says the arithmetic
    expect(c.api.goalPlanLine(p)).toBe(t('goals.planMath', { left: '15,000', days: '10', daily: '1,500', count: 10 }));
  });

  it('goals.pace: the straight line from the start point, stepped by writing days: on / behind / ahead; none without a start', () => {
    const now = new Date();
    const g = { project: 2000, deadline: dayStr(plus(10)), start: { day: dayStr(plus(-10)), w: 0 } };
    expect(c.api.goalOnPace(g, 1000, now)).toMatchObject({ state: 'on', expected: 1000 });
    expect(c.api.goalOnPace(g, 900, now)).toMatchObject({ state: 'behind', n: 100 });
    expect(c.api.goalOnPace(g, 1100, now)).toMatchObject({ state: 'ahead', n: 100 });
    expect(c.api.goalOnPace({ project: 2000, deadline: g.deadline }, 1000, now)).toBeNull();
    expect(c.api.goalOnPace(g, 2000, now)).toBeNull();
  });

  it('goals.kept: +100, −30, +20 → 120 written, 30 removed, +90 kept; the split starts the day it is first observed', () => {
    oneChapter(10);
    c.vars.wlogRebase = true;
    c.api.wlogObserve(1000);
    c.api.wlogObserve(1100);
    c.api.wlogObserve(1070);
    c.api.wlogObserve(1090);
    const today = dayStr(new Date());
    const book = c.vars.wlog.ar['goals-test-book'];
    expect(book.from).toBe(today);
    expect(c.api.goalKept(book, today, today)).toMatchObject({ a: 120, r: 30, net: 90, partial: false, none: false });
    // an earlier range is partial ("from <date>"), never back-filled
    expect(c.api.goalKept(book, dayStr(plus(-6)), today)).toMatchObject({ a: 120, partial: true });
    expect(c.vars.wlog.days[today].w).toBe(90);
  });

  it('goals.restdays.streak: Friday → Monday continues on weekdays only; a missed writing day ends it', () => {
    const wd = { days: [0, 1, 1, 1, 1, 1, 0] };
    // find the next Monday
    let mon = plus(1);
    while (mon.getDay() !== 1) mon = plus(1, mon);
    expect(c.api.goalStreakBridges(dayStr(plus(-3, mon)), mon, wd)).toBe(true); // Friday
    expect(c.api.goalStreakBridges(dayStr(plus(-4, mon)), mon, wd)).toBe(false); // Thursday: Friday was missed
    expect(c.api.goalStreakBridges(dayStr(plus(-3, mon)), mon, {})).toBe(false); // every day a writing day
  });

  it('goals.road.only-logged-days and goals.road.pace-line: logged days only, a gap breaks the line, the pace slope', () => {
    const d0 = plus(-6);
    const len: Rec = { [dayStr(d0)]: 100, [dayStr(plus(1, d0))]: 150, [dayStr(plus(4, d0))]: 300 };
    const pts = c.api.roadPoints(len);
    expect(pts.map((p) => p.w)).toEqual([100, 150, 300]);
    expect(c.api.roadSegments(pts).map((s) => s.length)).toEqual([2, 1]);
    const m = c.api.roadModel(pts, { project: 1300, deadline: dayStr(plus(10)) }, 300, new Date());
    expect(m.target).toBe(1300);
    expect(m.pace).toMatchObject({ fromW: 300, toW: 1300, perDay: 100 });
    expect(c.api.roadModel(pts, { project: 1300, deadline: dayStr(plus(-1)) }, 300, new Date()).pace).toBeNull();
    expect(c.api.roadModel(pts, { project: 200, deadline: dayStr(plus(10)) }, 300, new Date()).pace).toBeNull();
  });
});

describe('the writing log keeps 1.0\'s key and shape', () => {
  it('habit.calendar (log half): a burst is today\'s count once, still once after a reload; minutes only in front', () => {
    oneChapter(100);
    c.vars.wlogRebase = true;
    c.api.wlogObserve(100); // the arrival rebases
    c.api.wlogObserve(117);
    c.api.wlogFlush();
    const today = dayStr(new Date());
    let stored = JSON.parse(localStorage.getItem(WLOG)!);
    expect(stored.days[today].w).toBe(17);
    expect(Object.keys(stored).sort()).toEqual(['ar', 'base', 'baseDay', 'days', 'len']);
    c.vars.wlog = c.api.wlogLoad();
    c.vars.wlogRebase = true; // a reload: the session's first observation only sets the baseline
    c.api.wlogObserve(117);
    c.api.wlogFlush();
    stored = JSON.parse(localStorage.getItem(WLOG)!);
    expect(stored.days[today].w).toBe(17);
    // foreground minutes: three in front land, five hidden do not
    const before = c.api.wlogTodayMinutes();
    const t0 = Date.now();
    c.vars.wlogFgOverride = false;
    c.api.wlogTick(t0);
    c.vars.wlogFgOverride = true;
    c.api.wlogTick(t0 + 180000);
    const fg = c.api.wlogTodayMinutes();
    c.vars.wlogFgOverride = false;
    c.api.wlogTick(t0 + 480000);
    expect(fg - before).toBe(3);
    expect(c.api.wlogTodayMinutes()).toBe(fg);
    c.vars.wlogFgOverride = null;
    c.vars.wlogLastTick = Date.now();
  });

  it('a log written by 1.0 (its own stored shape) is read as 1.0 reads it', () => {
    const today = dayStr(new Date());
    localStorage.setItem(WLOG, JSON.stringify({ days: { [today]: { w: 42, s: 120 } }, base: 500, baseDay: today, len: { b: { [today]: 500 } }, ar: {} }));
    c.vars.wlog = c.api.wlogLoad();
    expect(c.api.wlogTodayWords()).toBe(42);
    expect(c.api.wlogTodayMinutes()).toBe(2);
  });
});

describe('goalsRun: only 1.0\'s save writes the book', () => {
  const LUNA = () => fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
  const open = () => {
    const y = new Y.Doc();
    importBook(structuredClone(LUNA().book), y);
    return y;
  };
  it('reads without writing; goalsApply writes 1.0\'s normalised goals where serializeBook puts them', () => {
    const y = open();
    const before = JSON.stringify(exportBook(y));
    goalsRun(c, y, () => {
      c.api.goalMath(c.getState().goals, c.api.bookTotalWords(), 0, new Date());
      c.api.goalEnsureStart(); // no deadline: nothing to stamp
    });
    expect(JSON.stringify(exportBook(y))).toBe(before);
    goalsRun(c, y, () => c.api.goalsApply({ daily: 300 }));
    const after = exportBook(y);
    expect(after.goals).toEqual({ daily: 300, project: 0, deadline: '' });
    const keys = (b: Rec) => Object.keys(b).join(',');
    expect(keys(after)).toBe(keys(JSON.parse(before)));
    // a deadline stamps today's start at the book's length
    goalsRun(c, y, () => c.api.goalsApply({ project: 90000, deadline: dayStr(plus(30)) }));
    const g = exportBook(y).goals as Rec;
    expect(g.start).toEqual({ day: dayStr(new Date()), w: expect.any(Number) });
  });
});

describe('the streak and the shelf', () => {
  it('signed out, nothing is sent; signed in, one heartbeat per ten minutes and the server\'s streak wins', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    setStreakFetch((async (u: string, init?: RequestInit) => {
      calls.push([u, init]);
      return new Response(JSON.stringify({ streak: { current: 7, todayCovered: true, freezesAvailable: 0 } }), { status: 200 });
    }) as unknown as typeof fetch);
    cloudHeartbeat();
    expect(cloudLoadStreak()).toBeNull();
    expect(calls).toHaveLength(0);
    Object.assign(cloudFacts, { available: true, user: { email: 'a@b.c' } });
    cloudHeartbeat();
    cloudHeartbeat(); // within ten minutes: not sent
    await waitFor(() => expect(cloudFacts.serverStreak).not.toBeNull());
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('/api/streak/heartbeat');
    expect(calls[0]![1]).toMatchObject({ method: 'POST', body: '{}', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
    await cloudLoadStreak();
    expect(calls[1]![0]).toBe('/api/streak');
    expect(c.api.goalStreakNow()).toBe(7);
  });
  it('the local streak: 1.0\'s markWritingActivity on a fresh day lights it (beuk.streak.v1, 1.0\'s shape)', () => {
    oneChapter(10);
    c.api.markWritingActivity();
    expect(JSON.parse(localStorage.getItem('beuk.streak.v1')!)).toEqual({ streak: 1, lastDay: dayStr(new Date()) });
  });
});

/* ---- the room and the sidebar, in the studio ---- */

async function studioWith(book: Rec) {
  await importToDevice(book);
  const r = render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect(document.getElementById('btnGoals')!.getAttribute('aria-disabled')).toBeNull(), { timeout: 20_000 });
  return r;
}
async function openGoals() {
  fireEvent.click(document.getElementById('btnGoals')!);
  await waitFor(() => expect(document.querySelector('#goalCal .cal-grid')).not.toBeNull(), { timeout: 20_000 });
}
async function exported(): Promise<Rec> {
  let blob: Blob | null = null;
  const sp = [
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => ((blob = b as Blob), 'blob:x')),
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined),
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined),
  ];
  fireEvent.click(document.getElementById('btnLocalBackup')!);
  await waitFor(() => expect(blob).not.toBeNull());
  sp.forEach((s) => s.mockRestore());
  const j = JSON.parse(await blob!.text()) as Rec;
  return j.book as Rec;
}
const setInput = (id: string, v: string) => {
  const el = document.getElementById(id) as HTMLInputElement;
  el.value = v;
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('the Goals room', () => {
  const book = () => ({ format: 'beuk-backup', version: 1, book: { ...c.api.buildEmptyBook(), sections: [c.api.mkSection('body', 'chapter', 'Goals Chapter', { number: '1', content: words(400) })] } });

  it('goals.targets: set through the room\'s own fields, the lines say 1.0\'s numbers; met and past state themselves; clearing removes every line', async () => {
    await studioWith(book());
    const first = await exported();
    await openGoals();
    // opening without editing writes nothing
    expect(JSON.stringify(await exported())).toBe(JSON.stringify(first));
    const dl5 = dayStr(plus(5));
    act(() => {
      (document.getElementById('goalDailyInput') as HTMLInputElement).value = '100';
      (document.getElementById('goalProjectInput') as HTMLInputElement).value = '1000';
      setInput('goalDeadlineInput', dl5);
    });
    const g = (await exported()).goals as Rec;
    expect(g).toMatchObject({ daily: 100, project: 1000, deadline: dl5, start: { day: dayStr(new Date()), w: expect.any(Number) } });
    const total = (g.start as { w: number }).w; // 1.0's bookTotalWords: the text and the chapter's title
    const remaining = 1000 - total;
    const lines = document.getElementById('goalLines')!;
    expect(lines.style.display).not.toBe('none');
    expect(lines.querySelector('.goal-fill')).not.toBeNull();
    expect(lines.textContent).toContain(t('goals.linePace', { n: String(Math.ceil(remaining / 5)) }));
    expect(document.getElementById('goalsProgress')!.textContent).toContain(String(total));
    act(() => setInput('goalProjectInput', String(total)));
    expect(lines.textContent).toContain(t('goals.metNote'));
    act(() => {
      setInput('goalProjectInput', '5000');
      setInput('goalDeadlineInput', dayStr(plus(-1)));
    });
    expect(lines.textContent).toContain(t('goals.linePast', { date: fmtDateIntl(plus(-1)), n: (5000 - total).toLocaleString('en') }));
    act(() => {
      setInput('goalDailyInput', '');
      setInput('goalProjectInput', '');
      setInput('goalDeadlineInput', '');
    });
    expect(lines.style.display).toBe('none');
    expect(lines.innerHTML).toBe('');
    expect(document.getElementById('goalsProgress')!.textContent).toContain(t('goals.noneSet'));
    expect((await exported()).goals).toEqual({ daily: 0, project: 0, deadline: '' });
  }, 60_000);

  it('habit.calendar (room half): today\'s cell carries its count; three months back nothing is logged', async () => {
    const today = dayStr(new Date());
    localStorage.setItem(WLOG, JSON.stringify({ days: { [today]: { w: 17, s: 0 } }, base: null, baseDay: '', len: {}, ar: {} }));
    c.vars.wlog = c.api.wlogLoad();
    await studioWith(book());
    await openGoals();
    const cell = document.querySelector('#goalCal .cal-cell.today')!;
    expect(cell.classList.contains('has')).toBe(true);
    expect(cell.textContent).toContain('17');
    for (let i = 0; i < 3; i++) act(() => (document.querySelector('#goalCal [data-calnav="-1"]') as HTMLElement).click());
    expect(document.querySelectorAll('#goalCal .cal-cell.has')).toHaveLength(0);
  }, 60_000);

  it('goals.justwrite.clear: just write hides the readouts and persists; Clear asks in the studio\'s dialog and wipes the log, never the book', async () => {
    await studioWith(book());
    const first = await exported();
    await openGoals();
    act(() => (document.getElementById('tglGoalJustWrite') as HTMLElement).click());
    expect(localStorage.getItem('beuk.justwrite.v1')).toBe('1');
    expect(document.getElementById('goalJwNote')!.hidden).toBe(false);
    expect(document.getElementById('goalsProgress')!.hidden).toBe(true);
    expect(document.getElementById('streakText')!.textContent).toBe(t('goals.justWriteSide'));
    act(() => (document.getElementById('tglGoalJustWrite') as HTMLElement).click());
    expect(localStorage.getItem('beuk.justwrite.v1')).toBeNull();
    // some tracking, then Clear
    c.api.streakState.streak = 3;
    c.api.streakState.lastDay = dayStr(new Date());
    c.api.saveStreak();
    const confirmSpy = vi.spyOn(window, 'confirm');
    act(() => (document.getElementById('btnGoalClearData') as HTMLElement).click());
    await waitFor(() => expect(document.getElementById('modalConfirm')).not.toBeNull());
    expect(document.getElementById('modalConfirm')!.textContent).toContain(t('goals.clearBody'));
    const yes = Array.from(document.querySelectorAll('#modalConfirm button')).find((b) => b.textContent === t('goals.clearYes')) as HTMLElement;
    act(() => yes.click());
    await waitFor(() => expect(JSON.parse(localStorage.getItem('beuk.streak.v1')!)).toEqual({ streak: 0, lastDay: '' }));
    expect(confirmSpy).not.toHaveBeenCalled();
    const log = JSON.parse(localStorage.getItem(WLOG)!);
    expect(log.days).toEqual({});
    const after = await exported();
    expect(JSON.stringify(after.sections)).toBe(JSON.stringify(first.sections));
  }, 60_000);
});
