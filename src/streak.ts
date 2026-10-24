import type { Db } from './db.js';

/* ------------------------------------------------------------------ *
 * Pure day math. Days are 'YYYY-MM-DD' strings in the app timezone.  *
 * ------------------------------------------------------------------ */

/** The calendar day containing `instant`, in the given IANA timezone. */
export function dayString(instant: Date, timeZone: string): string {
  // en-CA yields YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). */
export function diffDays(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export interface StreakComputation {
  /** Consecutive covered days ending today (or yesterday, if today is
   *  not covered yet — the streak is still alive). */
  current: number;
  longest: number;
  /** Most recent day with real activity, or null. */
  lastActiveDay: string | null;
  todayCovered: boolean;
  /** True if the streak would still count yesterday's run as current. */
  alive: boolean;
}

export function computeStreak(
  activeDays: ReadonlySet<string>,
  frozenDays: ReadonlySet<string>,
  today: string,
): StreakComputation {
  const covered = new Set<string>([...activeDays, ...frozenDays]);

  // Longest run of consecutive covered days.
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const day of [...covered].sort()) {
    run = prev !== null && diffDays(prev, day) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = day;
  }

  // Current run: anchor at today if covered, else yesterday if covered.
  let current = 0;
  let anchor: string | null = null;
  if (covered.has(today)) anchor = today;
  else if (covered.has(addDays(today, -1))) anchor = addDays(today, -1);
  if (anchor !== null) {
    let cursor: string = anchor;
    while (covered.has(cursor)) {
      current += 1;
      cursor = addDays(cursor, -1);
    }
  }

  const sortedActive = [...activeDays].sort();
  return {
    current,
    longest,
    lastActiveDay: sortedActive.length ? sortedActive[sortedActive.length - 1] : null,
    todayCovered: covered.has(today),
    alive: current > 0,
  };
}

/* ------------------------------------------------------------------ *
 * DB-backed service.                                                 *
 * ------------------------------------------------------------------ */

export interface StreakState extends StreakComputation {
  freezesAvailable: number;
  /** Days covered by a freeze (repair/pause/grant), sorted. */
  frozenDays: string[];
  /** M4 warmth surfacing: planned-pause days that are today or still to
   *  come, sorted — what the client shows as "you're paused". */
  pauseDays: string[];
  /** True when today itself is covered by a planned pause. */
  pausedToday: boolean;
}

function toDay(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

async function loadState(db: Db, userId: string, today: string): Promise<StreakState> {
  const [days, freezes, state] = await Promise.all([
    db.query<{ day: unknown }>('select day from streak_days where user_id = $1', [userId]),
    db.query<{ day: unknown; source: string }>(
      'select day, source from streak_freezes where user_id = $1',
      [userId],
    ),
    db.query<{ freezes_available: number }>(
      'select freezes_available from streak_state where user_id = $1',
      [userId],
    ),
  ]);
  const active = new Set(days.rows.map((r) => toDay(r.day)));
  const frozen = new Set(freezes.rows.map((r) => toDay(r.day)));
  const pauseDays = freezes.rows
    .filter((r) => r.source === 'pause')
    .map((r) => toDay(r.day))
    .filter((day) => day >= today)
    .sort();
  const computation = computeStreak(active, frozen, today);
  return {
    ...computation,
    freezesAvailable: state.rows[0]?.freezes_available ?? 0,
    frozenDays: [...frozen].sort(),
    pauseDays,
    pausedToday: pauseDays.includes(today),
  };
}

/** Ensure the per-user streak_state row exists (called at registration). */
export async function initStreakState(db: Db, userId: string): Promise<void> {
  await db.query('insert into streak_state (user_id) values ($1) on conflict do nothing', [userId]);
}

export async function getStreak(db: Db, userId: string, now: Date, timeZone: string): Promise<StreakState> {
  return loadState(db, userId, dayString(now, timeZone));
}

/**
 * Heartbeat: the server stamps ITS OWN date for this user, then repairs.
 * Repair policy (forgiving by design): any uncovered days strictly between
 * the most recent covered day and today are back-filled with freezes,
 * oldest gap first, as long as the freeze balance lasts; freezes are
 * applied to the missed days nearest today first within the affordable
 * count so the current streak is preserved as far as possible.
 */
export async function heartbeat(db: Db, userId: string, now: Date, timeZone: string): Promise<StreakState> {
  const today = dayString(now, timeZone);
  await db.query(
    'insert into streak_days (user_id, day) values ($1, $2) on conflict do nothing',
    [userId, today],
  );

  const state = await loadState(db, userId, today);
  if (state.freezesAvailable > 0) {
    const days = await db.query<{ day: unknown }>(
      'select day from streak_days where user_id = $1',
      [userId],
    );
    const allCovered = new Set<string>([
      ...days.rows.map((r) => toDay(r.day)),
      ...state.frozenDays,
    ]);
    // Most recent covered day before today.
    const before = [...allCovered].filter((d) => d < today).sort();
    if (before.length) {
      const last = before[before.length - 1];
      const missed: string[] = [];
      for (let d = addDays(last, 1); d < today; d = addDays(d, 1)) missed.push(d);
      // Apply freezes to the missed days nearest today first.
      const affordable = missed.slice(-state.freezesAvailable).reverse();
      for (const day of affordable) {
        await db.query(
          `insert into streak_freezes (user_id, day, source) values ($1, $2, 'repair')
           on conflict do nothing`,
          [userId, day],
        );
      }
      if (affordable.length) {
        await db.query(
          'update streak_state set freezes_available = freezes_available - $2, updated_at = now() where user_id = $1',
          [userId, affordable.length],
        );
      }
    }
  }
  return loadState(db, userId, today);
}

/**
 * Pause: pre-cover a run of future days (1–30) so they don't break the
 * streak. Planned pauses do not consume the freeze balance.
 */
export async function pauseStreak(
  db: Db,
  userId: string,
  now: Date,
  timeZone: string,
  startDay: string,
  days: number,
): Promise<StreakState> {
  const today = dayString(now, timeZone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDay)) throw new Error('start must be YYYY-MM-DD');
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('days must be 1..30');
  if (startDay < today) throw new Error('pause cannot start in the past');
  for (let i = 0; i < days; i++) {
    await db.query(
      `insert into streak_freezes (user_id, day, source) values ($1, $2, 'pause')
       on conflict do nothing`,
      [userId, addDays(startDay, i)],
    );
  }
  return loadState(db, userId, today);
}
