import { describe, expect, it } from 'vitest';
import { evaluateSubcategory } from '../src/engine/evaluate';
import { DEFAULT_POLICY } from '../src/engine/policy';
import type { Decision, Evidence } from '../src/engine/types';
import {
  EDIT_UNAVAILABLE,
  addDays,
  boundaryDates,
  buildEvidenceDraft,
  evidenceDraftIssues,
  nextEvidenceId,
  previewDecision,
  removeConfirmMessage,
  resolveDrawerPolicy,
  submitEvidenceEdit,
} from '../src/ui/drawerLogic';
import { AS_OF, ev, pack } from './helpers/pack';

const dec = (verdict: Decision['verdict'], rationale: string, subcategoryId = 'PR.AA-05'): Decision => ({
  subcategoryId,
  reviewer: 'r.kaur',
  verdict,
  rationale,
  decidedOn: AS_OF,
});
const LONG = 'Compensating manual review observed during the walkthrough on 2026-09-20; ticket E1 corroborates.';

describe('nextEvidenceId', () => {
  it('continues after the highest existing EV number even when an earlier id was removed', () => {
    const ids = Array.from({ length: 22 }, (_, i) => `EV-${String(i + 1).padStart(3, '0')}`).filter((id) => id !== 'EV-005');
    expect(nextEvidenceId(ids)).toBe('EV-023');
  });

  it('ignores ids that are not EV-<number>', () => {
    expect(nextEvidenceId(['X-9', 'EV-abc'])).toBe('EV-001');
    expect(nextEvidenceId(['X-9', 'EV-abc', 'EV-7'])).toBe('EV-008');
  });

  it('starts at EV-001 for an empty pack', () => {
    expect(nextEvidenceId([])).toBe('EV-001');
  });

  it('grows beyond three digits without truncating', () => {
    expect(nextEvidenceId(['EV-999'])).toBe('EV-1000');
    expect(nextEvidenceId(['EV-1000', 'EV-002'])).toBe('EV-1001');
  });
});

describe('previewDecision', () => {
  it('matches evaluateSubcategory for an accepted draft on a contradicted outcome and surfaces the refusal', () => {
    const p = pack([ev({ id: 'OK' }), ev({ id: 'BAD', type: 'log-sample', assertion: 'refutes' })]);
    const draft = dec('accepted', LONG);
    const r = previewDecision(p, 'PR.AA-05', draft);
    expect(r).toEqual(evaluateSubcategory('PR.AA-05', { ...p, decisions: [draft] }));
    expect(r.status).toBe('contradicted');
    expect(r.warnings).toContain('acceptance ignored while evidence is contradicted');
  });

  it('shows a valid override becoming sufficient, replacing the existing decision for that outcome without mutating the pack', () => {
    const p = pack([ev({ id: 'E1', scope: 'partial', type: 'ticket' })], [dec('gap', 'Not enforced.'), dec('gap', 'Other outcome.', 'PR.DS-01')]);
    const before = JSON.stringify(p);
    const draft = dec('accepted', LONG);
    const r = previewDecision(p, 'PR.AA-05', draft);
    expect(r.status).toBe('sufficient');
    expect(r.override).toBe(true);
    expect(r.overrideValid).toBe(true);
    expect(r.decision).toEqual(draft);
    expect(r).toEqual(evaluateSubcategory('PR.AA-05', { ...p, decisions: [dec('gap', 'Other outcome.', 'PR.DS-01'), draft] }));
    expect(JSON.stringify(p)).toBe(before);
  });

  it('flags a short override rationale exactly as the engine does', () => {
    const p = pack([ev({ id: 'E1', scope: 'partial', type: 'ticket' })]);
    const r = previewDecision(p, 'PR.AA-05', dec('accepted', 'ok'));
    expect(r.override).toBe(true);
    expect(r.overrideValid).toBe(false);
    expect(r.status).toBe('weak');
    expect(r.warnings).toContain('override rationale too short; computed status kept');
  });
});

describe('evidenceDraftIssues', () => {
  const existing = pack([ev({ id: 'EV-001' }), ev({ id: 'EV-002', type: 'report' })]);

  it('rejects a duplicate id when adding', () => {
    expect(evidenceDraftIssues(ev({ id: 'EV-001' }), existing)).toBe('Evidence id EV-001 already exists.');
  });

  it('allows the same id when editing that artifact', () => {
    expect(evidenceDraftIssues(ev({ id: 'EV-001', title: 'Renamed artifact' }), existing, 'EV-001')).toBeNull();
  });

  it('still rejects renaming an artifact onto another existing id', () => {
    expect(evidenceDraftIssues(ev({ id: 'EV-002' }), existing, 'EV-001')).toBe('Evidence id EV-002 already exists.');
  });

  it('surfaces validator paths for an invalid draft', () => {
    const msg = evidenceDraftIssues(ev({ id: 'EV-003', collectedOn: '31/12/2026' }), existing);
    expect(msg).not.toBeNull();
    expect(msg).toContain('collectedOn');
    expect(msg).toMatch(/^evidence\[2\]\.collectedOn: \S/); // path-addressed, in the slot the draft would occupy
  });

  it('validates an edit in the edited slot rather than reporting a duplicate', () => {
    const msg = evidenceDraftIssues(ev({ id: 'EV-001', validDays: 0 }), existing, 'EV-001');
    expect(msg).toContain('validDays');
    expect(msg).not.toMatch(/duplicate/i);
  });

  it('returns null for a valid new artifact', () => {
    expect(evidenceDraftIssues(ev({ id: 'EV-003' }), existing)).toBeNull();
  });
});

describe('boundaryDates and addDays', () => {
  it('computes aging and stale dates with the documented formulas', () => {
    expect(boundaryDates('2026-09-05', 45, 1.5)).toEqual({ agingOn: '2026-10-21', staleOn: '2026-11-12' });
  });

  it('crosses year ends and leap days in UTC', () => {
    expect(boundaryDates('2026-12-31', 1, 1)).toEqual({ agingOn: '2027-01-02', staleOn: '2027-01-02' });
    expect(boundaryDates('2028-02-28', 1, 2)).toEqual({ agingOn: '2028-03-01', staleOn: '2028-03-02' });
    expect(addDays('2026-10-01', 366)).toBe('2027-10-02');
  });

  it('returns empty strings instead of throwing for an unparsable date', () => {
    expect(addDays('not-a-date', 1)).toBe('');
    expect(boundaryDates('bad', 10, 1.5)).toEqual({ agingOn: '', staleOn: '' });
  });
});

describe('form helpers', () => {
  const base = {
    id: 'EV-009',
    subcategoryId: 'PR.DS-11',
    alsoApplies: [] as readonly string[],
    title: '  Backup runbook ',
    source: ' backup.example ',
    collectedBy: '   ',
    type: 'procedure' as const,
    collectedOn: '2026-09-30',
    validDays: 180,
    scope: 'full' as const,
    assertion: 'supports' as const,
    note: ' ',
  };

  it('builds a trimmed draft, omits blank optional fields and orders outcome references', () => {
    const e = buildEvidenceDraft({ ...base, alsoApplies: ['RC.RP-01', 'GV.OC-03', 'PR.DS-11', 'ZZ.ZZ-99'] });
    expect(e).toEqual({
      id: 'EV-009',
      title: 'Backup runbook',
      type: 'procedure',
      subcategoryIds: ['PR.DS-11', 'GV.OC-03', 'RC.RP-01'],
      collectedOn: '2026-09-30',
      validDays: 180,
      scope: 'full',
      assertion: 'supports',
      source: 'backup.example',
    });
    expect('note' in e).toBe(false);
    expect('collectedBy' in e).toBe(false);
  });

  it('keeps note and collector when provided', () => {
    const e = buildEvidenceDraft({ ...base, collectedBy: ' m.okafor ', note: 'Signed copy. ' });
    expect(e.collectedBy).toBe('m.okafor');
    expect(e.note).toBe('Signed copy.');
  });

  it('words the removal confirmation per artifact', () => {
    expect(removeConfirmMessage('EV-004')).toBe('Remove EV-004? This cannot be undone except with Undo.');
  });

  it('reports that editing is unavailable when no update handler is wired, otherwise delegates', () => {
    const draft = ev({ id: 'EV-001' });
    expect(EDIT_UNAVAILABLE).toBe('Editing is not available in this view.');
    expect(submitEvidenceEdit(undefined, draft)).toBe(EDIT_UNAVAILABLE);
    const seen: Evidence[] = [];
    expect(
      submitEvidenceEdit((e) => {
        seen.push(e);
        return null;
      }, draft),
    ).toBeNull();
    expect(seen).toEqual([draft]);
    expect(submitEvidenceEdit(() => 'nope', draft)).toBe('nope');
  });

  it('resolves the drawer policy: explicit prop, then pack policy, then legacy minRationale, then defaults', () => {
    const custom = { ...DEFAULT_POLICY, minOverrideRationale: 10 };
    const p = pack([]);
    expect(resolveDrawerPolicy(p, custom, 99)).toBe(custom);
    expect(resolveDrawerPolicy({ ...p, policy: custom }, undefined, 99)).toBe(custom);
    expect(resolveDrawerPolicy(p, undefined, 12)).toEqual({ ...DEFAULT_POLICY, minOverrideRationale: 12 });
    expect(resolveDrawerPolicy(p)).toBe(DEFAULT_POLICY);
  });
});
