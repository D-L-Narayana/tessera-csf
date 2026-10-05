import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/engine/catalog';
import { buildReport } from '../src/engine/evaluate';
import type { CsfFunction, Decision, Report, Status, SubcategoryResult } from '../src/engine/types';
import { validatePack } from '../src/engine/validate';
import fixture from '../src/fixtures/harbourline-pack.json';
import {
  BANDS,
  FUNCTIONS,
  STATUSES,
  baseRows,
  filterRows,
  functionSummary,
  isFilterActive,
  nextSort,
  overrideSummary,
  sortRows,
  statusDistribution,
} from '../src/ui/registerLogic';
import { AS_OF, ev, pack } from './helpers/pack';

const CANONICAL: Status[] = ['sufficient', 'partial', 'weak', 'none', 'contradicted', 'refuted', 'accepted-risk', 'not-applicable'];

function fixtureReport(): Report {
  const r = validatePack(JSON.stringify(fixture));
  if (!r.ok) throw new Error('bundled fixture failed validation: ' + r.issues.map((i) => `${i.path} ${i.message}`).join('; '));
  return buildReport(r.pack);
}

const sub = (id: string) => CATALOG.find((s) => s.id === id)!;
const fnOf = (r: SubcategoryResult): CsfFunction => sub(r.subcategoryId).fn;
const ids = (rows: readonly SubcategoryResult[]) => rows.map((r) => r.subcategoryId);
const allIds = CATALOG.map((s) => s.id);

const naDecision = (subcategoryId: string): Decision => ({
  subcategoryId,
  reviewer: 'r.kaur',
  verdict: 'not-applicable',
  rationale: 'Recovery is fully outsourced under contract RC-77; the provider evidence is reviewed separately.',
  decidedOn: AS_OF,
});

describe('register constants', () => {
  it('exposes the canonical status order, the six functions and the three bands', () => {
    expect([...STATUSES]).toEqual(CANONICAL);
    expect([...FUNCTIONS]).toEqual(['GV', 'ID', 'PR', 'DE', 'RS', 'RC']);
    expect([...BANDS]).toEqual(['low', 'moderate', 'high']);
  });
});

describe('filterRows', () => {
  const report = fixtureReport();

  it('returns every gap in report order when no filter is given', () => {
    expect(filterRows(report, {})).toEqual(report.gaps);
    expect(filterRows(report, { query: '' })).toEqual(report.gaps);
    expect(filterRows(buildReport(pack([])), {}).length).toBe(25);
  });

  it('bases the list on the gaps by default and on all results when closed outcomes are included', () => {
    expect(baseRows(report, false)).toEqual(report.gaps);
    expect(baseRows(report, true)).toEqual(report.results);
    expect(filterRows(report, { includeClosed: true }).length).toBe(25);
    expect(filterRows(report, { includeClosed: true })).toEqual(report.results);
  });

  it('filters by CSF function through the catalog', () => {
    const rows = filterRows(report, { fn: 'GV' });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => fnOf(r) === 'GV')).toBe(true);
    expect(ids(rows)).toEqual(ids(report.gaps.filter((g) => fnOf(g) === 'GV')));
    expect(filterRows(report, { fn: 'GV', includeClosed: true }).length).toBe(CATALOG.filter((s) => s.fn === 'GV').length);
    expect(filterRows(report, { fn: 'RS', includeClosed: true }).length).toBe(2);
  });

  it('filters by status', () => {
    const weak = filterRows(report, { status: 'weak' });
    expect(weak.length).toBeGreaterThan(0);
    expect(weak.every((r) => r.status === 'weak')).toBe(true);
    expect(ids(weak)).toEqual(ids(report.gaps.filter((g) => g.status === 'weak')));
    // sufficient outcomes are never in the gap base
    expect(filterRows(report, { status: 'sufficient' })).toEqual([]);
    const sufficient = filterRows(report, { status: 'sufficient', includeClosed: true });
    expect(sufficient.length).toBeGreaterThan(0);
    expect(ids(sufficient)).toEqual(ids(report.results.filter((r) => r.status === 'sufficient')));
  });

  it('filters by residual band', () => {
    for (const band of BANDS) {
      const rows = filterRows(report, { band });
      expect(rows.every((r) => r.band === band)).toBe(true);
      expect(ids(rows)).toEqual(ids(report.gaps.filter((g) => g.band === band)));
    }
    expect(filterRows(report, { band: 'high' }).length).toBeGreaterThan(0);
    expect(filterRows(report, { band: 'low' }).length).toBeGreaterThan(0);
  });

  it('matches the query against the outcome id case-insensitively', () => {
    const rows = filterRows(report, { query: 'pr.ds' });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.subcategoryId.startsWith('PR.DS'))).toBe(true);
    expect(ids(rows)).toEqual(ids(report.gaps.filter((g) => g.subcategoryId.startsWith('PR.DS'))));
    expect(filterRows(report, { query: 'PR.DS' })).toEqual(rows);
    expect(filterRows(report, { query: 'Pr.Ds' })).toEqual(rows);
  });

  it('matches the query against the category name', () => {
    const rows = filterRows(report, { query: 'data security' });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => sub(r.subcategoryId).categoryName === 'Data Security')).toBe(true);
    expect(ids(rows)).toEqual(ids(report.gaps.filter((g) => sub(g.subcategoryId).categoryName === 'Data Security')));
  });

  it('matches the query against the remediation text case-insensitively', () => {
    const rows = filterRows(report, { query: 'stale' });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.remediation ?? '').toMatch(/stale/i);
    expect(ids(rows)).toContain('DE.CM-01'); // the fixture's documented stale-only outcome
    expect(ids(rows)).toEqual(ids(report.gaps.filter((g) => /stale/i.test(g.remediation ?? ''))));
    expect(filterRows(report, { query: 'STALE' })).toEqual(rows);
  });

  it('matches the query against the function name and the status', () => {
    const govern = filterRows(report, { query: 'govern' });
    expect(govern.length).toBeGreaterThan(0);
    expect(ids(govern)).toEqual(ids(report.gaps.filter((g) => fnOf(g) === 'GV')));
    const contradicted = filterRows(report, { query: 'Contradicted' });
    expect(ids(contradicted)).toContain('PR.DS-11');
    expect(contradicted.every((r) => r.status === 'contradicted' || /contradicted/i.test(r.remediation ?? ''))).toBe(true);
  });

  it('trims the query and treats whitespace-only queries as no filter', () => {
    expect(filterRows(report, { query: '   ' })).toEqual(report.gaps);
    expect(filterRows(report, { query: '  pr.ds  ' })).toEqual(filterRows(report, { query: 'pr.ds' }));
  });

  it('composes function, status, band and query filters', () => {
    const gvWeak = filterRows(report, { fn: 'GV', status: 'weak' });
    expect(gvWeak.length).toBeGreaterThan(0);
    expect(ids(gvWeak)).toEqual(ids(report.gaps.filter((g) => fnOf(g) === 'GV' && g.status === 'weak')));
    expect(ids(filterRows(report, { fn: 'PR', band: 'high', query: 'contradiction' }))).toEqual(['PR.DS-11']);
    expect(filterRows(report, { fn: 'DE', status: 'sufficient', includeClosed: true })).toEqual([]);
    const closedPr = filterRows(report, { fn: 'PR', includeClosed: true, band: 'low' });
    expect(closedPr.every((r) => fnOf(r) === 'PR' && r.band === 'low')).toBe(true);
    expect(closedPr.length).toBe(report.results.filter((r) => fnOf(r) === 'PR' && r.band === 'low').length);
  });

  it('isFilterActive is false for the default filter and true when any filter or the include toggle is set', () => {
    expect(isFilterActive({})).toBe(false);
    expect(isFilterActive({ query: '   ', includeClosed: false })).toBe(false);
    expect(isFilterActive({ fn: 'GV' })).toBe(true);
    expect(isFilterActive({ status: 'weak' })).toBe(true);
    expect(isFilterActive({ band: 'low' })).toBe(true);
    expect(isFilterActive({ query: 'x' })).toBe(true);
    expect(isFilterActive({ includeClosed: true })).toBe(true);
  });

  it('never mutates the report', () => {
    const before = JSON.stringify(report);
    filterRows(report, { fn: 'ID', status: 'none', band: 'high', query: 'evidence', includeClosed: true });
    sortRows(report.gaps, 'id', 'desc');
    expect(JSON.stringify(report)).toBe(before);
  });
});

describe('sortRows', () => {
  const report = fixtureReport();

  it('sorts by id ascending and descending', () => {
    const asc = sortRows(report.gaps, 'id', 'asc');
    expect(ids(asc)).toEqual([...ids(report.gaps)].sort());
    const desc = sortRows(report.gaps, 'id', 'desc');
    expect(ids(desc)).toEqual([...ids(report.gaps)].sort().reverse());
  });

  it('sorts by residual descending with the id as tie-break, reproducing the report gap order', () => {
    const scrambled = [...report.gaps].reverse();
    expect(ids(sortRows(scrambled, 'residual', 'desc'))).toEqual(ids(report.gaps));
    const asc = sortRows(scrambled, 'residual', 'asc');
    for (let i = 1; i < asc.length; i++) {
      expect(asc[i - 1].residual).toBeLessThanOrEqual(asc[i].residual);
      if (asc[i - 1].residual === asc[i].residual) expect(asc[i - 1].subcategoryId < asc[i].subcategoryId).toBe(true);
    }
  });

  it('is stable for equal keys regardless of the input order', () => {
    // the largest group of gaps sharing one residual value (several fixture outcomes sit at the same residual)
    const groups = new Map<number, SubcategoryResult[]>();
    for (const g of report.gaps) groups.set(g.residual, [...(groups.get(g.residual) ?? []), g]);
    const tied = [...groups.values()].sort((a, b) => b.length - a.length)[0];
    expect(tied.length).toBeGreaterThan(1);
    const a = sortRows(tied, 'residual', 'desc');
    const b = sortRows([...tied].reverse(), 'residual', 'desc');
    expect(ids(a)).toEqual(ids(b));
    expect(ids(a)).toEqual([...ids(tied)].sort());
  });

  it('sorts by status in the canonical order', () => {
    const asc = sortRows(report.gaps, 'status', 'asc');
    for (let i = 1; i < asc.length; i++) {
      const prev = CANONICAL.indexOf(asc[i - 1].status);
      const next = CANONICAL.indexOf(asc[i].status);
      expect(prev).toBeLessThanOrEqual(next);
      if (prev === next) expect(asc[i - 1].subcategoryId < asc[i].subcategoryId).toBe(true);
    }
    const desc = sortRows(report.gaps, 'status', 'desc');
    for (let i = 1; i < desc.length; i++) {
      expect(CANONICAL.indexOf(desc[i - 1].status)).toBeGreaterThanOrEqual(CANONICAL.indexOf(desc[i].status));
    }
    expect(asc[0].status).toBe('partial'); // the first gap status in canonical order (sufficient is never a gap)
    expect(desc[0].status).toBe('accepted-risk');
  });

  it('sorts by priority with the id as tie-break', () => {
    const desc = sortRows(report.gaps, 'priority', 'desc');
    expect(desc[0].priority).toBe(3);
    for (let i = 1; i < desc.length; i++) {
      expect(desc[i - 1].priority).toBeGreaterThanOrEqual(desc[i].priority);
      if (desc[i - 1].priority === desc[i].priority) expect(desc[i - 1].subcategoryId < desc[i].subcategoryId).toBe(true);
    }
    const asc = sortRows(report.gaps, 'priority', 'asc');
    expect(asc[0].priority).toBe(1);
  });

  it('returns a new array and leaves the input untouched', () => {
    const input = [...report.gaps].reverse();
    const snapshot = ids(input);
    const out = sortRows(input, 'id', 'asc');
    expect(out).not.toBe(input);
    expect(ids(input)).toEqual(snapshot);
    expect(sortRows([], 'residual', 'desc')).toEqual([]);
  });

  it('nextSort flips the direction of the active key and starts a new key in its natural direction', () => {
    expect(nextSort({ key: 'residual', dir: 'desc' }, 'residual')).toEqual({ key: 'residual', dir: 'asc' });
    expect(nextSort({ key: 'residual', dir: 'asc' }, 'residual')).toEqual({ key: 'residual', dir: 'desc' });
    expect(nextSort({ key: 'residual', dir: 'desc' }, 'id')).toEqual({ key: 'id', dir: 'asc' });
    expect(nextSort({ key: 'id', dir: 'asc' }, 'status')).toEqual({ key: 'status', dir: 'asc' });
    expect(nextSort({ key: 'id', dir: 'asc' }, 'priority')).toEqual({ key: 'priority', dir: 'desc' });
    expect(nextSort({ key: 'status', dir: 'asc' }, 'residual')).toEqual({ key: 'residual', dir: 'desc' });
  });
});

describe('statusDistribution', () => {
  it('lists all eight statuses in canonical order and sums to 25 for a full report', () => {
    const report = fixtureReport();
    const dist = statusDistribution(report.results);
    expect(dist.map((d) => d.status)).toEqual(CANONICAL);
    expect(dist.reduce((a, d) => a + d.count, 0)).toBe(25);
    for (const d of dist) expect(d.count).toBe(report.results.filter((r) => r.status === d.status).length);
    expect(dist.find((d) => d.status === 'sufficient')!.count).toBeGreaterThan(0);
    expect(dist.find((d) => d.status === 'contradicted')!.count).toBeGreaterThan(0);
  });

  it('includes zero counts: an empty profile is 25 none and 0 of everything else', () => {
    const dist = statusDistribution(buildReport(pack([])).results);
    expect(dist.length).toBe(8);
    expect(dist.find((d) => d.status === 'none')!.count).toBe(25);
    for (const d of dist) if (d.status !== 'none') expect(d.count).toBe(0);
  });

  it('works on any subset of results, such as the gap rows', () => {
    const report = fixtureReport();
    const dist = statusDistribution(report.gaps);
    expect(dist.find((d) => d.status === 'sufficient')!.count).toBe(0);
    expect(dist.find((d) => d.status === 'not-applicable')!.count).toBe(0);
    expect(dist.reduce((a, d) => a + d.count, 0)).toBe(report.gaps.length);
  });
});

describe('functionSummary', () => {
  it('summarises each function in catalog order using the report rollups (fixture)', () => {
    const report = fixtureReport();
    const summary = functionSummary(report);
    expect(summary.map((f) => f.fn)).toEqual(['GV', 'ID', 'PR', 'DE', 'RS', 'RC']);
    const gv = summary[0];
    expect(gv.functionName).toBe('Govern');
    expect(gv.count).toBe(6);
    expect(gv.sufficient).toBe(0);
    expect(gv.gaps).toBe(report.gaps.filter((g) => fnOf(g) === 'GV').length);
    expect(gv.gaps).toBeGreaterThan(0);
    expect(gv.warnings).toBe(report.results.filter((r) => fnOf(r) === 'GV' && r.warnings.length > 0).length);
    expect(gv.warnings).toBeGreaterThanOrEqual(2); // stale decision on GV.RM-02 and the short override on GV.PO-01
    expect(gv.band).toBe(report.rollups.find((r) => r.fn === 'GV')!.band);
    expect(summary.reduce((a, f) => a + f.gaps, 0)).toBe(report.gaps.length);
    expect(summary.reduce((a, f) => a + f.count, 0)).toBe(25);
    for (const f of summary) {
      const roll = report.rollups.find((r) => r.fn === f.fn)!;
      expect(f.sufficient).toBe(roll.sufficient);
      expect(f.band).toBe(roll.band);
      expect(f.functionName).toBe(roll.functionName);
    }
  });

  it('reports not-assessed for a function whose outcomes are all scoped out', () => {
    const p = pack([], CATALOG.filter((s) => s.fn === 'RC').map((s) => naDecision(s.id)));
    const rc = functionSummary(buildReport(p)).find((f) => f.fn === 'RC')!;
    expect(rc).toMatchObject({ fn: 'RC', functionName: 'Recover', count: 2, sufficient: 0, gaps: 0, warnings: 0, band: 'not-assessed' });
  });

  it('an empty profile has no sufficient outcomes, every outcome as a gap and high bands', () => {
    const rows = functionSummary(buildReport(pack([])));
    expect(rows.length).toBe(6);
    for (const f of rows) {
      expect(f.sufficient).toBe(0);
      expect(f.gaps).toBe(f.count);
      expect(f.warnings).toBe(0);
      expect(f.band).toBe('high');
    }
  });
});

describe('overrideSummary', () => {
  it('counts valid and invalid overrides and the refused reviewer actions in the fixture', () => {
    const report = fixtureReport();
    const byId = (id: string) => report.results.find((r) => r.subcategoryId === id)!;
    expect(byId('RC.CO-03').override && byId('RC.CO-03').overrideValid).toBe(true); // accepted-risk is a valid override
    expect(byId('GV.PO-01').override && !byId('GV.PO-01').overrideValid).toBe(true); // "Looks fine."
    const o = overrideSummary(report);
    expect(o.valid).toBeGreaterThanOrEqual(1);
    expect(o.invalid).toBeGreaterThanOrEqual(1);
    expect(o.valid).toBe(report.results.filter((r) => r.override && r.overrideValid).length);
    expect(o.invalid).toBe(report.results.filter((r) => r.override && !r.overrideValid).length);
    expect(o.refusedActions).toBe(report.results.reduce((a, r) => a + r.warnings.length, 0));
    expect(o.refusedActions).toBeGreaterThanOrEqual(3); // stale decision, short rationale, acceptance of a contradicted outcome
  });

  it('is all zeros for an empty profile and for a fully sufficient one', () => {
    expect(overrideSummary(buildReport(pack([])))).toEqual({ valid: 0, invalid: 0, refusedActions: 0 });
    const full = buildReport(pack([ev({ id: 'E1', type: 'policy', subcategoryIds: allIds }), ev({ id: 'E2', type: 'configuration', subcategoryIds: allIds })]));
    expect(full.gaps).toEqual([]);
    expect(overrideSummary(full)).toEqual({ valid: 0, invalid: 0, refusedActions: 0 });
  });
});
