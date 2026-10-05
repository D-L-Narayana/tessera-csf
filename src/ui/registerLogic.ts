// Pure helpers for the gap register and the executive summary. No DOM access; testable in Node.
// Filtering and sorting never mutate the report; sorting is stable with the outcome id as the tie-break.
import { CATALOG } from '../engine/catalog';
import type { CsfFunction, Report, RiskBand, RollupBand, Status, Subcategory, SubcategoryResult } from '../engine/types';

/** Canonical status order used by the register's status sort and the summary's distribution. */
export const STATUSES: readonly Status[] = ['sufficient', 'partial', 'weak', 'none', 'contradicted', 'refuted', 'accepted-risk', 'not-applicable'];
export const FUNCTIONS: readonly CsfFunction[] = ['GV', 'ID', 'PR', 'DE', 'RS', 'RC'];
export const BANDS: readonly RiskBand[] = ['low', 'moderate', 'high'];

export interface RegisterFilter {
  fn?: CsfFunction;
  status?: Status;
  band?: RiskBand;
  query?: string;
  includeClosed?: boolean;
}
export type SortKey = 'residual' | 'id' | 'status' | 'priority';
export type SortDir = 'asc' | 'desc';
export interface SortState {
  key: SortKey;
  dir: SortDir;
}
export interface StatusCount {
  status: Status;
  count: number;
}
export interface FunctionSummaryRow {
  fn: CsfFunction;
  functionName: string;
  count: number;
  sufficient: number;
  gaps: number;
  warnings: number;
  band: RollupBand;
}
export interface OverrideSummary {
  valid: number;
  invalid: number;
  refusedActions: number;
}

/** The register's default view: every gap, residual exposure descending (the report's own gap order). */
export const DEFAULT_SORT: Readonly<SortState> = Object.freeze({ key: 'residual', dir: 'desc' });
export const EMPTY_FILTER: Readonly<RegisterFilter> = Object.freeze({});

const SUBCATEGORY: ReadonlyMap<string, Subcategory> = new Map(CATALOG.map((s) => [s.id, s]));
const STATUS_RANK: ReadonlyMap<Status, number> = new Map(STATUSES.map((s, i) => [s, i]));
/** Natural first direction per sort key: ids and statuses read upwards, exposure and priority read worst-first. */
const NATURAL_DIR: Record<SortKey, SortDir> = { id: 'asc', status: 'asc', residual: 'desc', priority: 'desc' };

function subcategoryOf(r: SubcategoryResult): Subcategory | undefined {
  return SUBCATEGORY.get(r.subcategoryId);
}

/** Code-unit comparison: deterministic and locale-independent for the fixed-width catalog ids. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The list the register starts from: the report's gaps, or all 25 results when closed outcomes are included. */
export function baseRows(report: Report, includeClosed: boolean): SubcategoryResult[] {
  return includeClosed ? report.results : report.gaps;
}

export function filterRows(report: Report, f: RegisterFilter): SubcategoryResult[] {
  const query = (f.query ?? '').trim().toLowerCase();
  return baseRows(report, f.includeClosed === true).filter((r) => {
    const s = subcategoryOf(r);
    if (f.fn && s?.fn !== f.fn) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.band && r.band !== f.band) return false;
    if (query) {
      const haystack = [r.subcategoryId, s?.categoryName ?? '', s?.functionName ?? '', r.status, r.remediation ?? ''].join('\u0000').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

/** True when any filter narrows the list or the include toggle widens it (drives the "Clear filters" control). */
export function isFilterActive(f: RegisterFilter): boolean {
  return Boolean(f.fn || f.status || f.band || (f.query ?? '').trim() || f.includeClosed);
}

export function sortRows(rows: readonly SubcategoryResult[], key: SortKey, dir: SortDir): SubcategoryResult[] {
  const sign = dir === 'asc' ? 1 : -1;
  const rank = (r: SubcategoryResult): number => {
    switch (key) {
      case 'residual':
        return r.residual;
      case 'priority':
        return r.priority;
      case 'status':
        return STATUS_RANK.get(r.status) ?? STATUSES.length;
      case 'id':
        return 0;
    }
  };
  return [...rows].sort((a, b) => {
    if (key === 'id') return sign * compareIds(a.subcategoryId, b.subcategoryId);
    const d = rank(a) - rank(b);
    return d !== 0 ? sign * d : compareIds(a.subcategoryId, b.subcategoryId);
  });
}

/** Clicking the active header reverses it; clicking another header starts that key in its natural direction. */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: NATURAL_DIR[key] };
}

/** All eight statuses in canonical order, zero counts included. */
export function statusDistribution(results: readonly SubcategoryResult[]): StatusCount[] {
  const counts = new Map<Status, number>(STATUSES.map((s) => [s, 0]));
  for (const r of results) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  return STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0 }));
}

/** One row per CSF function in catalog order; sufficient/band come from the report's roll-ups. */
export function functionSummary(report: Report): FunctionSummaryRow[] {
  return FUNCTIONS.map((fn) => {
    const subs = CATALOG.filter((s) => s.fn === fn);
    const inFn = report.results.filter((r) => subcategoryOf(r)?.fn === fn);
    const roll = report.rollups.find((r) => r.fn === fn);
    return {
      fn,
      functionName: roll?.functionName ?? subs[0]?.functionName ?? fn,
      count: roll?.count ?? subs.length,
      sufficient: roll?.sufficient ?? inFn.filter((r) => r.status === 'sufficient').length,
      gaps: report.gaps.filter((g) => subcategoryOf(g)?.fn === fn).length,
      warnings: inFn.filter((r) => r.warnings.length > 0).length,
      band: roll?.band ?? 'not-assessed',
    };
  });
}

/** Valid and invalid reviewer overrides, plus every refused reviewer action (one per engine warning). */
export function overrideSummary(report: Report): OverrideSummary {
  let valid = 0;
  let invalid = 0;
  let refusedActions = 0;
  for (const r of report.results) {
    if (r.override) {
      if (r.overrideValid) valid += 1;
      else invalid += 1;
    }
    refusedActions += r.warnings.length;
  }
  return { valid, invalid, refusedActions };
}
