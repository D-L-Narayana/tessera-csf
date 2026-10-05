import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PolicyPanel } from '../src/ui/PolicyPanel';
import { DEFAULT_POLICY, POLICY_BOUNDS, clampPolicyField, type RulePolicy } from '../src/engine/policy';

const noop = () => {};
const render = (policy: RulePolicy) => renderToStaticMarkup(<PolicyPanel policy={policy} onChange={noop} />);
const CUSTOM: RulePolicy = { ...DEFAULT_POLICY, decisionValidDays: 180, minOverrideRationale: 10, separationOfDuties: false };

const NUMBER_LABELS = [
  'Aging multiplier',
  'Decision validity (days)',
  'Minimum override rationale (characters)',
  'Sufficient coverage',
  'Distinct evidence types for sufficient',
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The <input> associated (via for/id) with the label whose visible text is exactly `label`. */
function inputFor(html: string, label: string): string {
  const lab = new RegExp(`<label[^>]*\\sfor="([^"]+)"[^>]*>${escapeRe(label)}</label>`).exec(html);
  if (!lab) throw new Error(`label not found: ${label}`);
  const input = new RegExp(`<input[^>]*\\sid="${escapeRe(lab[1])}"[^>]*>`).exec(html);
  if (!input) throw new Error(`input not found for label: ${label}`);
  return input[0];
}

describe('PolicyPanel (static markup)', () => {
  const html = render(DEFAULT_POLICY);

  it('is a <details> whose summary reads "Rule policy"', () => {
    expect(html).toMatch(/^<details[^>]*>/);
    const summary = /<summary[^>]*>(.*?)<\/summary>/s.exec(html);
    expect(summary).not.toBeNull();
    expect(summary![1].replace(/<[^>]+>/g, '')).toBe('Rule policy');
    // The title keeps its exact text when the badge is shown, so exact-text lookups keep working for custom policies.
    const customSummary = /<summary[^>]*>(.*?)<\/summary>/s.exec(render(CUSTOM))![1];
    expect(customSummary).toMatch(/<span class="policy__title">Rule policy<\/span>/);
    expect(customSummary).toMatch(/<span class="policy__badge">custom policy<\/span>/);
  });

  it('labels every control with the exact contract strings', () => {
    for (const label of NUMBER_LABELS) expect(inputFor(html, label)).toMatch(/type="number"/);
    expect(inputFor(html, 'Separation of duties')).toMatch(/type="checkbox"/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Reset to defaults<\/button>/);
  });

  it('shows the help text that explains the consequences of a change', () => {
    expect(html).toContain('Changing the policy changes every status; the policy is stored in the pack and the report.');
  });

  it('renders min, max and step attributes from POLICY_BOUNDS on every number input', () => {
    const expectBounds = (label: string, b: { min: number; max: number }, step: string) => {
      const input = inputFor(html, label);
      expect(input).toMatch(new RegExp(`\\smin="${escapeRe(String(b.min))}"`));
      expect(input).toMatch(new RegExp(`\\smax="${escapeRe(String(b.max))}"`));
      expect(input).toMatch(new RegExp(`\\sstep="${escapeRe(step)}"`));
    };
    expectBounds('Aging multiplier', POLICY_BOUNDS.agingMultiplier, '0.1');
    expectBounds('Decision validity (days)', POLICY_BOUNDS.decisionValidDays, '1');
    expectBounds('Minimum override rationale (characters)', POLICY_BOUNDS.minOverrideRationale, '1');
    expectBounds('Sufficient coverage', POLICY_BOUNDS.sufficientCoverage, '0.1');
    expectBounds('Distinct evidence types for sufficient', POLICY_BOUNDS.minDistinctTypes, '1');
  });

  it('renders the current policy values as the control values', () => {
    expect(inputFor(html, 'Aging multiplier')).toMatch(/\svalue="1.5"/);
    expect(inputFor(html, 'Decision validity (days)')).toMatch(/\svalue="365"/);
    expect(inputFor(html, 'Minimum override rationale (characters)')).toMatch(/\svalue="40"/);
    expect(inputFor(html, 'Sufficient coverage')).toMatch(/\svalue="1"/);
    expect(inputFor(html, 'Distinct evidence types for sufficient')).toMatch(/\svalue="2"/);
    expect(inputFor(html, 'Separation of duties')).toMatch(/\schecked=""/);

    const custom = render(CUSTOM);
    expect(inputFor(custom, 'Decision validity (days)')).toMatch(/\svalue="180"/);
    expect(inputFor(custom, 'Minimum override rationale (characters)')).toMatch(/\svalue="10"/);
    expect(inputFor(custom, 'Separation of duties')).not.toMatch(/checked/);
  });

  it('shows the "custom policy" badge only when the policy differs from the defaults', () => {
    expect(html).not.toContain('custom policy');
    expect(render(CUSTOM)).toMatch(/<span[^>]*class="policy__badge"[^>]*>custom policy<\/span>/);
  });

  it('associates every label with an existing, unique id generated for this instance', () => {
    const fors = [...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((m) => m[1]);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(fors.length).toBe(NUMBER_LABELS.length + 1);
    for (const f of fors) expect(ids).toContain(f);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses no inline styles and only policy__ classes', () => {
    expect(html).not.toMatch(/ style=/);
    expect(render(CUSTOM)).not.toMatch(/ style=/);
    const classes = [...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
    for (const c of classes) expect(c).toMatch(/^(policy__[a-z-]+(--[a-z-]+)?|ghost|small|muted)$/);
  });
});

describe('clampPolicyField (the panel clamps on change)', () => {
  it('clamps every editable field to its POLICY_BOUNDS', () => {
    expect(clampPolicyField('agingMultiplier', 0.2)).toBe(POLICY_BOUNDS.agingMultiplier.min);
    expect(clampPolicyField('agingMultiplier', 9)).toBe(POLICY_BOUNDS.agingMultiplier.max);
    expect(clampPolicyField('decisionValidDays', 0)).toBe(POLICY_BOUNDS.decisionValidDays.min);
    expect(clampPolicyField('decisionValidDays', 9000)).toBe(POLICY_BOUNDS.decisionValidDays.max);
    expect(clampPolicyField('minOverrideRationale', -5)).toBe(POLICY_BOUNDS.minOverrideRationale.min);
    expect(clampPolicyField('minOverrideRationale', 5000)).toBe(POLICY_BOUNDS.minOverrideRationale.max);
    expect(clampPolicyField('sufficientCoverage', 0)).toBe(POLICY_BOUNDS.sufficientCoverage.min);
    expect(clampPolicyField('sufficientCoverage', 11)).toBe(POLICY_BOUNDS.sufficientCoverage.max);
    expect(clampPolicyField('minDistinctTypes', 0)).toBe(POLICY_BOUNDS.minDistinctTypes.min);
    expect(clampPolicyField('minDistinctTypes', 8)).toBe(POLICY_BOUNDS.minDistinctTypes.max);
  });

  it('rounds integer fields, keeps two decimals on the others, and falls back to the default for non-numbers', () => {
    expect(clampPolicyField('minDistinctTypes', 2.6)).toBe(3);
    expect(clampPolicyField('decisionValidDays', 180.4)).toBe(180);
    expect(clampPolicyField('agingMultiplier', 1.257)).toBe(1.26);
    expect(clampPolicyField('sufficientCoverage', 1.5)).toBe(1.5);
    expect(clampPolicyField('agingMultiplier', Number.NaN)).toBe(DEFAULT_POLICY.agingMultiplier);
    expect(clampPolicyField('decisionValidDays', Number.POSITIVE_INFINITY)).toBe(DEFAULT_POLICY.decisionValidDays);
  });
});
