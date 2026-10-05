// Tessera decision engine. Pure, deterministic, no DOM access.
// Every threshold comes from the rule policy (pack.policy, otherwise DEFAULT_POLICY — see policy.ts and docs/policy.md).
// Rules are documented in README.md ("Algorithm") and traced into `reasons` for every result.
import { CATALOG, CSF_VERSION, SUBSET_LABEL } from './catalog';
import { DEFAULT_POLICY, canonicalPolicy, effectivePolicy, isDefaultPolicy, type RulePolicy } from './policy';
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

/** Fresh within validDays; aging up to agingMultiplier × validDays (1.5 by default); stale after that (or if dated in the future). */
export function assessFreshness(
  collectedOn: string,
  validDays: number,
  asOf: string,
  agingMultiplier: number = DEFAULT_POLICY.agingMultiplier,
): { freshness: Freshness; ageDays: number } {
  const ageDays = daysBetween(collectedOn, asOf);
  if (ageDays < 0) return { freshness: 'stale', ageDays };
  if (ageDays <= validDays) return { freshness: 'fresh', ageDays };
  if (ageDays <= validDays * agingMultiplier) return { freshness: 'aging', ageDays };
  return { freshness: 'stale', ageDays };
}

/** Residual exposure: how much of the priority weight remains as residual risk for a status (policy.exposure × priority). */
export function residualFor(status: Status, priority: Priority, policy: RulePolicy = DEFAULT_POLICY): number {
  return Math.round(policy.exposure[status] * priority * 100) / 100;
}

export function bandFor(residual: number, policy: RulePolicy = DEFAULT_POLICY): RiskBand {
  if (residual < policy.bands.moderate) return 'low';
  if (residual < policy.bands.high) return 'moderate';
  return 'high';
}

/** Legacy alias of DEFAULT_POLICY.minOverrideRationale. The engine reads the effective policy of the pack, not this constant. */
export const MIN_OVERRIDE_RATIONALE: number = DEFAULT_POLICY.minOverrideRationale;
/**
 * Reviewer decisions age like evidence: older than this (or dated in the future) they are ignored with a warning.
 * Legacy alias of DEFAULT_POLICY.decisionValidDays; the engine reads the effective policy of the pack.
 */
export const DECISION_VALID_DAYS: number = DEFAULT_POLICY.decisionValidDays;

/** Threshold formatting for prose: integers get one decimal place ("1.0"), other values print as-is. Locale-independent. */
function num(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

function computedStatusFor(coverage: number, distinctTypes: number, policy: RulePolicy): Status {
  if (coverage <= 0) return 'none';
  if (coverage >= policy.sufficientCoverage && distinctTypes >= policy.minDistinctTypes) return 'sufficient';
  if (coverage >= policy.sufficientCoverage) return 'partial'; // enough weight, but too few evidence types (single-source)
  return 'weak'; // some current evidence, but not enough weight
}

/**
 * Separation of duties: true when every current supporting artifact names the reviewer as its collector
 * (compared trimmed and case-insensitively). A current supporting artifact without `collectedBy` makes the rule
 * inapplicable, so packs that carry no provenance evaluate exactly as before.
 */
function collectedOnlyBy(reviewer: string, currentSupporting: Evidence[]): boolean {
  const who = reviewer.trim().toLowerCase();
  return currentSupporting.length > 0 && currentSupporting.every((e) => e.collectedBy !== undefined && e.collectedBy.trim().toLowerCase() === who);
}

export function evaluateSubcategory(subcategoryId: string, pack: EvidencePack): SubcategoryResult {
  const policy = effectivePolicy(pack);
  const asOf = pack.profile.asOf;
  const priority: Priority = pack.profile.priorities[subcategoryId] ?? 2;
  const reasons: string[] = [];
  const related = pack.evidence.filter((e) => e.subcategoryIds.includes(subcategoryId));

  const assessments: EvidenceAssessment[] = [];
  const supportingTypes = new Set<string>();
  const currentSupporting: Evidence[] = [];
  const currentRefutations: string[] = [];
  const staleRefutations: string[] = [];
  let coverage = 0;

  if (related.length) {
    const fw = policy.freshnessWeights;
    const sw = policy.scopeWeights;
    reasons.push(
      `Freshness rule: fresh within validDays, aging up to ${policy.agingMultiplier}× validDays, stale after that or when future-dated; weight = freshness (fresh ${fw.fresh}, aging ${fw.aging}, stale ${fw.stale}) × scope (full ${sw.full}, partial ${sw.partial})`,
    );
  }

  for (const e of related) {
    const { freshness, ageDays } = assessFreshness(e.collectedOn, e.validDays, asOf, policy.agingMultiplier);
    let weight = 0;
    if (e.assertion === 'supports') {
      weight = Math.round(policy.freshnessWeights[freshness] * policy.scopeWeights[e.scope] * 1000) / 1000;
      coverage += weight;
      if (weight > 0) {
        supportingTypes.add(e.type);
        currentSupporting.push(e);
      }
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
    computed = computedStatusFor(coverage, supportingTypes.size, policy);
    reasons.push(
      `Coverage ${coverage} from ${supportingTypes.size} evidence type(s) → ${computed} (sufficient needs coverage ≥ ${policy.sufficientCoverage} from ≥ ${policy.minDistinctTypes} types)`,
    );
  }

  // Reviewer overlay. Decisions never silently hide a contradiction or refutation, and they age.
  const warnings: string[] = [];
  const decisionRecord = pack.decisions.find((d) => d.subcategoryId === subcategoryId);
  let decision = decisionRecord;
  let decisionAgeDays: number | undefined;
  if (decisionRecord) {
    decisionAgeDays = daysBetween(decisionRecord.decidedOn, asOf);
    if (decisionAgeDays < 0 || decisionAgeDays > policy.decisionValidDays) {
      warnings.push(
        `stale decision ignored: ${decisionRecord.verdict} by ${decisionRecord.reviewer} on ${decisionRecord.decidedOn} (${decisionAgeDays} days; limit ${policy.decisionValidDays}) — re-review required`,
      );
      reasons.push(`Decision from ${decisionRecord.decidedOn} is stale (${decisionAgeDays} days; limit ${policy.decisionValidDays}) and was not applied`);
      decision = undefined;
    }
  }
  let status: Status = computed;
  let override = false;
  let overrideValid = false;
  let overrideIssue: SubcategoryResult['overrideIssue'];
  if (decision) {
    const minChars = policy.minOverrideRationale;
    const substantive = decision.rationale.trim().length >= minChars;
    switch (decision.verdict) {
      case 'not-applicable':
        if (computed === 'contradicted' || computed === 'refuted') {
          warnings.push(`not-applicable verdict ignored while evidence is ${computed}`);
          reasons.push(`Not applicable rejected: ${computed} evidence must be resolved before scoping the outcome out`);
        } else if (!substantive) {
          warnings.push('not-applicable verdict needs a substantive scope rationale');
          reasons.push(`Not applicable rejected: scope rationale needs ≥ ${minChars} characters`);
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
          if (!substantive) {
            overrideIssue = 'short-rationale';
            warnings.push('override rationale too short; computed status kept');
            reasons.push(`Reviewer override rejected: rationale needs ≥ ${minChars} characters`);
          } else if (computed === 'none') {
            overrideValid = true;
            status = 'accepted-risk';
            reasons.push(
              `Reviewer ${decision.reviewer} accepted the outcome with no current evidence → recorded as accepted-risk (an explicit gap, not sufficiency): ${decision.rationale}`,
            );
          } else if (policy.separationOfDuties && collectedOnlyBy(decision.reviewer, currentSupporting)) {
            overrideIssue = 'self-review';
            warnings.push(`override refused: reviewer ${decision.reviewer} also collected all current supporting evidence (separation of duties)`);
            reasons.push(
              `Reviewer override refused (separation of duties): ${decision.reviewer} collected every current supporting artifact (${currentSupporting.map((e) => e.id).join(', ')}); independent evidence or a different reviewer is required`,
            );
          } else {
            overrideValid = true;
            status = 'sufficient';
            reasons.push(`Reviewer override by ${decision.reviewer} accepted (${computed} → sufficient): ${decision.rationale}`);
          }
        } else {
          reasons.push(`Reviewer ${decision.reviewer} accepted the computed result`);
        }
        break;
    }
  }

  const residual = residualFor(status, priority, policy);
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
    band: bandFor(residual, policy),
    override,
    overrideValid,
    ...(overrideIssue ? { overrideIssue } : {}),
    decision: decisionRecord,
    decisionAgeDays,
    reasons,
    warnings,
  };
  result.remediation = remediationFor(result, related, policy);
  return result;
}

function typesNeeded(minDistinctTypes: number): string {
  if (minDistinctTypes === 1) return 'at least one current artifact (for example a policy, a configuration export or a log sample)';
  if (minDistinctTypes === 2) return 'at least two artifact types (for example a policy plus a configuration or log sample)';
  return `at least ${minDistinctTypes} artifact types (for example a policy plus a configuration or log sample)`;
}

function remediationFor(r: SubcategoryResult, related: Evidence[], policy: RulePolicy): string | undefined {
  switch (r.status) {
    case 'sufficient':
    case 'not-applicable':
      return undefined;
    case 'contradicted':
      return `Resolve contradiction: ${r.contradictions.join(', ')} refute the outcome. Investigate the refuting artifact before accepting any supporting evidence.`;
    case 'refuted':
      return 'Outcome is currently refuted. Treat as a confirmed gap: open remediation and collect corrective evidence.';
    case 'accepted-risk':
      return `Accepted risk without evidence (reviewer ${r.decision?.reviewer ?? 'unknown'}, ${r.decision?.decidedOn ?? ''}). This stays an open gap: collect at least one current artifact or formally scope the outcome out; the acceptance lapses after ${policy.decisionValidDays} days.`;
    case 'none': {
      const stale = r.evidence.filter((e) => e.freshness === 'stale').map((e) => e.evidenceId);
      if (stale.length) {
        return `No current evidence: all ${stale.length} artifact(s) are stale (${stale.join(', ')}). Re-collect them before the outcome can count.`;
      }
      return `No evidence recorded. Identify an owner and collect ${typesNeeded(policy.minDistinctTypes)}.`;
    }
    default: {
      const stale = r.evidence.filter((e) => e.freshness === 'stale').map((e) => e.evidenceId);
      const aging = r.evidence.filter((e) => e.freshness === 'aging').map((e) => e.evidenceId);
      const parts: string[] = [];
      if (stale.length) parts.push(`Refresh stale evidence: ${stale.join(', ')}.`);
      if (aging.length) parts.push(`Plan refresh for aging evidence: ${aging.join(', ')}.`);
      if (r.distinctTypes < policy.minDistinctTypes && r.coverage > 0) {
        const have = [...new Set(related.filter((e) => e.assertion === 'supports').map((e) => e.type))].join(', ') || 'none';
        parts.push(
          policy.minDistinctTypes === 2
            ? `Add a second evidence type (currently only: ${have}).`
            : `Add evidence types to reach ${policy.minDistinctTypes} distinct types (currently ${r.distinctTypes}: ${have}).`,
        );
      }
      if (r.coverage < policy.sufficientCoverage) {
        parts.push(
          `Increase coverage from ${r.coverage} to at least ${num(policy.sufficientCoverage)} (full-scope current artifacts count ${num(policy.freshnessWeights.fresh * policy.scopeWeights.full)}).`,
        );
      }
      if (r.override && !r.overrideValid) {
        parts.push(
          r.overrideIssue === 'self-review'
            ? 'Reviewer override refused under separation of duties. Independent evidence or a different reviewer is required.'
            : 'Reviewer override needs a substantive rationale or must be withdrawn.',
        );
      }
      return parts.join(' ');
    }
  }
}

export function evaluatePack(pack: EvidencePack): { results: SubcategoryResult[]; rollups: FunctionRollup[] } {
  const policy = effectivePolicy(pack);
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
      band: meanResidual === null ? 'not-assessed' : bandFor(meanResidual, policy),
    };
  });
  return { results, rollups };
}

/** Scoring note for a report computed with `policy`. The phrases "custom educational heuristic", "not a NIST" and "accepted-risk" are part of the report contract. */
export function scoringNoteFor(policy: RulePolicy): string {
  const origin = isDefaultPolicy(policy) ? 'the project defaults' : 'a custom policy';
  return `Residual exposure, coverage weights and status thresholds (including the accepted-risk exposure of ${policy.exposure['accepted-risk']}) are a custom educational heuristic defined in this project (README → Algorithm); the exact values used for this report are in its embedded policy object (${origin}, schema tessera.policy/1). They are not a NIST score, tier or maturity rating; CSF 2.0 does not define numeric scoring.`;
}

export const SCORING_NOTE = scoringNoteFor(DEFAULT_POLICY);

/** Decision-policy statement for a report computed with `policy`; quotes the validity window and rationale minimum in force. */
export function decisionPolicyFor(policy: RulePolicy): string {
  const sod = policy.separationOfDuties
    ? ' Under separation of duties, an accepted override is refused when the reviewer also collected every current supporting artifact.'
    : '';
  return `Reviewer decisions are valid for ${policy.decisionValidDays} days from decidedOn and never when dated after the evaluation date; stale decisions are ignored with a warning. Accepting a non-sufficient outcome or scoping it out needs a rationale of at least ${policy.minOverrideRationale} characters and is refused while evidence is contradicted or refuted.${sod} Accepting an outcome that has no current evidence records accepted-risk, which remains in the gap register; it never produces 'sufficient'.`;
}

export const DECISION_POLICY = decisionPolicyFor(DEFAULT_POLICY);

export const DISCLAIMER =
  'Educational prototype using synthetic evidence. Output is a readiness view against a 25-subcategory subset of NIST CSF 2.0; it is not a certification, attestation, audit opinion or legal/compliance conclusion.';

export function buildReport(pack: EvidencePack): Report {
  const policy = canonicalPolicy(effectivePolicy(pack));
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
    scoringNote: scoringNoteFor(policy),
    decisionPolicy: decisionPolicyFor(policy),
    disclaimer: DISCLAIMER,
    policy,
    policyIsDefault: isDefaultPolicy(policy),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Baseline (0.1) CSV shape. The application exports through src/engine/csv.ts, which extends this twelve-column
// layout and the neutralisation rule; these two functions are kept unchanged as the compatibility oracle that the
// extended exporter is tested against (the first twelve columns of a report CSV must stay byte-identical).
// ---------------------------------------------------------------------------------------------------------------

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
