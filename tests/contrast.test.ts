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
