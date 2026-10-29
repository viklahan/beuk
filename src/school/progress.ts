import type { Db } from '../db.js';

/** A signed-in writer's finished School lessons. Anonymous visitors have none, ever. */
export interface LessonDone {
  course: string;
  lesson: string;
  completedAt: string;
}

export async function listProgress(db: Db, userId: string): Promise<LessonDone[]> {
  const r = await db.query<{ course: string; lesson: string; completed_at: string | Date }>(
    'select course, lesson, completed_at from school_progress where user_id = $1 order by completed_at',
    [userId],
  );
  return r.rows.map((row) => ({ course: row.course, lesson: row.lesson, completedAt: new Date(row.completed_at).toISOString() }));
}

export async function setLessonDone(db: Db, userId: string, course: string, lesson: string, done: boolean): Promise<void> {
  if (done) {
    await db.query(
      `insert into school_progress (user_id, course, lesson) values ($1, $2, $3)
       on conflict (user_id, course, lesson) do nothing`,
      [userId, course, lesson],
    );
  } else {
    await db.query('delete from school_progress where user_id = $1 and course = $2 and lesson = $3', [userId, course, lesson]);
  }
}
