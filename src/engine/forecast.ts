// Horizon forecast: what stops being evidenced soon. Pure and deterministic — the only dates involved are the ones in
// the pack, so the same pack always yields the same forecast (no clock access, no locale, no randomness).
// Boundary formulas and inclusion rules are documented in docs/forecast.md.
import { assessFreshness, buildReport, daysBetween } from './evaluate';
import { effectivePolicy, type RulePolicy } from './policy';
import type { Evidence, EvidencePack, EvidenceType, Freshness, Status, Verdict } from './types';

export const HORIZONS = [30, 60, 90, 180] as const;
export type HorizonDays = (typeof HORIZONS)[number];
export const DEFAULT_HORIZON_DAYS: HorizonDays = 90;
export const MIN_HORIZON_DAYS = 1;
export const MAX_HORIZON_DAYS = 3650;

export interface EvidenceExpiry {
  evidenceId: string;
  title: string;
  type: EvidenceType;
  subcategoryIds: string[];
  freshness: Freshness; // at asOf
  agingOn: string | null; // first day the artifact counts as aging; null once that day has passed
  staleOn: string | null; // first day the artifact counts as stale
  daysToAging: number | null; // from asOf; null when the boundary already passed
  daysToStale: number | null;
}

export interface DecisionLapse {
  subcategoryId: string;
  reviewer: string;
  verdict: Verdict;
  decidedOn: string;
  lapsesOn: string; // first day the decision is no longer applied
  daysToLapse: number;
}

export interface OutcomeProjection {
  subcategoryId: string;
  statusNow: Status;
  statusAtHorizon: Status;
  residualNow: number;
  residualAtHorizon: number;
  change: 'worsens' | 'improves' | 'same';
}

export interface Forecast {
  asOf: string;
  horizonDays: number;
  horizonDate: string;
  evidence: EvidenceExpiry[];
  decisions: DecisionLapse[];
  outcomes: OutcomeProjection[];
}

const DAY = 86_400_000;
const MAX_TIME = 8.64e15; // ECMAScript Date range; beyond it toISOString() would throw

/** `iso` plus `days` calendar days, computed in UTC on YYYY-MM-DD strings (no time zone, no DST). */
export function addDays(iso: string, days: number): string {
  const start = Date.parse(iso + 'T00:00:00Z');
  if (!Number.isFinite(start) || !Number.isFinite(days)) return iso;
  const shifted = start + Math.trunc(days) * DAY;
  if (Math.abs(shifted) > MAX_TIME) return iso;
  return new Date(shifted).toISOString().slice(0, 10);
}

function clampHorizon(days: number): number {
  if (!Number.isFinite(days)) return MIN_HORIZON_DAYS;
  return Math.min(MAX_HORIZON_DAYS, Math.max(MIN_HORIZON_DAYS, Math.floor(days)));
}

/**
 * The first day on which an artifact counts as aging, and the first day on which it counts as stale.
 * The engine keeps an artifact fresh while age ≤ validDays and aging while age ≤ validDays × agingMultiplier,
 * so each state begins one day after the last day of the previous one.
 */
export function evidenceBoundaries(e: Pick<Evidence, 'collectedOn' | 'validDays'>, policy: RulePolicy): { agingOn: string; staleOn: string } {
  return {
    agingOn: addDays(e.collectedOn, e.validDays + 1),
    staleOn: addDays(e.collectedOn, Math.floor(e.validDays * policy.agingMultiplier) + 1),
  };
}

/** The first day on which a decision is no longer applied (applied while 0 ≤ age ≤ decisionValidDays). */
export function decisionLapsesOn(decidedOn: string, policy: RulePolicy): string {
  return addDays(decidedOn, policy.decisionValidDays + 1);
}

/** Freshness at `asOf` under the effective policy: the engine's rule, with the aging window taken from the policy. */
function freshnessAt(e: Evidence, asOf: string, policy: RulePolicy): Freshness {
  const { freshness, ageDays } = assessFreshness(e.collectedOn, e.validDays, asOf);
  if (ageDays < 0 || freshness === 'fresh') return freshness; // future-dated → stale; within validDays → fresh
  return ageDays <= e.validDays * policy.agingMultiplier ? 'aging' : 'stale';
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const CHANGE_RANK: Record<OutcomeProjection['change'], number> = { worsens: 0, improves: 1, same: 2 };

function residualDelta(o: OutcomeProjection): number {
  // Residuals carry at most two decimals, so rounding the difference removes floating-point noise before sorting.
  return Math.round(Math.abs(o.residualAtHorizon - o.residualNow) * 100) / 100;
}

export function forecast(pack: EvidencePack, horizonDays: number): Forecast {
  const asOf = pack.profile.asOf;
  const days = clampHorizon(horizonDays);
  const horizonDate = addDays(asOf, days);
  const policy = effectivePolicy(pack);
  const inWindow = (date: string): boolean => date > asOf && date <= horizonDate;

  // Evidence crossing a freshness boundary in (asOf, horizonDate].
  const evidence: EvidenceExpiry[] = [];
  for (const e of pack.evidence) {
    const freshness = freshnessAt(e, asOf, policy);
    if (freshness === 'stale') continue; // nothing left to cross — includes future-dated artifacts
    const { agingOn, staleOn } = evidenceBoundaries(e, policy);
    if (!inWindow(agingOn) && !inWindow(staleOn)) continue;
    const agingAhead = freshness === 'fresh'; // otherwise the aging boundary has already passed
    evidence.push({
      evidenceId: e.id,
      title: e.title,
      type: e.type,
      subcategoryIds: [...e.subcategoryIds],
      freshness,
      agingOn: agingAhead ? agingOn : null,
      staleOn,
      daysToAging: agingAhead ? daysBetween(asOf, agingOn) : null,
      daysToStale: daysBetween(asOf, staleOn),
    });
  }
  evidence.sort((a, b) => cmp(a.agingOn ?? a.staleOn ?? '', b.agingOn ?? b.staleOn ?? '') || cmp(a.evidenceId, b.evidenceId));

  // Decisions applied at asOf that stop being applied by the horizon date.
  const decisions: DecisionLapse[] = [];
  for (const d of pack.decisions) {
    const age = daysBetween(d.decidedOn, asOf);
    if (!(age >= 0 && age <= policy.decisionValidDays)) continue; // future-dated or already ignored: it cannot lapse
    const lapsesOn = decisionLapsesOn(d.decidedOn, policy);
    if (lapsesOn > horizonDate) continue;
    decisions.push({
      subcategoryId: d.subcategoryId,
      reviewer: d.reviewer,
      verdict: d.verdict,
      decidedOn: d.decidedOn,
      lapsesOn,
      daysToLapse: daysBetween(asOf, lapsesOn),
    });
  }
  decisions.sort((a, b) => cmp(a.lapsesOn, b.lapsesOn) || cmp(a.subcategoryId, b.subcategoryId));

  // Outcomes: the same pack evaluated today and as of the horizon date; list every difference.
  const now = buildReport(pack);
  const later = buildReport({ ...pack, profile: { ...pack.profile, asOf: horizonDate } });
  const laterById = new Map(later.results.map((r) => [r.subcategoryId, r]));
  const outcomes: OutcomeProjection[] = [];
  for (const r of now.results) {
    const h = laterById.get(r.subcategoryId);
    if (!h || (h.status === r.status && h.residual === r.residual)) continue;
    outcomes.push({
      subcategoryId: r.subcategoryId,
      statusNow: r.status,
      statusAtHorizon: h.status,
      residualNow: r.residual,
      residualAtHorizon: h.residual,
      change: h.residual > r.residual ? 'worsens' : h.residual < r.residual ? 'improves' : 'same',
    });
  }
  outcomes.sort(
    (a, b) => CHANGE_RANK[a.change] - CHANGE_RANK[b.change] || residualDelta(b) - residualDelta(a) || cmp(a.subcategoryId, b.subcategoryId),
  );

  return { asOf, horizonDays: days, horizonDate, evidence, decisions, outcomes };
}
