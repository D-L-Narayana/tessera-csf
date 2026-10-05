import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/engine/catalog';
import { evidenceInventoryRows, gapRegisterRows, reportToCsvRows, toCsv } from '../src/engine/csv';
import { buildReport, reportToCsvRows as baselineReportToCsvRows, toCsv as baselineToCsv } from '../src/engine/evaluate';
import { reportToMarkdown } from '../src/engine/markdown';
import { DEFAULT_POLICY } from '../src/engine/policy';
import type { Decision, EvidencePack, Report } from '../src/engine/types';
import { validatePack } from '../src/engine/validate';
import demo from '../src/fixtures/harbourline-pack.json';
import { withBom } from '../src/ui/files';
import { AS_OF, ev, pack } from './helpers/pack';

function demoPack(): EvidencePack {
  const r = validatePack(JSON.stringify(demo));
  if (!r.ok) throw new Error('bundled fixture failed validation');
  return r.pack;
}

const fixture = demoPack();
const fixtureReport = buildReport(fixture);

const BASELINE_HEADER = ['subcategory', 'function', 'category', 'status', 'computed', 'coverage', 'types', 'priority', 'residual', 'band', 'override', 'remediation'];
const EXTRA_HEADER = ['reviewer', 'verdict', 'decidedOn', 'warnings'];

describe('toCsv — baseline compatibility (byte-identical to the engine toCsv)', () => {
  it('matches the engine for the formula-injection cases from the baseline suite', () => {
    const rows = [
      ['id', 'title'],
      ['=1+1', '+cmd|"x"'],
      ['-x', '@SUM(A1)'],
      ['plain, comma', 'tab\there'],
    ];
    const csv = toCsv(rows);
    expect(csv).toBe(baselineToCsv(rows));
    const lines = csv.split('\r\n');
    expect(lines.length).toBe(4);
    expect(lines[0]).toBe('"id","title"');
    expect(lines[1]).toBe(`"'=1+1","'+cmd|""x"""`);
    expect(lines[2]).toBe(`"'-x","'@SUM(A1)"`);
    expect(lines[3]).toBe(`"plain, comma","tab\there"`);
  });

  it('matches the engine for formulas hidden behind leading whitespace or control characters', () => {
    const rows = [[' =HYPERLINK("x")', '\t=1+1', '\r=cmd', '  @SUM(A1)', '\u0000-x', '\u001f+y']];
    const csv = toCsv(rows);
    expect(csv).toBe(baselineToCsv(rows));
    const cells = csv.split(',');
    expect(cells.length).toBe(6);
    for (const c of cells) expect(c.startsWith(`"'`)).toBe(true);
  });

  it('matches the engine for the whole fixture report and for numeric, empty and non-ASCII cells', () => {
    const rows = baselineReportToCsvRows(fixtureReport);
    expect(toCsv(rows)).toBe(baselineToCsv(rows));
    const mixed = [[0, -1, 2.5, '', 'ü — €', 'EV-001; EV-002']];
    expect(toCsv(mixed)).toBe(baselineToCsv(mixed));
  });

  it('quotes every cell, doubles embedded quotes, joins rows with CRLF and never adds a byte-order mark', () => {
    const csv = toCsv([['a', 1], ['he said "hi"', 'x']]);
    expect(csv).toBe('"a","1"\r\n"he said ""hi""","x"');
    expect(csv.charCodeAt(0)).toBe(0x22);
    expect(csv.includes('﻿')).toBe(false);
  });
});

describe('toCsv — pipe (DDE-style) neutralisation', () => {
  it("prefixes a leading '|' with an apostrophe, also when hidden behind whitespace or control characters", () => {
    expect(toCsv([['|cmd', ' |cmd', '\t|cmd', '\u0000|cmd']])).toBe(`"'|cmd","' |cmd","'\t|cmd","'\u0000|cmd"`);
  });

  it('leaves a pipe that does not lead the cell untouched', () => {
    expect(toCsv([['a|b', 'EV-001; EV-002']])).toBe('"a|b","EV-001; EV-002"');
  });
});

describe('reportToCsvRows', () => {
  const rows = reportToCsvRows(fixtureReport);
  const baseline = baselineReportToCsvRows(fixtureReport);
  const rowFor = (id: string) => rows.find((r) => r[0] === id)!;

  it('keeps the twelve baseline columns first, in order, and appends four decision columns', () => {
    expect(rows.length).toBe(fixtureReport.results.length + 1);
    expect(rows[0].slice(0, 12)).toEqual(BASELINE_HEADER);
    expect(rows[0].slice(12)).toEqual(EXTRA_HEADER);
    expect(rows[0]).toEqual([...baseline[0], ...EXTRA_HEADER]);
  });

  it('emits one row per result whose baseline cells are byte-identical to the engine rows', () => {
    expect(rows.length).toBe(baseline.length);
    for (let i = 0; i < rows.length; i++) expect(rows[i].slice(0, 12)).toEqual(baseline[i]);
    expect(toCsv(rows.map((r) => r.slice(0, 12)))).toBe(baselineToCsv(baseline));
  });

  it('fills reviewer, verdict, decidedOn and warnings from the result and leaves them blank without a decision', () => {
    const gvpo = rowFor('GV.PO-01');
    const result = fixtureReport.results.find((r) => r.subcategoryId === 'GV.PO-01')!;
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(gvpo.slice(12, 15)).toEqual(['r.kaur', 'accepted', '2026-09-29']);
    expect(gvpo[15]).toBe(result.warnings.join('; '));
    expect(String(gvpo[15])).toMatch(/rationale/i);
    expect(rowFor('PR.AT-01').slice(12)).toEqual(['', '', '', '']);
  });

  it("joins several warnings with '; ' so the cell starts with a word, never a pipe", () => {
    const report: Report = structuredClone(fixtureReport);
    report.results[0].warnings = ['first warning', 'second warning'];
    const row = reportToCsvRows(report)[1];
    expect(row[15]).toBe('first warning; second warning');
  });
});

describe('gapRegisterRows', () => {
  const rows = gapRegisterRows(fixtureReport);

  it('has a header plus one row per gap, ranked 1..n in register order', () => {
    expect(fixtureReport.gaps.length).toBeGreaterThan(0);
    expect(rows.length).toBe(fixtureReport.gaps.length + 1);
    expect(rows[0]).toEqual(['rank', 'subcategory', 'function', 'category', 'status', 'priority', 'residual', 'band', 'remediation']);
    expect(rows.slice(1).map((r) => r[0])).toEqual(fixtureReport.gaps.map((_, i) => i + 1));
    expect(rows.slice(1).map((r) => r[1])).toEqual(fixtureReport.gaps.map((g) => g.subcategoryId));
  });

  it('carries catalog names and the gap status, priority, residual, band and remediation', () => {
    const first = fixtureReport.gaps[0];
    const s = CATALOG.find((c) => c.id === first.subcategoryId)!;
    expect(rows[1]).toEqual([1, first.subcategoryId, s.functionName, s.categoryName, first.status, first.priority, first.residual, first.band, first.remediation ?? '']);
  });

  it('is only the header when every outcome is sufficient or not applicable', () => {
    const decisions: Decision[] = CATALOG.map((s) => ({
      subcategoryId: s.id,
      reviewer: 'x',
      verdict: 'not-applicable',
      rationale: "Scoped out for this exercise under the parent entity's services agreement (SA-2026-04).",
      decidedOn: AS_OF,
    }));
    const report = buildReport(pack([], decisions));
    expect(report.gaps.length).toBe(0);
    expect(gapRegisterRows(report).length).toBe(1);
  });
});

describe('evidenceInventoryRows', () => {
  const rows = evidenceInventoryRows(fixture, fixtureReport);
  const rowFor = (id: string) => rows.find((r) => r[0] === id)!;

  it('has a header plus one row per evidence artifact, in pack order', () => {
    expect(rows.length).toBe(fixture.evidence.length + 1);
    expect(rows[0]).toEqual(['id', 'title', 'type', 'scope', 'assertion', 'source', 'collectedBy', 'collectedOn', 'validDays', 'freshness', 'ageDays', 'weight', 'subcategoryIds', 'note']);
    expect(rows.slice(1).map((r) => r[0])).toEqual(fixture.evidence.map((e) => e.id));
  });

  it('reports freshness, age and weight as assessed at asOf (refuting EV-005 is fresh with weight 0; EV-006 is stale)', () => {
    const ev5 = rowFor('EV-005');
    expect(ev5.slice(9, 12)).toEqual(['fresh', 13, 0]);
    const ev6 = rowFor('EV-006');
    expect(ev6[9]).toBe('stale');
    expect(ev6[11]).toBe(0);
    const ev1 = rowFor('EV-001');
    expect(ev1[9]).toBe('fresh');
    expect(ev1[11]).toBe(1);
  });

  it("joins subcategory references with '; ' and leaves optional fields blank when absent", () => {
    const ev1 = rowFor('EV-001');
    expect(ev1.slice(1, 9)).toEqual(['Access control policy v4 (approved)', 'policy', 'full', 'supports', 'grc.example', '', '2026-08-14', 365]);
    expect(ev1[12]).toBe('PR.AA-05; PR.AA-01');
    expect(ev1[13]).toBe('Signed by CIO 2026-08-10; covers least privilege and SoD.');
    expect(rowFor('EV-003')[13]).toBe('');
  });

  it('includes collectedBy when the artifact records who collected it', () => {
    const p = pack([ev({ id: 'E1', collectedBy: 'a.lee' }), ev({ id: 'E2' })]);
    const r = evidenceInventoryRows(p, buildReport(p));
    expect(r.length).toBe(3);
    expect(r[1][6]).toBe('a.lee');
    expect(r[2][6]).toBe('');
  });
});

describe('reportToMarkdown', () => {
  const md = reportToMarkdown(fixtureReport, fixture);
  const lines = md.split('\n');

  it('opens with the report heading and states the as-of date, framework and subset', () => {
    expect(lines[0]).toBe('# Tessera report — Harbourline Logistics (synthetic demo profile)');
    expect(md).toContain(`As of: ${fixtureReport.asOf}`);
    expect(md).toContain(fixtureReport.framework);
    expect(md).toContain(fixtureReport.subset);
    expect(md.includes('\r')).toBe(false);
  });

  it('keeps the scoring note, decision policy and disclaimer verbatim', () => {
    expect(md).toContain('## Notes');
    expect(md).toContain(fixtureReport.scoringNote);
    expect(md).toContain(fixtureReport.decisionPolicy);
    expect(md).toContain(fixtureReport.disclaimer);
    expect(md).toMatch(/custom educational heuristic/);
    expect(md).toMatch(/not a certification/);
  });

  it('ends with the exact footer and carries no tool or authorship attribution', () => {
    const footer = `Generated by Tessera (educational prototype) for ${fixtureReport.generatedFor} as of ${fixtureReport.asOf}.`;
    const nonEmpty = lines.filter((l) => l.trim() !== '');
    expect(nonEmpty[nonEmpty.length - 1]).toBe(footer);
    const generated = lines.filter((l) => l.startsWith('Generated by'));
    expect(generated).toEqual([footer]);
    expect(md).not.toMatch(/generated with|co-authored|powered by|assistant|model/i);
  });

  it('summarises the rule policy with its key thresholds and says it is the default', () => {
    expect(md).toContain('## Rule policy');
    expect(md).toMatch(/default policy/);
    expect(md).not.toMatch(/custom policy/);
    expect(md).toMatch(/\| agingMultiplier \| 1\.5 \|/);
    expect(md).toMatch(/\| decisionValidDays \| 365 \|/);
    expect(md).toMatch(/\| minOverrideRationale \| 40 \|/);
    expect(md).toMatch(/\| sufficientCoverage \| 1 \|/);
    expect(md).toMatch(/\| minDistinctTypes \| 2 \|/);
    expect(md).toMatch(/\| separationOfDuties \| true \|/);
  });

  it('labels a non-default policy as custom and prints its values', () => {
    const p: EvidencePack = { ...pack([ev({ id: 'E1' })]), policy: { ...DEFAULT_POLICY, decisionValidDays: 180, minOverrideRationale: 10 } };
    const r = buildReport(p);
    expect(r.policyIsDefault).toBe(false);
    const out = reportToMarkdown(r, p);
    expect(out).toMatch(/custom policy/);
    expect(out).not.toMatch(/default policy/);
    expect(out).toMatch(/\| decisionValidDays \| 180 \|/);
    expect(out).toMatch(/\| minOverrideRationale \| 10 \|/);
  });

  it('renders a function table with six rows and a gap register table with one row per gap', () => {
    expect(md).toContain('| Function | Sufficient | Assessed | Mean residual | Band |');
    const fnRows = lines.filter((l) => /^\| (GV|ID|PR|DE|RS|RC) /.test(l));
    expect(fnRows.length).toBe(6);
    expect(md).toContain('| # | Outcome | Status | Priority | Residual | Band | Remediation |');
    const gapRows = lines.filter((l) => /^\| \d+ \| /.test(l));
    expect(gapRows.length).toBe(fixtureReport.gaps.length);
    expect(gapRows[0]).toContain(fixtureReport.gaps[0].subcategoryId);
    expect(gapRows[0]).toContain(fixtureReport.gaps[0].residual.toFixed(2));
  });

  it('escapes pipes, angle brackets and ampersands in cells and never leaves a raw newline inside a cell', () => {
    const report: Report = structuredClone(fixtureReport);
    report.gaps[0].remediation = 'a|b\nc<d & e\r\nf';
    const out = reportToMarkdown(report, fixture);
    expect(out).toContain('a\\|b c&lt;d &amp; e f');
    expect(out).not.toContain('a|b');
    const section = out.slice(out.indexOf('## Gap register'), out.indexOf('## Notes'));
    const tableLines = section.split('\n').filter((l) => l.startsWith('|'));
    expect(tableLines.length).toBe(report.gaps.length + 2);
    for (const l of tableLines) expect(l.replace(/\\\|/g, '').split('|').length - 1).toBe(8);
  });

  it('escapes the profile name wherever it appears', () => {
    const p = pack([], [], { name: 'Acme <Ops> & Co' });
    const out = reportToMarkdown(buildReport(p), p);
    expect(out.split('\n')[0]).toBe('# Tessera report — Acme &lt;Ops> &amp; Co');
    expect(out).not.toContain('<Ops>');
  });

  it('is deterministic for the same inputs', () => {
    const clone = structuredClone(fixture);
    expect(reportToMarkdown(buildReport(clone), clone)).toBe(md);
  });
});

describe('withBom (download helper)', () => {
  it('prepends the UTF-8 byte-order mark only when requested', () => {
    expect(withBom('x', true)).toBe('﻿x');
    expect(withBom('x', true).charCodeAt(0)).toBe(0xfeff);
    expect(withBom('x', false)).toBe('x');
    expect(withBom('x', undefined)).toBe('x');
    expect(withBom('', true)).toBe('﻿');
    expect(withBom('﻿x', true)).toBe('﻿x'); // never doubles an existing mark
  });
});
