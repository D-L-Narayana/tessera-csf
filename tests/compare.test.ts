// Period-over-period comparison: bounded validation of a previously exported tessera.report/1 and
// deterministic per-outcome deltas against the current evaluation.
import { describe, expect, it } from 'vitest';
import { buildReport } from '../src/engine/evaluate';
import { DEFAULT_POLICY } from '../src/engine/policy';
import { MAX_PACK_BYTES, validatePackObject } from '../src/engine/validate';
import {
  MAX_PRIOR_RESULTS,
  compareReports,
  formatDelta,
  validatePriorReport,
  type Change,
  type PriorReport,
  type PriorResult,
} from '../src/engine/compare';
import type { Report } from '../src/engine/types';
import demo from '../src/fixtures/harbourline-pack.json';
import { AS_OF, ev, pack } from './helpers/pack';

const GROUP_ORDER: Change[] = ['regressed', 'changed', 'improved', 'added', 'removed', 'unchanged'];
const PRIOR_AS_OF = '2026-07-01'; // a quarter before AS_OF

function res(subcategoryId: string, status: PriorResult['status'], residual: number, priority: PriorResult['priority'] = 2): PriorResult {
  return { subcategoryId, status, residual, priority };
}

/** A hand-built prior report as the raw object a file would contain (extra keys allowed on purpose). */
function priorOf(results: unknown[], patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { schema: 'tessera.report/1', generatedFor: 'Test profile', asOf: PRIOR_AS_OF, results, ...patch };
}

function parse(raw: unknown): PriorReport {
  const r = validatePriorReport(JSON.stringify(raw));
  const why = r.ok ? '' : 'expected a valid prior report: ' + r.issues.map((i) => `${i.path} ${i.message}`).join('; ');
  expect(r.ok, why).toBe(true);
  if (!r.ok) throw new Error(why);
  return r.report;
}

function issuesOf(raw: unknown) {
  return issuesOfText(JSON.stringify(raw));
}

function issuesOfText(text: string) {
  const r = validatePriorReport(text);
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error('unreachable: the prior report was accepted');
  return r.issues;
}

function fixtureReport(): Report {
  const v = validatePackObject(demo);
  if (!v.ok) throw new Error('bundled fixture failed validation');
  return buildReport(v.pack);
}

describe('validatePriorReport — bounds and shape', () => {
  it('rejects text larger than MAX_PACK_BYTES with the byte limit in the message and an empty path', () => {
    const issues = issuesOfText('x'.repeat(MAX_PACK_BYTES + 1));
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('');
    expect(issues[0].message).toMatch(/too large/i);
    expect(issues[0].message).toContain(String(MAX_PACK_BYTES));
  });

  it('rejects invalid JSON and empty input without throwing', () => {
    expect(issuesOfText('{not json')[0].message).toMatch(/not valid JSON/i);
    expect(issuesOfText('')[0].message).toMatch(/not valid JSON/i);
    expect(issuesOfText('{"schema":"tessera.report/1","results":')[0].message).toMatch(/not valid JSON/i);
  });

  it('rejects documents that are not a JSON object', () => {
    for (const text of ['[1,2]', '"report"', 'null', '42', 'true']) {
      const issues = issuesOfText(text);
      expect(issues[0].path).toBe('');
      expect(issues[0].message).toMatch(/object/i);
    }
  });

  it('rejects a wrong schema tag at path "schema"', () => {
    const issues = issuesOf(priorOf([res('PR.AA-05', 'none', 2)], { schema: 'tessera.pack/1' }));
    expect(issues.some((i) => i.path === 'schema' && /tessera\.report\/1/.test(i.message))).toBe(true);
  });

  it('rejects a bad asOf at path "asOf" and a bad generatedFor at path "generatedFor"', () => {
    expect(issuesOf(priorOf([], { asOf: '2026-02-30' })).some((i) => i.path === 'asOf')).toBe(true);
    expect(issuesOf(priorOf([], { asOf: 20260701 })).some((i) => i.path === 'asOf')).toBe(true);
    expect(issuesOf(priorOf([], { generatedFor: '' })).some((i) => i.path === 'generatedFor')).toBe(true);
    expect(issuesOf(priorOf([], { generatedFor: 'x'.repeat(161) })).some((i) => i.path === 'generatedFor')).toBe(true);
    expect(issuesOf(priorOf([], { generatedFor: 7 })).some((i) => i.path === 'generatedFor')).toBe(true);
    expect(parse(priorOf([], { generatedFor: 'x'.repeat(160) })).generatedFor).toHaveLength(160);
  });

  it('rejects results that are not an array or exceed the result cap at path "results"', () => {
    expect(issuesOf(priorOf([], { results: {} })).some((i) => i.path === 'results')).toBe(true);
    expect(issuesOf(priorOf([], { results: null })).some((i) => i.path === 'results')).toBe(true);
    const many = Array.from({ length: MAX_PRIOR_RESULTS + 1 }, () => res('PR.AA-05', 'none', 2));
    const issues = issuesOf(priorOf(many));
    expect(issues.some((i) => i.path === 'results' && i.message.includes(String(MAX_PRIOR_RESULTS)))).toBe(true);
    expect(MAX_PRIOR_RESULTS).toBe(200);
  });
});

describe('validatePriorReport — per-result rules', () => {
  it('rejects an unknown subcategory id at results[0].subcategoryId', () => {
    const issues = issuesOf(priorOf([res('PR.XX-99', 'none', 2)]));
    expect(issues.some((i) => i.path === 'results[0].subcategoryId' && /unknown subcategory/i.test(i.message))).toBe(true);
  });

  it('rejects an unknown status at results[3].status in a four-result report', () => {
    const issues = issuesOf(
      priorOf([
        res('GV.OC-03', 'sufficient', 0.3),
        res('GV.RM-02', 'partial', 1),
        res('GV.RR-02', 'weak', 1.6),
        { subcategoryId: 'GV.PO-01', status: 'great', residual: 1, priority: 2 },
      ]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('results[3].status');
    expect(issues[0].message).toMatch(/must be one of/);
  });

  it('rejects a computedStatus that is present but unknown, and accepts its absence', () => {
    const bad = issuesOf(priorOf([{ ...res('PR.AA-05', 'none', 2), computedStatus: 'maybe' }]));
    expect(bad.some((i) => i.path === 'results[0].computedStatus')).toBe(true);
    const ok = parse(priorOf([res('PR.AA-05', 'none', 2)]));
    expect('computedStatus' in ok.results[0]).toBe(false);
    const withComputed = parse(priorOf([{ ...res('PR.AA-05', 'sufficient', 0.3), computedStatus: 'weak' }]));
    expect(withComputed.results[0].computedStatus).toBe('weak');
  });

  it('rejects a duplicate subcategory id at the second occurrence', () => {
    const issues = issuesOf(priorOf([res('PR.AA-05', 'none', 2), res('PR.AA-05', 'weak', 1.6)]));
    expect(issues.some((i) => i.path === 'results[1].subcategoryId' && /duplicate/i.test(i.message))).toBe(true);
  });

  it('rejects residuals outside 0..3 or not finite numbers, and accepts the boundaries', () => {
    for (const residual of [3.5, -0.1, '1', null, undefined]) {
      const issues = issuesOf(priorOf([{ subcategoryId: 'PR.AA-05', status: 'none', residual, priority: 2 }]));
      expect(issues.some((i) => i.path === 'results[0].residual')).toBe(true);
    }
    expect(parse(priorOf([res('PR.AA-05', 'not-applicable', 0)])).results[0].residual).toBe(0);
    expect(parse(priorOf([res('PR.AA-05', 'none', 3, 3)])).results[0].residual).toBe(3);
  });

  it('rejects a priority other than 1, 2 or 3 at results[i].priority', () => {
    for (const priority of [0, 4, '2', null]) {
      const issues = issuesOf(priorOf([{ subcategoryId: 'PR.AA-05', status: 'none', residual: 2, priority }]));
      expect(issues.some((i) => i.path === 'results[0].priority')).toBe(true);
    }
  });

  it('rejects a result that is not an object at results[i]', () => {
    const issues = issuesOf(priorOf([res('PR.AA-05', 'none', 2), 'nope']));
    expect(issues.some((i) => i.path === 'results[1]' && /object/i.test(i.message))).toBe(true);
  });

  it('drops unknown keys (including evidence and reasons) and keeps policy only when it is an object', () => {
    const exported = JSON.stringify({ ...fixtureReport(), extra: { nested: true } }, null, 2);
    const r = validatePriorReport(exported);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.report).sort()).toEqual(['asOf', 'generatedFor', 'policy', 'results', 'schema']);
    for (const result of r.report.results) {
      expect(Object.keys(result).sort()).toEqual(['computedStatus', 'priority', 'residual', 'status', 'subcategoryId']);
    }
    expect(r.report.policy).toEqual(DEFAULT_POLICY);
    expect(parse(priorOf([res('PR.AA-05', 'none', 2)], { policy: 'default' })).policy).toBeUndefined();
    expect(parse(priorOf([res('PR.AA-05', 'none', 2)], { policy: [1, 2] })).policy).toBeUndefined();
    expect(parse(priorOf([res('PR.AA-05', 'none', 2)])).policy).toBeUndefined();
  });

  it('caps issues at 50 for a hostile report and never throws', () => {
    const hostile = priorOf(Array.from({ length: MAX_PRIOR_RESULTS }, () => ({ subcategoryId: 'ZZ.ZZ-00', status: 'bad', residual: 9, priority: 0 })));
    const r = validatePriorReport(JSON.stringify(hostile));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toHaveLength(50);
    for (const text of ['{"schema":"tessera.report/1","results":null}', '{"__proto__":{"x":1}}', '{"results":[{}]}']) {
      const out = validatePriorReport(text);
      expect(typeof out.ok).toBe('boolean');
      expect(out.ok).toBe(false);
    }
  });
});

describe('compareReports — classification', () => {
  it('self-compare of an exported fixture report yields 25 unchanged outcomes with zero deltas', () => {
    const current = fixtureReport();
    const prior = parse(JSON.parse(JSON.stringify(current, null, 2)));
    const cmp = compareReports(prior, current);
    expect(cmp.deltas).toHaveLength(25);
    expect(cmp.counts).toEqual({ improved: 0, regressed: 0, changed: 0, unchanged: 25, added: 0, removed: 0 });
    for (const d of cmp.deltas) {
      expect(d.change).toBe('unchanged');
      expect(d.residualDelta).toBe(0);
      expect(d.before).toBe(d.after);
      expect(d.residualBefore).toBe(d.residualAfter);
    }
    expect(cmp.before).toEqual({ asOf: current.asOf, generatedFor: current.generatedFor });
    expect(cmp.after).toEqual({ asOf: current.asOf, generatedFor: current.generatedFor });
    // Same asOf on both sides is the only caveat worth raising here.
    expect(cmp.warnings).toHaveLength(1);
    expect(cmp.warnings[0]).toMatch(/not older than the current evaluation/);
  });

  it('a residual decrease is improved, with the delta rounded to 2 decimals', () => {
    const prior = parse(priorOf([res('PR.AA-05', 'weak', 1.6)]));
    const current = buildReport(pack([ev({ id: 'E1' }), ev({ id: 'E2', type: 'report' })]));
    const d = compareReports(prior, current).deltas.find((x) => x.subcategoryId === 'PR.AA-05')!;
    expect(d).toMatchObject({ before: 'weak', after: 'sufficient', residualBefore: 1.6, residualAfter: 0.3, residualDelta: -1.3, change: 'improved' });

    const tiny = parse(priorOf([res('PR.AA-05', 'weak', 0.3, 1)]));
    const low = buildReport(pack([ev({ id: 'E1' }), ev({ id: 'E2', type: 'report' })], [], { priorities: { 'PR.AA-05': 1 } }));
    const t = compareReports(tiny, low).deltas.find((x) => x.subcategoryId === 'PR.AA-05')!;
    expect(t.residualAfter).toBe(0.15);
    expect(t.residualDelta).toBe(-0.15); // after − before, rounded to 2 decimals
    expect(t.change).toBe('improved');
  });

  it('a residual increase is regressed', () => {
    const prior = parse(priorOf([res('PR.AA-05', 'sufficient', 0.3)]));
    const current = buildReport(pack([]));
    const d = compareReports(prior, current).deltas.find((x) => x.subcategoryId === 'PR.AA-05')!;
    expect(d).toMatchObject({ before: 'sufficient', after: 'none', residualDelta: 1.7, change: 'regressed' });
  });

  it('an equal residual with a different status is changed (none 1.0 → contradicted 1.0 at priority 1)', () => {
    const prior = parse(priorOf([res('PR.AA-05', 'none', 1, 1)]));
    const current = buildReport(pack([ev({ id: 'OK' }), ev({ id: 'BAD', type: 'log-sample', assertion: 'refutes' })], [], { priorities: { 'PR.AA-05': 1 } }));
    const d = compareReports(prior, current).deltas.find((x) => x.subcategoryId === 'PR.AA-05')!;
    expect(d.after).toBe('contradicted');
    expect(d.residualAfter).toBe(1);
    expect(d).toMatchObject({ before: 'none', residualDelta: 0, change: 'changed' });
  });

  it('outcomes only in the current report are added and only in the prior report are removed', () => {
    const prior = parse(priorOf([res('PR.AA-05', 'none', 2)]));
    const current = buildReport(pack([]));
    const cmp = compareReports(prior, current);
    expect(cmp.counts.added).toBe(24);
    expect(cmp.counts.unchanged).toBe(1);
    const added = cmp.deltas.filter((d) => d.change === 'added');
    for (const d of added) {
      expect(d.before).toBeUndefined();
      expect(d.residualBefore).toBeUndefined();
      expect(d.after).toBe('none');
      expect(d.residualDelta).toBe(d.residualAfter);
      expect(d.residualDelta).toBe(2);
    }

    const full = buildReport(pack([]));
    const trimmed: Report = { ...full, results: full.results.filter((r) => r.subcategoryId !== 'RC.CO-03') };
    const fromFull = parse(JSON.parse(JSON.stringify(full)));
    const removed = compareReports(fromFull, trimmed).deltas.filter((d) => d.change === 'removed');
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ subcategoryId: 'RC.CO-03', before: 'none', residualBefore: 2, residualDelta: -2 });
    expect(removed[0].after).toBeUndefined();
    expect(removed[0].residualAfter).toBeUndefined();
  });

  it('counts carry all six keys and sum to the number of deltas', () => {
    const cmp = compareReports(parse(priorOf([res('PR.AA-05', 'sufficient', 0.3)])), buildReport(pack([])));
    expect(Object.keys(cmp.counts).sort()).toEqual([...GROUP_ORDER].sort());
    const total = Object.values(cmp.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(cmp.deltas.length);
    expect(cmp.counts.regressed).toBe(1);
  });
});

describe('compareReports — ordering, warnings, determinism', () => {
  const current = buildReport(pack([])); // every outcome: none, residual 2.00 at priority 2
  const mixed = priorOf([
    res('GV.OC-03', 'sufficient', 0.3), // +1.70 regressed
    res('GV.RM-02', 'partial', 1), // +1.00 regressed
    res('GV.RR-02', 'weak', 1.6), // +0.40 regressed
    res('GV.PO-01', 'contradicted', 2), // 0.00 changed
    res('GV.SC-04', 'none', 2), // unchanged
    res('GV.SC-07', 'refuted', 3, 3), // −1.00 improved
    res('ID.AM-01', 'none', 3, 3), // −1.00 improved (tie → id order)
  ]);

  it('sorts regressed, changed, improved, added, removed, unchanged; then |Δ| desc, then id', () => {
    const cmp = compareReports(parse(mixed), current);
    expect(cmp.deltas.slice(0, 6).map((d) => d.subcategoryId)).toEqual(['GV.OC-03', 'GV.RM-02', 'GV.RR-02', 'GV.PO-01', 'GV.SC-07', 'ID.AM-01']);
    expect(cmp.deltas.slice(0, 3).map((d) => d.residualDelta)).toEqual([1.7, 1, 0.4]);
    expect(cmp.deltas.at(-1)!).toMatchObject({ subcategoryId: 'GV.SC-04', change: 'unchanged' });
    const ranks = cmp.deltas.map((d) => GROUP_ORDER.indexOf(d.change));
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
    const addedIds = cmp.deltas.filter((d) => d.change === 'added').map((d) => d.subcategoryId);
    expect(addedIds).toHaveLength(18);
    expect(addedIds).toEqual([...addedIds].sort());
    expect(cmp.counts).toEqual({ regressed: 3, changed: 1, improved: 2, added: 18, removed: 0, unchanged: 1 });
  });

  it('warns when the profile name differs, quoting both names', () => {
    const cmp = compareReports(parse(priorOf([], { generatedFor: 'Old Co' })), current);
    expect(cmp.warnings.some((w) => /profile differs: "Old Co" vs "Test profile"/.test(w))).toBe(true);
    expect(compareReports(parse(priorOf([])), current).warnings.some((w) => /profile differs/.test(w))).toBe(false);
  });

  it('warns when the previous report is not older than the current evaluation', () => {
    const same = compareReports(parse(priorOf([], { asOf: AS_OF })), current);
    expect(same.warnings.some((w) => /not older than the current evaluation/.test(w) && w.includes(AS_OF))).toBe(true);
    const newer = compareReports(parse(priorOf([], { asOf: '2026-12-01' })), current);
    expect(newer.warnings.some((w) => /not older/.test(w))).toBe(true);
    const older = compareReports(parse(priorOf([], { asOf: PRIOR_AS_OF })), current);
    expect(older.warnings.some((w) => /not older/.test(w))).toBe(false);
  });

  it('warns when the previous report carries no rule policy, or a different one, and stays quiet when it matches', () => {
    const none = compareReports(parse(priorOf([])), current);
    expect(none.warnings.some((w) => /no rule policy/.test(w) && /thresholds may differ/.test(w))).toBe(true);
    expect(none.warnings.some((w) => /policy differs/.test(w))).toBe(false);

    const differs = compareReports(parse(priorOf([], { policy: { ...DEFAULT_POLICY, decisionValidDays: 180 } })), current);
    expect(differs.warnings.some((w) => /rule policy differs between the two reports/.test(w))).toBe(true);
    expect(differs.warnings.some((w) => /no rule policy/.test(w))).toBe(false);

    const matches = compareReports(parse(priorOf([], { policy: DEFAULT_POLICY })), current);
    expect(matches.warnings.some((w) => /policy/.test(w))).toBe(false);
    expect(matches.warnings).toEqual([]);
  });

  it('is deterministic and independent of the order of the prior results', () => {
    const prior = parse(mixed);
    const a = JSON.stringify(compareReports(prior, current));
    const b = JSON.stringify(compareReports(prior, current));
    expect(a).toBe(b);
    const reversed: PriorReport = { ...prior, results: [...prior.results].reverse() };
    expect(JSON.stringify(compareReports(reversed, current))).toBe(a);
    const shuffled: PriorReport = { ...prior, results: [prior.results[3], prior.results[6], prior.results[0], prior.results[5], prior.results[1], prior.results[4], prior.results[2]] };
    expect(JSON.stringify(compareReports(shuffled, current))).toBe(a);
  });

  it('formats residual deltas with an explicit sign', () => {
    expect(formatDelta(0.5)).toBe('+0.50');
    expect(formatDelta(-1)).toBe('−1.00');
    expect(formatDelta(0)).toBe('0.00');
    expect(formatDelta(-0)).toBe('0.00');
    expect(formatDelta(1.7)).toBe('+1.70');
  });
});
