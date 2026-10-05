// Defensive import validation for evidence packs. Bounded size and counts, path-addressed issues,
// no exceptions escape. Unknown keys are dropped so the in-memory model only contains known fields.
// Accepted values are rebuilt key by key in a fixed order, so validating an already-validated pack is the
// identity and a JSON round trip of a valid pack is byte-identical (see docs/validation.md).
import { CATALOG_IDS } from './catalog';
import { DEFAULT_POLICY, POLICY_BOUNDS, type RulePolicy } from './policy';
import {
  EVIDENCE_TYPES,
  type Decision,
  type Evidence,
  type EvidencePack,
  type Priority,
  type Status,
  type ValidationIssue,
  type ValidationResult,
} from './types';

export const MAX_PACK_BYTES = 512 * 1024;
export const MAX_EVIDENCE = 500;
export const MAX_DECISIONS = 200;
export const MAX_TEXT = 2000;
export const MAX_SHORT = 160;
export const MAX_ID = 64;
/** Reviewer and collector names. */
export const MAX_NAME = 80;
export const MAX_SUBCATEGORY_ID = 16;
export const MAX_VALID_DAYS = 3650;
/** The subset has 25 subcategories, so no evidence item or priority map can legitimately reference more. */
export const MAX_SUBCATEGORY_REFS = 25;
/** Issues are capped so a hostile file cannot produce an unbounded error report. */
export const MAX_ISSUES = 50;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** C0 control characters and DEL: never allowed in short strings. */
const CONTROL = /[\u0000-\u001f\u007f]/;
/** Long texts (note, rationale) may contain line feeds and tabs, nothing else from the control range. */
const CONTROL_EXCEPT_NEWLINE_TAB = /[\u0000-\u0008\u000b-\u001f\u007f]/;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_DATE.test(v)) return false;
  const t = Date.parse(v + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

type Issues = ValidationIssue[];

/**
 * 'short': single-line value (title, source, reviewer, collector, profile name, subcategory id) — no control
 * characters, not blank. 'id': a short string that additionally may not start or end with whitespace.
 * 'long': free text (note, rationale) — line feeds and tabs allowed, may be empty.
 */
type StringKind = 'short' | 'id' | 'long';

function str(v: unknown, path: string, issues: Issues, max = MAX_SHORT, min = 1, kind: StringKind = 'short'): string {
  if (typeof v !== 'string') {
    issues.push({ path, message: 'must be a string' });
    return '';
  }
  if (v.length < min) issues.push({ path, message: `must be at least ${min} character(s)` });
  if (v.length > max) issues.push({ path, message: `must be at most ${max} characters` });
  if ((kind === 'long' ? CONTROL_EXCEPT_NEWLINE_TAB : CONTROL).test(v)) {
    issues.push({ path, message: 'must not contain control characters' });
  } else if (kind !== 'long' && v.length >= min && v.trim().length === 0) {
    issues.push({ path, message: 'must not be blank' });
  } else if (kind === 'id' && v.trim() !== v) {
    issues.push({ path, message: 'must not start or end with whitespace' });
  }
  return v;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string, issues: Issues): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    issues.push({ path, message: `must be one of ${allowed.join(', ')}` });
    return allowed[0];
  }
  return v as T;
}

function date(v: unknown, path: string, issues: Issues): string {
  if (!isIsoDate(v)) {
    issues.push({ path, message: 'must be an ISO date (YYYY-MM-DD)' });
    return '2000-01-01';
  }
  return v;
}

/** Finite number within [min, max] (integer when requested). Returns NaN after reporting, so later ordering checks skip it. */
function num(v: unknown, path: string, issues: Issues, range: { min: number; max: number }, integer = false): number {
  if (typeof v !== 'number') {
    issues.push({ path, message: 'must be a number' });
    return NaN;
  }
  if (!Number.isFinite(v)) {
    issues.push({ path, message: 'must be a finite number' });
    return NaN;
  }
  if ((integer && !Number.isInteger(v)) || v < range.min || v > range.max) {
    issues.push({ path, message: integer ? `must be an integer from ${range.min} to ${range.max}` : `must be between ${range.min} and ${range.max}` });
    return NaN;
  }
  return v === 0 ? 0 : v; // -0 becomes 0 so the canonical form equals its JSON text
}

function evidence(raw: unknown, path: string, issues: Issues): Evidence {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') issues.push({ path, message: 'must be an object' });
  const ids: string[] = [];
  if (!Array.isArray(o.subcategoryIds) || o.subcategoryIds.length === 0) {
    issues.push({ path: path + '.subcategoryIds', message: 'must be a non-empty array' });
  } else if (o.subcategoryIds.length > MAX_SUBCATEGORY_REFS) {
    issues.push({ path: path + '.subcategoryIds', message: `at most ${MAX_SUBCATEGORY_REFS} subcategory references per evidence item` });
  } else {
    o.subcategoryIds.forEach((id, i) => {
      if (typeof id !== 'string' || !CATALOG_IDS.has(id)) {
        issues.push({ path: `${path}.subcategoryIds[${i}]`, message: `unknown subcategory id in this subset: ${String(id).slice(0, 20)}` });
      } else if (!ids.includes(id)) ids.push(id);
    });
  }
  const validDays = typeof o.validDays === 'number' && Number.isInteger(o.validDays) ? o.validDays : NaN;
  if (!(validDays >= 1 && validDays <= MAX_VALID_DAYS)) {
    issues.push({ path: path + '.validDays', message: `validDays must be an integer from 1 to ${MAX_VALID_DAYS}` });
  }
  const e: Evidence = {
    id: str(o.id, path + '.id', issues, MAX_ID, 1, 'id'),
    title: str(o.title, path + '.title', issues),
    type: oneOf(o.type, EVIDENCE_TYPES, path + '.type', issues),
    subcategoryIds: ids,
    collectedOn: date(o.collectedOn, path + '.collectedOn', issues),
    validDays: Number.isFinite(validDays) ? validDays : 1,
    scope: oneOf(o.scope, ['full', 'partial'] as const, path + '.scope', issues),
    assertion: oneOf(o.assertion, ['supports', 'refutes'] as const, path + '.assertion', issues),
    source: str(o.source, path + '.source', issues),
  };
  if (o.note !== undefined) e.note = str(o.note, path + '.note', issues, MAX_TEXT, 0, 'long');
  if (o.collectedBy !== undefined) e.collectedBy = str(o.collectedBy, path + '.collectedBy', issues, MAX_NAME);
  return e;
}

function decision(raw: unknown, path: string, issues: Issues): Decision {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') issues.push({ path, message: 'must be an object' });
  const subcategoryId = str(o.subcategoryId, path + '.subcategoryId', issues, MAX_SUBCATEGORY_ID);
  if (subcategoryId && !CATALOG_IDS.has(subcategoryId)) issues.push({ path: path + '.subcategoryId', message: 'unknown subcategory id in this subset' });
  return {
    subcategoryId,
    reviewer: str(o.reviewer, path + '.reviewer', issues, MAX_NAME),
    verdict: oneOf(o.verdict, ['accepted', 'gap', 'needs-more', 'not-applicable'] as const, path + '.verdict', issues),
    rationale: str(o.rationale, path + '.rationale', issues, MAX_TEXT, 0, 'long'),
    decidedOn: date(o.decidedOn, path + '.decidedOn', issues),
  };
}

/** Canonical exposure key order is the order of DEFAULT_POLICY.exposure. */
const STATUS_KEYS = Object.keys(DEFAULT_POLICY.exposure) as Status[];

/**
 * Validates a tessera.policy/1 object against POLICY_BOUNDS and rebuilds it in canonical key order (the order
 * of DEFAULT_POLICY), dropping unknown keys. Cross-field rules: fresh ≥ aging ≥ stale, full ≥ partial,
 * bands.moderate < bands.high, exposure['not-applicable'] === 0, every status present in exposure.
 */
function policy(raw: unknown, path: string, issues: Issues): RulePolicy {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({ path, message: 'must be an object' });
    return DEFAULT_POLICY;
  }
  const o = raw as Record<string, unknown>;
  const B = POLICY_BOUNDS;
  const section = (key: string): Record<string, unknown> | null => {
    const v = o[key];
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      issues.push({ path: `${path}.${key}`, message: 'must be an object' });
      return null;
    }
    return v as Record<string, unknown>;
  };
  const field = (container: Record<string, unknown> | null, key: string, name: string, range: { min: number; max: number }): number =>
    container ? num(container[name], `${path}.${key}.${name}`, issues, range) : NaN;

  if (o.schema !== 'tessera.policy/1') issues.push({ path: `${path}.schema`, message: "schema must be 'tessera.policy/1'" });
  const agingMultiplier = num(o.agingMultiplier, `${path}.agingMultiplier`, issues, B.agingMultiplier);

  const fw = section('freshnessWeights');
  const fresh = field(fw, 'freshnessWeights', 'fresh', B.weight);
  const aging = field(fw, 'freshnessWeights', 'aging', B.weight);
  const stale = field(fw, 'freshnessWeights', 'stale', B.weight);
  if (aging > fresh) issues.push({ path: `${path}.freshnessWeights.aging`, message: 'must not exceed freshnessWeights.fresh' });
  if (stale > aging) issues.push({ path: `${path}.freshnessWeights.stale`, message: 'must not exceed freshnessWeights.aging' });

  const sw = section('scopeWeights');
  const full = field(sw, 'scopeWeights', 'full', B.weight);
  const partial = field(sw, 'scopeWeights', 'partial', B.weight);
  if (partial > full) issues.push({ path: `${path}.scopeWeights.partial`, message: 'must not exceed scopeWeights.full' });

  const sufficientCoverage = num(o.sufficientCoverage, `${path}.sufficientCoverage`, issues, B.sufficientCoverage);
  const minDistinctTypes = num(o.minDistinctTypes, `${path}.minDistinctTypes`, issues, B.minDistinctTypes, true);

  const ex = section('exposure');
  const exposure = {} as Record<Status, number>;
  for (const s of STATUS_KEYS) exposure[s] = field(ex, 'exposure', s, B.exposure);
  if (!Number.isNaN(exposure['not-applicable']) && exposure['not-applicable'] !== 0) {
    issues.push({ path: `${path}.exposure.not-applicable`, message: 'must be 0' });
  }

  const bd = section('bands');
  const moderate = field(bd, 'bands', 'moderate', B.band);
  const high = field(bd, 'bands', 'high', B.band);
  if (high <= moderate) issues.push({ path: `${path}.bands.high`, message: 'must be greater than bands.moderate' });

  const minOverrideRationale = num(o.minOverrideRationale, `${path}.minOverrideRationale`, issues, B.minOverrideRationale, true);
  const decisionValidDays = num(o.decisionValidDays, `${path}.decisionValidDays`, issues, B.decisionValidDays, true);
  if (typeof o.separationOfDuties !== 'boolean') issues.push({ path: `${path}.separationOfDuties`, message: 'must be a boolean' });

  return {
    schema: 'tessera.policy/1',
    agingMultiplier,
    freshnessWeights: { fresh, aging, stale },
    scopeWeights: { full, partial },
    sufficientCoverage,
    minDistinctTypes,
    exposure,
    bands: { moderate, high },
    minOverrideRationale,
    decisionValidDays,
    separationOfDuties: o.separationOfDuties === true,
  };
}

export type PolicyValidationResult = { ok: true; policy: RulePolicy } | { ok: false; issues: ValidationIssue[] };

/** Validates a stand-alone policy object (for example from the policy editor); issue paths are prefixed with `policy`. */
export function validatePolicyObject(raw: unknown): PolicyValidationResult {
  const issues: Issues = [];
  const p = policy(raw, 'policy', issues);
  if (issues.length) return { ok: false, issues: issues.slice(0, MAX_ISSUES) };
  return { ok: true, policy: p };
}

export function validatePackObject(raw: unknown): ValidationResult {
  const issues: Issues = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, issues: [{ path: '', message: 'pack must be a JSON object' }] };
  }
  const o = raw as Record<string, unknown>;
  if (o.schema !== 'tessera.pack/1') issues.push({ path: 'schema', message: "schema must be 'tessera.pack/1'" });

  const profileIsObject = !!o.profile && typeof o.profile === 'object' && !Array.isArray(o.profile);
  const p = (profileIsObject ? o.profile : {}) as Record<string, unknown>;
  if (!profileIsObject) issues.push({ path: 'profile', message: 'must be an object' });
  const priorities: Record<string, Priority> = {};
  if (p.priorities !== undefined) {
    if (!p.priorities || typeof p.priorities !== 'object' || Array.isArray(p.priorities)) {
      issues.push({ path: 'profile.priorities', message: 'must be an object keyed by subcategory id' });
    } else if (Object.keys(p.priorities).length > MAX_SUBCATEGORY_REFS) {
      issues.push({ path: 'profile.priorities', message: `at most ${MAX_SUBCATEGORY_REFS} priority entries (one per subcategory in the subset)` });
    } else {
      for (const [k, v] of Object.entries(p.priorities as Record<string, unknown>)) {
        if (!CATALOG_IDS.has(k)) issues.push({ path: `profile.priorities.${k.slice(0, 16)}`, message: 'unknown subcategory id' });
        else if (v !== 1 && v !== 2 && v !== 3) issues.push({ path: `profile.priorities.${k}`, message: 'priority must be 1, 2 or 3' });
        else priorities[k] = v;
      }
    }
  }
  const profile = {
    name: str(p.name, 'profile.name', issues),
    asOf: date(p.asOf, 'profile.asOf', issues),
    priorities,
  };

  const evList: Evidence[] = [];
  if (!Array.isArray(o.evidence)) issues.push({ path: 'evidence', message: 'must be an array' });
  else if (o.evidence.length > MAX_EVIDENCE) issues.push({ path: 'evidence', message: `at most ${MAX_EVIDENCE} evidence items are accepted` });
  else {
    const seen = new Set<string>();
    o.evidence.forEach((raw, i) => {
      const e = evidence(raw, `evidence[${i}]`, issues);
      if (seen.has(e.id)) issues.push({ path: `evidence[${i}].id`, message: `duplicate evidence id ${e.id.slice(0, MAX_ID)}` });
      seen.add(e.id);
      evList.push(e);
    });
  }

  const decList: Decision[] = [];
  if (o.decisions === undefined) {
    // optional
  } else if (!Array.isArray(o.decisions)) issues.push({ path: 'decisions', message: 'must be an array' });
  else if (o.decisions.length > MAX_DECISIONS) issues.push({ path: 'decisions', message: `at most ${MAX_DECISIONS} decisions are accepted` });
  else {
    const seen = new Set<string>();
    o.decisions.forEach((raw, i) => {
      const d = decision(raw, `decisions[${i}]`, issues);
      if (seen.has(d.subcategoryId)) issues.push({ path: `decisions[${i}].subcategoryId`, message: 'duplicate decision for the same subcategory' });
      seen.add(d.subcategoryId);
      decList.push(d);
    });
  }

  // Optional rule policy. Absent means "use the defaults"; the key is never added to a pack that did not have one.
  const rulePolicy = o.policy === undefined ? undefined : policy(o.policy, 'policy', issues);

  if (issues.length) return { ok: false, issues: issues.slice(0, MAX_ISSUES) };
  const pack: EvidencePack = { schema: 'tessera.pack/1', profile, evidence: evList, decisions: decList };
  if (rulePolicy) pack.policy = rulePolicy;
  return { ok: true, pack };
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function validatePack(text: string): ValidationResult {
  if (typeof text !== 'string') return { ok: false, issues: [{ path: '', message: 'file is not text' }] };
  // Cheap pre-check (every char is >= 1 byte), then an exact UTF-8 byte count.
  if (text.length > MAX_PACK_BYTES || utf8Bytes(text) > MAX_PACK_BYTES) {
    return { ok: false, issues: [{ path: '', message: `pack too large: limit is ${MAX_PACK_BYTES} bytes` }] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ path: '', message: 'file is not valid JSON' }] };
  }
  return validatePackObject(raw);
}
