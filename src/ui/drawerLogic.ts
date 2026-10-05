// Pure helpers for the outcome drawer: identifiers, hypothetical evaluation, draft validation and date
// arithmetic. No DOM access, so every rule here is unit-tested in Node. Boundary formulas mirror the
// engine's freshness rules (fresh while age ≤ validDays; aging while age ≤ validDays × agingMultiplier).
import { CATALOG } from '../engine/catalog';
import { evaluateSubcategory } from '../engine/evaluate';
import { DEFAULT_POLICY, type RulePolicy } from '../engine/policy';
import type { Decision, Evidence, EvidencePack, EvidenceType, SubcategoryResult } from '../engine/types';
import { validatePackObject } from '../engine/validate';

/** Message shown when the drawer is rendered without an update handler (edits cannot be saved). */
export const EDIT_UNAVAILABLE = 'Editing is not available in this view.';

const EV_ID = /^EV-(\d+)$/;
const DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** ECMAScript Date range: ±8.64e15 ms around the epoch. */
const MAX_DATE_MS = 8.64e15;

/**
 * Next free evidence id: `EV-` + (highest numeric suffix among `EV-<digits>` ids + 1), zero-padded to at
 * least three digits. Ids with another shape are ignored, so removing an item never produces a collision.
 */
export function nextEvidenceId(existingIds: readonly string[]): string {
  let max = 0;
  for (const id of existingIds) {
    const m = EV_ID.exec(id);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isSafeInteger(n) && n > max) max = n;
  }
  return 'EV-' + String(max + 1).padStart(3, '0');
}

/** Evaluate one outcome as if `draft` replaced any current decision for it. The pack is not mutated. */
export function previewDecision(pack: EvidencePack, subcategoryId: string, draft: Decision): SubcategoryResult {
  const decisions = [...pack.decisions.filter((d) => d.subcategoryId !== subcategoryId), draft];
  return evaluateSubcategory(subcategoryId, { ...pack, decisions });
}

/**
 * Validate an evidence draft in the context of the pack it would join (or replace `editingId` in).
 * Returns `null` when valid, a duplicate-id message when adding an id that already exists, or the
 * validator's path-addressed issues joined as `path: message`.
 */
export function evidenceDraftIssues(draft: Evidence, pack: EvidencePack, editingId?: string): string | null {
  const editing = editingId !== undefined;
  if (pack.evidence.some((e) => e.id === draft.id && (!editing || e.id !== editingId))) {
    return `Evidence id ${draft.id} already exists.`;
  }
  const replaces = editing && pack.evidence.some((e) => e.id === editingId);
  const evidence = replaces ? pack.evidence.map((e) => (e.id === editingId ? draft : e)) : [...pack.evidence, draft];
  const check = validatePackObject({ ...pack, evidence });
  if (check.ok) return null;
  return check.issues.map((i) => `${i.path}: ${i.message}`).join(' ');
}

/** UTC calendar arithmetic on YYYY-MM-DD strings; empty string when the input cannot be parsed. */
export function addDays(iso: string, days: number): string {
  const start = Date.parse(iso + 'T00:00:00Z');
  if (!Number.isFinite(start) || !Number.isFinite(days)) return '';
  const ms = start + Math.round(days) * DAY;
  if (!Number.isFinite(ms) || Math.abs(ms) > MAX_DATE_MS) return '';
  const out = new Date(ms).toISOString().slice(0, 10);
  return ISO_DATE.test(out) ? out : '';
}

/**
 * First day an artifact counts as aging (collectedOn + validDays + 1) and as stale
 * (collectedOn + floor(validDays × agingMultiplier) + 1).
 */
export function boundaryDates(collectedOn: string, validDays: number, agingMultiplier: number): { agingOn: string; staleOn: string } {
  return {
    agingOn: addDays(collectedOn, validDays + 1),
    staleOn: addDays(collectedOn, Math.floor(validDays * agingMultiplier) + 1),
  };
}

export interface EvidenceDraftInput {
  id: string;
  /** The outcome whose drawer owns the form; always the first subcategory reference. */
  subcategoryId: string;
  /** Other outcomes ticked under "Also applies to"; unknown ids and the owning outcome are dropped. */
  alsoApplies: readonly string[];
  title: string;
  source: string;
  collectedBy: string;
  type: EvidenceType;
  collectedOn: string;
  validDays: number;
  scope: Evidence['scope'];
  assertion: Evidence['assertion'];
  note: string;
}

/** Build a full Evidence record from form values: trimmed strings, blank optionals omitted, references in catalog order. */
export function buildEvidenceDraft(input: EvidenceDraftInput): Evidence {
  const extra = CATALOG.filter((s) => s.id !== input.subcategoryId && input.alsoApplies.includes(s.id)).map((s) => s.id);
  const e: Evidence = {
    id: input.id.trim(),
    title: input.title.trim(),
    type: input.type,
    subcategoryIds: [input.subcategoryId, ...extra],
    collectedOn: input.collectedOn.trim(),
    validDays: input.validDays,
    scope: input.scope,
    assertion: input.assertion,
    source: input.source.trim(),
  };
  const note = input.note.trim();
  if (note) e.note = note;
  const collectedBy = input.collectedBy.trim();
  if (collectedBy) e.collectedBy = collectedBy;
  return e;
}

export function removeConfirmMessage(id: string): string {
  return `Remove ${id}? This cannot be undone except with Undo.`;
}

/** Route a saved edit to the host's update handler, or explain that this view cannot save edits. */
export function submitEvidenceEdit(onUpdate: ((e: Evidence) => string | null) | undefined, draft: Evidence): string | null {
  if (!onUpdate) return EDIT_UNAVAILABLE;
  return onUpdate(draft);
}

/**
 * The policy whose numbers the drawer displays: an explicit `policy` prop, else the pack's own policy,
 * else the defaults with the legacy `minRationale` prop applied, else the defaults.
 */
export function resolveDrawerPolicy(pack: EvidencePack, policy?: RulePolicy, minRationale?: number): RulePolicy {
  if (policy) return policy;
  if (pack.policy) return pack.policy;
  if (minRationale !== undefined && minRationale !== DEFAULT_POLICY.minOverrideRationale) {
    return { ...DEFAULT_POLICY, minOverrideRationale: minRationale };
  }
  return DEFAULT_POLICY;
}
