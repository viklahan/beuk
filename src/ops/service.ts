import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { HousekeepingLock } from '../housekeeping/lock.js';
import type { Mailer } from '../mailer.js';
import { BackupAlerts } from './alerts.js';
import { purgeClientErrors } from './client-errors.js';
import { applyRetention, type RetentionResult } from './retention.js';
import { rollupUsage } from './usage.js';

/**
 * The ops work that rides on the backup scheduler's 15-minute tick
 * (src/index.ts): after the scheduler's own tick, apply local backup
 * retention (under the Housekeeping lock), evaluate backup alerts, purge
 * old studio error reports and refresh the derived usage counter.
 * Never throws: each step's failure is logged and the next step runs.
 */
export interface OpsDeps {
  db: Db;
  config: Config;
  mailer: Mailer;
  lock: HousekeepingLock;
  secrets: readonly string[];
  now?: () => Date;
  fetchImpl?: typeof fetch;
}

export class OpsService {
  readonly alerts: BackupAlerts;
  private readonly now: () => Date;
  constructor(private readonly deps: OpsDeps) {
    this.now = deps.now ?? (() => new Date());
    this.alerts = new BackupAlerts({
      db: deps.db,
      config: deps.config,
      mailer: deps.mailer,
      secrets: deps.secrets,
      now: this.now,
      fetchImpl: deps.fetchImpl,
    });
  }

  async retention(): Promise<RetentionResult> {
    return applyRetention(this.deps.config, this.deps.lock, this.now());
  }

  async afterBackupTick(): Promise<void> {
    const step = async (name: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        console.error(`ops ${name} failed`, err instanceof Error ? err.message : err);
      }
    };
    await step('retention', () => this.retention());
    await step('alerts', () => this.alerts.evaluate());
    await step('client-error purge', () => purgeClientErrors(this.deps.db, this.deps.config, this.now()));
    await step('usage rollup', () => rollupUsage(this.deps.db, this.deps.config, this.now(), 2));
  }
}
