import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Structural guards for the colour schemes and the print stylesheet. Contrast ratios live in contrast.test.ts.
const css = readFileSync(resolve(process.cwd(), 'src/ui/styles.css'), 'utf8');
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

/** Inner text of the first brace-matched `{ … }` block that follows `marker`, or '' when the marker is absent. */
function blockAfter(source: string, marker: string): string {
  const at = source.indexOf(marker);
  if (at < 0) return '';
  const open = source.indexOf('{', at);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return '';
}

const lightRoot = blockAfter(css, ':root');
const darkMedia = blockAfter(css, '@media (prefers-color-scheme: dark)');
const darkRoot = blockAfter(darkMedia, ':root');
const printBlock = blockAfter(css, '@media print');
const hex = (name: string) => new RegExp(`${name}:\\s*#[0-9a-fA-F]{6}\\s*;`);

const DARK_TOKENS = ['--ground', '--paper', '--ink', '--ink-2', '--ink-3', '--line', '--stone', '--stone-2', '--focus', '--gv', '--id', '--pr', '--de', '--de-text', '--rs', '--rc', '--bad', '--warn', '--warn-text', '--good'];
const BG_TOKENS = ['--tile-base', '--bad-fill', '--button-hover', '--row-selected-bg', '--warnbox-bg', '--remediation-bg', '--refute-bg', '--chip-fresh-bg', '--chip-aging-bg', '--chip-refutes-bg', '--chip-supports-bg'];
const MIX_TOKENS = ['--tile-mix', '--tile-mix-partial', '--tile-mix-faint', '--tile-mix-weak'];

describe('colour schemes', () => {
  it('declares color-scheme: light dark on :root', () => {
    expect(lightRoot).toMatch(/color-scheme:\s*light dark;/);
  });
  it('index.html meta color-scheme matches the schemes the stylesheet implements', () => {
    const m = /<meta name="color-scheme" content="([^"]+)"/.exec(html);
    expect(m?.[1]).toBe('light dark');
    expect(darkRoot).not.toBe('');
  });
  it('has a prefers-color-scheme: dark block that redefines :root tokens', () => {
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(darkRoot).toMatch(/--paper:/);
  });
  for (const t of DARK_TOKENS) {
    it(`dark block redefines ${t} as a 6-digit hex token`, () => {
      expect(darkRoot).toMatch(hex(t));
    });
  }
  for (const t of BG_TOKENS) {
    it(`${t} is defined in both the light and the dark token set`, () => {
      expect(lightRoot).toMatch(hex(t));
      expect(darkRoot).toMatch(hex(t));
    });
  }
  for (const t of MIX_TOKENS) {
    it(`${t} percentage is defined in both schemes`, () => {
      const re = new RegExp(`${t}:\\s*\\d+(?:\\.\\d+)?%\\s*;`);
      expect(lightRoot).toMatch(re);
      expect(darkRoot).toMatch(re);
    });
  }
  it('tile-base is white in the light scheme (fills are unchanged from the baseline palette)', () => {
    expect(lightRoot).toMatch(/--tile-base:\s*#ffffff;/);
    expect(lightRoot).toMatch(/--tile-mix:\s*72%;/);
  });
  it('status fills mix the function hue with var(--tile-base), never with literal white', () => {
    const pats = css.match(/\.pat--[a-z-]+ \{[^}]*\}/g) ?? [];
    expect(pats.length).toBe(8);
    for (const p of pats) expect(p).not.toMatch(/,\s*(white|#fff|#ffffff)\s*\)/i);
    expect(css).toMatch(/\.pat--sufficient \{ background: color-mix\(in srgb, var\(--fnc\) var\(--tile-mix\), var\(--tile-base\)\); \}/);
  });
  it('no background declaration carries a hard-coded hex colour (all are tokens)', () => {
    const decls = css.match(/background(?:-color)?:[^;]+;/g) ?? [];
    expect(decls.length).toBeGreaterThan(10);
    for (const d of decls) expect(d).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
  it('never uses !important', () => {
    expect(css).not.toContain('!important');
  });
  it('keeps the frozen selectors other components depend on', () => {
    for (const sel of ['.app', '.masthead', '.profile', '.notice', '.workbench', '.mosaic', '.row', '.row__code', '.cat__label', '.cat__tiles', '.tile', '.tile__id', '.legend', '.drawer', '.fn', '.facts', '.status', '.band', '.warnbox', '.remediation', '.trace', '.evlist', '.ev', '.chip', '.addform', '.decision', '.grid2', '.field-error', '.counter', '.btnrow', '.gaps', '.table-wrap', '.foot', '.skip', '.muted', '.small', '.eyebrow', '.empty']) {
      expect(css, `${sel} rule present`).toMatch(new RegExp(`${sel.replace('.', '\\.')}[\\s,{.:]`));
    }
  });
  it('keeps the two breakpoints and the reduced-motion block', () => {
    expect(css).toContain('@media (max-width: 1000px)');
    expect(css).toContain('@media (max-width: 600px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});

describe('visually hidden utility', () => {
  it('.sr-only exists and takes the element out of the visual flow without hiding it from assistive tech', () => {
    const rule = /\.sr-only\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule?.[1]).toMatch(/position:\s*absolute/);
    expect(rule?.[1]).toMatch(/width:\s*1px/);
    expect(rule?.[1]).not.toMatch(/display:\s*none/);
    expect(rule?.[1]).not.toMatch(/visibility:\s*hidden/);
  });
});

describe('print stylesheet', () => {
  const hiddenSelectors = (printBlock.match(/([^{}]+)\{[^}]*display:\s*none[^}]*\}/g) ?? []).map((r) => r.slice(0, r.indexOf('{'))).join(',');
  it('has an @media print block', () => {
    expect(printBlock).not.toBe('');
  });
  for (const sel of ['.skip', '.profile__actions', 'form.addform', 'form.decision', '.notice', 'button:not(.tile)', '[class^="session__"]', '[class*=" session__"]', '[class^="exports__"]', '[class*=" exports__"]', '[class^="policy__"]', '[class*=" policy__"]']) {
    it(`hides ${sel} on paper`, () => {
      expect(hiddenSelectors).toContain(sel);
    });
  }
  it('keeps outcome links (button.linkish) and column-header buttons readable on paper', () => {
    expect(hiddenSelectors).toContain('button:not(.tile):not(.linkish)');
    expect(printBlock).toMatch(/th button:not\(\.tile\):not\(\.linkish\)\s*\{[^}]*display:\s*inline[^}]*\}/);
  });
  it('does not hide tiles, the drawer, the register or the footer disclaimer', () => {
    for (const keep of ['.tile', '.drawer', '.gaps', '.foot', '.trace', '.legend']) {
      const parts = hiddenSelectors.split(',').map((s) => s.trim());
      expect(parts, `${keep} must stay visible`).not.toContain(keep);
    }
  });
  it('keeps the open derivation trace visible', () => {
    expect(printBlock).toMatch(/details\.trace\[open\]/);
  });
  it('makes the drawer static and the workbench a single column', () => {
    expect(printBlock).toMatch(/\.drawer\s*\{[^}]*position:\s*static[^}]*\}/);
    expect(printBlock).toMatch(/\.drawer\s*\{[^}]*max-height:\s*none[^}]*\}/);
    expect(printBlock).toMatch(/\.workbench\s*\{[^}]*grid-template-columns:\s*1fr[^}]*\}/);
  });
  it('prints black on white by overriding the surface and ink tokens', () => {
    const root = blockAfter(printBlock, ':root');
    expect(root).toMatch(/--ink:\s*#000000;/);
    expect(root).toMatch(/--paper:\s*#ffffff;/);
    expect(root).toMatch(/--ground:\s*#ffffff;/);
    expect(root).toMatch(/--tile-base:\s*#ffffff;/);
    expect(root).toMatch(/color-scheme:\s*light;/);
  });
  it('re-pins every dark-redefined token so a dark OS prints the light palette', () => {
    const root = blockAfter(printBlock, ':root');
    for (const t of [...DARK_TOKENS, ...BG_TOKENS]) expect(root, `${t} pinned for print`).toMatch(hex(t));
    for (const t of MIX_TOKENS) expect(root, `${t} pinned for print`).toMatch(new RegExp(`${t}:\\s*\\d+%\\s*;`));
  });
  it('asks the browser to keep tile patterns and swatches when printing', () => {
    const rule = /([^{}]*\.tile[^{}]*)\{([^}]*)\}/g;
    let found = false;
    for (let m = rule.exec(printBlock); m; m = rule.exec(printBlock)) {
      if (/print-color-adjust:\s*exact/.test(m[2]) && /-webkit-print-color-adjust:\s*exact/.test(m[2]) && /\[class\*="pat--"\]/.test(m[1]) && /\.legend__swatch/.test(m[1])) found = true;
    }
    expect(found).toBe(true);
  });
  it('starts the gap register on a new page and keeps table rows together', () => {
    expect(printBlock).toMatch(/\.gaps\s*\{[^}]*break-before:\s*page[^}]*\}/);
    expect(printBlock).toMatch(/(^|[\s,])tr\s*\{[^}]*break-inside:\s*avoid[^}]*\}/);
  });
});
