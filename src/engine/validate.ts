// Defensive import validation for evidence packs. Bounded size and counts, path-addressed issues,
// no exceptions escape. Unknown keys are dropped so the in-memory model only contains known fields.
import { CATALOG_IDS } from './catalog';
import { EVIDENCE_TYPES, type Decision, type Evidence, type EvidencePack, type Priority, type ValidationIssue, type ValidationResult } from './types';

export const MAX_PACK_BYTES = 512 * 1024;
export const MAX_EVIDENCE = 500;
export const MAX_DECISIONS = 200;
export const MAX_TEXT = 2000;
export const MAX_SHORT = 160;
/** The subset has 25 subcategories, so no evidence item or priority map can legitimately reference more. */
export const MAX_SUBCATEGORY_REFS = 25;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_DATE.test(v)) return false;
  const t = Date.parse(v + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

type Issues = ValidationIssue[];

function str(v: unknown, path: string, issues: Issues, max = MAX_SHORT, min = 1): string {
  if (typeof v !== 'string') {
    issues.push({ path, message: 'must be a string' });
    return '';
  }
  if (v.length < min) issues.push({ path, message: `must be at least ${min} character(s)` });
  if (v.length > max) issues.push({ path, message: `must be at most ${max} characters` });
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
  if (!(validDays >= 1 && validDays <= 3650)) issues.push({ path: path + '.validDays', message: 'validDays must be an integer from 1 to 3650' });
  const e: Evidence = {
    id: str(o.id, path + '.id', issues, 64),
    title: str(o.title, path + '.title', issues),
    type: oneOf(o.type, EVIDENCE_TYPES, path + '.type', issues),
    subcategoryIds: ids,
    collectedOn: date(o.collectedOn, path + '.collectedOn', issues),
    validDays: Number.isFinite(validDays) ? validDays : 1,
    scope: oneOf(o.scope, ['full', 'partial'] as const, path + '.scope', issues),
    assertion: oneOf(o.assertion, ['supports', 'refutes'] as const, path + '.assertion', issues),
    source: str(o.source, path + '.source', issues),
  };
  if (o.note !== undefined) e.note = str(o.note, path + '.note', issues, MAX_TEXT, 0);
  return e;
}

function decision(raw: unknown, path: string, issues: Issues): Decision {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') issues.push({ path, message: 'must be an object' });
  const subcategoryId = str(o.subcategoryId, path + '.subcategoryId', issues, 16);
  if (subcategoryId && !CATALOG_IDS.has(subcategoryId)) issues.push({ path: path + '.subcategoryId', message: 'unknown subcategory id in this subset' });
  return {
    subcategoryId,
    reviewer: str(o.reviewer, path + '.reviewer', issues, 80),
    verdict: oneOf(o.verdict, ['accepted', 'gap', 'needs-more', 'not-applicable'] as const, path + '.verdict', issues),
    rationale: str(o.rationale, path + '.rationale', issues, MAX_TEXT, 0),
    decidedOn: date(o.decidedOn, path + '.decidedOn', issues),
  };
}

export function validatePackObject(raw: unknown): ValidationResult {
  const issues: Issues = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, issues: [{ path: '', message: 'pack must be a JSON object' }] };
  }
  const o = raw as Record<string, unknown>;
  if (o.schema !== 'tessera.pack/1') issues.push({ path: 'schema', message: "schema must be 'tessera.pack/1'" });

  const p = (o.profile && typeof o.profile === 'object' ? o.profile : {}) as Record<string, unknown>;
  if (!o.profile || typeof o.profile !== 'object') issues.push({ path: 'profile', message: 'must be an object' });
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
      if (seen.has(e.id)) issues.push({ path: `evidence[${i}].id`, message: `duplicate evidence id ${e.id}` });
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

  if (issues.length) return { ok: false, issues: issues.slice(0, 50) };
  const pack: EvidencePack = { schema: 'tessera.pack/1', profile, evidence: evList, decisions: decList };
  return { ok: true, pack };
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function validatePack(text: string): ValidationResult {
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
