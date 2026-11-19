import { cloudFacts } from '../closure/index';
import { apiFetch } from './net';
import { arisStatus } from './state';
import { DEFAULT_MODELS } from './propose';

/* The editorial read, behind the laurel. The studio drives the loop —
   one section per POST /api/aris/editorial, the rolling digest carried
   forward — accumulates findings and claims, and asks the server's
   verdict endpoint for the deterministic gate. The report renders in a
   native <dialog>: verdict, findings grouped by severity with their
   quotes, the rejected tally when the lens had findings thrown out, and
   the extracted travel/calendar claims for the writer's own eye. */

type Finding = { severity: 'critical' | 'major' | 'minor'; category: string; location: string; quote: string; why: string; fix: string };
type Claims = {
  counts: { chapter: string; subject: string; op: string; amount: number; quote: string }[];
  travel: { chapter: string; from: string; to: string; quote: string }[];
  calendar: { chapter: string; event: string; date: string; quote: string }[];
};

let dialog: HTMLDialogElement | null = null;
let running = false;
let abandoned = false;

const el = (tag: string, attrs: Record<string, string>, text?: string): HTMLElement => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text) node.textContent = text;
  return node;
};

/** Dialog methods degrade to the `open` attribute where unimplemented
 *  (jsdom): `d.open` then tells the truth in both worlds, and the run
 *  loop reads it as its abandon signal. */
const shut = (d: HTMLDialogElement) => {
  if (typeof d.close === 'function') d.close();
  else d.removeAttribute('open');
};

function ensureDialog(): HTMLDialogElement {
  if (dialog && document.contains(dialog)) return dialog;
  const d = document.createElement('dialog');
  d.setAttribute('data-aris', 'editorial');
  const close = el('button', { type: 'button', 'data-aris': 'editorial-close', 'aria-label': 'Close' }, '✕');
  close.addEventListener('click', () => shut(d));
  const title = el('h3', {}, 'Editorial read');
  const status = el('p', { 'data-aris': 'editorial-status' }, 'Aris reads the whole book, section by section, and reports only what it can quote.');
  const run = el('button', { type: 'button', 'data-aris': 'editorial-run' }, 'Run the read');
  const abandon = el('button', { type: 'button', 'data-aris': 'editorial-abandon', hidden: '' }, 'Abandon');
  run.addEventListener('click', () => void runRead(d));
  abandon.addEventListener('click', () => { abandoned = true; });
  const actions = el('div', { 'data-aris': 'editorial-actions' });
  actions.append(run, abandon);
  const report = el('div', { 'data-aris': 'editorial-report', hidden: '' });
  d.append(close, title, status, actions, report);
  d.addEventListener('click', (e) => { if (e.target === d) shut(d); });
  // However it closes — ✕, backdrop, Esc — a run in flight stops. The read
  // must never keep spending the writer's key behind a closed door.
  d.addEventListener('close', () => { abandoned = true; });
  document.body.appendChild(d);
  dialog = d;
  return d;
}

export function openEditorial(): void {
  const d = ensureDialog();
  if (typeof d.showModal === 'function') d.showModal();
  else d.setAttribute('open', '');
}

const put = (d: HTMLDialogElement, sel: string, text: string) => {
  const node = d.querySelector(sel);
  if (node) node.textContent = text;
};

async function runRead(d: HTMLDialogElement): Promise<void> {
  if (running) return;
  const fail = (msg: string) => put(d, '[data-aris="editorial-status"]', msg);
  const manuscriptId = cloudFacts.linkedId;
  if (!manuscriptId) return fail('this book is not on your shelf yet — save it to the shelf first');
  const key = arisStatus()?.keys[0] as { provider?: unknown } | undefined;
  const provider = typeof key?.provider === 'string' ? key.provider : '';
  if (!provider) return fail('add a provider key on your /aris page first');
  const model = DEFAULT_MODELS[provider];
  if (!model) return fail(`no default model for ${provider}`);

  running = true;
  abandoned = false;
  const runBtn = d.querySelector<HTMLButtonElement>('[data-aris="editorial-run"]');
  const abandonBtn = d.querySelector<HTMLButtonElement>('[data-aris="editorial-abandon"]');
  if (runBtn) runBtn.hidden = true;
  if (abandonBtn) abandonBtn.hidden = false;

  const findings: Finding[] = [];
  const claims: Claims = { counts: [], travel: [], calendar: [] };
  const truncatedLabels: string[] = [];
  let digest = '';
  let rejected = 0;
  let error: string | null = null;
  let gate = '';
  let ledgerFindings: Finding[] = [];
  try {
    let index = 0;
    let count = 1;
    while (index < count && !abandoned) {
      if (!d.open) { abandoned = true; break; } // the dialog closed under the run (belt to the close event's braces)
      const r = await apiFetch('/api/aris/editorial', {
        method: 'POST',
        body: JSON.stringify({ manuscriptId, sectionIndex: index, digest, provider, model }),
      });
      if (!r) { error = 'Aris could not be reached'; break; }
      if ('__error' in r) { error = String(r.__error); break; }
      const section = r.section as { index: number; count: number; label: string; empty?: boolean } | undefined;
      if (!section || typeof section.count !== 'number') { error = 'Aris sent back something unreadable'; break; }
      count = section.count;
      put(d, '[data-aris="editorial-status"]', `Reading ${section.label} — ${section.index + 1} of ${count}`);
      const report = r.report as
        | { findings: Finding[]; claims: Claims; digest: string; rejected: number; truncated?: boolean }
        | undefined;
      if (!section.empty && report) {
        digest = report.digest;
        rejected += report.rejected;
        if (report.truncated) truncatedLabels.push(section.label);
        findings.push(...report.findings);
        claims.counts.push(...report.claims.counts);
        claims.travel.push(...report.claims.travel);
        claims.calendar.push(...report.claims.calendar);
      }
      index++;
    }

    if (!error && !abandoned) {
      const v = await apiFetch('/api/aris/editorial/verdict', { method: 'POST', body: JSON.stringify({ findings, claims }) });
      if (v && !('__error' in v)) {
        gate = String(v.gate);
        ledgerFindings = (v.ledgerFindings as Finding[]) ?? [];
      } else error = v ? String(v.__error) : 'Aris could not be reached';
    }
  } catch {
    error = 'the read broke off unexpectedly';
  } finally {
    // Whatever happened — a throw included — the dialog must come back
    // usable: a wedged Run button would outlive any error message.
    put(
      d,
      '[data-aris="editorial-status"]',
      error ? `${error} — the partial report stands below` : abandoned ? 'Abandoned — the partial report stands below' : 'The read is done.',
    );
    render(d, gate, [...findings, ...ledgerFindings], claims, rejected, truncatedLabels);
    if (runBtn) { runBtn.hidden = false; runBtn.textContent = 'Run it again'; }
    if (abandonBtn) abandonBtn.hidden = true;
    running = false;
  }
}

function render(
  d: HTMLDialogElement,
  gate: string,
  findings: Finding[],
  claims: Claims,
  rejected: number,
  truncatedLabels: string[] = [],
): void {
  const box = d.querySelector<HTMLElement>('[data-aris="editorial-report"]');
  if (!box) return;
  box.hidden = false;
  box.textContent = '';
  if (gate) {
    const banner = el('p', { 'data-aris': 'editorial-gate', 'data-gate': gate.startsWith('PASS') ? 'pass' : 'fail' }, gate);
    box.appendChild(banner);
  }
  if (truncatedLabels.length) {
    // A verdict over half-read chapters must say so — a quiet PASS over
    // unread pages would be a fake-green.
    box.appendChild(
      el(
        'p',
        { 'data-aris': 'editorial-truncated' },
        `Read only in part (over the lens's window): ${truncatedLabels.join(', ')} — the rest of those sections went unread.`,
      ),
    );
  }
  for (const severity of ['critical', 'major', 'minor'] as const) {
    const group = findings.filter((f) => f.severity === severity);
    if (!group.length) continue;
    box.appendChild(el('h4', {}, `${severity} — ${group.length}`));
    for (const f of group) {
      const item = el('div', { 'data-aris': 'editorial-finding' });
      item.appendChild(el('p', { class: 'aris-ed-where' }, `${f.category} · ${f.location}`));
      item.appendChild(el('blockquote', {}, f.quote));
      item.appendChild(el('p', {}, f.why));
      item.appendChild(el('p', { class: 'aris-ed-fix' }, f.fix));
      box.appendChild(item);
    }
  }
  if (!findings.length) box.appendChild(el('p', {}, 'No findings Aris could quote.'));
  if (rejected > 0)
    box.appendChild(el('p', { 'data-aris': 'editorial-rejected' }, `${rejected} finding${rejected === 1 ? '' : 's'} were rejected for lacking a verbatim quote — the lens is held to its own law.`));
  if (claims.travel.length || claims.calendar.length) {
    box.appendChild(el('h4', {}, 'For your own eye — extracted, not verified'));
    for (const t of claims.travel) box.appendChild(el('p', { class: 'aris-ed-claim' }, `${t.chapter}: ${t.from} → ${t.to} — “${t.quote}”`));
    for (const c of claims.calendar) box.appendChild(el('p', { class: 'aris-ed-claim' }, `${c.chapter}: ${c.event} — ${c.date} — “${c.quote}”`));
  }
}
