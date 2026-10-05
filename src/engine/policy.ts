// Rule policy: every threshold the engine uses, in one place. The defaults are the project's documented
// educational heuristic (README → Algorithm). A pack may carry its own policy; every report embeds the policy
// it was computed with so that old reports stay reproducible when the defaults change.
import type { Status } from './types';

export interface RulePolicy {
  schema: 'tessera.policy/1';
  agingMultiplier: number; // aging while age ≤ validDays × agingMultiplier
  freshnessWeights: { fresh: number; aging: number; stale: number };
  scopeWeights: { full: number; partial: number };
  sufficientCoverage: number; // coverage needed for partial/sufficient
  minDistinctTypes: number; // distinct supporting types needed for sufficient
  exposure: Record<Status, number>; // 'not-applicable' must be 0
  bands: { moderate: number; high: number }; // residual < moderate → low; < high → moderate; else high
  minOverrideRationale: number;
  decisionValidDays: number;
  separationOfDuties: boolean; // refuse an accepted override when the reviewer collected all current supporting evidence
}

export const DEFAULT_POLICY: Readonly<RulePolicy> = Object.freeze({
  schema: 'tessera.policy/1',
  agingMultiplier: 1.5,
  freshnessWeights: { fresh: 1, aging: 0.5, stale: 0 },
  scopeWeights: { full: 1, partial: 0.5 },
  sufficientCoverage: 1,
  minDistinctTypes: 2,
  exposure: { none: 1, refuted: 1, contradicted: 1, weak: 0.8, partial: 0.5, sufficient: 0.15, 'accepted-risk': 0.6, 'not-applicable': 0 },
  bands: { moderate: 0.75, high: 1.75 },
  minOverrideRationale: 40,
  decisionValidDays: 365,
  separationOfDuties: true,
});

export const POLICY_BOUNDS = {
  agingMultiplier: { min: 1, max: 5 },
  weight: { min: 0, max: 1 }, // freshness/scope weights; fresh ≥ aging ≥ stale; full ≥ partial
  sufficientCoverage: { min: 0.1, max: 10 },
  minDistinctTypes: { min: 1, max: 7 }, // 7 = number of evidence types
  exposure: { min: 0, max: 1 }, // not-applicable must equal 0
  band: { min: 0.01, max: 3 }, // moderate < high
  minOverrideRationale: { min: 0, max: 2000 },
  decisionValidDays: { min: 1, max: 3650 },
} as const;

/** The policy fields that are edited as numbers in the Rule policy panel. */
export type NumericPolicyField = 'agingMultiplier' | 'decisionValidDays' | 'minOverrideRationale' | 'sufficientCoverage' | 'minDistinctTypes';

const NUMERIC_FIELD_RULES: Record<NumericPolicyField, { min: number; max: number; integer: boolean }> = {
  agingMultiplier: { ...POLICY_BOUNDS.agingMultiplier, integer: false },
  decisionValidDays: { ...POLICY_BOUNDS.decisionValidDays, integer: true },
  minOverrideRationale: { ...POLICY_BOUNDS.minOverrideRationale, integer: true },
  sufficientCoverage: { ...POLICY_BOUNDS.sufficientCoverage, integer: false },
  minDistinctTypes: { ...POLICY_BOUNDS.minDistinctTypes, integer: true },
};

export function effectivePolicy(pack: { policy?: RulePolicy }): RulePolicy {
  return pack.policy ?? DEFAULT_POLICY;
}

/** Rebuilds a policy in canonical key order (the order of DEFAULT_POLICY), so JSON comparisons and exports are stable. */
export function canonicalPolicy(p: RulePolicy): RulePolicy {
  const exposure = {} as Record<Status, number>;
  for (const status of Object.keys(DEFAULT_POLICY.exposure) as Status[]) exposure[status] = p.exposure[status];
  return {
    schema: 'tessera.policy/1',
    agingMultiplier: p.agingMultiplier,
    freshnessWeights: { fresh: p.freshnessWeights.fresh, aging: p.freshnessWeights.aging, stale: p.freshnessWeights.stale },
    scopeWeights: { full: p.scopeWeights.full, partial: p.scopeWeights.partial },
    sufficientCoverage: p.sufficientCoverage,
    minDistinctTypes: p.minDistinctTypes,
    exposure,
    bands: { moderate: p.bands.moderate, high: p.bands.high },
    minOverrideRationale: p.minOverrideRationale,
    decisionValidDays: p.decisionValidDays,
    separationOfDuties: p.separationOfDuties,
  };
}

/** True when the policy equals DEFAULT_POLICY value for value; key order does not matter. */
export function isDefaultPolicy(p: RulePolicy): boolean {
  return JSON.stringify(canonicalPolicy(p)) === JSON.stringify(DEFAULT_POLICY);
}

/**
 * Clamps a numeric policy field to its POLICY_BOUNDS. Integer fields are rounded; the others are kept to two decimals.
 * Non-finite input (an empty or unparsable field) falls back to the default value.
 */
export function clampPolicyField(field: NumericPolicyField, value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_POLICY[field];
  const rule = NUMERIC_FIELD_RULES[field];
  const clamped = Math.min(rule.max, Math.max(rule.min, value));
  return rule.integer ? Math.round(clamped) : Math.round(clamped * 100) / 100;
}
