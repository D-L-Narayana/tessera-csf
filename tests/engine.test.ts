import { describe, expect, it } from 'vitest';
import {
  assessFreshness,
  evaluatePack,
  evaluateSubcategory,
  residualFor,
  toCsv,
  buildReport,
} from '../src/engine/evaluate';
import { validatePack, MAX_PACK_BYTES } from '../src/engine/validate';
import { DECISION_VALID_DAYS } from '../src/engine/evaluate';
import { CATALOG } from '../src/engine/catalog';
import type { Evidence, EvidencePack, Decision } from '../src/engine/types';

const AS_OF = '2026-10-01';

function ev(partial: Partial<Evidence> & { id: string }): Evidence {
  return {
    title: 'Evidence ' + partial.id,
    type: 'policy',
    subcategoryIds: ['PR.AA-05'],
    collectedOn: '2026-09-01',
    validDays: 365,
    scope: 'full',
    assertion: 'supports',
    source: 'grc.example',
    ...partial,
  };
}

function pack(evidence: Evidence[], decisions: Decision[] = []): EvidencePack {
  return {
    schema: 'tessera.pack/1',
    profile: { name: 'Test profile', asOf: AS_OF, priorities: {} },
    evidence,
    decisions,
  };
}

describe('catalog', () => {
  it('contains exactly 25 unique CSF 2.0 subcategories across all six functions', () => {
    expect(CATALOG.length).toBe(25);
    expect(new Set(CATALOG.map((s) => s.id)).size).toBe(25);
    expect(new Set(CATALOG.map((s) => s.fn))).toEqual(new Set(['GV', 'ID', 'PR', 'DE', 'RS', 'RC']));
    for (const s of CATALOG) expect(s.id).toMatch(/^(GV|ID|PR|DE|RS|RC)\.[A-Z]{2}-\d{2}$/);
  });
});

describe('freshness', () => {
  it('is fresh within validDays, aging up to 1.5x, stale beyond', () => {
    expect(assessFreshness('2026-09-01', 90, AS_OF).freshness).toBe('fresh'); // 30 days
    expect(assessFreshness('2026-06-01', 90, AS_OF).freshness).toBe('aging'); // 122 days
    expect(assessFreshness('2025-10-01', 90, AS_OF).freshness).toBe('stale'); // 365 days
  });
  it('treats the exact validDays boundary as fresh and one day over as aging', () => {
    expect(assessFreshness('2026-07-03', 90, AS_OF).freshness).toBe('fresh'); // 90 days
    expect(assessFreshness('2026-07-02', 90, AS_OF).freshness).toBe('aging'); // 91 days
  });
  it('flags evidence dated in the future as stale with a negative age', () => {
    const r = assessFreshness('2027-01-01', 90, AS_OF);
    expect(r.freshness).toBe('stale');
    expect(r.ageDays).toBeLessThan(0);
  });
});

describe('subcategory evaluation', () => {
  it('reports none when there is no evidence', () => {
    const r = evaluateSubcategory('PR.AA-05', pack([]));
    expect(r.status).toBe('none');
    expect(r.coverage).toBe(0);
    expect(r.remediation).toMatch(/no evidence/i);
  });

  it('requires two distinct evidence types for sufficiency even when coverage is high', () => {
    const r = evaluateSubcategory(
      'PR.AA-05',
      pack([ev({ id: 'E1', type: 'policy' }), ev({ id: 'E2', type: 'policy' })]),
    );
    expect(r.coverage).toBe(2);
    expect(r.distinctTypes).toBe(1);
    expect(r.status).toBe('partial');
    expect(r.remediation).toMatch(/second evidence type/i);
  });

  it('is sufficient with coverage >= 1 from two types', () => {
    const r = evaluateSubcategory(
      'PR.AA-05',
      pack([ev({ id: 'E1', type: 'policy', scope: 'partial' }), ev({ id: 'E2', type: 'configuration', scope: 'partial' })]),
    );
    expect(r.coverage).toBe(1);
    expect(r.status).toBe('sufficient');
  });

  it('gives stale evidence zero weight and aging evidence half weight', () => {
    const r = evaluateSubcategory(
      'PR.AA-05',
      pack([
        ev({ id: 'STALE', type: 'policy', collectedOn: '2024-01-01', validDays: 90 }),
        ev({ id: 'AGING', type: 'configuration', collectedOn: '2026-06-01', validDays: 90 }),
      ]),
    );
    const stale = r.evidence.find((e) => e.evidenceId === 'STALE')!;
    const aging = r.evidence.find((e) => e.evidenceId === 'AGING')!;
    expect(stale.weight).toBe(0);
    expect(aging.weight).toBe(0.5);
    expect(r.status).toBe('weak');
    expect(r.remediation).toMatch(/stale/i);
  });

  it('is contradicted when current evidence both supports and refutes', () => {
    const r = evaluateSubcategory(
      'PR.AA-05',
      pack([ev({ id: 'OK', type: 'policy' }), ev({ id: 'BAD', type: 'log-sample', assertion: 'refutes' })]),
    );
    expect(r.status).toBe('contradicted');
    expect(r.contradictions).toEqual(['BAD']);
    expect(r.remediation).toMatch(/BAD/);
  });

  it('is refuted when the only current evidence refutes the outcome', () => {
    const r = evaluateSubcategory('PR.AA-05', pack([ev({ id: 'BAD', assertion: 'refutes' })]));
    expect(r.status).toBe('refuted');
  });

  it('ignores a stale refutation when deciding contradiction', () => {
    const r = evaluateSubcategory(
      'PR.AA-05',
      pack([
        ev({ id: 'OK', type: 'policy' }),
        ev({ id: 'OLDBAD', type: 'log-sample', assertion: 'refutes', collectedOn: '2023-01-01', validDays: 30 }),
      ]),
    );
    expect(r.status).not.toBe('contradicted');
    expect(r.reasons.join(' ')).toMatch(/stale refutation/i);
  });

  it('ignores evidence that does not reference the subcategory', () => {
    const r = evaluateSubcategory('PR.AA-05', pack([ev({ id: 'E1', subcategoryIds: ['PR.DS-01'] })]));
    expect(r.status).toBe('none');
  });
});

describe('reviewer overlay', () => {
  const dec = (verdict: Decision['verdict'], rationale: string): Decision => ({
    subcategoryId: 'PR.AA-05',
    reviewer: 'r.kaur',
    verdict,
    rationale,
    decidedOn: AS_OF,
  });

  it('marks an accepted-but-weak result as an override that needs a substantive rationale', () => {
    const weak = pack([ev({ id: 'E1', scope: 'partial', type: 'ticket' })], [dec('accepted', 'ok')]);
    const r = evaluateSubcategory('PR.AA-05', weak);
    expect(r.override).toBe(true);
    expect(r.overrideValid).toBe(false);
    expect(r.status).toBe('weak'); // invalid override does not change status
  });

  it('applies a valid override and keeps the trace', () => {
    const weak = pack(
      [ev({ id: 'E1', scope: 'partial', type: 'ticket' })],
      [dec('accepted', 'Compensating manual review observed during walkthrough on 2026-09-20; ticket E1 corroborates.')],
    );
    const r = evaluateSubcategory('PR.AA-05', weak);
    expect(r.override).toBe(true);
    expect(r.overrideValid).toBe(true);
    expect(r.status).toBe('sufficient');
    expect(r.reasons.join(' ')).toMatch(/override/i);
  });

  it('never lets a reviewer accept a contradicted outcome', () => {
    const p = pack(
      [ev({ id: 'OK' }), ev({ id: 'BAD', type: 'log-sample', assertion: 'refutes' })],
      [dec('accepted', 'A long enough rationale that should still not be allowed to override.')],
    );
    const r = evaluateSubcategory('PR.AA-05', p);
    expect(r.status).toBe('contradicted');
    expect(r.override).toBe(false);
  });

  it('respects a not-applicable verdict and zeroes residual', () => {
    const r = evaluateSubcategory('PR.AA-05', pack([], [dec('not-applicable', 'No workforce identities in scope: the entity has no employees and all access is held by the parent company.')]));
    expect(r.status).toBe('not-applicable');
    expect(r.residual).toBe(0);
  });

  it('a gap verdict forces the status down even if evidence looks sufficient', () => {
    const p = pack(
      [ev({ id: 'E1', type: 'policy' }), ev({ id: 'E2', type: 'configuration' })],
      [dec('gap', 'Policy exists but is not enforced per interview.')],
    );
    expect(evaluateSubcategory('PR.AA-05', p).status).toBe('weak');
  });
});

describe('residual risk', () => {
  it('scales exposure by priority and status', () => {
    expect(residualFor('none', 3)).toBe(3);
    expect(residualFor('sufficient', 3)).toBeCloseTo(0.45);
    expect(residualFor('partial', 2)).toBe(1);
    expect(residualFor('not-applicable', 3)).toBe(0);
    expect(residualFor('contradicted', 1)).toBe(1);
  });
  it('bands residual into low (<0.75), moderate (<1.75), high (>=1.75)', () => {
    const p = pack([]);
    p.profile.priorities = { 'PR.AA-05': 3, 'PR.DS-01': 1 };
    const r = evaluatePack(p);
    const byId = (id: string) => r.results.find((x) => x.subcategoryId === id)!;
    expect(byId('PR.AA-05').band).toBe('high'); // priority 3, none => 3.0
    expect(byId('PR.DS-01').band).toBe('moderate'); // priority 1, none => 1.0
    expect(byId('GV.PO-01').band).toBe('high'); // default priority 2, none => 2.0
  });
});

describe('pack evaluation and report', () => {
  it('evaluates every catalog subcategory exactly once and rolls up per function', () => {
    const r = evaluatePack(pack([]));
    expect(r.results.length).toBe(25);
    expect(r.rollups.length).toBe(6);
    expect(r.rollups.every((f) => f.count > 0)).toBe(true);
  });
  it('orders gaps by residual descending and excludes sufficient and n/a outcomes', () => {
    const p = pack(
      [ev({ id: 'E1', type: 'policy' }), ev({ id: 'E2', type: 'configuration' })],
      [{ subcategoryId: 'RC.RP-01', reviewer: 'x', verdict: 'not-applicable', rationale: 'Recovery execution is contractually performed by the hosting provider; evidence is reviewed separately.', decidedOn: AS_OF }],
    );
    p.profile.priorities = { 'GV.PO-01': 3, 'DE.CM-01': 1 };
    const report = buildReport(p);
    expect(report.gaps.find((g) => g.subcategoryId === 'PR.AA-05')).toBeUndefined();
    expect(report.gaps.find((g) => g.subcategoryId === 'RC.RP-01')).toBeUndefined();
    expect(report.gaps[0].subcategoryId).toBe('GV.PO-01');
    for (let i = 1; i < report.gaps.length; i++) {
      expect(report.gaps[i - 1].residual).toBeGreaterThanOrEqual(report.gaps[i].residual);
    }
  });
  it('is deterministic: same pack produces byte-identical report JSON', () => {
    const p = pack([ev({ id: 'E1' }), ev({ id: 'E2', type: 'report' })]);
    expect(JSON.stringify(buildReport(p))).toBe(JSON.stringify(buildReport(structuredClone(p))));
  });
  it('labels the framework version and the subset honestly in the report', () => {
    const report = buildReport(pack([]));
    expect(report.framework).toContain('CSF 2.0');
    expect(report.subset).toMatch(/25 of 106/);
    expect(report.disclaimer).toMatch(/not a certification/i);
  });
});

describe('CSV export', () => {
  it('neutralises spreadsheet formula injection and quotes fields', () => {
    const csv = toCsv([
      ['id', 'title'],
      ['=1+1', '+cmd|"x"'],
      ['-x', '@SUM(A1)'],
      ['plain, comma', 'tab\there'],
    ]);
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe(`"'=1+1","'+cmd|""x"""`);
    expect(lines[2]).toBe(`"'-x","'@SUM(A1)"`);
    expect(lines[3]).toBe(`"plain, comma","tab\there"`);
  });
});

describe('pack validation', () => {
  const good = pack([ev({ id: 'E1' })]);

  it('accepts a well-formed pack', () => {
    const r = validatePack(JSON.stringify(good));
    expect(r.ok).toBe(true);
  });
  it('rejects malformed JSON without throwing', () => {
    const r = validatePack('{not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].message).toMatch(/JSON/);
  });
  it('rejects oversized input before parsing', () => {
    const big = 'x'.repeat(MAX_PACK_BYTES + 1);
    const r = validatePack(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].message).toMatch(/too large/i);
  });
  it('rejects unknown subcategory ids and bad dates with paths', () => {
    const bad = pack([ev({ id: 'E1', subcategoryIds: ['PR.ZZ-99'], collectedOn: '31/12/2026' })]);
    const r = validatePack(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.path === 'evidence[0].subcategoryIds[0]')).toBe(true);
      expect(r.issues.some((i) => i.path === 'evidence[0].collectedOn')).toBe(true);
    }
  });
  it('rejects validDays outside 1..3650, duplicate ids and wrong schema tag', () => {
    const bad = pack([ev({ id: 'E1', validDays: 0 }), ev({ id: 'E1', validDays: 5000 })]);
    (bad as unknown as { schema: string }).schema = 'other/9';
    const r = validatePack(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const msgs = r.issues.map((i) => i.message).join(' | ');
      expect(msgs).toMatch(/schema/);
      expect(msgs).toMatch(/validDays/);
      expect(msgs).toMatch(/duplicate/i);
    }
  });
  it('rejects more than 500 evidence items', () => {
    const many = pack(Array.from({ length: 501 }, (_, i) => ev({ id: 'E' + i })));
    const r = validatePack(JSON.stringify(many));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].message).toMatch(/500/);
  });
  it('rejects a decision rationale over 2000 characters and strips unknown keys', () => {
    const p = pack([], [{ subcategoryId: 'PR.AA-05', reviewer: 'r', verdict: 'gap', rationale: 'x'.repeat(2001), decidedOn: AS_OF }]);
    const r = validatePack(JSON.stringify({ ...p, extra: { nested: true } }));
    expect(r.ok).toBe(false);
  });
});

describe('pack validation — parent review regressions', () => {
  it('measures the size limit in UTF-8 bytes, not UTF-16 code units', () => {
    // 200k characters of a 3-byte glyph = 600k bytes > 512k limit even though length < limit
    const text = '€'.repeat(200_000);
    const r = validatePack(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].message).toMatch(/too large/i);
  });
  it('rejects evidence that references more than 25 subcategories instead of truncating', () => {
    const p = pack([ev({ id: 'E1', subcategoryIds: Array.from({ length: 26 }, () => 'PR.AA-05') })]);
    const r = validatePack(JSON.stringify(p));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.path === 'evidence[0].subcategoryIds' && /25/.test(i.message))).toBe(true);
  });
  it('rejects more than 25 priority entries instead of truncating', () => {
    const p = pack([]);
    const priorities: Record<string, number> = {};
    for (let i = 0; i < 26; i++) priorities['PR.AA-0' + i] = 2;
    (p.profile as unknown as { priorities: Record<string, number> }).priorities = priorities;
    const r = validatePack(JSON.stringify(p));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.path === 'profile.priorities' && /25/.test(i.message))).toBe(true);
  });
  it('deduplicates repeated subcategory ids within one evidence item', () => {
    const r = validatePack(JSON.stringify(pack([ev({ id: 'E1', subcategoryIds: ['PR.AA-05', 'PR.AA-05'] })])));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.pack.evidence[0].subcategoryIds).toEqual(['PR.AA-05']);
  });
});

describe('not-applicable guardrails — parent review regressions', () => {
  const na = (rationale: string): Decision => ({ subcategoryId: 'PR.AA-05', reviewer: 'r.kaur', verdict: 'not-applicable', rationale, decidedOn: AS_OF });

  it('rejects a not-applicable verdict whose rationale is not substantive and keeps the computed status', () => {
    const r = evaluateSubcategory('PR.AA-05', pack([ev({ id: 'E1', scope: 'partial', type: 'ticket' })], [na('n/a')]));
    expect(r.status).toBe('weak');
    expect(r.residual).toBeGreaterThan(0);
    expect(r.reasons.join(' ')).toMatch(/not applicable rejected/i);
  });

  it('never lets not-applicable hide a contradiction or refutation', () => {
    const contradicted = pack(
      [ev({ id: 'OK' }), ev({ id: 'BAD', type: 'log-sample', assertion: 'refutes' })],
      [na('Workforce identities are managed by the parent company under a signed services agreement (SA-2026-04).')],
    );
    const r = evaluateSubcategory('PR.AA-05', contradicted);
    expect(r.status).toBe('contradicted');
    expect(r.residual).toBeGreaterThan(0);
    expect(r.warnings).toContain('not-applicable verdict ignored while evidence is contradicted');

    const refuted = pack([ev({ id: 'BAD', assertion: 'refutes' })], [na('Workforce identities are managed by the parent company under a signed services agreement (SA-2026-04).')]);
    expect(evaluateSubcategory('PR.AA-05', refuted).status).toBe('refuted');
  });

  it('accepts a substantive not-applicable scope rationale and records it as a scoping decision', () => {
    const r = evaluateSubcategory('PR.AA-05', pack([], [na('Workforce identities are managed by the parent company under a signed services agreement (SA-2026-04).')]));
    expect(r.status).toBe('not-applicable');
    expect(r.residual).toBe(0);
    expect(r.warnings).toEqual([]);
  });

  it('rolls up an all-not-applicable function as not-assessed rather than low risk', () => {
    const p = pack([]);
    p.decisions = CATALOG.filter((s) => s.fn === 'RC').map((s) => ({ ...na('Recovery is fully outsourced under contract RC-77; the provider\'s evidence is reviewed in Tierline.'), subcategoryId: s.id }));
    const { rollups } = evaluatePack(p);
    const rc = rollups.find((f) => f.fn === 'RC')!;
    expect(rc.assessed).toBe(0);
    expect(rc.band).toBe('not-assessed');
    expect(rc.meanResidual).toBeNull();
  });

  it('labels residual scoring as a custom educational heuristic in the report', () => {
    const report = buildReport(pack([]));
    expect(report.scoringNote).toMatch(/custom educational heuristic/i);
    expect(report.scoringNote).toMatch(/not a NIST/i);
  });
});

describe('CSV export — leading whitespace formula cases', () => {
  it('neutralises formulas hidden behind leading spaces, tabs or carriage returns', () => {
    const csv = toCsv([[' =HYPERLINK("x")', '\t=1+1', '\r=cmd', '  @SUM(A1)']]);
    const cells = csv.split(',');
    for (const c of cells) expect(c.startsWith(`"'`)).toBe(true);
  });
});

describe('bundled fixture', () => {
  it('validates against the subset and exercises every status at least once', async () => {
    const demo = (await import('../src/fixtures/harbourline-pack.json')).default;
    const r = validatePack(JSON.stringify(demo));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const report = buildReport(r.pack);
    const statuses = new Set(report.results.map((x) => x.status));
    for (const s of ['sufficient', 'partial', 'weak', 'none', 'contradicted', 'accepted-risk']) expect(statuses.has(s as never)).toBe(true);
    expect(report.results.find((x) => x.subcategoryId === 'GV.RM-02')!.warnings.join(' ')).toMatch(/stale decision/i); // 2024 acceptance ignored
    // adversarial fixture expectations
    expect(report.results.find((x) => x.subcategoryId === 'PR.DS-11')!.status).toBe('contradicted');
    expect(report.results.find((x) => x.subcategoryId === 'ID.RA-01')!.evidence[0].freshness).toBe('stale'); // future-dated
    expect(report.results.find((x) => x.subcategoryId === 'GV.PO-01')!.overrideValid).toBe(false); // "Looks fine."
    expect(report.results.find((x) => x.subcategoryId === 'PR.AA-01')!.override).toBe(false); // sufficient; acceptance is not an override
  });
});

describe('sixth-Fable review regressions — decision freshness and zero-evidence overrides', () => {
  const dec = (verdict: Decision['verdict'], rationale: string, decidedOn: string): Decision => ({ subcategoryId: 'PR.AA-05', reviewer: 'rv', verdict, rationale, decidedOn });
  const long = 'Compensating manual control observed and documented in the walkthrough notes.';

  it('an accepted override with zero current evidence becomes accepted-risk, not sufficient, and stays in the gap register', () => {
    const p = pack([], [dec('accepted', long, AS_OF)]);
    const r = evaluateSubcategory('PR.AA-05', p);
    expect(r.computedStatus).toBe('none');
    expect(r.status).toBe('accepted-risk');
    expect(r.residual).toBeGreaterThan(0);
    expect(r.override).toBe(true);
    const report = buildReport(p);
    expect(report.gaps.some((g) => g.subcategoryId === 'PR.AA-05')).toBe(true);
    expect(r.remediation).toMatch(/accepted risk/i);
  });

  it('a stale accepted decision (older than the decision validity window) is ignored with a warning', () => {
    const p = pack([], [dec('accepted', long, '2020-01-01')]);
    const r = evaluateSubcategory('PR.AA-05', p);
    expect(r.status).toBe('none');
    expect(r.override).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/stale decision/i);
    expect(r.decisionAgeDays).toBeGreaterThan(DECISION_VALID_DAYS);
  });

  it('decision freshness boundary: exactly DECISION_VALID_DAYS old still applies; one day older does not', () => {
    const onBoundary = pack([], [dec('not-applicable', long, '2025-10-01')]); // 365 days
    expect(evaluateSubcategory('PR.AA-05', onBoundary).status).toBe('not-applicable');
    const over = pack([], [dec('not-applicable', long, '2025-09-30')]);
    expect(evaluateSubcategory('PR.AA-05', over).status).toBe('none');
  });

  it('a decision dated after the evaluation date is treated as stale (data-entry error), not as fresh', () => {
    const p = pack([ev({ id: 'E1' }), ev({ id: 'E2', type: 'report' })], [dec('gap', 'Policy not enforced.', '2027-01-01')]);
    const r = evaluateSubcategory('PR.AA-05', p);
    expect(r.status).toBe('sufficient');
    expect(r.warnings.join(' ')).toMatch(/stale decision/i);
  });

  it('a stale gap verdict is also ignored (decisions age symmetrically)', () => {
    const p = pack([ev({ id: 'E1' }), ev({ id: 'E2', type: 'report' })], [dec('gap', 'Old finding.', '2020-01-01')]);
    expect(evaluateSubcategory('PR.AA-05', p).status).toBe('sufficient');
  });

  it('accepted-risk has a documented exposure and residual band and appears in the report scoring note', () => {
    expect(residualFor('accepted-risk', 2)).toBe(1.2);
    const report = buildReport(pack([], [dec('accepted', long, AS_OF)]));
    expect(report.scoringNote).toMatch(/accepted-risk/);
    expect(report.decisionPolicy).toMatch(new RegExp(String(DECISION_VALID_DAYS)));
  });
});
