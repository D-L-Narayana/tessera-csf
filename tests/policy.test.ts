import { describe, expect, it } from 'vitest';
import {
  DECISION_POLICY,
  DECISION_VALID_DAYS,
  MIN_OVERRIDE_RATIONALE,
  assessFreshness,
  bandFor,
  buildReport,
  decisionPolicyFor,
  evaluatePack,
  evaluateSubcategory,
  residualFor,
} from '../src/engine/evaluate';
import { DEFAULT_POLICY, canonicalPolicy, effectivePolicy, isDefaultPolicy, type RulePolicy } from '../src/engine/policy';
import { validatePack } from '../src/engine/validate';
import type { Decision, EvidencePack, Status } from '../src/engine/types';
import demo from '../src/fixtures/harbourline-pack.json';
import { AS_OF, ev, pack } from './helpers/pack';

type PolicyPatch = Partial<Omit<RulePolicy, 'schema'>>;
const policy = (patch: PolicyPatch): RulePolicy => ({ ...DEFAULT_POLICY, ...patch });
const withPolicy = (p: EvidencePack, patch: PolicyPatch): EvidencePack => ({ ...p, policy: policy(patch) });

const LONG = 'Compensating manual review observed during the walkthrough on 2026-09-20; the ticket corroborates it.';
const decide = (verdict: Decision['verdict'], rationale: string, decidedOn = AS_OF): Decision => ({
  subcategoryId: 'PR.AA-05',
  reviewer: 'r.kaur',
  verdict,
  rationale,
  decidedOn,
});
const result = <T extends { subcategoryId: string }>(report: { results: T[] }, id: string): T => report.results.find((r) => r.subcategoryId === id)!;

const fixture: EvidencePack = (() => {
  const r = validatePack(JSON.stringify(demo));
  if (!r.ok) throw new Error('bundled fixture failed validation: ' + r.issues.map((i) => i.path + ' ' + i.message).join('; '));
  return r.pack;
})();

// Statuses of the bundled fixture (asOf 2026-10-01) under the fixed-constant baseline engine. Any change here is a
// behaviour change for every existing pack and must be deliberate.
const BASELINE_STATUS: Record<string, Status> = {
  'GV.OC-03': 'weak',
  'GV.RM-02': 'none',
  'GV.RR-02': 'partial',
  'GV.PO-01': 'partial',
  'GV.SC-04': 'weak',
  'GV.SC-07': 'weak',
  'ID.AM-01': 'sufficient',
  'ID.AM-02': 'sufficient',
  'ID.RA-01': 'none',
  'ID.RA-05': 'none',
  'ID.IM-02': 'partial',
  'PR.AA-01': 'sufficient',
  'PR.AA-05': 'sufficient',
  'PR.AT-01': 'partial',
  'PR.DS-01': 'partial',
  'PR.DS-11': 'contradicted',
  'PR.PS-01': 'none',
  'PR.PS-02': 'sufficient',
  'PR.IR-01': 'weak',
  'DE.CM-01': 'none',
  'DE.AE-02': 'none',
  'RS.MA-01': 'sufficient',
  'RS.AN-03': 'partial',
  'RC.RP-01': 'none',
  'RC.CO-03': 'accepted-risk',
};

describe('rule policy — the default policy reproduces the baseline engine', () => {
  it('evaluates the bundled fixture to the baseline status of every outcome', () => {
    const report = buildReport(fixture);
    const statuses = Object.fromEntries(report.results.map((r) => [r.subcategoryId, r.status]));
    expect(statuses).toEqual(BASELINE_STATUS);
    expect(Object.keys(statuses).length).toBe(25);
    expect(report.policyIsDefault).toBe(true);
  });

  it('keeps the legacy constants as aliases of the default policy', () => {
    expect(MIN_OVERRIDE_RATIONALE).toBe(DEFAULT_POLICY.minOverrideRationale);
    expect(DECISION_VALID_DAYS).toBe(DEFAULT_POLICY.decisionValidDays);
    expect(DECISION_POLICY).toBe(decisionPolicyFor(DEFAULT_POLICY));
  });

  it('residualFor, bandFor and assessFreshness default their policy parameters to the default policy', () => {
    const statuses: Status[] = ['none', 'refuted', 'contradicted', 'weak', 'partial', 'sufficient', 'accepted-risk', 'not-applicable'];
    for (const s of statuses) {
      expect(residualFor(s, 3)).toBe(residualFor(s, 3, DEFAULT_POLICY));
      expect(residualFor(s, 3)).toBe(Math.round(DEFAULT_POLICY.exposure[s] * 3 * 100) / 100);
    }
    expect(residualFor('none', 3)).toBe(3);
    expect(residualFor('sufficient', 3)).toBeCloseTo(0.45);
    expect(bandFor(0.74)).toBe('low');
    expect(bandFor(0.75)).toBe('moderate');
    expect(bandFor(1.74)).toBe('moderate');
    expect(bandFor(1.75)).toBe('high');
    expect(bandFor(1.75)).toBe(bandFor(1.75, DEFAULT_POLICY));
    expect(assessFreshness('2026-06-01', 90, AS_OF).freshness).toBe('aging'); // 122 days ≤ 135
    expect(assessFreshness('2026-06-01', 90, AS_OF, DEFAULT_POLICY.agingMultiplier).freshness).toBe('aging');
  });

  it('evaluates a pack without a policy byte-identically to the same pack with an explicit copy of the default policy', () => {
    const p = pack([ev({ id: 'E1' }), ev({ id: 'E2', type: 'report', scope: 'partial' })], [decide('accepted', 'ok')]);
    const explicit: EvidencePack = { ...p, policy: structuredClone(DEFAULT_POLICY) };
    expect(effectivePolicy(p)).toEqual(DEFAULT_POLICY);
    expect(JSON.stringify(buildReport(p))).toBe(JSON.stringify(buildReport(explicit)));
    expect(buildReport(explicit).policyIsDefault).toBe(true);
  });
});

describe('rule policy — every threshold is read from the pack policy', () => {
  it('agingMultiplier 2 keeps a 170-day-old artifact with 90 valid days aging; the default 1.5 makes it stale', () => {
    expect(assessFreshness('2026-04-14', 90, AS_OF)).toEqual({ freshness: 'stale', ageDays: 170 });
    expect(assessFreshness('2026-04-14', 90, AS_OF, 2)).toEqual({ freshness: 'aging', ageDays: 170 });

    const p = pack([ev({ id: 'E1', collectedOn: '2026-04-14', validDays: 90 })]);
    const base = evaluateSubcategory('PR.AA-05', p);
    expect(base.evidence[0].weight).toBe(0);
    expect(base.status).toBe('none');

    const r = evaluateSubcategory('PR.AA-05', withPolicy(p, { agingMultiplier: 2 }));
    expect(r.evidence[0]).toEqual({ evidenceId: 'E1', freshness: 'aging', ageDays: 170, weight: 0.5 });
    expect(r.status).toBe('weak');
    expect(r.reasons.join(' ')).toMatch(/aging up to 2× validDays/);
  });

  it('freshness and scope weights come from the policy', () => {
    const p = pack([
      ev({ id: 'AGING', type: 'configuration', collectedOn: '2026-06-01', validDays: 90 }), // 122 days: aging
      ev({ id: 'PART', type: 'policy', scope: 'partial' }), // fresh, partial scope
    ]);
    const base = evaluateSubcategory('PR.AA-05', p);
    expect(base.evidence.map((e) => e.weight)).toEqual([0.5, 0.5]);
    expect(base.coverage).toBe(1);

    const r = evaluateSubcategory(
      'PR.AA-05',
      withPolicy(p, { freshnessWeights: { fresh: 1, aging: 0.25, stale: 0 }, scopeWeights: { full: 1, partial: 0.75 } }),
    );
    expect(r.evidence.map((e) => e.weight)).toEqual([0.25, 0.75]);
    expect(r.coverage).toBe(1);
    expect(r.reasons.join(' ')).toMatch(/aging 0\.25/);
    expect(r.reasons.join(' ')).toMatch(/partial 0\.75/);
  });

  it('decisionValidDays 180 ignores a 200-day-old decision with a stale-decision warning that quotes the limit', () => {
    const p = pack([], [decide('not-applicable', LONG, '2026-03-15')]); // 200 days before asOf
    const base = evaluateSubcategory('PR.AA-05', p);
    expect(base.decisionAgeDays).toBe(200);
    expect(base.status).toBe('not-applicable');
    expect(base.warnings).toEqual([]);

    const r = evaluateSubcategory('PR.AA-05', withPolicy(p, { decisionValidDays: 180 }));
    expect(r.status).toBe('none');
    expect(r.decision).toBeDefined(); // the record is kept for the reader even though it was not applied
    expect(r.warnings.join(' ')).toMatch(/stale decision/i);
    expect(r.warnings.join(' ')).toMatch(/limit 180/);
    expect(r.warnings.join(' ')).not.toMatch(/365/);
  });

  it('minOverrideRationale 10 validates the override rationale "Looks fine." that the default 40 refuses', () => {
    const p = pack([ev({ id: 'E1', type: 'ticket', scope: 'partial' })], [decide('accepted', 'Looks fine.')]);
    const base = evaluateSubcategory('PR.AA-05', p);
    expect(base.override).toBe(true);
    expect(base.overrideValid).toBe(false);
    expect(base.overrideIssue).toBe('short-rationale');
    expect(base.status).toBe('weak');
    expect(base.warnings).toContain('override rationale too short; computed status kept');

    const r = evaluateSubcategory('PR.AA-05', withPolicy(p, { minOverrideRationale: 10 }));
    expect(r.override).toBe(true);
    expect(r.overrideValid).toBe(true);
    expect(r.overrideIssue).toBeUndefined();
    expect(r.status).toBe('sufficient');
    expect(r.warnings).toEqual([]);
  });

  it('minOverrideRationale 10 turns the fixture\'s GV.PO-01 acceptance into a valid override without moving any other outcome', () => {
    const report = buildReport(withPolicy(fixture, { minOverrideRationale: 10 }));
    expect(result(report, 'GV.PO-01').overrideValid).toBe(true);
    expect(result(report, 'GV.PO-01').status).toBe('sufficient');
    for (const r of report.results) {
      if (r.subcategoryId !== 'GV.PO-01') expect(r.status).toBe(BASELINE_STATUS[r.subcategoryId]);
    }
    expect(report.policyIsDefault).toBe(false);
  });

  it('minDistinctTypes 1 makes a single-type, coverage-1 outcome sufficient', () => {
    const p = pack([ev({ id: 'E1', type: 'policy' })]);
    expect(evaluateSubcategory('PR.AA-05', p).status).toBe('partial');
    const r = evaluateSubcategory('PR.AA-05', withPolicy(p, { minDistinctTypes: 1 }));
    expect(r.distinctTypes).toBe(1);
    expect(r.status).toBe('sufficient');
    expect(r.remediation).toBeUndefined();
  });

  it('sufficientCoverage 2 keeps coverage 1.5 from two types at weak and reaches sufficient at 2.0', () => {
    const p = pack([ev({ id: 'E1', type: 'policy' }), ev({ id: 'E2', type: 'configuration', scope: 'partial' })]);
    expect(evaluateSubcategory('PR.AA-05', p).status).toBe('sufficient');

    const r = evaluateSubcategory('PR.AA-05', withPolicy(p, { sufficientCoverage: 2 }));
    expect(r.coverage).toBe(1.5);
    expect(r.status).toBe('weak');
    expect(r.remediation).toMatch(/at least 2\.0/);

    const full = withPolicy(pack([ev({ id: 'E1', type: 'policy' }), ev({ id: 'E2', type: 'configuration' })]), { sufficientCoverage: 2 });
    expect(evaluateSubcategory('PR.AA-05', full).status).toBe('sufficient');
  });

  it('bands change the band labels of results and of function rollups', () => {
    const tight = policy({ bands: { moderate: 0.5, high: 1 } });
    expect(bandFor(1)).toBe('moderate');
    expect(bandFor(1, tight)).toBe('high');
    expect(bandFor(0.49, tight)).toBe('low');
    expect(bandFor(0.5, tight)).toBe('moderate');

    const p = pack([], [], { priorities: { 'RC.RP-01': 1, 'RC.CO-03': 1 } });
    const base = evaluatePack(p);
    expect(result(base, 'RC.RP-01').residual).toBe(1);
    expect(result(base, 'RC.RP-01').band).toBe('moderate');
    expect(base.rollups.find((f) => f.fn === 'RC')!.band).toBe('moderate');

    const r = evaluatePack({ ...p, policy: tight });
    expect(result(r, 'RC.RP-01').band).toBe('high');
    expect(r.rollups.find((f) => f.fn === 'RC')!.meanResidual).toBe(1);
    expect(r.rollups.find((f) => f.fn === 'RC')!.band).toBe('high');
  });

  it('exposure changes the residual of a status', () => {
    const softer = policy({ exposure: { ...DEFAULT_POLICY.exposure, weak: 0.5 } });
    expect(residualFor('weak', 2)).toBe(1.6);
    expect(residualFor('weak', 2, softer)).toBe(1);

    const p = pack([ev({ id: 'E1', type: 'ticket', scope: 'partial' })]);
    expect(evaluateSubcategory('PR.AA-05', p).residual).toBe(1.6);
    const r = evaluateSubcategory('PR.AA-05', { ...p, policy: softer });
    expect(r.status).toBe('weak');
    expect(r.residual).toBe(1);
    expect(r.band).toBe('moderate');
  });
});

describe('rule policy — report embedding', () => {
  it('embeds the default policy with policyIsDefault true when the pack has no policy', () => {
    const report = buildReport(pack([]));
    expect(report.policy).toEqual(DEFAULT_POLICY);
    expect(report.policyIsDefault).toBe(true);
    expect(isDefaultPolicy(report.policy)).toBe(true);
  });

  it('embeds a custom policy with policyIsDefault false', () => {
    const custom = policy({ decisionValidDays: 180, minOverrideRationale: 10 });
    const report = buildReport({ ...pack([]), policy: custom });
    expect(report.policy).toEqual(custom);
    expect(report.policyIsDefault).toBe(false);
    expect(isDefaultPolicy(report.policy)).toBe(false);
  });

  it('rebuilds a policy given in another key order into the canonical order so default detection is reliable', () => {
    const shuffled = {
      separationOfDuties: true,
      decisionValidDays: 365,
      minOverrideRationale: 40,
      bands: { high: 1.75, moderate: 0.75 },
      exposure: { 'not-applicable': 0, 'accepted-risk': 0.6, sufficient: 0.15, partial: 0.5, weak: 0.8, contradicted: 1, refuted: 1, none: 1 },
      minDistinctTypes: 2,
      sufficientCoverage: 1,
      scopeWeights: { partial: 0.5, full: 1 },
      freshnessWeights: { stale: 0, aging: 0.5, fresh: 1 },
      agingMultiplier: 1.5,
      schema: 'tessera.policy/1',
    } satisfies RulePolicy;
    expect(JSON.stringify(shuffled)).not.toBe(JSON.stringify(DEFAULT_POLICY));
    expect(JSON.stringify(canonicalPolicy(shuffled))).toBe(JSON.stringify(DEFAULT_POLICY));
    expect(Object.keys(canonicalPolicy(shuffled))).toEqual(Object.keys(DEFAULT_POLICY));
    const report = buildReport({ ...pack([]), policy: shuffled });
    expect(JSON.stringify(report.policy)).toBe(JSON.stringify(DEFAULT_POLICY));
    expect(report.policyIsDefault).toBe(true);
  });

  it('decisionPolicy and scoringNote describe the policy actually used', () => {
    const base = buildReport(pack([]));
    expect(base.decisionPolicy).toMatch(/365 days/);
    expect(base.decisionPolicy).toMatch(/40 characters/);
    expect(base.decisionPolicy).toMatch(/separation of duties/i);
    expect(base.scoringNote).toMatch(/custom educational heuristic/i);
    expect(base.scoringNote).toMatch(/not a NIST/i);
    expect(base.scoringNote).toMatch(/accepted-risk/);
    expect(base.scoringNote).toMatch(/policy/i);

    const custom = buildReport({ ...pack([]), policy: policy({ decisionValidDays: 180, minOverrideRationale: 10, separationOfDuties: false }) });
    expect(custom.decisionPolicy).toBe(decisionPolicyFor(custom.policy));
    expect(custom.decisionPolicy).toMatch(/180 days/);
    expect(custom.decisionPolicy).not.toMatch(/365/);
    expect(custom.decisionPolicy).toMatch(/10 characters/);
    expect(custom.decisionPolicy).not.toMatch(/separation of duties/i);
    expect(custom.scoringNote).toMatch(/custom educational heuristic/i);
    expect(custom.scoringNote).toMatch(/not a NIST/i);
  });

  it('trace lines quote the thresholds in force', () => {
    const p = pack([ev({ id: 'E1', type: 'ticket', scope: 'partial' })], [decide('accepted', 'ok')]);
    const base = evaluateSubcategory('PR.AA-05', p);
    expect(base.reasons.join(' ')).toMatch(/aging up to 1\.5× validDays/);
    expect(base.reasons.join(' ')).toMatch(/≥ 40 characters/);
    expect(base.reasons.join(' ')).toMatch(/coverage ≥ 1 from ≥ 2 types/);

    const custom = evaluateSubcategory('PR.AA-05', withPolicy(p, { minOverrideRationale: 10, sufficientCoverage: 2, minDistinctTypes: 3 }));
    expect(custom.status).toBe('weak'); // "ok" is 2 characters: still short even at a minimum of 10
    expect(custom.overrideIssue).toBe('short-rationale');
    expect(custom.reasons.join(' ')).toMatch(/≥ 10 characters/);
    expect(custom.reasons.join(' ')).toMatch(/coverage ≥ 2 from ≥ 3 types/);

    const stale = evaluateSubcategory('PR.AA-05', withPolicy(pack([], [decide('gap', 'Old finding.', '2026-03-15')]), { decisionValidDays: 180 }));
    expect(stale.reasons.join(' ')).toMatch(/limit 180/);
    expect(evaluateSubcategory('PR.AA-05', pack([], [decide('gap', 'Old finding.', '2020-01-01')])).warnings.join(' ')).toMatch(/limit 365/);
  });

  it('is deterministic with a custom policy: byte-identical report JSON for identical input', () => {
    const p = withPolicy(pack([ev({ id: 'E1' }), ev({ id: 'E2', type: 'report', scope: 'partial' })], [decide('accepted', LONG)]), {
      agingMultiplier: 2,
      bands: { moderate: 0.5, high: 1 },
    });
    expect(JSON.stringify(buildReport(p))).toBe(JSON.stringify(buildReport(structuredClone(p))));
  });
});
