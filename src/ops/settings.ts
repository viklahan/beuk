import type { Config, OpsConfig } from '../config.js';

/** The ops settings with their defaults: everything off / keep-all. */
export const DEFAULT_OPS: OpsConfig = {
  alertEmail: null,
  alertWebhookUrl: null,
  alertWebhookFormat: 'json',
  backupKeepDays: null,
  backupKeepCount: null,
  clientErrorsKeepDays: 30,
};

export function opsSettings(config: Config): OpsConfig {
  return { ...DEFAULT_OPS, ...(config.ops ?? {}) };
}

/** YYYY-MM-DD of `instant` in `timeZone` (the streak's day boundary). */
export function dayIn(instant: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}

export function addDaysIso(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** pg returns `date` columns as Date (node-postgres) or string (PGlite). */
export function isoDay(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
