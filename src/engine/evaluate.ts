// Tessera decision engine. Pure, deterministic, no DOM access.
// Rules are documented in README.md ("Algorithm") and traced into `reasons` for every result.
import { CATALOG, CSF_VERSION, SUBSET_LABEL } from './catalog';
import type {
  CsfFunction,
  Decision,
  Evidence,
  EvidenceAssessment,
  EvidencePack,
  Freshness,
  FunctionRollup,
  Priority,
  Report,
  RiskBand,
  Status,
  SubcategoryResult,
} from './types';

const DAY = 86_400_000;

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso + 'T00:00:00Z');
  const to = Date.parse(toIso + 'T00:00:00Z');
  return Math.round((to - from) / DAY);
}

/** Fresh within validDays; aging up to 1.5x validDays; stale after that (or if dated in the future). */
export function assessFreshness(
  collectedOn: string,
  validDays: number,
  asOf: string,
): { freshness: Freshness; ageDays: number } {
  const ageDays = daysBetween(collectedOn, asOf);
  if (ageDays < 0) return { freshness: 'stale', ageDays };
  if (ageDays <= validDays) return { freshness: 'fresh', ageDays };
  if (ageDays <= validDays * 1.5) return { freshness: 'aging', ageDays };
  return { freshness: 'stale', ageDays };
}

const FRESHNESS_FACTOR: Record<Freshness, number> = { fresh: 1, aging: 0.5, stale: 0 };
const SCOPE_FACTOR = { full: 1, partial: 0.5 } as const;

/** Exposure factor: how much of the priority weight remains as residual risk for a status. */
const EXPOSURE: Record<Status, number> = {
  none: 1,
  refuted: 1,
  contradicted: 1,
  weak: 0.8,
  partial: 0.5,
  sufficient: 0.15,
  'accepted-risk': 0.6, // accepted without evidence: lower than 'none' because a named reviewer owns it, but still a gap
  'not-applicable': 0,
};

export function residualFor(status: Status, priority: Priority): number {
  return Math.round(EXPOSURE[status] * priority * 100) / 100;
}

export function bandFor(residual: number): RiskBand {
  if (residual < 0.75) return 'low';
  if (residual < 1.75) return 'moderate';
  return 'high';
}

export const MIN_OVERRIDE_RATIONALE = 40;
/** Reviewer decisions age like evidence: older than this (or dated in the future) they are ignored with a warning. */
export const DECISION_VALID_DAYS = 365;

function computedStatusFor(coverage: number, distinctTypes: number): Status {
  if (coverage <= 0) return 'none';
  if (coverage >= 1 && distinctTypes >= 2) return 'sufficient';
  if (coverage >= 1) return 'partial'; // enough weight, but a single evidence type (single-source)
  return 'weak'; // some current evidence, but not enough weight
}

export function evaluateSubcategory(subcategoryId: string, pack: EvidencePack): SubcategoryResult {
  const asOf = pack.profile.asOf;
  const priority: Priority = pack.profile.priorities[subcategoryId] ?? 2;
  const reasons: string[] = [];
  const related = pack.evidence.filter((e) => e.subcategoryIds.includes(subcategoryId));

  const assessments: EvidenceAssessment[] = [];
  const supportingTypes = new Set<string>();
  const currentRefutations: string[] = [];
  const staleRefutations: string[] = [];
  let coverage = 0;

  for (const e of related) {
    const { freshness, ageDays } = assessFreshness(e.collectedOn, e.validDays, asOf);
    let weight = 0;
    if (e.assertion === 'supports') {
      weight = FRESHNESS_FACTOR[freshness] * SCOPE_FACTOR[e.scope];
      coverage += weight;
      if (weight > 0) supportingTypes.add(e.type);
    } else if (freshness === 'stale') {
      staleRefutations.push(e.id);
    } else {
      currentRefutations.push(e.id);
    }
    assessments.push({ evidenceId: e.id, freshness, ageDays, weight });
    reasons.push(
      `${e.id} (${e.type}, ${e.assertion}, ${e.scope}) is ${freshness} at ${ageDays} days vs ${e.validDays} valid days → weight ${weight}`,
    );
  }
  coverage = Math.round(coverage * 1000) / 1000;
  if (staleRefutations.length) reasons.push(`Stale refutation ignored: ${staleRefutations.join(', ')}`);

  let computed: Status;
  if (currentRefutations.length && coverage > 0) {
    computed = 'contradicted';
    reasons.push(`Contradicted: ${currentRefutations.join(', ')} refute while current evidence supports`);
  } else if (currentRefutations.length) {
    computed = 'refuted';
    reasons.push(`Refuted: only current evidence (${currentRefutations.join(', ')}) refutes the outcome`);
  } else {
    computed = computedStatusFor(coverage, supportingTypes.size);
    reasons.push(`Coverage ${coverage} from ${supportingTypes.size} evidence type(s) → ${computed}`);
  }

  // Reviewer overlay. Decisions never silently hide a contradiction or refutation, and they age.
  const warnings: string[] = [];
  const decisionRecord = pack.decisions.find((d) => d.subcategoryId === subcategoryId);
  let decision = decisionRecord;
  let decisionAgeDays: number | undefined;
  if (decisionRecord) {
    decisionAgeDays = daysBetween(decisionRecord.decidedOn, asOf);
    if (decisionAgeDays < 0 || decisionAgeDays > DECISION_VALID_DAYS) {
      warnings.push(`stale decision ignored: ${decisionRecord.verdict} by ${decisionRecord.reviewer} on ${decisionRecord.decidedOn} (${decisionAgeDays} days; limit ${DECISION_VALID_DAYS}) — re-review required`);
      reasons.push(`Decision from ${decisionRecord.decidedOn} is stale (${decisionAgeDays} days vs ${DECISION_VALID_DAYS}) and was not applied`);
      decision = undefined;
    }
  }
  let status: Status = computed;
  let override = false;
  let overrideValid = false;
  if (decision) {
    switch (decision.verdict) {
      case 'not-applicable':
        if (computed === 'contradicted' || computed === 'refuted') {
          warnings.push(`not-applicable verdict ignored while evidence is ${computed}`);
          reasons.push(`Not applicable rejected: ${computed} evidence must be resolved before scoping the outcome out`);
        } else if (decision.rationale.trim().length < MIN_OVERRIDE_RATIONALE) {
          warnings.push('not-applicable verdict needs a substantive scope rationale');
          reasons.push(`Not applicable rejected: scope rationale must be at least ${MIN_OVERRIDE_RATIONALE} characters`);
        } else {
          status = 'not-applicable';
          reasons.push(`Scoped out by ${decision.reviewer} (not applicable): ${decision.rationale}`);
        }
        break;
      case 'gap':
        if (status !== 'contradicted' && status !== 'refuted' && status !== 'none') {
          status = 'weak';
        }
        reasons.push(`Reviewer ${decision.reviewer} recorded a gap: ${decision.rationale}`);
        break;
      case 'needs-more':
        if (status === 'sufficient') status = 'partial';
        reasons.push(`Reviewer ${decision.reviewer} asked for more evidence: ${decision.rationale}`);
        break;
      case 'accepted':
        if (computed === 'contradicted' || computed === 'refuted') {
          warnings.push(`acceptance ignored while evidence is ${computed}`);
          reasons.push('Reviewer acceptance ignored: contradicted/refuted outcomes cannot be accepted');
        } else if (computed !== 'sufficient') {
          override = true;
          overrideValid = decision.rationale.trim().length >= MIN_OVERRIDE_RATIONALE;
          if (overrideValid && computed === 'none') {
            status = 'accepted-risk';
            reasons.push(`Reviewer ${decision.reviewer} accepted the outcome with no current evidence → recorded as accepted-risk (an explicit gap, not sufficiency): ${decision.rationale}`);
          } else if (overrideValid) {
            status = 'sufficient';
            reasons.push(`Reviewer override by ${decision.reviewer} accepted (${computed} → sufficient): ${decision.rationale}`);
          } else {
            warnings.push('override rationale too short; computed status kept');
            reasons.push(
              `Reviewer override rejected: rationale must be at least ${MIN_OVERRIDE_RATIONALE} characters`,
            );
          }
        } else {
          reasons.push(`Reviewer ${decision.reviewer} accepted the computed result`);
        }
        break;
    }
  }

  const residual = residualFor(status, priority);
  const result: SubcategoryResult = {
    subcategoryId,
    status,
    computedStatus: computed,
    coverage,
    distinctTypes: supportingTypes.size,
    evidence: assessments,
    contradictions: computed === 'contradicted' ? currentRefutations : [],
    priority,
    residual,
    band: bandFor(residual),
    override,
    overrideValid,
    decision: decisionRecord,
    decisionAgeDays,
    reasons,
    warnings,
  };
  result.remediation = remediationFor(result, related);
  return result;
}

function remediationFor(r: SubcategoryResult, related: Evidence[]): string | undefined {
  switch (r.status) {
    case 'sufficient':
    case 'not-applicable':
      return undefined;
    case 'contradicted':
      return `Resolve contradiction: ${r.contradictions.join(', ')} refute the outcome. Investigate the refuting artifact before accepting any supporting evidence.`;
    case 'refuted':
      return 'Outcome is currently refuted. Treat as a confirmed gap: open remediation and collect corrective evidence.';
    case 'accepted-risk':
      return `Accepted risk without evidence (reviewer ${r.decision?.reviewer ?? 'unknown'}, ${r.decision?.decidedOn ?? ''}). This stays an open gap: collect at least one current artifact or formally scope the outcome out; the acceptance lapses after ${DECISION_VALID_DAYS} days.`;
    case 'none': {
      const stale = r.evidence.filter((e) => e.freshness === 'stale').map((e) => e.evidenceId);
      if (stale.length) {
        return `No current evidence: all ${stale.length} artifact(s) are stale (${stale.join(', ')}). Re-collect them before the outcome can count.`;
      }
      return 'No evidence recorded. Identify an owner and collect at least two artifact types (for example a policy plus a configuration or log sample).';
    }
    default: {
      const stale = r.evidence.filter((e) => e.freshness === 'stale').map((e) => e.evidenceId);
      const aging = r.evidence.filter((e) => e.freshness === 'aging').map((e) => e.evidenceId);
      const parts: string[] = [];
      if (stale.length) parts.push(`Refresh stale evidence: ${stale.join(', ')}.`);
      if (aging.length) parts.push(`Plan refresh for aging evidence: ${aging.join(', ')}.`);
      if (r.distinctTypes < 2 && r.coverage > 0) {
        const have = new Set(related.filter((e) => e.assertion === 'supports').map((e) => e.type));
        parts.push(`Add a second evidence type (currently only: ${[...have].join(', ') || 'none'}).`);
      }
      if (r.coverage < 1) parts.push(`Increase coverage from ${r.coverage} to at least 1.0 (full-scope current artifacts count 1.0).`);
      if (r.override && !r.overrideValid) parts.push('Reviewer override needs a substantive rationale or must be withdrawn.');
      return parts.join(' ');
    }
  }
}

export function evaluatePack(pack: EvidencePack): { results: SubcategoryResult[]; rollups: FunctionRollup[] } {
  const results = CATALOG.map((s) => evaluateSubcategory(s.id, pack));
  const fns: CsfFunction[] = ['GV', 'ID', 'PR', 'DE', 'RS', 'RC'];
  const rollups: FunctionRollup[] = fns.map((fn) => {
    const inFn = results.filter((r) => CATALOG.find((s) => s.id === r.subcategoryId)!.fn === fn);
    const scored = inFn.filter((r) => r.status !== 'not-applicable');
    const meanResidual = scored.length
      ? Math.round((scored.reduce((a, r) => a + r.residual, 0) / scored.length) * 100) / 100
      : null;
    return {
      fn,
      functionName: CATALOG.find((s) => s.fn === fn)!.functionName,
      count: inFn.length,
      assessed: scored.length,
      sufficient: inFn.filter((r) => r.status === 'sufficient').length,
      meanResidual,
      band: meanResidual === null ? 'not-assessed' : bandFor(meanResidual),
    };
  });
  return { results, rollups };
}

export const SCORING_NOTE =
  'Residual exposure, coverage weights and status thresholds (including the accepted-risk exposure of 0.6) are a custom educational heuristic defined in this project (README → Algorithm). They are not a NIST score, tier or maturity rating; CSF 2.0 does not define numeric scoring.';

export const DECISION_POLICY =
  `Reviewer decisions are valid for ${DECISION_VALID_DAYS} days from decidedOn and never when dated after the evaluation date; stale decisions are ignored with a warning. Accepting an outcome that has no current evidence records accepted-risk, which remains in the gap register; it never produces 'sufficient'.`;

export const DISCLAIMER =
  'Educational prototype using synthetic evidence. Output is a readiness view against a 25-subcategory subset of NIST CSF 2.0; it is not a certification, attestation, audit opinion or legal/compliance conclusion.';

export function buildReport(pack: EvidencePack): Report {
  const { results, rollups } = evaluatePack(pack);
  const gaps = results
    .filter((r) => r.status !== 'sufficient' && r.status !== 'not-applicable')
    .sort((a, b) => b.residual - a.residual || a.subcategoryId.localeCompare(b.subcategoryId));
  return {
    schema: 'tessera.report/1',
    generatedFor: pack.profile.name,
    asOf: pack.profile.asOf,
    framework: CSF_VERSION,
    subset: SUBSET_LABEL,
    results,
    rollups,
    gaps,
    scoringNote: SCORING_NOTE,
    decisionPolicy: DECISION_POLICY,
    disclaimer: DISCLAIMER,
  };
}

/** RFC 4180-style CSV with spreadsheet formula-injection neutralisation. */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number): string => {
    let s = String(v);
    // Neutralise formula triggers even when hidden behind leading whitespace/control characters.
    if (/^[\s\u0000-\u001f]*[=+\-@]/.test(s) || /^[\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

export function reportToCsvRows(report: Report): (string | number)[][] {
  const rows: (string | number)[][] = [
    ['subcategory', 'function', 'category', 'status', 'computed', 'coverage', 'types', 'priority', 'residual', 'band', 'override', 'remediation'],
  ];
  for (const r of report.results) {
    const s = CATALOG.find((c) => c.id === r.subcategoryId)!;
    rows.push([
      r.subcategoryId,
      s.functionName,
      s.categoryName,
      r.status,
      r.computedStatus,
      r.coverage,
      r.distinctTypes,
      r.priority,
      r.residual,
      r.band,
      r.override ? (r.overrideValid ? 'valid' : 'invalid') : '',
      r.remediation ?? '',
    ]);
  }
  return rows;
}

export function decisionsFor(pack: EvidencePack, subcategoryId: string): Decision | undefined {
  return pack.decisions.find((d) => d.subcategoryId === subcategoryId);
}
