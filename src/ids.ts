import type { NextFunction, Request, Response } from 'express';

/** Canonical hyphenated UUID text (any version). Every primary key in
 *  migrations/ is `uuid default gen_random_uuid()`. Anything else can
 *  never name a row, so it is answered as "not found" instead of being
 *  handed to Postgres (which would raise 22P02 → a 500). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** router.param('id', uuidParam('manuscript not found')) */
export function uuidParam(notFoundMessage: string) {
  return (_req: Request, res: Response, next: NextFunction, value: string): void => {
    if (isUuid(value)) return next();
    res.status(404).json({ error: notFoundMessage });
  };
}
