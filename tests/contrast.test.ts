import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Guards the theme tokens that are used as *text* against WCAG 2.1 AA (4.5:1) on the surfaces they appear on.
// Added after a parent axe scan found 3.49:1 (ochre on paper) and 4.23:1 (muted ink on paper) in the built app.
const css = readFileSync(resolve(process.cwd(), 'src/ui/styles.css'), 'utf8');
const token = (name: string): string => {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m) throw new Error(`token ${name} not found`);
  return m[1];
};
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const contrast = (a: string, b: string) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

describe('theme text contrast (WCAG 2.1 AA, 4.5:1)', () => {
  const surfaces = ['--paper', '--ground'];
  const textTokens = ['--ink', '--ink-2', '--ink-3', '--gv', '--id', '--pr', '--de-text', '--rs', '--rc', '--good', '--bad', '--warn-text', '--focus'];
  for (const t of textTokens) {
    for (const s of surfaces) {
      it(`${t} on ${s} ≥ 4.5`, () => {
        expect(contrast(token(t), token(s))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  it('text-role rules use the text-safe warn/ochre tokens, not the tile fill token', () => {
    expect(css).toMatch(/\.band--moderate \{ color: var\(--warn-text\); \}/);
    expect(css).toMatch(/\.status--partial, \.status--weak \{ color: var\(--warn-text\); \}/);
    expect(css).toMatch(/\.status--accepted-risk \{ color: var\(--warn-text\)/);
    expect(css).toMatch(/\.fn--DE \{ --fnc: var\(--de-text\); \}/);
    expect(css).toMatch(/\.row--DE \{ --fnc: var\(--de\); --fnt: var\(--de-text\); \}/);
  });
  it('the contrast helper agrees with a known pair (black on white = 21)', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Tessera 0.2 additions (additive only; the 28 token checks and two structural tests above are frozen).
// Covers the dark scheme, the status-pattern tile fills (color-mix replicated per channel in 8-bit sRGB)
// and every text/background pairing that is not plain ink-on-paper, in BOTH schemes.
// ---------------------------------------------------------------------------------------------------------
type Scheme = 'light' | 'dark';
const HEX6 = /^#[0-9a-fA-F]{6}$/;

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
const roots: Record<Scheme, string> = {
  light: blockAfter(css, ':root'),
  dark: blockAfter(blockAfter(css, '@media (prefers-color-scheme: dark)'), ':root'),
};
const schemeToken = (scheme: Scheme, name: string): string | null => {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(roots[scheme]);
  return m ? m[1] : null;
};
const schemePercent = (scheme: Scheme, name: string): number | null => {
  const m = new RegExp(`${name}:\\s*(\\d+(?:\\.\\d+)?)%\\s*;`).exec(roots[scheme]);
  return m ? Number(m[1]) / 100 : null;
};
/** `color-mix(in srgb, C p, B)` as browsers resolve it for 8-bit sRGB: per channel round(C·p + B·(1−p)). */
const mix = (c: string, p: number, b: string): string =>
  '#' +
  [1, 3, 5]
    .map((i) => Math.round(parseInt(c.slice(i, i + 2), 16) * p + parseInt(b.slice(i, i + 2), 16) * (1 - p)).toString(16).padStart(2, '0'))
    .join('');
const resolveColour = (scheme: Scheme, expr: string): string | null => {
  const e = expr.trim();
  const v = /^var\((--[\w-]+)\)$/.exec(e);
  if (v) return schemeToken(scheme, v[1]);
  if (e === 'white') return '#ffffff';
  return HEX6.test(e) ? e : null;
};
const resolvePercent = (scheme: Scheme, expr: string): number | null => {
  const e = expr.trim();
  const v = /^var\((--[\w-]+)\)$/.exec(e);
  if (v) return schemePercent(scheme, v[1]);
  const m = /^(\d+(?:\.\d+)?)%$/.exec(e);
  return m ? Number(m[1]) / 100 : null;
};
// The first color-mix() of each pattern rule: sufficient = the whole fill; partial = the strong stripe; weak = the hue stripe.
const firstMix = (pattern: string): { p: string; base: string } | null => {
  const rule = new RegExp(`\\.pat--${pattern} \\{([^}]*)\\}`).exec(css);
  const m = rule && /color-mix\(in srgb, var\(--fnc\) ([^,]+), (var\(--[\w-]+\)|#[0-9a-fA-F]{6}|white)\)/.exec(rule[1]);
  return m ? { p: m[1], base: m[2] } : null;
};
const patternFill = (scheme: Scheme, pattern: string, hue: string): string | null => {
  const m = firstMix(pattern);
  if (!m) return null;
  const h = schemeToken(scheme, hue);
  const p = resolvePercent(scheme, m.p);
  const b = resolveColour(scheme, m.base);
  return h && p !== null && b ? mix(h, p, b) : null;
};
const expectPair = (fg: string | null, bg: string | null, label: string) => {
  expect(fg, `${label}: foreground colour must resolve to a #rrggbb token in this scheme`).not.toBeNull();
  expect(bg, `${label}: background colour must resolve to a #rrggbb token in this scheme`).not.toBeNull();
  expect(contrast(String(fg), String(bg)), label).toBeGreaterThanOrEqual(4.5);
};

const SCHEMES: Scheme[] = ['light', 'dark'];
const TEXT_TOKENS = ['--ink', '--ink-2', '--ink-3', '--gv', '--id', '--pr', '--de-text', '--rs', '--rc', '--good', '--bad', '--warn-text', '--focus'];
const HUES = ['--gv', '--id', '--pr', '--de', '--rs', '--rc'];

describe('dark scheme text contrast (WCAG 2.1 AA, 4.5:1)', () => {
  it('defines a dark :root token set under prefers-color-scheme: dark', () => {
    expect(roots.dark).toMatch(/--paper:\s*#[0-9a-fA-F]{6};/);
    expect(roots.dark).toMatch(/--ink:\s*#[0-9a-fA-F]{6};/);
  });
  for (const t of TEXT_TOKENS) {
    for (const s of ['--paper', '--ground']) {
      it(`dark scheme: ${t} on ${s} ≥ 4.5`, () => {
        expectPair(schemeToken('dark', t), schemeToken('dark', s), `dark ${t} on ${s}`);
      });
    }
  }
  it('dark surfaces are actually dark and the light surfaces are actually light', () => {
    for (const s of ['--paper', '--ground', '--tile-base']) {
      expect(contrast('#ffffff', String(schemeToken('dark', s))), `dark ${s}`).toBeGreaterThanOrEqual(12);
      expect(contrast('#000000', String(schemeToken('light', s))), `light ${s}`).toBeGreaterThanOrEqual(12);
    }
  });
});

describe('tile text on status-pattern fills (color-mix replicated), both schemes', () => {
  it('pat--sufficient mixes the function hue with var(--tile-base) using the per-scheme --tile-mix percentage', () => {
    const m = firstMix('sufficient');
    expect(m).not.toBeNull();
    expect(m?.base).toBe('var(--tile-base)');
    expect(m?.p).toBe('var(--tile-mix)');
    expect(resolvePercent('light', String(m?.p))).toBe(0.72);
    expect(resolvePercent('dark', String(m?.p))).not.toBeNull();
  });
  it('pat--partial and pat--weak mix with var(--tile-base) too', () => {
    expect(firstMix('partial')?.base).toBe('var(--tile-base)');
    expect(firstMix('weak')?.base).toBe('var(--tile-base)');
  });
  it('color-mix replication matches a hand-computed example (72% of #5b4b8a over white = #897dab)', () => {
    expect(mix('#5b4b8a', 0.72, '#ffffff')).toBe('#897dab');
    expect(mix('#000000', 0.5, '#ffffff')).toBe('#808080');
  });
  for (const scheme of SCHEMES) {
    for (const hue of HUES) {
      it(`${scheme} scheme: --ink on pat--sufficient fill for ${hue} ≥ 4.5`, () => {
        expectPair(schemeToken(scheme, '--ink'), patternFill(scheme, 'sufficient', hue), `${scheme} sufficient ${hue}`);
      });
      it(`${scheme} scheme: --ink on pat--partial strong stripe for ${hue} ≥ 4.5`, () => {
        expectPair(schemeToken(scheme, '--ink'), patternFill(scheme, 'partial', hue), `${scheme} partial ${hue}`);
      });
      it(`${scheme} scheme: --ink on pat--weak stripe for ${hue} ≥ 4.5`, () => {
        expectPair(schemeToken(scheme, '--ink'), patternFill(scheme, 'weak', hue), `${scheme} weak ${hue}`);
      });
    }
    it(`${scheme} scheme: white tile text on --bad-fill (refuted/contradicted stripes) ≥ 4.5`, () => {
      expectPair('#ffffff', schemeToken(scheme, '--bad-fill'), `${scheme} refuted`);
    });
    it(`${scheme} scheme: --ink on --warn (accepted-risk stripes) ≥ 4.5`, () => {
      expectPair(schemeToken(scheme, '--ink'), schemeToken(scheme, '--warn'), `${scheme} accepted-risk`);
    });
    it(`${scheme} scheme: --ink-2 on --ground (pat--none text) ≥ 4.5`, () => {
      expectPair(schemeToken(scheme, '--ink-2'), schemeToken(scheme, '--ground'), `${scheme} none`);
    });
    it(`${scheme} scheme: --ink-2 on --stone and --paper (pat--not-applicable stripes) ≥ 4.5`, () => {
      expectPair(schemeToken(scheme, '--ink-2'), schemeToken(scheme, '--stone'), `${scheme} not-applicable stone stripe`);
      expectPair(schemeToken(scheme, '--ink-2'), schemeToken(scheme, '--paper'), `${scheme} not-applicable paper stripe`);
    });
  }
  it('not-applicable tiles use --ink-2 for their text (the muted --ink-3 measures below 4.5 on the stone stripe)', () => {
    expect(css).toMatch(/\.pat--not-applicable \{[^}]*color: var\(--ink-2\); \}/);
  });
  it('refuted and contradicted tiles use the fill-safe --bad-fill token, not the text token', () => {
    expect(css).toMatch(/\.pat--refuted \{ background: var\(--bad-fill\); color: #fff/);
    expect(css).toMatch(/\.pat--contradicted \{[^}]*var\(--bad-fill\)[^}]*\}/);
    expect(css).not.toMatch(/\.pat--contradicted \{[^}]*var\(--bad\)[^}]*\}/);
  });
});

describe('chip and panel text/background pairs, both schemes', () => {
  const CHIP_PAIRS: [string, string][] = [
    ['--good', '--chip-fresh-bg'],
    ['--warn-text', '--chip-aging-bg'],
    ['--bad', '--chip-refutes-bg'],
    ['--id', '--chip-supports-bg'],
    ['--ink-2', '--stone'],
  ];
  const PANEL_PAIRS: [string, string][] = [
    ['--ink', '--warnbox-bg'],
    ['--ink', '--remediation-bg'],
    ['--ink', '--refute-bg'],
    ['--ink-2', '--refute-bg'],
    ['--ink-3', '--refute-bg'],
    ['--paper', '--ink'],
    ['--paper', '--button-hover'],
  ];
  const ROW_TEXT = ['--ink', '--ink-2', '--ink-3', '--good', '--bad', '--warn-text', '--gv', '--id', '--pr', '--de-text', '--rs', '--rc'];
  for (const scheme of SCHEMES) {
    for (const [fg, bg] of CHIP_PAIRS) {
      it(`${scheme} scheme: chip ${fg} on ${bg} ≥ 4.5`, () => {
        expectPair(schemeToken(scheme, fg), schemeToken(scheme, bg), `${scheme} chip ${fg}/${bg}`);
      });
    }
    for (const [fg, bg] of PANEL_PAIRS) {
      it(`${scheme} scheme: ${fg} on ${bg} ≥ 4.5`, () => {
        expectPair(schemeToken(scheme, fg), schemeToken(scheme, bg), `${scheme} ${fg}/${bg}`);
      });
    }
    for (const fg of ROW_TEXT) {
      it(`${scheme} scheme: ${fg} on --row-selected-bg (selected register row) ≥ 4.5`, () => {
        expectPair(schemeToken(scheme, fg), schemeToken(scheme, '--row-selected-bg'), `${scheme} row ${fg}`);
      });
    }
  }
  it('chips, panels and the selected row use the tokens (no literal hex backgrounds)', () => {
    expect(css).toMatch(/\.chip--fresh \{ background: var\(--chip-fresh-bg\); color: var\(--good\); \}/);
    expect(css).toMatch(/\.chip--aging \{ background: var\(--chip-aging-bg\); color: var\(--warn-text\); \}/);
    expect(css).toMatch(/\.chip--refutes \{ background: var\(--chip-refutes-bg\); color: var\(--bad\); \}/);
    expect(css).toMatch(/\.chip--supports \{ background: var\(--chip-supports-bg\); color: var\(--id\); \}/);
    expect(css).toMatch(/\.warnbox \{ background: var\(--warnbox-bg\);/);
    expect(css).toMatch(/\.remediation \{ background: var\(--remediation-bg\);/);
    expect(css).toMatch(/\.ev--refutes \{ border-left-color: var\(--bad\); background: var\(--refute-bg\); \}/);
    expect(css).toMatch(/tr\.is-selected td \{ background: var\(--row-selected-bg\); \}/);
    // :where() keeps the hover rule at element specificity so .pat--* fills are not wiped on hover.
    expect(css).toMatch(/button:where\(:hover\) \{ background: var\(--button-hover\); \}/);
  });
});
