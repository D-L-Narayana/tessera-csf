// Period-over-period comparison against a previously exported tessera.report/1.
// Pure and deterministic: no DOM, no clock, no locale formatting. The prior report is parsed with the same
// defensive posture as pack import (bounded size and counts, path-addressed issues, unknown keys dropped,
// nothing thrown), and only the fields needed for a delta are kept.
import { CATALOG_IDS } from './catalog';
import type { Priority, Report, Status, ValidationIssue } from './types';
import { MAX_PACK_BYTES, MAX_SHORT, isIsoDate, utf8Bytes } from './validate';

/** A report is one result per subcategory; the cap leaves room for a larger future subset while staying bounded. */
export const MAX_PRIOR_RESULTS = 200;
export const MAX_ISSUES = 50;

// Record<Status, true> makes this list fail to compile when a status is added to or removed from the union.
const STATUS_FLAGS: Record<Status, true> = {
  sufficient: true,
  partial: true,
  weak: true,
  none: true,
  contradicted: true,
  refuted: true,
  'accepted-risk': true,
  'not-applicable': true,
};
export const KNOWN_STATUSES: readonly Status[] = Object.keys(STATUS_FLAGS) as Status[];

export interface PriorResult {
  subcategoryId: string;
  status: Status;
  computedStatus?: Status;
  residual: number;
  priority: Priority;
}

export interface PriorReport {
  schema: 'tessera.report/1';
  generatedFor: string;
  asOf: string;
  results: PriorResult[];
  /** Kept verbatim when the exported report carried a rule policy object; compared by canonical JSON only. */
  policy?: unknown;
}

export type PriorValidation = { ok: true; report: PriorReport } | { ok: false; issues: ValidationIssue[] };

type Issues = ValidationIssue[];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function statusAt(v: unknown, path: string, issues: Issues): Status | undefined {
  if (typeof v === 'string' && (KNOWN_STATUSES as readonly string[]).includes(v)) return v as Status;
  issues.push({ path, message: `must be one of ${KNOWN_STATUSES.join(', ')}` });
  return undefined;
}

function resultAt(raw: unknown, path: string, seen: Set<string>, issues: Issues): PriorResult | undefined {
  if (!isRecord(raw)) {
    issues.push({ path, message: 'must be an object' });
    return undefined;
  }
  const rawId = raw.subcategoryId;
  let id: string | undefined;
  if (typeof rawId !== 'string' || !CATALOG_IDS.has(rawId)) {
    const shown = typeof rawId === 'string' ? `: ${rawId.slice(0, 20)}` : '';
    issues.push({ path: path + '.subcategoryId', message: `unknown subcategory id in this subset${shown}` });
  } else if (seen.has(rawId)) {
    issues.push({ path: path + '.subcategoryId', message: `duplicate result for ${rawId}` });
  } else {
    seen.add(rawId);
    id = rawId;
  }
  const status = statusAt(raw.status, path + '.status', issues);
  let computedStatus: Status | undefined;
  let computedOk = true;
  if (raw.computedStatus !== undefined) {
    computedStatus = statusAt(raw.computedStatus, path + '.computedStatus', issues);
    computedOk = computedStatus !== undefined;
  }
  const rawResidual = raw.residual;
  const residual = typeof rawResidual === 'number' && Number.isFinite(rawResidual) && rawResidual >= 0 && rawResidual <= 3 ? rawResidual : undefined;
  if (residual === undefined) issues.push({ path: path + '.residual', message: 'must be a finite number from 0 to 3' });
  const rawPriority = raw.priority;
  const priority: Priority | undefined = rawPriority === 1 || rawPriority === 2 || rawPriority === 3 ? rawPriority : undefined;
  if (priority === undefined) issues.push({ path: path + '.priority', message: 'priority must be 1, 2 or 3' });
  if (id === undefined || status === undefined || !computedOk || residual === undefined || priority === undefined) return undefined;
  // Key order mirrors SubcategoryResult so a parsed prior report reads like the export it came from.
  return computedStatus === undefined
    ? { subcategoryId: id, status, residual, priority }
    : { subcategoryId: id, status, computedStatus, residual, priority };
}

function validateObject(raw: unknown): PriorValidation {
  if (!isRecord(raw)) return { ok: false, issues: [{ path: '', message: 'report must be a JSON object' }] };
  const issues: Issues = [];
  if (raw.schema !== 'tessera.report/1') issues.push({ path: 'schema', message: "schema must be 'tessera.report/1'" });

  let asOf = '';
  if (isIsoDate(raw.asOf)) asOf = raw.asOf;
  else issues.push({ path: 'asOf', message: 'must be an ISO date (YYYY-MM-DD)' });

  let generatedFor = '';
  if (typeof raw.generatedFor === 'string' && raw.generatedFor.length >= 1 && raw.generatedFor.length <= MAX_SHORT) generatedFor = raw.generatedFor;
  else issues.push({ path: 'generatedFor', message: `must be a string of 1 to ${MAX_SHORT} characters` });

  const results: PriorResult[] = [];
  if (!Array.isArray(raw.results)) issues.push({ path: 'results', message: 'must be an array' });
  else if (raw.results.length > MAX_PRIOR_RESULTS) issues.push({ path: 'results', message: `at most ${MAX_PRIOR_RESULTS} results are accepted` });
  else {
    const seen = new Set<string>();
    raw.results.forEach((r, i) => {
      const result = resultAt(r, `results[${i}]`, seen, issues);
      if (result) results.push(result);
    });
  }

  if (issues.length) return { ok: false, issues: issues.slice(0, MAX_ISSUES) };
  const report: PriorReport = { schema: 'tessera.report/1', generatedFor, asOf, results };
  if (isRecord(raw.policy)) report.policy = raw.policy;
  return { ok: true, report };
}

/** Validate an already-parsed value (for example from an in-memory export). Never throws. */
export function validatePriorReportObject(raw: unknown): PriorValidation {
  try {
    return validateObject(raw);
  } catch {
    return { ok: false, issues: [{ path: '', message: 'report could not be validated' }] };
  }
}

/** Validate the text of a previously exported report. Bounded by MAX_PACK_BYTES; never throws. */
export function validatePriorReport(text: string): PriorValidation {
  if (typeof text !== 'string') return { ok: false, issues: [{ path: '', message: 'file is not valid JSON' }] };
  // Cheap pre-check (every char is >= 1 byte), then an exact UTF-8 byte count — same approach as validatePack.
  if (text.length > MAX_PACK_BYTES || utf8Bytes(text) > MAX_PACK_BYTES) {
    return { ok: false, issues: [{ path: '', message: `report too large: limit is ${MAX_PACK_BYTES} bytes` }] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return { ok: false, issues: [{ path: '', message: 'file is not valid JSON' }] };
  }
  return validatePriorReportObject(raw);
}

export type Change = 'improved' | 'regressed' | 'changed' | 'unchanged' | 'added' | 'removed';

/** Display and sort order: what got worse first, then what moved, then what cannot be matched, then the rest. */
export const CHANGE_ORDER: readonly Change[] = ['regressed', 'changed', 'improved', 'added', 'removed', 'unchanged'];

export interface OutcomeDelta {
  subcategoryId: string;
  before?: Status;
  after?: Status;
  residualBefore?: number;
  residualAfter?: number;
  /** after − before, rounded to 2 decimals; residualAfter for added, −residualBefore for removed. */
  residualDelta: number;
  change: Change;
}

export interface Comparison {
  before: { asOf: string; generatedFor: string };
  after: { asOf: string; generatedFor: string };
  deltas: OutcomeDelta[];
  counts: Record<Change, number>;
  warnings: string[];
}

function round2(x: number): number {
  const r = Math.round(x * 100) / 100;
  return r === 0 ? 0 : r; // normalise −0
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Key-order-independent JSON text, so two equal policies written in different key order do not look different. */
function canonical(v: unknown, depth = 0): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (depth > 32) return '"[too deep]"';
  if (Array.isArray(v)) return '[' + v.map((x) => canonical(x, depth + 1)).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canonical(o[k], depth + 1)).join(',') + '}';
}

function samePolicy(a: unknown, b: unknown): boolean {
  try {
    return canonical(a) === canonical(b);
  } catch {
    return false;
  }
}

export function compareReports(prior: PriorReport, current: Report): Comparison {
  const before = new Map(prior.results.map((r) => [r.subcategoryId, r] as const));
  const after = new Map(current.results.map((r) => [r.subcategoryId, r] as const));
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort(compareIds);

  const deltas: OutcomeDelta[] = [];
  for (const id of ids) {
    const b = before.get(id);
    const a = after.get(id);
    if (b && a) {
      const residualDelta = round2(a.residual - b.residual);
      const change: Change = residualDelta < 0 ? 'improved' : residualDelta > 0 ? 'regressed' : a.status !== b.status ? 'changed' : 'unchanged';
      deltas.push({ subcategoryId: id, before: b.status, after: a.status, residualBefore: b.residual, residualAfter: a.residual, residualDelta, change });
    } else if (a) {
      deltas.push({ subcategoryId: id, after: a.status, residualAfter: a.residual, residualDelta: round2(a.residual), change: 'added' });
    } else if (b) {
      deltas.push({ subcategoryId: id, before: b.status, residualBefore: b.residual, residualDelta: round2(-b.residual), change: 'removed' });
    }
  }
  const rank = (c: Change) => CHANGE_ORDER.indexOf(c);
  deltas.sort((x, y) => rank(x.change) - rank(y.change) || Math.abs(y.residualDelta) - Math.abs(x.residualDelta) || compareIds(x.subcategoryId, y.subcategoryId));

  const counts: Record<Change, number> = { improved: 0, regressed: 0, changed: 0, unchanged: 0, added: 0, removed: 0 };
  for (const d of deltas) counts[d.change] += 1;

  const warnings: string[] = [];
  if (prior.generatedFor !== current.generatedFor) warnings.push(`profile differs: "${prior.generatedFor}" vs "${current.generatedFor}"`);
  if (prior.asOf >= current.asOf) warnings.push(`previous report is not older than the current evaluation (asOf ${prior.asOf} vs ${current.asOf})`);
  if (prior.policy === undefined) warnings.push('previous report carries no rule policy (schema before 0.2); thresholds may differ');
  else if (!samePolicy(prior.policy, current.policy)) warnings.push('rule policy differs between the two reports');

  return {
    before: { asOf: prior.asOf, generatedFor: prior.generatedFor },
    after: { asOf: current.asOf, generatedFor: current.generatedFor },
    deltas,
    counts,
    warnings,
  };
}

/** "+0.50", "−1.00" (typographic minus), "0.00". Locale-independent. */
export function formatDelta(delta: number): string {
  const r = round2(delta);
  if (r === 0 || !Number.isFinite(r)) return '0.00';
  return (r > 0 ? '+' : '−') + Math.abs(r).toFixed(2);
}
