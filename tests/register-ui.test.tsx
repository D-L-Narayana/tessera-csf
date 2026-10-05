import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOG } from '../src/engine/catalog';
import { buildReport } from '../src/engine/evaluate';
import type { CsfFunction, Decision, Report, Status, SubcategoryResult } from '../src/engine/types';
import { validatePack } from '../src/engine/validate';
import fixture from '../src/fixtures/harbourline-pack.json';
import { GapRegister, GapRegisterView } from '../src/ui/GapRegister';
import { Summary } from '../src/ui/Summary';
import { AS_OF, ev, pack } from './helpers/pack';

const CANONICAL: Status[] = ['sufficient', 'partial', 'weak', 'none', 'contradicted', 'refuted', 'accepted-risk', 'not-applicable'];

function fixtureReport(): Report {
  const r = validatePack(JSON.stringify(fixture));
  if (!r.ok) throw new Error('bundled fixture failed validation: ' + r.issues.map((i) => `${i.path} ${i.message}`).join('; '));
  return buildReport(r.pack);
}
const allIds = CATALOG.map((s) => s.id);
function allSufficientReport(): Report {
  return buildReport(pack([ev({ id: 'E1', type: 'policy', subcategoryIds: allIds }), ev({ id: 'E2', type: 'configuration', subcategoryIds: allIds })]));
}
const naDecision = (subcategoryId: string): Decision => ({
  subcategoryId,
  reviewer: 'r.kaur',
  verdict: 'not-applicable',
  rationale: 'Recovery is fully outsourced under contract RC-77; the provider evidence is reviewed separately.',
  decidedOn: AS_OF,
});

const fnOf = (r: SubcategoryResult): CsfFunction => CATALOG.find((s) => s.id === r.subcategoryId)!.fn;
const strip = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '');
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Finds a form control by its visible <label> text and returns the control's opening tag plus the markup up to its closing tag. */
function control(html: string, label: string): { tag: string; open: string; block: string } {
  const m = new RegExp(`<label\\b[^>]*\\bfor="([^"]+)"[^>]*>${reEsc(label)}</label>`).exec(html);
  expect(m, `a <label> reading exactly "${label}"`).not.toBeNull();
  const id = m![1];
  const c = new RegExp(`<(select|input)\\b[^>]*\\bid="${reEsc(id)}"[^>]*>`).exec(html);
  expect(c, `a control associated with the label "${label}"`).not.toBeNull();
  const start = c!.index;
  const end = c![1] === 'select' ? html.indexOf('</select>', start) : start + c![0].length;
  return { tag: c![1], open: c![0], block: html.slice(start, end) };
}

const tbodyOf = (html: string) => (html.includes('<tbody>') ? html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>')) : '');
const noop = () => {};

describe('GapRegister', () => {
  const report = fixtureReport();
  const html = renderToStaticMarkup(<GapRegister report={report} selected="PR.DS-11" onSelect={noop} />);

  it('keeps the section landmark, heading, table region and row contract', () => {
    expect(html).toContain('<section class="gaps" aria-labelledby="gaps-h">');
    expect(html).toContain('<h2 id="gaps-h">Gap register</h2>');
    expect(html).toMatch(/<div class="table-wrap"[^>]*role="region"[^>]*aria-label="Gap register table"/);
    expect(report.gaps.length).toBeGreaterThan(0);
    expect(count(tbodyOf(html), /<tr[\s>]/g)).toBe(report.gaps.length);
    expect(count(html, /class="linkish"/g)).toBe(report.gaps.length);
    expect(html).toContain('<span class="fn fn--PR">PR.DS-11</span>');
    expect(html).toContain('class="status status--contradicted"');
    expect(html).toContain('class="band band--high"');
    expect(count(html, /class="remed"/g)).toBe(report.gaps.length);
    const selectedRows = html.match(/<tr class="is-selected">[\s\S]*?<\/tr>/g) ?? [];
    expect(selectedRows.length).toBe(1);
    expect(selectedRows[0]).toContain('PR.DS-11');
    expect(count(html, /<tr class="is-selected"/g)).toBe(1);
  });

  it('renders a search landmark with labelled Function, Status, Band and Search controls', () => {
    expect(html).toMatch(/<form[^>]*role="search"[^>]*aria-label="Filter gap register"/);
    const fn = control(html, 'Function');
    expect(fn.tag).toBe('select');
    expect(count(fn.block, /<option\b/g)).toBe(7);
    expect(fn.block).toMatch(/<option value=""[^>]*>All<\/option>/);
    for (const f of ['GV', 'ID', 'PR', 'DE', 'RS', 'RC']) expect(fn.block).toContain(`<option value="${f}"`);
    const status = control(html, 'Status');
    expect(status.tag).toBe('select');
    expect(count(status.block, /<option\b/g)).toBe(9);
    for (const s of CANONICAL) expect(status.block).toContain(`<option value="${s}"`);
    const band = control(html, 'Band');
    expect(band.tag).toBe('select');
    expect(count(band.block, /<option\b/g)).toBe(4);
    for (const b of ['low', 'moderate', 'high']) expect(band.block).toContain(`<option value="${b}"`);
    const search = control(html, 'Search');
    expect(search.tag).toBe('input');
    expect(search.open).toMatch(/type="(search|text)"/);
  });

  it('offers an unchecked "Include sufficient and not-applicable outcomes" checkbox by default', () => {
    const box = control(html, 'Include sufficient and not-applicable outcomes');
    expect(box.tag).toBe('input');
    expect(box.open).toContain('type="checkbox"');
    expect(box.open).not.toMatch(/\bchecked\b/);
  });

  it('marks the sortable headers with aria-sort and buttons, residual descending by default', () => {
    expect(count(html, /aria-sort="descending"/g)).toBe(1);
    expect(count(html, /aria-sort="none"/g)).toBe(2);
    expect(count(html, /aria-sort="ascending"/g)).toBe(0);
    expect(html).toMatch(/<th[^>]*aria-sort="descending"[^>]*>\s*<button[^>]*type="button"[^>]*>Residual/);
    expect(html).toMatch(/<th[^>]*aria-sort="none"[^>]*>\s*<button[^>]*type="button"[^>]*>Outcome/);
    expect(html).toMatch(/<th[^>]*aria-sort="none"[^>]*>\s*<button[^>]*type="button"[^>]*>Status/);
    // the rank and remediation columns are not sortable
    expect(html).toMatch(/<th scope="col">#<\/th>/);
    expect(html).toMatch(/<th scope="col">Remediation<\/th>/);
    // a visually hidden caption names the table and spells out the active sort for assistive technology
    expect(html).toContain(`<caption class="register__sr">Gap register: ${report.gaps.length} outcomes sorted by residual exposure, descending.</caption>`);
    // default order is the report's gap order (residual descending, id ascending)
    const first = report.gaps[0].subcategoryId;
    expect(tbodyOf(html)).toMatch(new RegExp(`^<tbody><tr[^>]*><td[^>]*>1</td><td[^>]*><button[^>]*><span class="fn fn--[A-Z]{2}">${reEsc(first)}</span>`));
  });

  it('states how many outcomes are shown out of the base list', () => {
    expect(strip(html)).toContain(`Showing ${report.gaps.length} of ${report.gaps.length} outcomes.`);
  });

  it('labels every cell with its column name for the card layout', () => {
    expect(count(html, /<td[\s>]/g)).toBe(report.gaps.length * 5);
    expect(count(html, /data-label=/g)).toBe(count(html, /<td[\s>]/g));
    for (const label of ['#', 'Outcome', 'Status', 'Residual', 'Remediation']) {
      expect(count(html, new RegExp(`data-label="${reEsc(label)}"`, 'g'))).toBe(report.gaps.length);
    }
  });

  it('offers a Clear filters button only when a filter or the include toggle is active', () => {
    expect(html).not.toContain('Clear filters');
    const filtered = renderToStaticMarkup(
      <GapRegisterView
        report={report}
        selected={null}
        onSelect={noop}
        filter={{ band: 'low' }}
        sort={{ key: 'residual', dir: 'desc' }}
        onFilterChange={noop}
        onSortChange={noop}
      />,
    );
    expect(filtered).toMatch(/<button type="button"[^>]*>Clear filters<\/button>/);
    const lowBand = report.gaps.filter((g) => g.band === 'low').length;
    expect(lowBand).toBeGreaterThan(0);
    expect(count(tbodyOf(filtered), /<tr[\s>]/g)).toBe(lowBand);
    expect(strip(filtered)).toContain(`Showing ${lowBand} of ${report.gaps.length} outcomes.`);
    expect(control(filtered, 'Band').block).toMatch(/<option value="low"[^>]*selected/);
  });

  it('uses no inline styles and no duplicate ids', () => {
    expect(html).not.toMatch(/ style=/);
    expect(html).not.toMatch(/<style/);
    const ids = (html.match(/ id="([^"]+)"/g) ?? []).map((s) => s.slice(5, -1));
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lists all 25 outcomes for an empty profile without any filter applied', () => {
    const empty = renderToStaticMarkup(<GapRegister report={buildReport(pack([]))} selected={null} onSelect={noop} />);
    expect(count(tbodyOf(empty), /<tr[\s>]/g)).toBe(25);
    expect(strip(empty)).toContain('Showing 25 of 25 outcomes.');
    expect(empty).not.toMatch(/<tr class="is-selected"/);
  });

  it('keeps the no-gaps sentence when every outcome is sufficient, with the filter bar still available', () => {
    const closed = renderToStaticMarkup(<GapRegister report={allSufficientReport()} selected={null} onSelect={noop} />);
    expect(closed).toContain('Every outcome in the subset is sufficient or not applicable. Export the report to keep the trace.');
    expect(closed).not.toContain('<tbody');
    expect(closed).not.toContain('No outcomes match the current filters.');
    expect(closed).toContain('Include sufficient and not-applicable outcomes');
  });

  it('GapRegisterView shows the filtered-empty message when the filters match nothing', () => {
    const view = renderToStaticMarkup(
      <GapRegisterView
        report={report}
        selected={null}
        onSelect={noop}
        filter={{ query: 'no-such-outcome-text' }}
        sort={{ key: 'residual', dir: 'desc' }}
        onFilterChange={noop}
        onSortChange={noop}
      />,
    );
    expect(view).toContain('No outcomes match the current filters.');
    expect(strip(view)).toContain(`Showing 0 of ${report.gaps.length} outcomes.`);
    expect(view).not.toContain('<tbody');
    expect(view).not.toContain('Every outcome in the subset is sufficient');
    expect(control(view, 'Search').open).toContain('value="no-such-outcome-text"');
  });

  it('GapRegisterView reflects explicit filter and sort props in the controls, headers and rows', () => {
    const sufficient = report.results.filter((r) => r.status === 'sufficient');
    expect(sufficient.length).toBeGreaterThan(0);
    const view = renderToStaticMarkup(
      <GapRegisterView
        report={report}
        selected={null}
        onSelect={noop}
        filter={{ status: 'sufficient', includeClosed: true }}
        sort={{ key: 'id', dir: 'asc' }}
        onFilterChange={noop}
        onSortChange={noop}
      />,
    );
    expect(count(tbodyOf(view), /<tr[\s>]/g)).toBe(sufficient.length);
    expect(strip(view)).toContain(`Showing ${sufficient.length} of ${report.results.length} outcomes.`);
    expect(control(view, 'Include sufficient and not-applicable outcomes').open).toMatch(/\bchecked\b/);
    expect(control(view, 'Status').block).toMatch(/<option value="sufficient"[^>]*selected/);
    expect(view).toMatch(/<th[^>]*aria-sort="ascending"[^>]*>\s*<button[^>]*>Outcome/);
    expect(count(view, /aria-sort="none"/g)).toBe(2);
    expect(view).toContain(`<caption class="register__sr">Gap register: ${sufficient.length} outcomes sorted by outcome id, ascending.</caption>`);
    const firstId = sufficient.map((r) => r.subcategoryId).sort()[0];
    expect(tbodyOf(view)).toMatch(new RegExp(`^<tbody><tr[^>]*><td[^>]*>1</td><td[^>]*><button[^>]*><span class="fn fn--[A-Z]{2}">${reEsc(firstId)}</span>`));
    expect(view).toContain('class="status status--sufficient"');
    expect(view).not.toMatch(/ style=/);
  });
});

describe('Summary', () => {
  const report = fixtureReport();
  const html = renderToStaticMarkup(<Summary report={report} />);
  const text = strip(html);

  it('renders a labelled section with the Summary heading, the gap count line and the disclaimer', () => {
    const m = /<section class="summary" aria-labelledby="([^"]+)">/.exec(html);
    expect(m).not.toBeNull();
    expect(html).toContain(`<h2 id="${m![1]}">Summary</h2>`);
    expect(text).toContain(`${report.gaps.length} of ${report.results.length} outcomes are in the gap register.`);
    expect(text).toContain('of 25 outcomes are in the gap register.');
    expect(html).toContain(`<p class="small muted">${escapeHtml(report.disclaimer)}</p>`);
    expect(text).toContain(escapeHtml(report.generatedFor));
    expect(text).toContain(report.asOf);
  });

  it('summarises overrides and refused reviewer actions', () => {
    const valid = report.results.filter((r) => r.override && r.overrideValid).length;
    const invalid = report.results.filter((r) => r.override && !r.overrideValid).length;
    const refused = report.results.reduce((a, r) => a + r.warnings.length, 0);
    expect(valid).toBeGreaterThan(0);
    expect(invalid).toBeGreaterThan(0);
    expect(text).toContain(`Overrides: ${valid} valid, ${invalid} invalid · ${plural(refused, 'refused reviewer action')}`);
  });

  it('draws the status distribution as one accessible stacked SVG bar with a text fallback', () => {
    const start = html.indexOf('<svg');
    expect(start).toBeGreaterThan(-1);
    const svg = html.slice(start, html.indexOf('</svg>', start));
    expect(svg).toContain('role="img"');
    expect(svg).toContain('viewBox="0 0 100 8"');
    const label = /aria-label="([^"]+)"/.exec(svg);
    expect(label).not.toBeNull();
    expect(label![1].startsWith('Status distribution: ')).toBe(true);
    const counts = CANONICAL.map((s) => ({ status: s, count: report.results.filter((r) => r.status === s).length }));
    for (const c of counts) expect(label![1]).toContain(`${c.count} ${c.status}`);

    const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="0" width="([\d.]+)" height="8" class="summary__bar summary__bar--([a-z-]+)"/g)];
    const nonZero = counts.filter((c) => c.count > 0);
    expect(nonZero.length).toBeGreaterThan(2);
    expect(rects.map((r) => r[3])).toEqual(nonZero.map((c) => c.status));
    const widths = rects.map((r) => Number(r[2]));
    expect(Math.abs(widths.reduce((a, w) => a + w, 0) - 100)).toBeLessThan(0.01);
    let cum = 0;
    rects.forEach((r, i) => {
      expect(Math.abs(Number(r[1]) - cum)).toBeLessThan(0.01);
      expect(Math.abs(widths[i] - (nonZero[i].count / 25) * 100)).toBeLessThan(0.01);
      cum += widths[i];
    });

    const ulStart = html.indexOf('<ul class="summary__statuses">');
    expect(ulStart).toBeGreaterThan(-1);
    const ul = html.slice(ulStart, html.indexOf('</ul>', ulStart));
    expect(count(ul, /<li[\s>]/g)).toBe(8);
    for (const c of counts) expect(strip(ul)).toContain(`${c.count} ${c.status}`);
    expect(strip(ul)).toContain('0 refuted');
  });

  it('renders one line per function with sufficient, gaps, warnings and band', () => {
    const ulStart = html.indexOf('<ul class="summary__functions">');
    expect(ulStart).toBeGreaterThan(-1);
    const ul = html.slice(ulStart, html.indexOf('</ul>', ulStart));
    expect(count(ul, /<li[\s>]/g)).toBe(6);
    const gvGaps = report.gaps.filter((g) => fnOf(g) === 'GV').length;
    const gvWarnings = report.results.filter((r) => fnOf(r) === 'GV' && r.warnings.length > 0).length;
    const gvBand = report.rollups.find((r) => r.fn === 'GV')!.band;
    expect(gvBand).not.toBe('not-assessed');
    expect(strip(ul)).toContain(`GV Govern — 0/6 sufficient · ${plural(gvGaps, 'gap')} · ${plural(gvWarnings, 'warning')} · ${gvBand}`);
    expect(ul).toContain('<span class="fn fn--GV">GV</span>');
    expect(ul).toContain(`class="band band--${gvBand}"`);
  });

  it('spells out a not-assessed function', () => {
    const p = pack([], CATALOG.filter((s) => s.fn === 'RC').map((s) => naDecision(s.id)));
    const out = strip(renderToStaticMarkup(<Summary report={buildReport(p)} />));
    expect(out).toContain('RC Recover — 0/2 sufficient · 0 gaps · 0 warnings · not assessed');
  });

  it('shows a single full-width segment and zero overrides for an empty profile', () => {
    const empty = renderToStaticMarkup(<Summary report={buildReport(pack([]))} />);
    const rects = [...empty.matchAll(/<rect x="([\d.]+)" y="0" width="([\d.]+)" height="8" class="summary__bar summary__bar--([a-z-]+)"/g)];
    expect(rects.length).toBe(1);
    expect(rects[0][1]).toBe('0');
    expect(rects[0][2]).toBe('100');
    expect(rects[0][3]).toBe('none');
    const t = strip(empty);
    expect(t).toContain('25 of 25 outcomes are in the gap register.');
    expect(t).toContain('Overrides: 0 valid, 0 invalid · 0 refused reviewer actions');
    expect(t).toContain('25 none');
  });

  it('uses no inline styles', () => {
    expect(html).not.toMatch(/ style=/);
    expect(html).not.toMatch(/<style/);
    expect(html).not.toContain('dangerouslySetInnerHTML');
  });
});
