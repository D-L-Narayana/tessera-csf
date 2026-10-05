import { describe, expect, it } from 'vitest';
import fixture from '../src/fixtures/harbourline-pack.json';
import { assessFreshness, daysBetween } from '../src/engine/evaluate';
import { DEFAULT_HORIZON_DAYS, HORIZONS, MAX_HORIZON_DAYS, MIN_HORIZON_DAYS, addDays, forecast, type Forecast } from '../src/engine/forecast';
import { DEFAULT_POLICY } from '../src/engine/policy';
import type { Decision, EvidencePack } from '../src/engine/types';
import { validatePack } from '../src/engine/validate';
import { AS_OF, ev, pack } from './helpers/pack';

function fixturePack(): EvidencePack {
  const r = validatePack(JSON.stringify(fixture));
  if (!r.ok) throw new Error('bundled fixture failed validation: ' + r.issues.map((i) => `${i.path} ${i.message}`).join('; '));
  return r.pack;
}

const evidenceIds = (f: Forecast): string[] => f.evidence.map((e) => e.evidenceId);
const decisionIds = (f: Forecast): string[] => f.decisions.map((d) => d.subcategoryId);
const outcomeIds = (f: Forecast): string[] => f.outcomes.map((o) => o.subcategoryId);

// A gap verdict dated exactly 365 days before asOf: still applied today under the default policy, lapses tomorrow.
const boundaryGap: Decision = {
  subcategoryId: 'PR.AA-05',
  reviewer: 'r.kaur',
  verdict: 'gap',
  rationale: 'Policy exists but is not enforced per interview.',
  decidedOn: '2025-10-01',
};

describe('addDays', () => {
  it('adds days in UTC across a month end, a year end and the 2028 leap day', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2026-10-01', 90)).toBe('2026-12-30');
  });

  it('handles zero and negative offsets and a non-leap February', () => {
    expect(addDays('2026-10-01', 0)).toBe('2026-10-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-10-01', 365)).toBe('2027-10-01');
  });
});

describe('horizon window', () => {
  it('exposes the four horizons and clamps requested days to 1..3650', () => {
    expect([...HORIZONS]).toEqual([30, 60, 90, 180]);
    expect(DEFAULT_HORIZON_DAYS).toBe(90);
    expect(MIN_HORIZON_DAYS).toBe(1);
    expect(MAX_HORIZON_DAYS).toBe(3650);
    const fx = fixturePack();
    expect(forecast(fx, 0)).toMatchObject({ asOf: AS_OF, horizonDays: 1, horizonDate: '2026-10-02' });
    expect(forecast(fx, -5).horizonDays).toBe(1);
    expect(forecast(fx, 99999)).toMatchObject({ horizonDays: 3650, horizonDate: '2036-09-28' });
    expect(forecast(fx, 45.9).horizonDays).toBe(45);
    expect(forecast(fx, Number.NaN).horizonDays).toBe(1);
    expect(forecast(fx, 90)).toMatchObject({ asOf: AS_OF, horizonDays: 90, horizonDate: '2026-12-30' });
  });

  it('includes boundaries strictly after asOf and up to the horizon date inclusive', () => {
    // All collected 2026-09-01 (30 days old). A: aging boundary falls on asOf itself (not in the window) but the
    // stale boundary is; B: aging boundary falls exactly on the horizon date; C: aging boundary one day past it.
    const p = pack([ev({ id: 'A', validDays: 29 }), ev({ id: 'B', validDays: 59 }), ev({ id: 'C', validDays: 60 })]);
    const f = forecast(p, 30);
    expect(f.horizonDate).toBe('2026-10-31');
    expect(evidenceIds(f)).toEqual(['A', 'B']);
    expect(f.evidence[0]).toEqual({
      evidenceId: 'A',
      title: 'Evidence A',
      type: 'policy',
      subcategoryIds: ['PR.AA-05'],
      freshness: 'aging',
      agingOn: null,
      staleOn: '2026-10-15',
      daysToAging: null,
      daysToStale: 14,
    });
    expect(f.evidence[1]).toEqual({
      evidenceId: 'B',
      title: 'Evidence B',
      type: 'policy',
      subcategoryIds: ['PR.AA-05'],
      freshness: 'fresh',
      agingOn: '2026-10-31',
      staleOn: '2026-11-29',
      daysToAging: 30,
      daysToStale: 59,
    });
  });
});

describe('evidence boundaries (bundled fixture, asOf 2026-10-01)', () => {
  const fx = fixturePack();

  it('EV-007 (2026-09-05, 45 d) turns aging on 2026-10-21 and stale on 2026-11-12; listed at 30 and at 60 days', () => {
    const expected = {
      evidenceId: 'EV-007',
      title: 'Monthly patch compliance report',
      type: 'report',
      subcategoryIds: ['PR.PS-02'],
      freshness: 'fresh',
      agingOn: '2026-10-21',
      staleOn: '2026-11-12', // floor(45 × 1.5) + 1 = 68 days after collection
      daysToAging: 20,
      daysToStale: 42,
    };
    const f30 = forecast(fx, 30);
    expect(f30.horizonDate).toBe('2026-10-31');
    expect(f30.evidence.find((e) => e.evidenceId === 'EV-007')).toEqual(expected); // only the aging boundary is inside the window
    expect(forecast(fx, 60).evidence.find((e) => e.evidenceId === 'EV-007')).toEqual(expected); // both boundaries inside
  });

  it('EV-003 (2026-09-22, 90 d) turns aging on 2026-12-22: excluded at 60 days, included at 90', () => {
    const f60 = forecast(fx, 60);
    expect(f60.horizonDate).toBe('2026-11-30');
    expect(evidenceIds(f60)).not.toContain('EV-003');
    const f90 = forecast(fx, 90);
    expect(f90.horizonDate).toBe('2026-12-30');
    expect(f90.evidence.find((e) => e.evidenceId === 'EV-003')).toEqual({
      evidenceId: 'EV-003',
      title: 'IdP MFA enforcement export',
      type: 'configuration',
      subcategoryIds: ['PR.AA-01'],
      freshness: 'fresh',
      agingOn: '2026-12-22',
      staleOn: '2027-02-05',
      daysToAging: 82,
      daysToStale: 127,
    });
  });

  it('excludes artifacts already stale at asOf — EV-006, EV-019 and the future-dated EV-009 — at every horizon', () => {
    for (const h of [...HORIZONS, 365, 3650]) {
      const listed = evidenceIds(forecast(fx, h));
      expect(listed.length).toBeGreaterThan(0); // the list is populated at every horizon, so the exclusions are real
      expect(listed).not.toContain('EV-006');
      expect(listed).not.toContain('EV-009');
      expect(listed).not.toContain('EV-019');
    }
  });

  it('reports already-aging artifacts by their stale boundary only and sorts by the next boundary, then id', () => {
    const f30 = forecast(fx, 30);
    expect(evidenceIds(f30)).toEqual(['EV-002', 'EV-015', 'EV-007', 'EV-012']);
    expect(f30.evidence[0]).toMatchObject({ evidenceId: 'EV-002', freshness: 'aging', agingOn: null, daysToAging: null, staleOn: '2026-10-03', daysToStale: 2 });
    expect(evidenceIds(forecast(fx, 90))).toEqual(['EV-002', 'EV-015', 'EV-007', 'EV-012', 'EV-011', 'EV-004', 'EV-003', 'EV-020']);
    expect(evidenceIds(forecast(fx, 180))).toEqual([
      'EV-002', 'EV-015', 'EV-007', 'EV-012', 'EV-011', 'EV-004', 'EV-003', 'EV-020', 'EV-013', 'EV-018', 'EV-021', 'EV-005',
    ]);
  });

  it('labels freshness at asOf exactly as the engine does under the default policy', () => {
    const f = forecast(fx, 180);
    expect(f.evidence.length).toBeGreaterThanOrEqual(12);
    for (const row of f.evidence) {
      const src = fx.evidence.find((e) => e.id === row.evidenceId)!;
      expect(row.freshness).toBe(assessFreshness(src.collectedOn, src.validDays, AS_OF).freshness);
      expect(row.freshness).not.toBe('stale');
    }
  });

  it('boundary dates are the first day on which the engine reports the next freshness state', () => {
    const f = forecast(fx, 180);
    expect(f.evidence.length).toBeGreaterThanOrEqual(12);
    for (const row of f.evidence) {
      const src = fx.evidence.find((e) => e.id === row.evidenceId)!;
      if (row.agingOn) {
        expect(assessFreshness(src.collectedOn, src.validDays, addDays(row.agingOn, -1)).freshness).toBe('fresh');
        expect(assessFreshness(src.collectedOn, src.validDays, row.agingOn).freshness).toBe('aging');
      }
      expect(row.staleOn).not.toBeNull();
      expect(assessFreshness(src.collectedOn, src.validDays, addDays(row.staleOn!, -1)).freshness).toBe('aging');
      expect(assessFreshness(src.collectedOn, src.validDays, row.staleOn!).freshness).toBe('stale');
    }
  });

  it('keeps every subcategory reference of a multi-outcome artifact', () => {
    expect(forecast(fx, 180).evidence.find((e) => e.evidenceId === 'EV-013')).toEqual({
      evidenceId: 'EV-013',
      title: 'Asset management procedure',
      type: 'procedure',
      subcategoryIds: ['ID.AM-01', 'ID.AM-02'],
      freshness: 'fresh',
      agingOn: '2027-01-11',
      staleOn: '2027-07-12',
      daysToAging: 102,
      daysToStale: 284,
    });
  });
});

describe('decision lapses', () => {
  const fx = fixturePack();

  it('RS.AN-03 (2026-09-30) lapses on 2027-10-01 under the default policy: outside 180 days, inside 365', () => {
    const f180 = forecast(fx, 180);
    for (const id of ['GV.PO-01', 'PR.AA-01', 'RS.AN-03', 'PR.DS-11', 'RC.CO-03']) expect(decisionIds(f180)).not.toContain(id);
    const f365 = forecast(fx, 365);
    expect(f365.horizonDate).toBe('2027-10-01');
    expect(f365.decisions.find((d) => d.subcategoryId === 'RS.AN-03')).toEqual({
      subcategoryId: 'RS.AN-03',
      reviewer: 'm.okafor',
      verdict: 'needs-more',
      decidedOn: '2026-09-30',
      lapsesOn: '2027-10-01',
      daysToLapse: 365,
    });
    expect(decisionIds(forecast(fx, 364))).not.toContain('RS.AN-03');
    // sorted by lapse date, then id
    const keys = f365.decisions.map((d) => `${d.lapsesOn} ${d.subcategoryId}`);
    expect(keys).toEqual([...keys].sort());
    expect(f365.decisions.length).toBeGreaterThanOrEqual(5);
  });

  it('never lists the already-ignored 2024 acceptance on GV.RM-02', () => {
    for (const h of [...HORIZONS, 365, 3650]) expect(decisionIds(forecast(fx, h))).not.toContain('GV.RM-02');
    // every decision applied at asOf lapses within a year of it; the ignored one is the only one missing
    const appliedAtAsOf = fx.decisions
      .filter((d) => {
        const age = daysBetween(d.decidedOn, AS_OF);
        return age >= 0 && age <= DEFAULT_POLICY.decisionValidDays;
      })
      .map((d) => d.subcategoryId)
      .sort();
    expect(appliedAtAsOf).not.toContain('GV.RM-02'); // the 2024 acceptance is already ignored
    expect(appliedAtAsOf.length).toBeGreaterThanOrEqual(5);
    for (const h of [365, 3650]) expect([...decisionIds(forecast(fx, h))].sort()).toEqual(appliedAtAsOf);
  });

  it('lists a gap verdict at the validity boundary as lapsing tomorrow and projects its outcome to improve', () => {
    const p = pack([ev({ id: 'E1', type: 'policy' }), ev({ id: 'E2', type: 'configuration' })], [boundaryGap]);
    const f = forecast(p, 30);
    expect(f.decisions).toEqual([
      { subcategoryId: 'PR.AA-05', reviewer: 'r.kaur', verdict: 'gap', decidedOn: '2025-10-01', lapsesOn: '2026-10-02', daysToLapse: 1 },
    ]);
    expect(f.outcomes).toEqual([
      { subcategoryId: 'PR.AA-05', statusNow: 'weak', statusAtHorizon: 'sufficient', residualNow: 1.6, residualAtHorizon: 0.3, change: 'improves' },
    ]);
    // one day older it is already ignored today, so nothing lapses and nothing changes
    const lapsed = pack(p.evidence, [{ ...boundaryGap, decidedOn: '2025-09-30' }]);
    expect(forecast(lapsed, 30).decisions).toEqual([]);
    expect(forecast(lapsed, 30).outcomes).toEqual([]);
    // a future-dated decision is not applied today either
    const future = pack(p.evidence, [{ ...boundaryGap, decidedOn: '2026-10-05' }]);
    expect(forecast(future, 30).decisions).toEqual([]);
  });
});

describe('outcome projections', () => {
  const fx = fixturePack();

  it('PR.PS-02 worsens at 90 days because EV-007 goes stale and coverage drops to a single type', () => {
    const f90 = forecast(fx, 90);
    expect(f90.outcomes[0]).toEqual({
      subcategoryId: 'PR.PS-02',
      statusNow: 'sufficient',
      statusAtHorizon: 'weak',
      residualNow: 0.45,
      residualAtHorizon: 2.4,
      change: 'worsens',
    });
    // all five worsen; ordered by residual delta descending
    expect(outcomeIds(f90)).toEqual(['PR.PS-02', 'PR.AA-05', 'ID.AM-01', 'PR.DS-01', 'GV.OC-03']);
    expect(f90.outcomes.every((o) => o.change === 'worsens')).toBe(true);
    // at 30 days only EV-002's stale boundary (2026-10-03) changes an outcome
    expect(forecast(fx, 30).outcomes).toEqual([
      { subcategoryId: 'PR.AA-05', statusNow: 'sufficient', statusAtHorizon: 'partial', residualNow: 0.45, residualAtHorizon: 1.5, change: 'worsens' },
    ]);
  });

  it('classifies a status change with equal residual as "same" and sorts it last (PR.DS-11 at 180 days)', () => {
    const f180 = forecast(fx, 180);
    expect(f180.horizonDate).toBe('2027-03-30');
    expect(f180.outcomes.find((o) => o.subcategoryId === 'PR.DS-11')).toEqual({
      subcategoryId: 'PR.DS-11',
      statusNow: 'contradicted',
      statusAtHorizon: 'refuted', // EV-004 goes stale on 2027-01-29 while the refuting EV-005 is still current
      residualNow: 3,
      residualAtHorizon: 3,
      change: 'same',
    });
    expect(f180.outcomes[f180.outcomes.length - 1]?.subcategoryId).toBe('PR.DS-11');
  });

  it('orders worsens before improves before same, then by residual delta descending, then id', () => {
    const p = pack(
      [
        ev({ id: 'E1', type: 'policy' }),
        ev({ id: 'E2', type: 'configuration' }),
        // aging today (61 days vs 45), stale on 2026-10-08
        ev({ id: 'E3', type: 'configuration', subcategoryIds: ['PR.DS-01'], collectedOn: '2026-08-01', validDays: 45 }),
        ev({ id: 'E4', type: 'configuration', subcategoryIds: ['PR.IR-01'], collectedOn: '2026-08-01', validDays: 45 }),
        ev({ id: 'E5', type: 'log-sample', subcategoryIds: ['PR.IR-01'], assertion: 'refutes' }),
        ev({ id: 'E6', type: 'configuration', subcategoryIds: ['PR.PS-01'], collectedOn: '2026-08-01', validDays: 45, scope: 'partial' }),
        ev({ id: 'E7', type: 'policy', subcategoryIds: ['DE.AE-02'] }),
        ev({ id: 'E8', type: 'configuration', subcategoryIds: ['DE.AE-02'], collectedOn: '2026-08-01', validDays: 45 }),
      ],
      [boundaryGap],
    );
    const f = forecast(p, 30);
    expect(f.outcomes.map((o) => [o.subcategoryId, o.change])).toEqual([
      ['DE.AE-02', 'worsens'], // sufficient → partial, delta 0.70
      ['PR.DS-01', 'worsens'], // weak → none, delta 0.40
      ['PR.PS-01', 'worsens'], // weak → none, delta 0.40 (id tiebreak)
      ['PR.AA-05', 'improves'], // gap verdict lapses
      ['PR.IR-01', 'same'], // contradicted → refuted, equal residual
    ]);
    expect(evidenceIds(f)).toEqual(['E3', 'E4', 'E6', 'E8']);
    expect(f.evidence[0]).toMatchObject({ freshness: 'aging', agingOn: null, daysToAging: null, staleOn: '2026-10-08', daysToStale: 7 });
  });
});

describe('policy, determinism and empty packs', () => {
  it('respects pack.policy: agingMultiplier 3 moves EV-007 stale boundary to 2027-01-19; decisionValidDays 10 lapses RS.AN-03 on 2026-10-11', () => {
    const fx = fixturePack();
    const slow: EvidencePack = { ...fx, policy: { ...DEFAULT_POLICY, agingMultiplier: 3 } };
    expect(forecast(slow, 180).evidence.find((e) => e.evidenceId === 'EV-007')).toMatchObject({
      agingOn: '2026-10-21',
      daysToAging: 20,
      staleOn: '2027-01-19', // floor(45 × 3) + 1 = 136 days after collection
      daysToStale: 110,
    });
    expect(forecast(fx, 180).evidence.find((e) => e.evidenceId === 'EV-007')?.staleOn).toBe('2026-11-12');

    const brief: EvidencePack = { ...fx, policy: { ...DEFAULT_POLICY, decisionValidDays: 10 } };
    const f = forecast(brief, 30);
    expect(f.decisions.find((d) => d.subcategoryId === 'RS.AN-03')).toEqual({
      subcategoryId: 'RS.AN-03',
      reviewer: 'm.okafor',
      verdict: 'needs-more',
      decidedOn: '2026-09-30',
      lapsesOn: '2026-10-11',
      daysToLapse: 10,
    });
    expect(decisionIds(f)).not.toContain('GV.RM-02'); // 685 days old: still ignored, so it cannot lapse
    const keys = f.decisions.map((d) => `${d.lapsesOn} ${d.subcategoryId}`);
    expect(keys).toEqual([...keys].sort());
    expect(f.decisions.length).toBeGreaterThanOrEqual(5);
  });

  it('labels freshness at asOf with the policy multiplier (aging under ×2 where the default is already stale)', () => {
    // 153 days old against 90 valid days: stale under 1.5× (135), aging under 2× (180) until 2026-10-29.
    const base = pack([ev({ id: 'E1', collectedOn: '2026-05-01', validDays: 90 })]);
    expect(forecast(base, 30).evidence).toEqual([]);
    const doubled: EvidencePack = { ...base, policy: { ...DEFAULT_POLICY, agingMultiplier: 2 } };
    expect(forecast(doubled, 30).evidence).toEqual([
      {
        evidenceId: 'E1',
        title: 'Evidence E1',
        type: 'policy',
        subcategoryIds: ['PR.AA-05'],
        freshness: 'aging',
        agingOn: null,
        staleOn: '2026-10-29',
        daysToAging: null,
        daysToStale: 28,
      },
    ]);
  });

  it('is deterministic and does not alias the pack arrays', () => {
    const fx = fixturePack();
    const a = forecast(fx, 90);
    const b = forecast(structuredClone(fx), 90);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const e7 = a.evidence.find((e) => e.evidenceId === 'EV-007');
    const src = fx.evidence.find((e) => e.id === 'EV-007');
    expect(e7?.subcategoryIds).toEqual(src?.subcategoryIds);
    expect(e7?.subcategoryIds).not.toBe(src?.subcategoryIds);
  });

  it('returns three empty lists for an empty pack', () => {
    expect(forecast(pack(), 90)).toEqual({ asOf: AS_OF, horizonDays: 90, horizonDate: '2026-12-30', evidence: [], decisions: [], outcomes: [] });
    expect(forecast(pack(), DEFAULT_HORIZON_DAYS).horizonDays).toBe(90);
  });
});
