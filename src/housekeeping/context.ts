import { randomBytes } from 'node:crypto';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { HousekeepingLock } from './lock.js';
import { collectSecrets } from './scrub.js';
import type { RestoreDiff } from './backup.js';

/** A throwaway database for Rehearse: migrations + boot check run here,
 *  never against production data. */
export interface ScratchDb {
  db: Db;
  cleanup: () => Promise<void>;
}
export type ScratchDbFactory = () => Promise<ScratchDb>;

/** Boot/health probe against a (scratch) database. */
export type BootCheck = (db: Db) => Promise<{ ok: boolean; detail: string }>;

export interface HousekeepingDeps {
  lock?: HousekeepingLock;
  scratchFactory?: ScratchDbFactory;
  bootCheck?: BootCheck;
}

export interface RestorePreview {
  id: string;
  backupName: string;
  actorId: string;
  expiresAt: number;
  diff: RestoreDiff;
}

const PREVIEW_TTL_MS = 10 * 60 * 1000;

export interface HousekeepingContext {
  config: Config;
  secrets: string[];
  lock: HousekeepingLock;
  scratchFactory?: ScratchDbFactory;
  bootCheck?: BootCheck;
  previews: Map<string, RestorePreview>;
  newPreview: (backupName: string, actorId: string, diff: RestoreDiff) => RestorePreview;
  takePreview: (id: string, backupName: string, actorId: string) => RestorePreview | null;
}

export function createHousekeepingContext(
  config: Config,
  deps: HousekeepingDeps = {},
): HousekeepingContext {
  const previews = new Map<string, RestorePreview>();
  return {
    config,
    secrets: collectSecrets(config),
    lock: deps.lock ?? new HousekeepingLock(),
    scratchFactory: deps.scratchFactory,
    bootCheck: deps.bootCheck,
    previews,
    newPreview(backupName, actorId, diff) {
      const preview: RestorePreview = {
        id: randomBytes(12).toString('hex'),
        backupName,
        actorId,
        expiresAt: Date.now() + PREVIEW_TTL_MS,
        diff,
      };
      previews.set(preview.id, preview);
      return preview;
    },
    takePreview(id, backupName, actorId) {
      const preview = previews.get(id);
      if (!preview) return null;
      previews.delete(id);
      if (preview.expiresAt < Date.now()) return null;
      if (preview.backupName !== backupName || preview.actorId !== actorId) return null;
      return preview;
    },
  };
}

/** One audit row per Housekeeping action (spec). Params summaries are
 *  stored already-scrubbed by the caller. */
export async function writeAudit(
  db: Db,
  entry: {
    actorId: string | null;
    actorEmail: string | null;
    action: string;
    params: Record<string, unknown>;
    result: string;
    detail?: string;
  },
): Promise<void> {
  await db.query(
    `insert into housekeeping_audit (actor_user_id, actor_email, action, params_summary, result, detail)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      entry.actorId,
      entry.actorEmail,
      entry.action,
      JSON.stringify(entry.params),
      entry.result,
      entry.detail ?? null,
    ],
  );
}
