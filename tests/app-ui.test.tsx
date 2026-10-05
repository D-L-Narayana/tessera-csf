import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import App from '../src/ui/App';

// Whole-application render in Node (no DOM): proves every section composes, the default selection is PR.DS-11, every
// exact UI string the browser workflow relies on is present, and no inline style attribute exists (CSP style-src 'self').
describe('App composition (server render)', () => {
  const html = renderToStaticMarkup(<App />);

  it('renders the masthead, mosaic, drawer for the default selection, planning panels, register and footer', () => {
    expect(html).toContain('Tessera');
    expect(html).toContain('Outcome mosaic');
    expect(html).toContain('class="drawer__id">PR.DS-11');
    expect(html).toContain('Horizon');
    expect(html).toContain('Compare with a previous report');
    expect(html).toContain('Gap register');
    expect(html).toContain('Summary');
    expect(html).toContain('Rule policy');
    expect(html).toContain('not a certification');
  });

  it('exposes the exact control names used by the browser workflow', () => {
    for (const label of [
      'Load demo pack', 'Start empty', 'Import pack JSON', 'Export pack', 'Export report JSON', 'Export report CSV',
      'Export gap register CSV', 'Export evidence inventory CSV', 'Export summary (Markdown)',
      'Keep this session in this browser', 'Undo', 'Redo', 'Add evidence', 'Record decision', 'Close outcome details',
      'Horizon (days)', 'Import previous report JSON', 'Minimum override rationale (characters)', 'Reset to defaults',
      'Include sufficient and not-applicable outcomes',
    ]) {
      expect(html, label).toContain(label);
    }
  });

  it('renders 25 tiles with data-tile-id and exactly one roving tab stop among them', () => {
    const tiles = html.match(/<button[^>]*class="tile [^"]*"[^>]*>/g) ?? [];
    expect(tiles.length).toBe(25);
    expect(tiles.filter((t) => / data-tile-id="/.test(t)).length).toBe(25);
    expect(tiles.filter((t) => / tabindex="0"/.test(t)).length).toBe(1);
  });

  it('contains no inline style attributes, inline scripts or event-handler attributes', () => {
    expect(html).not.toMatch(/ style=/);
    expect(html).not.toMatch(/<script/);
    expect(html).not.toMatch(/ on[a-z]+=/);
  });

  it('uses unique id attributes', () => {
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
