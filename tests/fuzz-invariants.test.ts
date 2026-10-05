// Seeded fuzzing of the validator and the engine. Every case is reproducible from its seed (see tests/helpers/fuzz.ts).
// Random valid packs must validate, round-trip byte-identically and keep every engine invariant; mutated and
// garbage inputs must never make the validator throw. The whole file is meant to run in well under five seconds.
import { describe, expect, it } from 'vitest';
import fixture from '../src/fixtures/harbourline-pack.json';
import { CATALOG } from '../src/engine/catalog';
import { buildReport } from '../src/engine/evaluate';
import { effectivePolicy } from '../src/engine/policy';
import type { EvidencePack, Report, RiskBand, ValidationResult } from '../src/engine/types';
import { validatePack, validatePackObject } from '../src/engine/validate';
import { int, mulberry32, mutateJson, pick, randomPack } from './helpers/fuzz';

const N = 300;
const STATUSES: ReadonlySet<string> = new Set(['sufficient', 'partial', 'weak', 'none', 'contradicted', 'refuted', 'accepted-risk', 'not-applicable']);
const BAND_RANK: Record<RiskBand, number> = { low: 0, moderate: 1, high: 2 };

/** Independent oracle for the documented band rule: residual < moderate → low; < high → moderate; else high. */
function bandFor(residual: number, bands: { moderate: number; high: number }): RiskBand {
  return residual < bands.moderate ? 'low' : residual < bands.high ? 'moderate' : 'high';
}

function twoDecimals(x: number): boolean {
  return Number.isFinite(x) && Math.round(x * 100) / 100 === x;
}

/** Policy-independent invariants of buildReport. Returns human-readable violations (empty when all hold). */
function reportProblems(pack: EvidencePack): { report: Report; problems: string[] } {
  const problems: string[] = [];
  const check = (ok: boolean, what: string): void => {
    if (!ok) problems.push(what);
  };
  const report = buildReport(pack);

  check(report.results.length === 25, `results.length ${report.results.length}`);
  check(report.results.map((r) => r.subcategoryId).join() === CATALOG.map((s) => s.id).join(), 'results are not the catalog in order');
  for (const r of report.results) {
    check(STATUSES.has(r.status), `${r.subcategoryId}: unknown status ${r.status}`);
    check(STATUSES.has(r.computedStatus), `${r.subcategoryId}: unknown computed status ${r.computedStatus}`);
    check(r.residual >= 0 && r.residual <= 3 && twoDecimals(r.residual), `${r.subcategoryId}: residual ${r.residual}`);
    check(r.band in BAND_RANK, `${r.subcategoryId}: unknown band ${r.band}`);
    check(r.residual !== 0 || r.band === 'low', `${r.subcategoryId}: residual 0 banded ${r.band}`);
  }
  const byResidual = [...report.results].sort((a, b) => a.residual - b.residual);
  for (let i = 1; i < byResidual.length; i++) {
    check(BAND_RANK[byResidual[i].band] >= BAND_RANK[byResidual[i - 1].band], `band not monotone in residual around ${byResidual[i].subcategoryId}`);
  }

  const expectedGaps = report.results.filter((r) => r.status !== 'sufficient' && r.status !== 'not-applicable').map((r) => r.subcategoryId).sort();
  check([...report.gaps.map((g) => g.subcategoryId)].sort().join() === expectedGaps.join(), 'gaps are not exactly the non-sufficient, non-n/a outcomes');
  for (let i = 1; i < report.gaps.length; i++) {
    const a = report.gaps[i - 1];
    const b = report.gaps[i];
    check(
      a.residual > b.residual || (a.residual === b.residual && a.subcategoryId < b.subcategoryId),
      `gaps out of order at ${i}: ${a.subcategoryId} (${a.residual}) before ${b.subcategoryId} (${b.residual})`,
    );
  }

  check(report.rollups.length === 6, `rollups.length ${report.rollups.length}`);
  check(report.rollups.reduce((n, f) => n + f.count, 0) === 25, 'rollup counts do not sum to 25');
  for (const f of report.rollups) {
    const inFn = report.results.filter((r) => CATALOG.find((s) => s.id === r.subcategoryId)?.fn === f.fn);
    const assessed = inFn.filter((r) => r.status !== 'not-applicable').length;
    check(f.count === inFn.length, `${f.fn}: count ${f.count} vs ${inFn.length}`);
    check(f.assessed === assessed, `${f.fn}: assessed ${f.assessed} vs ${assessed}`);
    check(f.sufficient === inFn.filter((r) => r.status === 'sufficient').length, `${f.fn}: sufficient count ${f.sufficient}`);
    if (assessed === 0) check(f.meanResidual === null && f.band === 'not-assessed', `${f.fn}: empty function not marked not-assessed`);
    else {
      check(
        f.meanResidual !== null && twoDecimals(f.meanResidual) && f.meanResidual >= 0 && f.meanResidual <= 3 && f.band !== 'not-assessed',
        `${f.fn}: meanResidual ${f.meanResidual} band ${f.band}`,
      );
    }
  }

  check(JSON.stringify(report.policy) === JSON.stringify(effectivePolicy(pack)), 'report.policy differs from the effective policy');
  const once = JSON.stringify(report);
  check(JSON.stringify(buildReport(pack)) === once, 'a second buildReport call differs');
  check(JSON.stringify(buildReport(structuredClone(pack))) === once, 'buildReport on a structuredClone differs');
  return { report, problems };
}

/** Bands must follow the thresholds of the policy the report embeds. */
function bandProblems(report: Report, bands: { moderate: number; high: number }): string[] {
  const problems: string[] = [];
  for (const r of report.results) {
    const want = bandFor(r.residual, bands);
    if (r.band !== want) problems.push(`${r.subcategoryId}: residual ${r.residual} banded ${r.band}, policy bands say ${want}`);
  }
  for (const f of report.rollups) {
    if (f.meanResidual === null) continue;
    const want = bandFor(f.meanResidual, bands);
    if (f.band !== want) problems.push(`${f.fn}: mean residual ${f.meanResidual} banded ${f.band}, policy bands say ${want}`);
  }
  return problems;
}

describe('fuzz: random valid packs', () => {
  it('fuzz helpers are deterministic for a given seed', () => {
    expect(JSON.stringify(randomPack(mulberry32(42), { withPolicy: true }))).toBe(JSON.stringify(randomPack(mulberry32(42), { withPolicy: true })));
    expect(JSON.stringify(mutateJson(mulberry32(42), fixture))).toBe(JSON.stringify(mutateJson(mulberry32(42), fixture)));
    expect(JSON.stringify(randomPack(mulberry32(1)))).not.toBe(JSON.stringify(randomPack(mulberry32(2))));
    expect(JSON.stringify(mutateJson(mulberry32(1), fixture))).not.toBe(JSON.stringify(fixture));
  });

  it('300 seeded random valid packs pass validatePack, round-trip byte-identically and validate idempotently', () => {
    let withPolicy = 0;
    let withCollectors = 0;
    for (let seed = 1; seed <= N; seed++) {
      const p = randomPack(mulberry32(seed), { withPolicy: seed % 3 === 0 });
      if (p.policy) withPolicy++;
      if (p.evidence.some((e) => e.collectedBy !== undefined)) withCollectors++;
      const text = JSON.stringify(p);
      const r = validatePack(text);
      expect(r.ok, `seed ${seed}: ${r.ok ? '' : JSON.stringify(r.issues)}`).toBe(true);
      if (!r.ok) continue;
      expect(JSON.stringify(r.pack), `seed ${seed}: validated pack is not byte-identical to the input`).toBe(text);
      const again = validatePackObject(r.pack);
      expect(again.ok, `seed ${seed}`).toBe(true);
      if (again.ok) expect(again.pack, `seed ${seed}: second validation differs`).toStrictEqual(r.pack);
    }
    expect(withPolicy).toBe(100);
    expect(withCollectors).toBeGreaterThan(100);
  });

  it('engine invariants hold for 300 random policy-free packs, with bands following the effective policy', () => {
    for (let seed = 1; seed <= N; seed++) {
      const p = randomPack(mulberry32(seed));
      const { report, problems } = reportProblems(p);
      expect([...problems, ...bandProblems(report, effectivePolicy(p).bands)], `seed ${seed}`).toEqual([]);
    }
  });

  it('engine invariants hold for 300 random packs carrying a custom policy, with bands following that policy', () => {
    for (let seed = 1001; seed <= 1000 + N; seed++) {
      const p = randomPack(mulberry32(seed), { withPolicy: true });
      expect(p.policy).toBeDefined();
      const { report, problems } = reportProblems(p);
      expect([...problems, ...bandProblems(report, effectivePolicy(p).bands)], `seed ${seed}`).toEqual([]);
    }
  });
});

describe('fuzz: hostile input never throws', () => {
  it('300 mutated fixture copies always yield a boolean ok, bounded issues and idempotent accepted packs', () => {
    let accepted = 0;
    let rejected = 0;
    for (let seed = 1; seed <= N; seed++) {
      const mutated = mutateJson(mulberry32(5000 + seed), fixture);
      let results: ValidationResult[];
      try {
        results = [validatePack(JSON.stringify(mutated)), validatePackObject(mutated)];
      } catch (e) {
        throw new Error(`seed ${seed}: validator threw ${String(e)}`);
      }
      for (const r of results) {
        expect(typeof r.ok, `seed ${seed}`).toBe('boolean');
        if (r.ok) {
          const again = validatePackObject(r.pack);
          expect(again.ok, `seed ${seed}`).toBe(true);
          if (again.ok) expect(again.pack, `seed ${seed}: accepted pack is not idempotent`).toStrictEqual(r.pack);
        } else {
          expect(Array.isArray(r.issues), `seed ${seed}`).toBe(true);
          expect(r.issues.length, `seed ${seed}`).toBeGreaterThan(0);
          expect(r.issues.length, `seed ${seed}`).toBeLessThanOrEqual(50);
          for (const issue of r.issues) {
            expect(typeof issue.path, `seed ${seed}`).toBe('string');
            expect(typeof issue.message, `seed ${seed}`).toBe('string');
            expect(issue.message.length, `seed ${seed}`).toBeGreaterThan(0);
          }
        }
      }
      if (results[0].ok) accepted++;
      else rejected++;
    }
    expect(accepted + rejected).toBe(N);
    expect(rejected).toBeGreaterThan(0);
  });

  it('50 raw non-JSON strings and truncated JSON texts are rejected without throwing', () => {
    const rng = mulberry32(99);
    const text = JSON.stringify(fixture);
    const inputs: string[] = [];
    for (let i = 0; i < 25; i++) inputs.push(text.slice(0, int(rng, 0, text.length - 1)));
    const alphabet = [...'{}[]":,\\ \n\t0123456789abcnulltruefalse-+.eE\u0000é€𝄞'];
    for (let i = 0; i < 15; i++) inputs.push(Array.from({ length: int(rng, 1, 200) }, () => pick(rng, alphabet)).join(''));
    inputs.push('', ' ', 'null', 'true', '1', '"tessera.pack/1"', '[]', '{}', 'NaN', '{"schema":"tessera.pack/1",');
    expect(inputs.length).toBe(50);
    for (const s of inputs) {
      let r: ValidationResult;
      try {
        r = validatePack(s);
      } catch (e) {
        throw new Error(`input ${JSON.stringify(s.slice(0, 40))}: validator threw ${String(e)}`);
      }
      expect(r.ok, JSON.stringify(s.slice(0, 40))).toBe(false);
      if (!r.ok) expect(r.issues.length).toBeGreaterThan(0);
    }
    // Defensive: a non-string reaching validatePack at runtime is rejected, not thrown.
    expect(validatePack(undefined as unknown as string).ok).toBe(false);
    expect(validatePack(42 as unknown as string).ok).toBe(false);
  });
});
