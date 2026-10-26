import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { checkHelpContent, getHelpContent } from '../help/content.js';
import { listBackups } from '../housekeeping/backup.js';
import { offsiteFreshness, scheduleHealth } from '../housekeeping/offsite.js';
import { epubcheckProblem, pdfRenderProblem, pdfxProblem } from '../jobs/tools.js';
import type { Mailer } from '../mailer.js';
import { clientDir } from '../warmth/pages.js';

/**
 * The public status reading behind /status and /api/status/public.
 *
 * What it claims, and nothing more:
 *   studio        the studio's file is present in this deploy (it runs in the
 *                 writer's browser; once loaded, writing needs no server)
 *   shelf         the database answered `select 1` (the API answered by
 *                 construction: this reading came from it)
 *   help          the Help content loaded, and whether its own check found problems
 *   serverChecks  EPUBCheck / PDF/X tools INSTALLED (configured and present),
 *                 not "working": whether they run is known when a job runs them
 *   email         configured (SMTP_URL + MAIL_FROM) or not; nothing is sent to check
 *   backups       how old the newest complete local backup is, whether the
 *                 schedule's own check is green, and whether an off-site copy
 *                 is configured and fresh
 * Never shown: error texts, hostnames, paths, settings values, counts of
 * users or books. One reading is cached for 30 s, so a monitor polling
 * every few seconds costs one database round trip per half minute.
 */

export type ComponentState = 'ok' | 'off' | 'attention' | 'down';

export interface Component {
  id: 'studio' | 'shelf' | 'help' | 'serverChecks' | 'email' | 'backups';
  name: string;
  state: ComponentState;
  /** Short, public, plain words. */
  summary: string;
  checkedAt: string;
}

export interface PublicStatus {
  /** True when the shelf (API + database) answers. */
  ok: boolean;
  overall: 'ok' | 'attention' | 'down';
  headline: string;
  checkedAt: string;
  version: string;
  components: Component[];
}

export const STATUS_TTL_MS = 30_000;

function ageWords(ms: number): string {
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export async function readPublicStatus(db: Db, config: Config, mailer: Mailer, now: Date = new Date()): Promise<PublicStatus> {
  const stamp = () => new Date().toISOString();
  const components: Component[] = [];

  // Studio
  {
    let present = false;
    try {
      const s = await stat(path.join(clientDir(), 'index.html'));
      present = s.isFile() && s.size > 0;
    } catch {
      present = false;
    }
    components.push({
      id: 'studio',
      name: 'Studio',
      state: present ? 'ok' : 'down',
      summary: present
        ? 'The studio is on the server. Once it has loaded, writing works on your device without the server.'
        : 'The studio file is missing from this server.',
      checkedAt: stamp(),
    });
  }

  // Shelf
  let dbUp = false;
  {
    try {
      await db.query('select 1');
      dbUp = true;
    } catch {
      dbUp = false;
    }
    components.push({
      id: 'shelf',
      name: 'Shelf (sign-in, saving, archive)',
      state: dbUp ? 'ok' : 'down',
      summary: dbUp
        ? 'The server and its database answered.'
        : 'The server answered, but its database did not. Books on your device are safe; saving to the shelf waits until it is back.',
      checkedAt: stamp(),
    });
  }

  // Help
  {
    let state: ComponentState = 'ok';
    let summary: string;
    try {
      const c = getHelpContent();
      const problems = checkHelpContent(c);
      if (problems.length) {
        state = 'attention';
        summary = `Help is up, but its own check found ${problems.length} problem${problems.length === 1 ? '' : 's'} in the guides.`;
      } else {
        summary = `Help is up: ${c.guides.length} guides and the error dictionary.`;
      }
    } catch {
      state = 'down';
      summary = 'The Help pages could not be loaded.';
    }
    components.push({ id: 'help', name: 'Help', state, summary, checkedAt: stamp() });
  }

  // Server checks
  {
    const epub = !epubcheckProblem(config);
    const pdfx = !pdfxProblem(config) && !pdfRenderProblem(config);
    const parts = [
      `EPUBCheck ${epub ? 'installed' : 'not installed'}`,
      `PDF/X tools ${pdfx ? 'installed' : 'not installed'}`,
    ];
    components.push({
      id: 'serverChecks',
      name: 'Server checks (EPUBCheck, PDF/X)',
      state: epub && pdfx ? 'ok' : 'off',
      summary: `${parts.join('; ')}.${epub || pdfx ? ' Installed means set up on this server; whether a tool runs is known when a job runs it.' : ''}${!epub || !pdfx ? ' A job for a tool that is not installed fails and says so.' : ''}`,
      checkedAt: stamp(),
    });
  }

  // Email
  {
    const configured = mailer.status().configured;
    components.push({
      id: 'email',
      name: 'Email',
      state: configured ? 'ok' : 'off',
      summary: configured
        ? 'Email is set up on this server (for password-reset links). This page does not send a message to test it.'
        : "Email isn't set up on this server yet, so password-reset emails cannot be sent.",
      checkedAt: stamp(),
    });
  }

  // Backups
  {
    let newest: number | null = null;
    try {
      for (const m of await listBackups(config)) {
        const t = Date.parse(m.createdAt);
        if (!Number.isNaN(t) && (newest === null || t > newest)) newest = t;
      }
    } catch {
      newest = null;
    }
    const schedule = await scheduleHealth(config, now).catch(() => ({ status: 'fail' as const, detail: '' }));
    const offsite = await offsiteFreshness(config, now).catch(() => ({ status: 'fail' as const, detail: '' }));
    let state: ComponentState;
    const bits: string[] = [];
    bits.push(newest === null ? 'No backup has been made yet.' : `Last backup ${ageWords(now.getTime() - newest)}.`);
    if (schedule.status === 'pass') state = 'ok';
    else if (schedule.status === 'not-configured') {
      state = 'off';
      bits.push('Scheduled backups are switched off on this server.');
    } else {
      state = 'attention';
      bits.push('The backup schedule needs attention.');
    }
    if (offsite.status === 'pass') bits.push('A recent encrypted copy is kept off-site.');
    else if (offsite.status === 'not-configured') bits.push('No off-site copy is set up yet.');
    else {
      state = 'attention';
      bits.push('The off-site copy needs attention.');
    }
    components.push({ id: 'backups', name: 'Backups', state, summary: bits.join(' '), checkedAt: stamp() });
  }

  const overall: PublicStatus['overall'] = !dbUp
    ? 'down'
    : components.some((c) => c.state === 'down' || c.state === 'attention')
      ? 'attention'
      : 'ok';
  const headline =
    overall === 'down'
      ? 'The shelf is down. Writing on your device still works.'
      : overall === 'attention'
        ? 'Beuk is up. Something below needs attention.'
        : components.some((c) => c.state === 'off')
          ? 'Beuk is up. Some parts are not set up on this server yet.'
          : 'Beuk is up and everything below is working.';
  return { ok: dbUp, overall, headline, checkedAt: now.toISOString(), version: config.appVersion, components };
}

/** A 30-second cache per (db, config) pair. */
export class StatusCache {
  private value: PublicStatus | null = null;
  private at = 0;
  private inflight: Promise<PublicStatus> | null = null;
  constructor(
    private readonly read: () => Promise<PublicStatus>,
    private readonly clock: () => number = Date.now,
    private readonly ttlMs = STATUS_TTL_MS,
  ) {}

  async get(): Promise<PublicStatus> {
    if (this.value && this.clock() - this.at < this.ttlMs) return this.value;
    if (!this.inflight) {
      this.inflight = this.read()
        .then((v) => {
          this.value = v;
          this.at = this.clock();
          return v;
        })
        .finally(() => {
          this.inflight = null;
        });
    }
    return this.inflight;
  }
}
