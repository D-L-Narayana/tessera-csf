// Compare panel rendered in Node via react-dom/server: structure, strings, accessibility, no inline styles.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildReport } from '../src/engine/evaluate';
import { validatePriorReport, type Comparison, type PriorReport } from '../src/engine/compare';
import { Compare, ComparisonView } from '../src/ui/Compare';
import { pack } from './helpers/pack';

const noop = () => {};

function priorFromCurrent(): PriorReport {
  const r = validatePriorReport(JSON.stringify(buildReport(pack([])), null, 2));
  if (!r.ok) throw new Error('expected the exported report to validate');
  return r.report;
}

const handBuilt: Comparison = {
  before: { asOf: '2026-07-01', generatedFor: 'Harbourline Logistics (Q2)' },
  after: { asOf: '2026-10-01', generatedFor: 'Harbourline Logistics (Q3)' },
  deltas: [
    { subcategoryId: 'PR.AA-05', before: 'sufficient', after: 'weak', residualBefore: 0.45, residualAfter: 2.4, residualDelta: 1.95, change: 'regressed' },
    { subcategoryId: 'GV.PO-01', before: 'none', after: 'contradicted', residualBefore: 2, residualAfter: 2, residualDelta: 0, change: 'changed' },
    { subcategoryId: 'DE.CM-01', before: 'weak', after: 'sufficient', residualBefore: 2.4, residualAfter: 0.45, residualDelta: -1.95, change: 'improved' },
    { subcategoryId: 'ID.AM-01', after: 'none', residualAfter: 2, residualDelta: 2, change: 'added' },
    { subcategoryId: 'RS.MA-01', before: 'partial', residualBefore: 1, residualDelta: -1, change: 'removed' },
    { subcategoryId: 'RC.CO-03', before: 'none', after: 'none', residualBefore: 2, residualAfter: 2, residualDelta: 0, change: 'unchanged' },
  ],
  counts: { improved: 1, regressed: 1, changed: 1, unchanged: 1, added: 1, removed: 1 },
  warnings: ['profile differs: "Harbourline Logistics (Q2)" vs "Harbourline Logistics (Q3)"'],
};

describe('Compare — before any import', () => {
  const html = renderToStaticMarkup(<Compare report={buildReport(pack([]))} onSelect={noop} />);

  it('renders the heading, the import button and the empty state', () => {
    expect(html).toContain('Compare with a previous report');
    expect(html).toContain('Import previous report JSON');
    expect(html).toContain('Import a previously exported report JSON to see which outcomes improved or regressed.');
    expect(html).not.toContain('Clear comparison');
    expect(html).not.toContain('Show unchanged outcomes');
  });

  it('labels the section by its heading and keeps the file input hidden but typed', () => {
    const m = /<h2 id="([^"]+)">Compare with a previous report<\/h2>/.exec(html);
    expect(m).not.toBeNull();
    expect(html).toContain(`aria-labelledby="${m![1]}"`);
    const fileInput = /<input[^>]*type="file"[^>]*>/.exec(html);
    expect(fileInput).not.toBeNull();
    expect(fileInput![0]).toContain('accept="application/json,.json"');
    expect(fileInput![0]).toContain('hidden');
    expect(fileInput![0]).toContain('aria-hidden="true"');
  });

  it('uses no inline styles, no style element and no dangerous HTML', () => {
    expect(html).not.toMatch(/ style=/);
    expect(html).not.toMatch(/<style/);
  });
});

describe('Compare — with a loaded previous report', () => {
  const report = buildReport(pack([]));
  const html = renderToStaticMarkup(<Compare report={report} onSelect={noop} initialPrior={priorFromCurrent()} />);

  it('shows Clear comparison, the unchanged toggle with a label association, and the summary line', () => {
    expect(html).toContain('Clear comparison');
    const label = /<label for="([^"]+)">Show unchanged outcomes<\/label>/.exec(html);
    expect(label).not.toBeNull();
    const escaped = label![1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const checkbox = new RegExp(`<input[^>]*\\bid="${escaped}"[^>]*>`).exec(html);
    expect(checkbox).not.toBeNull();
    expect(checkbox![0]).toContain('type="checkbox"');
    expect(html).toContain('0 improved · 0 regressed · 25 unchanged');
    expect(html).not.toContain('Import a previously exported report JSON to see which outcomes');
  });

  it('hides unchanged rows by default and explains how to show them, with the asOf caveat listed', () => {
    expect(html).toMatch(/No outcome changed/);
    expect(html).not.toContain('class="status status--none"');
    expect(html).toMatch(/not older than the current evaluation/);
    expect(html).toContain('2026-10-01');
    expect(html).toContain('Test profile');
  });

  it('uses no inline styles', () => {
    expect(html).not.toMatch(/ style=/);
  });
});

describe('ComparisonView — presentational table', () => {
  const hidden = renderToStaticMarkup(<ComparisonView comparison={handBuilt} onSelect={noop} showUnchanged={false} />);
  const shown = renderToStaticMarkup(<ComparisonView comparison={handBuilt} onSelect={noop} showUnchanged />);

  it('renders both periods, the warnings and the exact summary line', () => {
    expect(hidden).toContain('2026-07-01');
    expect(hidden).toContain('2026-10-01');
    expect(hidden).toContain('Harbourline Logistics (Q2)');
    expect(hidden).toContain('Harbourline Logistics (Q3)');
    expect(hidden).toMatch(/profile differs/);
    expect(hidden).toContain('1 improved · 1 regressed · 1 unchanged');
  });

  it('renders before/after statuses as status spans and residual deltas with explicit signs', () => {
    expect(hidden).toContain('class="status status--sufficient"');
    expect(hidden).toContain('class="status status--weak"');
    expect(hidden).toContain('class="status status--contradicted"');
    expect(hidden).toContain('class="status status--partial"');
    for (const text of ['+1.95', '−1.95', '+2.00', '−1.00', '0.00']) expect(hidden).toContain(text);
    expect(hidden).toMatch(/compare__delta--up[^>]*>\+1\.95</);
    expect(hidden).toMatch(/compare__delta--down[^>]*>−1\.95</);
    expect(hidden).toMatch(/compare__delta--zero[^>]*>0\.00</);
  });

  it('renders the change as a text chip, not colour alone, for every visible row', () => {
    for (const change of ['regressed', 'changed', 'improved', 'added', 'removed']) {
      expect(hidden).toMatch(new RegExp(`compare__chip--${change}[^>]*>${change}<`));
    }
    expect(hidden).not.toMatch(/compare__chip--unchanged/);
    expect(shown).toMatch(/compare__chip--unchanged[^>]*>unchanged</);
  });

  it('hides unchanged outcomes unless asked, and reports how many are hidden', () => {
    expect(hidden).not.toContain('RC.CO-03');
    expect(hidden).toMatch(/1 unchanged outcome hidden/);
    expect(shown).toContain('RC.CO-03');
    expect(shown).not.toMatch(/unchanged outcome hidden/);
  });

  it('exposes each outcome as a linkish button with the function class and a labelled table region', () => {
    expect(hidden.match(/class="linkish"/g)?.length).toBe(5);
    expect(hidden).toMatch(/<button type="button" class="linkish"><span class="fn fn--PR">PR\.AA-05<\/span><\/button>/);
    expect(hidden).toContain('Identity Management, Authentication, and Access Control');
    expect(hidden).toContain('role="region" aria-label="Comparison table"');
    for (const th of ['Outcome', 'Before', 'After', 'Residual Δ', 'Change']) expect(hidden).toContain(`<th scope="col">${th}</th>`);
  });

  it('marks missing sides in words rather than leaving cells blank', () => {
    expect(hidden).toMatch(/not in previous report/);
    expect(hidden).toMatch(/not in current evaluation/);
  });

  it('uses no inline styles', () => {
    expect(hidden).not.toMatch(/ style=/);
    expect(shown).not.toMatch(/ style=/);
  });
});
