import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildReport } from '../src/engine/evaluate';
import { validatePackObject } from '../src/engine/validate';
import { CATALOG } from '../src/engine/catalog';
import type { SubcategoryResult } from '../src/engine/types';
import demoPack from '../src/fixtures/harbourline-pack.json';
import { Mosaic, nextTileId, tileOrder } from '../src/ui/Mosaic';
import { Legend } from '../src/ui/Legend';

// Static render in Node (react-dom/server): structure, ARIA, data attributes and the roving tabindex. No DOM, no browser.
const validated = validatePackObject(demoPack);
if (!validated.ok) throw new Error('fixture pack failed validation: ' + validated.issues.map((i) => i.path).join(', '));
const report = buildReport(validated.pack);
const byId = new Map<string, SubcategoryResult>(report.results.map((r) => [r.subcategoryId, r]));

const render = (selected: string | null) => renderToStaticMarkup(<Mosaic results={byId} selected={selected} onSelect={() => {}} rollups={report.rollups} />);
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
const buttonTags = (html: string) => html.match(/<button\b[^>]*>/g) ?? [];
const tileTag = (html: string, id: string) => buttonTags(html).find((t) => t.includes(`data-tile-id="${id}"`)) ?? '';

describe('Mosaic — structure and ARIA', () => {
  const html = render('PR.DS-11');
  it('renders 25 tiles as buttons, each carrying data-tile-id', () => {
    expect(buttonTags(html).length).toBe(25);
    expect(count(html, /data-tile-id="/g)).toBe(25);
    for (const s of CATALOG) expect(html).toContain(`data-tile-id="${s.id}"`);
  });
  it('wraps each function in a section with role="group" labelled by its heading', () => {
    const sections = html.match(/<section\b[^>]*>/g) ?? [];
    expect(sections.length).toBe(6);
    for (const fn of ['GV', 'ID', 'PR', 'DE', 'RS', 'RC']) {
      const sec = sections.find((s) => s.includes(`aria-labelledby="fn-${fn}"`)) ?? '';
      expect(sec, `section for ${fn}`).toContain('role="group"');
      expect(sec).toContain(`row--${fn}`);
      expect(html).toContain(`id="fn-${fn}"`);
    }
    expect(count(html, /role="group"/g)).toBe(6);
  });
  it('keeps the aria-label pattern and aria-pressed on the selected, warned tile', () => {
    const tag = tileTag(html, 'PR.DS-11');
    expect(tag).toContain('aria-label="PR.DS-11: contradicted, residual 3.00 (high), priority 3, has reviewer warning"');
    expect(tag).toContain('aria-pressed="true"');
    expect(tag).toMatch(/class="[^"]*\btile\b[^"]*\bpat--contradicted\b[^"]*\bis-selected\b[^"]*\bhas-warning\b[^"]*"/);
    expect(count(html, /aria-pressed="true"/g)).toBe(1);
  });
  it('labels every tile with "<id>: <status>, residual <n.nn> (<band>), priority <p>"', () => {
    for (const tag of buttonTags(html)) {
      expect(tag).toMatch(/aria-label="[A-Z]{2}\.[A-Z]{2}-\d{2}: [a-z-]+, residual \d\.\d{2} \((low|moderate|high)\), priority [123](, has reviewer warning)?"/);
    }
  });
  it('adds a visually hidden arrow-key hint referenced by aria-describedby on the mosaic container', () => {
    const container = (html.match(/<div\b[^>]*class="mosaic"[^>]*>/) ?? [''])[0];
    const described = /aria-describedby="([^"]+)"/.exec(container);
    expect(described, 'aria-describedby on .mosaic').not.toBeNull();
    const hint = new RegExp(`<p[^>]*id="${(described?.[1] ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>Use arrow keys to move between tiles</p>`);
    expect(html).toMatch(hint);
    expect(html).toMatch(/<p[^>]*class="sr-only"[^>]*>Use arrow keys to move between tiles<\/p>/);
    expect(count(html, /Use arrow keys to move between tiles/g)).toBe(1);
  });
  it('uses no inline styles (CSP style-src self)', () => {
    expect(html).not.toMatch(/ style=/);
    expect(render(null)).not.toMatch(/ style=/);
  });
});

describe('Mosaic — roving tabindex', () => {
  it('exactly one tile is in the tab sequence: the selected tile', () => {
    const html = render('PR.DS-11');
    expect(count(html, /tabindex="0"/g)).toBe(1);
    expect(count(html, /tabindex="-1"/g)).toBe(24);
    expect(tileTag(html, 'PR.DS-11')).toContain('tabindex="0"');
    expect(tileTag(html, 'GV.OC-03')).toContain('tabindex="-1"');
  });
  it('falls back to the first tile (GV.OC-03) when nothing is selected', () => {
    const html = render(null);
    expect(count(html, /tabindex="0"/g)).toBe(1);
    expect(count(html, /tabindex="-1"/g)).toBe(24);
    expect(tileTag(html, 'GV.OC-03')).toContain('tabindex="0"');
    expect(count(html, /aria-pressed="true"/g)).toBe(0);
  });
  it('renders tiles in the same order the keyboard map uses', () => {
    const html = render(null);
    const rendered = [...html.matchAll(/data-tile-id="([^"]+)"/g)].map((m) => m[1]);
    const rows = tileOrder();
    expect(rows.length).toBe(6);
    expect(rows.flat()).toEqual(rendered);
    expect(rows.flat().length).toBe(25);
    expect(rows[0][0]).toBe('GV.OC-03');
    expect(rows[5][1]).toBe('RC.CO-03');
  });
});

describe('Mosaic — keyboard map (pure)', () => {
  const rows = tileOrder();
  it('ArrowRight/ArrowLeft walk the document order across categories and rows', () => {
    expect(nextTileId(rows, 'GV.OC-03', 'ArrowRight')).toBe('GV.RM-02');
    expect(nextTileId(rows, 'GV.SC-07', 'ArrowRight')).toBe('ID.AM-01');
    expect(nextTileId(rows, 'ID.AM-01', 'ArrowLeft')).toBe('GV.SC-07');
    expect(nextTileId(rows, 'GV.OC-03', 'ArrowLeft')).toBeNull();
    expect(nextTileId(rows, 'RC.CO-03', 'ArrowRight')).toBeNull();
  });
  it('ArrowDown/ArrowUp move to the same index in the adjacent function row, clamped to its length', () => {
    expect(nextTileId(rows, 'GV.PO-01', 'ArrowDown')).toBe('ID.RA-05');
    expect(nextTileId(rows, 'GV.SC-07', 'ArrowDown')).toBe('ID.IM-02');
    expect(nextTileId(rows, 'PR.IR-01', 'ArrowDown')).toBe('DE.AE-02');
    expect(nextTileId(rows, 'DE.AE-02', 'ArrowUp')).toBe('PR.AA-05');
    expect(nextTileId(rows, 'ID.RA-05', 'ArrowUp')).toBe('GV.PO-01');
    expect(nextTileId(rows, 'GV.OC-03', 'ArrowUp')).toBeNull();
    expect(nextTileId(rows, 'RC.RP-01', 'ArrowDown')).toBeNull();
  });
  it('Home/End jump to the first and last tile', () => {
    expect(nextTileId(rows, 'PR.DS-11', 'Home')).toBe('GV.OC-03');
    expect(nextTileId(rows, 'PR.DS-11', 'End')).toBe('RC.CO-03');
  });
  it('ignores other keys and unknown ids', () => {
    expect(nextTileId(rows, 'PR.DS-11', 'Enter')).toBeNull();
    expect(nextTileId(rows, 'PR.DS-11', ' ')).toBeNull();
    expect(nextTileId(rows, 'PR.DS-11', 'Tab')).toBeNull();
    expect(nextTileId(rows, 'ZZ.ZZ-00', 'ArrowRight')).toBeNull();
  });
});

describe('Legend', () => {
  const html = renderToStaticMarkup(<Legend />);
  it('keeps the eight status pattern items with their text', () => {
    expect(count(html, /tile--legend pat--/g)).toBe(8);
    for (const status of ['sufficient', 'partial', 'weak', 'none', 'contradicted', 'refuted', 'accepted-risk', 'not-applicable']) {
      expect(html).toContain(`pat--${status}`);
    }
    expect(html).toContain('Sufficient: coverage ≥ 1.0 from two or more evidence types');
    expect(html).toContain('Accepted risk: reviewer accepted with no current evidence — stays a gap');
    expect(html).toContain('Not applicable (reviewer decision)');
  });
  it('adds a Function colours row with a swatch and visible text for all six functions', () => {
    expect(html).toContain('Function colours');
    for (const [fn, name] of [['GV', 'Govern'], ['ID', 'Identify'], ['PR', 'Protect'], ['DE', 'Detect'], ['RS', 'Respond'], ['RC', 'Recover']]) {
      expect(html).toMatch(new RegExp(`<span class="legend__swatch fn--${fn}" aria-hidden="true"></span>`));
      expect(html).toContain(name);
    }
    expect(count(html, /legend__swatch/g)).toBe(6);
  });
  it('uses no inline styles', () => {
    expect(html).not.toMatch(/ style=/);
  });
});
