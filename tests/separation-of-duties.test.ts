import { describe, expect, it } from 'vitest';
import { buildReport, evaluateSubcategory, reportToCsvRows } from '../src/engine/evaluate';
import { DEFAULT_POLICY } from '../src/engine/policy';
import type { Decision, Evidence, EvidencePack } from '../src/engine/types';
import { AS_OF, ev, pack } from './helpers/pack';

const LONG = 'Compensating manual review observed during the walkthrough on 2026-09-20; the ticket corroborates it.';
const REFUSAL = 'override refused: reviewer r.kaur also collected all current supporting evidence (separation of duties)';
const INDEPENDENT = 'Independent evidence or a different reviewer is required.';

const accept = (reviewer: string, rationale = LONG): Decision => ({ subcategoryId: 'PR.AA-05', reviewer, verdict: 'accepted', rationale, decidedOn: AS_OF });
/** A current, partial-scope ticket collected by r.kaur: alone it computes to `weak` (coverage 0.5). */
const own = (partial: Partial<Evidence> & { id: string }): Evidence => ev({ type: 'ticket', scope: 'partial', collectedBy: 'r.kaur', ...partial });
const sodOff = (p: EvidencePack): EvidencePack => ({ ...p, policy: { ...DEFAULT_POLICY, separationOfDuties: false } });

describe('separation of duties — an accepted override needs evidence the reviewer did not collect', () => {
  it('refuses the override when the reviewer collected every current supporting artifact (trimmed, case-insensitive match)', () => {
    const p = pack([own({ id: 'E1', collectedBy: ' R.Kaur ' })], [accept('r.kaur')]);
    const r = evaluateSubcategory('PR.AA-05', p);
    expect(r.computedStatus).toBe('weak');
    expect(r.status).toBe('weak');
    expect(r.override).toBe(true);
    expect(r.overrideValid).toBe(false);
    expect(r.overrideIssue).toBe('self-review');
    expect(r.warnings).toEqual([REFUSAL]);
    expect(r.remediation).toContain(INDEPENDENT);
    expect(r.reasons.join(' ')).toMatch(/separation of duties/i);
    expect(r.residual).toBe(1.6); // weak × priority 2: the refusal leaves the computed residual in place
  });

  it('also refuses when the computed status is partial (two self-collected artifacts of one type)', () => {
    const p = pack([own({ id: 'E1', type: 'policy', scope: 'full' }), own({ id: 'E2', type: 'policy', scope: 'full' })], [accept('r.kaur')]);
    const r = evaluateSubcategory('PR.AA-05', p);
    expect(r.computedStatus).toBe('partial');
    expect(r.status).toBe('partial');
    expect(r.overrideIssue).toBe('self-review');
    expect(r.warnings).toEqual([REFUSAL]);
  });

  it('allows the override when at least one current supporting artifact has a different collector', () => {
    const p = pack([own({ id: 'E1' }), own({ id: 'E2', collectedBy: 'm.okafor' })], [accept('r.kaur')]);
    const r = evaluateSubcategory('PR.AA-05', p);
    expect(r.computedStatus).toBe('partial'); // coverage 1 from a single type
    expect(r.status).toBe('sufficient');
    expect(r.override).toBe(true);
    expect(r.overrideValid).toBe(true);
    expect(r.overrideIssue).toBeUndefined();
    expect(r.warnings).toEqual([]);
  });

  it('is not applicable when collectedBy is absent on any current supporting artifact (no regression for existing packs)', () => {
    const one = evaluateSubcategory('PR.AA-05', pack([own({ id: 'E1' }), own({ id: 'E2', collectedBy: undefined })], [accept('r.kaur')]));
    expect(one.status).toBe('sufficient');
    expect(one.overrideValid).toBe(true);
    expect(one.overrideIssue).toBeUndefined();

    const none = evaluateSubcategory('PR.AA-05', pack([ev({ id: 'E1', type: 'ticket', scope: 'partial' })], [accept('r.kaur')]));
    expect(none.status).toBe('sufficient');
    expect(none.warnings).toEqual([]);
  });

  it('only counts current supporting artifacts: a stale artifact from another collector does not provide independence', () => {
    const p = pack(
      [own({ id: 'E1' }), own({ id: 'E2', type: 'report', collectedBy: 'm.okafor', collectedOn: '2024-01-01', validDays: 30 })],
      [accept('r.kaur')],
    );
    const r = evaluateSubcategory('PR.AA-05', p);
    expect(r.evidence.find((e) => e.evidenceId === 'E2')!.weight).toBe(0);
    expect(r.status).toBe('weak');
    expect(r.overrideIssue).toBe('self-review');
    expect(r.warnings).toEqual([REFUSAL]);
  });

  it('ignores refuting artifacts when deciding who collected the supporting evidence', () => {
    const p = pack(
      [own({ id: 'E1' }), own({ id: 'OLDBAD', type: 'log-sample', assertion: 'refutes', collectedBy: 'm.okafor', collectedOn: '2023-01-01', validDays: 30 })],
      [accept('r.kaur')],
    );
    const r = evaluateSubcategory('PR.AA-05', p);
    expect(r.computedStatus).toBe('weak');
    expect(r.overrideIssue).toBe('self-review');
  });

  it('does not apply to a computed sufficient outcome: accepting the computed result is not an override', () => {
    const p = pack([own({ id: 'E1', type: 'policy', scope: 'full' }), own({ id: 'E2', type: 'configuration', scope: 'full' })], [accept('r.kaur')]);
    const r = evaluateSubcategory('PR.AA-05', p);
    expect(r.computedStatus).toBe('sufficient');
    expect(r.status).toBe('sufficient');
    expect(r.override).toBe(false);
    expect(r.overrideIssue).toBeUndefined();
    expect(r.warnings).toEqual([]);
  });

  it('does not apply to the accepted-risk path (computed none), even when the only stale artifact was self-collected', () => {
    const empty = evaluateSubcategory('PR.AA-05', pack([], [accept('r.kaur')]));
    expect(empty.status).toBe('accepted-risk');
    expect(empty.overrideValid).toBe(true);
    expect(empty.overrideIssue).toBeUndefined();

    const stale = evaluateSubcategory('PR.AA-05', pack([own({ id: 'E1', collectedOn: '2024-01-01', validDays: 30 })], [accept('r.kaur')]));
    expect(stale.computedStatus).toBe('none');
    expect(stale.status).toBe('accepted-risk');
    expect(stale.overrideIssue).toBeUndefined();
    expect(stale.warnings).toEqual([]);
  });

  it('is disabled by policy.separationOfDuties = false', () => {
    const p = sodOff(pack([own({ id: 'E1' })], [accept('r.kaur')]));
    const r = evaluateSubcategory('PR.AA-05', p);
    expect(r.status).toBe('sufficient');
    expect(r.overrideValid).toBe(true);
    expect(r.overrideIssue).toBeUndefined();
    expect(r.warnings).toEqual([]);
    expect(buildReport(p).policyIsDefault).toBe(false);
  });

  it('reports a short rationale as the issue before checking separation of duties', () => {
    const r = evaluateSubcategory('PR.AA-05', pack([own({ id: 'E1' })], [accept('r.kaur', 'ok')]));
    expect(r.override).toBe(true);
    expect(r.overrideValid).toBe(false);
    expect(r.overrideIssue).toBe('short-rationale');
    expect(r.warnings).toEqual(['override rationale too short; computed status kept']);
    expect(r.remediation).not.toContain(INDEPENDENT);
  });

  it('marks the override column of the CSV export as invalid for a refused self-review', () => {
    const refused = reportToCsvRows(buildReport(pack([own({ id: 'E1' })], [accept('r.kaur')])));
    const col = refused[0].indexOf('override');
    expect(col).toBeGreaterThan(0);
    expect(refused.find((row) => row[0] === 'PR.AA-05')![col]).toBe('invalid');

    const allowed = reportToCsvRows(buildReport(pack([own({ id: 'E1' }), own({ id: 'E2', collectedBy: 'm.okafor' })], [accept('r.kaur')])));
    expect(allowed.find((row) => row[0] === 'PR.AA-05')![col]).toBe('valid');
  });
});
