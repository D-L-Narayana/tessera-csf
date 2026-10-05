import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { evidenceInventoryRows, gapRegisterRows, reportToCsvRows, toCsv } from '../src/engine/csv';
import { buildReport } from '../src/engine/evaluate';
import { reportToMarkdown } from '../src/engine/markdown';
import type { EvidencePack } from '../src/engine/types';
import { validatePackObject } from '../src/engine/validate';
import demo from '../src/fixtures/harbourline-pack.json';
import { ExportMenu, exportItems } from '../src/ui/ExportMenu';
import { ev, pack } from './helpers/pack';

const LABELS = ['Export pack', 'Export report JSON', 'Export report CSV', 'Export gap register CSV', 'Export evidence inventory CSV', 'Export summary (Markdown)'];

function demoPack(): EvidencePack {
  const r = validatePackObject(demo);
  if (!r.ok) throw new Error('bundled fixture failed validation');
  return r.pack;
}

describe('ExportMenu (rendered in Node with renderToStaticMarkup)', () => {
  const p = demoPack();
  const report = buildReport(p);
  const html = renderToStaticMarkup(<ExportMenu pack={p} report={report} />);

  it('renders exactly six buttons with the contracted names, in order', () => {
    const names = [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
    expect(names).toEqual(LABELS);
  });

  it('groups the buttons under an accessible "Export" group', () => {
    const group = /<div([^>]*)>/.exec(html);
    expect(group).not.toBeNull();
    expect(group![1]).toContain('role="group"');
    expect(group![1]).toContain('aria-label="Export"');
  });

  it('uses no inline styles, no aria-label overrides on buttons, and only type="button" controls', () => {
    expect(html).not.toMatch(/ style=/);
    expect((html.match(/<button/g) ?? []).length).toBe(6);
    expect((html.match(/<button type="button"/g) ?? []).length).toBe(6);
    expect(html).not.toMatch(/<button[^>]*aria-label=/);
  });
});

describe('exportItems (pure description of the six downloads)', () => {
  const p = demoPack();
  const report = buildReport(p);
  const items = exportItems(p, report);

  it('plans six downloads with asOf-stamped filenames, MIME types and a BOM only for CSV', () => {
    expect(items.map((i) => i.label)).toEqual(LABELS);
    expect(items.map((i) => i.kind)).toEqual(['pack', 'report-json', 'report-csv', 'gaps-csv', 'evidence-csv', 'summary-md']);
    expect(items.map((i) => i.filename)).toEqual([
      'tessera-pack-20261001.json',
      'tessera-report-20261001.json',
      'tessera-report-20261001.csv',
      'tessera-gaps-20261001.csv',
      'tessera-evidence-20261001.csv',
      'tessera-summary-20261001.md',
    ]);
    expect(items.map((i) => i.mime)).toEqual(['application/json', 'application/json', 'text/csv', 'text/csv', 'text/csv', 'text/markdown']);
    expect(items.map((i) => i.bom)).toEqual([false, false, true, true, true, false]);
  });

  it('produces pretty-printed JSON (two spaces) and the engine CSV/Markdown text without embedding a BOM', () => {
    expect(items[0].text()).toBe(JSON.stringify(p, null, 2));
    expect(items[1].text()).toBe(JSON.stringify(report, null, 2));
    expect(items[2].text()).toBe(toCsv(reportToCsvRows(report)));
    expect(items[3].text()).toBe(toCsv(gapRegisterRows(report)));
    expect(items[4].text()).toBe(toCsv(evidenceInventoryRows(p, report)));
    expect(items[5].text()).toBe(reportToMarkdown(report, p));
    for (const i of items) expect(i.text().startsWith('﻿')).toBe(false);
  });

  it('stamps filenames from the evaluation date of the pack being exported', () => {
    const other = pack([ev({ id: 'E1' })], [], { asOf: '2027-03-09' });
    const names = exportItems(other, buildReport(other)).map((i) => i.filename);
    expect(names.length).toBe(6);
    expect(names.every((n) => n.includes('-20270309.'))).toBe(true);
  });
});
