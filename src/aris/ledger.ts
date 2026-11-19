/**
 * Editorial ledger math and the gate verdict — pure code, no model.
 * The lens EXTRACTS claims with quotes (src/aris/editorial.ts); only this
 * module computes. "Never pretend to know" applied to arithmetic: a count
 * conflict is shown as start − losses = remaining, with the numbers.
 */

export type EditorialSeverity = 'critical' | 'major' | 'minor';
export type EditorialCategory = 'continuity' | 'prose' | 'ledger';
export type EditorialFinding = {
  severity: EditorialSeverity;
  category: EditorialCategory;
  location: string;
  quote: string;
  why: string;
  fix: string;
};
export type CountClaim = { chapter: string; subject: string; op: 'set' | 'loss' | 'gain'; amount: number; quote: string };
export type TravelClaim = { chapter: string; from: string; to: string; quote: string };
export type CalendarClaim = { chapter: string; event: string; date: string; quote: string };
export type EditorialClaims = { counts: CountClaim[]; travel: TravelClaim[]; calendar: CalendarClaim[] };

/** Walk each subject's claims in story order: `set` (re)starts its running
 *  total, `loss`/`gain` adjust it, and a later `set` that disagrees with
 *  the computed total is a major with the arithmetic spelled out. A loss
 *  or gain before any set is a minor (nothing to count from). */
export function verifyCounts(claims: CountClaim[]): EditorialFinding[] {
  const findings: EditorialFinding[] = [];
  const totals = new Map<string, { value: number; sinceSet: number[] }>();
  for (const claim of claims) {
    const running = totals.get(claim.subject);
    if (claim.op === 'set') {
      if (running && running.value !== claim.amount) {
        const losses = running.sinceSet.filter((n) => n < 0).reduce((a, b) => a - b, 0);
        const gains = running.sinceSet.filter((n) => n > 0).reduce((a, b) => a + b, 0);
        const start = running.value + losses - gains;
        findings.push({
          severity: 'major',
          category: 'ledger',
          location: `chapter ${claim.chapter}`,
          quote: claim.quote,
          why:
            `${claim.subject}: ${start} − ${losses}` +
            (gains ? ` + ${gains}` : '') +
            ` = ${running.value}, but the text now says ${claim.amount}`,
          fix: `reconcile the ${claim.subject} count: carry ${running.value} forward or account for the difference on-page`,
        });
      }
      totals.set(claim.subject, { value: claim.amount, sinceSet: [] });
    } else {
      const delta = claim.op === 'loss' ? -claim.amount : claim.amount;
      if (!running) {
        findings.push({
          severity: 'minor',
          category: 'ledger',
          location: `chapter ${claim.chapter}`,
          quote: claim.quote,
          why: `${claim.subject}: a ${claim.op} of ${claim.amount} with no earlier stated total to count from`,
          fix: `state the starting ${claim.subject} count before spending it`,
        });
      } else {
        running.value += delta;
        running.sinceSet.push(delta);
      }
    }
  }
  return findings;
}

/** The gate is deterministic: any critical fails; more than three majors
 *  sharing one category fails; everything else passes. Tallies ride along
 *  as the report's temperature. */
export function verdict(findings: EditorialFinding[]): {
  gate: 'PASS' | 'FAIL — DO NOT SHIP';
  tallies: Record<EditorialSeverity, number>;
} {
  const tallies: Record<EditorialSeverity, number> = { critical: 0, major: 0, minor: 0 };
  const majorsByCategory = new Map<EditorialCategory, number>();
  for (const finding of findings) {
    tallies[finding.severity]++;
    if (finding.severity === 'major')
      majorsByCategory.set(finding.category, (majorsByCategory.get(finding.category) ?? 0) + 1);
  }
  const categoryFail = [...majorsByCategory.values()].some((n) => n > 3);
  const gate = tallies.critical > 0 || categoryFail ? 'FAIL — DO NOT SHIP' : 'PASS';
  return { gate, tallies };
}
