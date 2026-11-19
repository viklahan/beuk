import { loadPersona } from './persona.js';
import { covenantBlock, type CovenantEntry } from './prompts.js';
import type { ArisMessage } from './providers.js';
import type { CalendarClaim, CountClaim, EditorialClaims, EditorialFinding, TravelClaim } from './ledger.js';

/**
 * The editorial lens engine. The prompt asks for one JSON report; the
 * parser trusts none of it: findings and claims survive only with a
 * verbatim quote from the batch text (normalized comparison), and every
 * dropped item is counted in `rejected` — the lens's honesty is itself
 * part of the report. Arithmetic never happens here (src/aris/ledger.ts).
 */
export const EDITORIAL_WINDOW_CHARS = 24_000;
export const EDITORIAL_MAX_TOKENS = 4096;
// Must leave most of EDITORIAL_MAX_TOKENS (~4 chars/token) for the findings
// and claims: a digest that filled the output budget would cut the reply
// mid-JSON on exactly the long books the lens targets.
export const DIGEST_MAX_CHARS = 6_000;

export type EditorialBatchInput = {
  sectionText: string;
  sectionLabel: string;
  digest: string;
  bookTitle: string;
  covenants: CovenantEntry[];
};

export type EditorialBatchReport = {
  findings: EditorialFinding[];
  claims: EditorialClaims;
  digest: string;
  rejected: number;
  truncated: boolean;
};

const OUTPUT_CONTRACT = `Reply with ONE JSON object and nothing else — no preamble, no code fence:
{"digest": "<the extended state digest>",
 "findings": [{"severity": "critical|major|minor", "category": "continuity|prose|ledger", "location": "<where>", "quote": "<verbatim words from the section>", "why": "<why it fails>", "fix": "<smallest honest fix>"}],
 "claims": {"counts": [{"chapter": "<label>", "subject": "<what is counted>", "op": "set|loss|gain", "amount": <number>, "quote": "<verbatim>"}],
            "travel": [{"chapter": "<label>", "from": "<place>", "to": "<place>", "quote": "<verbatim>"}],
            "calendar": [{"chapter": "<label>", "event": "<what>", "date": "<as stated>", "quote": "<verbatim>"}]}}
Every quote must be copied verbatim from the section text. A finding or claim you cannot quote does not exist.
Keep the digest under ${DIGEST_MAX_CHARS} characters — carry forward only what later batches need to keep the book honest.`;

export function buildEditorialPrompt(input: EditorialBatchInput): ArisMessage[] {
  const persona = loadPersona();
  const text =
    input.sectionText.length > EDITORIAL_WINDOW_CHARS
      ? input.sectionText.slice(0, EDITORIAL_WINDOW_CHARS) + '\n[truncated for this read]'
      : input.sectionText;
  const covenant = covenantBlock(input.covenants);
  const user = [
    `<book title="${input.bookTitle.replace(/"/g, "'")}">`,
    covenant ? `<covenant>\n${covenant}\n</covenant>` : '',
    `<digest>\n${input.digest || 'none — this is the first batch'}\n</digest>`,
    `<section label="${input.sectionLabel.replace(/"/g, "'")}">\n${text}\n</section>`,
    OUTPUT_CONTRACT,
  ]
    .filter(Boolean)
    .join('\n\n');
  return [
    { role: 'system', content: `${persona.core}\n\n${persona.editorial}` },
    { role: 'user', content: user },
  ];
}

/** Whitespace-collapsed, curly-quote-normalized containment: the honesty
 *  bar a quote must clear. */
const normalize = (s: string) =>
  s
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/—/g, '--') // stored text keeps '--' and '*' as typed (src/shares/render.ts); models quote them back typeset
    .replace(/–/g, '-')
    .replace(/[*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const quoted = (haystackNorm: string, quote: unknown): quote is string =>
  typeof quote === 'string' && quote.trim().length > 0 && haystackNorm.includes(normalize(quote));

const SEVERITIES = new Set(['critical', 'major', 'minor']);
const CATEGORIES = new Set(['continuity', 'prose', 'ledger']);
const OPS = new Set(['set', 'loss', 'gain']);
const str = (v: unknown): v is string => typeof v === 'string';

export function parseEditorialReply(
  replyText: string,
  sectionText: string,
  truncated: boolean,
): EditorialBatchReport | { error: string } {
  const start = replyText.indexOf('{');
  const end = replyText.lastIndexOf('}');
  if (start < 0 || end <= start) return { error: 'the lens returned an unreadable report — retry' };
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(replyText.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return { error: 'the lens returned an unreadable report — retry' };
  }
  // A reply missing its fields must never read as a clean batch: {} would
  // pass as "no findings", and a missing digest would wipe the rolling
  // state the next batch depends on.
  if (!Array.isArray(raw.findings) || typeof raw.claims !== 'object' || raw.claims === null || !str(raw.digest) || !raw.digest.trim()) {
    return { error: 'the lens returned an incomplete report — retry' };
  }
  const haystack = normalize(sectionText);
  let rejected = 0;

  const findings: EditorialFinding[] = [];
  for (const f of Array.isArray(raw.findings) ? (raw.findings as Record<string, unknown>[]) : []) {
    if (
      f &&
      str(f.severity) && SEVERITIES.has(f.severity) &&
      str(f.category) && CATEGORIES.has(f.category) &&
      str(f.location) && str(f.why) && str(f.fix) &&
      quoted(haystack, f.quote)
    ) {
      findings.push({
        severity: f.severity as EditorialFinding['severity'],
        category: f.category as EditorialFinding['category'],
        location: f.location,
        quote: f.quote as string,
        why: f.why,
        fix: f.fix,
      });
    } else rejected++;
  }

  const rawClaims = (raw.claims ?? {}) as Record<string, unknown>;
  const counts: CountClaim[] = [];
  for (const c of Array.isArray(rawClaims.counts) ? (rawClaims.counts as Record<string, unknown>[]) : []) {
    if (
      c && str(c.chapter) && str(c.subject) && str(c.op) && OPS.has(c.op) &&
      typeof c.amount === 'number' && Number.isFinite(c.amount) &&
      quoted(haystack, c.quote)
    ) {
      counts.push({ chapter: c.chapter, subject: c.subject, op: c.op as CountClaim['op'], amount: c.amount, quote: c.quote as string });
    } else rejected++;
  }
  const travel: TravelClaim[] = [];
  for (const t of Array.isArray(rawClaims.travel) ? (rawClaims.travel as Record<string, unknown>[]) : []) {
    if (t && str(t.chapter) && str(t.from) && str(t.to) && quoted(haystack, t.quote)) {
      travel.push({ chapter: t.chapter, from: t.from, to: t.to, quote: t.quote as string });
    } else rejected++;
  }
  const calendar: CalendarClaim[] = [];
  for (const d of Array.isArray(rawClaims.calendar) ? (rawClaims.calendar as Record<string, unknown>[]) : []) {
    if (d && str(d.chapter) && str(d.event) && str(d.date) && quoted(haystack, d.quote)) {
      calendar.push({ chapter: d.chapter, event: d.event, date: d.date, quote: d.quote as string });
    } else rejected++;
  }

  return {
    findings,
    claims: { counts, travel, calendar },
    digest: String(raw.digest ?? '').slice(0, DIGEST_MAX_CHARS),
    rejected,
    truncated,
  };
}
