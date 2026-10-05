// CSV exports. RFC 4180 shape (every cell quoted, quotes doubled, CRLF between rows) with spreadsheet
// formula-injection neutralisation. Pure and deterministic; no DOM access; no byte-order mark (the download helper
// adds one on request so the text itself stays comparable across runs).
import { CATALOG } from './catalog';
import type { EvidenceAssessment, EvidencePack, Report } from './types';

/**
 * Cells that a spreadsheet could interpret as a formula or a DDE command (`=`, `+`, `-`, `@`, `|`), even when hidden
 * behind leading whitespace or control characters, are prefixed with an apostrophe. Cells starting with a tab or a
 * carriage return are prefixed as well so the first visible character can never be a trigger.
 */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number): string => {
    let s = String(v);
    if (/^[\s\u0000-\u001f]*[=+\-@|]/.test(s) || /^[\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

function names(subcategoryId: string): { functionName: string; categoryName: string } {
  const s = CATALOG.find((c) => c.id === subcategoryId);
  return { functionName: s?.functionName ?? '', categoryName: s?.categoryName ?? '' };
}

/** One row per outcome: the twelve original columns, then the reviewer decision and any refusals or warnings. */
export function reportToCsvRows(report: Report): (string | number)[][] {
  const rows: (string | number)[][] = [
    ['subcategory', 'function', 'category', 'status', 'computed', 'coverage', 'types', 'priority', 'residual', 'band', 'override', 'remediation', 'reviewer', 'verdict', 'decidedOn', 'warnings'],
  ];
  for (const r of report.results) {
    const s = names(r.subcategoryId);
    rows.push([
      r.subcategoryId,
      s.functionName,
      s.categoryName,
      r.status,
      r.computedStatus,
      r.coverage,
      r.distinctTypes,
      r.priority,
      r.residual,
      r.band,
      r.override ? (r.overrideValid ? 'valid' : 'invalid') : '',
      r.remediation ?? '',
      r.decision?.reviewer ?? '',
      r.decision?.verdict ?? '',
      r.decision?.decidedOn ?? '',
      r.warnings.join('; '),
    ]);
  }
  return rows;
}

/** The ranked gap register (report.gaps order): header plus one row per gap. */
export function gapRegisterRows(report: Report): (string | number)[][] {
  const rows: (string | number)[][] = [['rank', 'subcategory', 'function', 'category', 'status', 'priority', 'residual', 'band', 'remediation']];
  report.gaps.forEach((g, i) => {
    const s = names(g.subcategoryId);
    rows.push([i + 1, g.subcategoryId, s.functionName, s.categoryName, g.status, g.priority, g.residual, g.band, g.remediation ?? '']);
  });
  return rows;
}

/**
 * Every artifact in the pack with its freshness, age and coverage weight as assessed at the report's as-of date.
 * The assessment is the same for every outcome an artifact supports, so the first one found in the report is used.
 */
export function evidenceInventoryRows(pack: EvidencePack, report: Report): (string | number)[][] {
  const rows: (string | number)[][] = [
    ['id', 'title', 'type', 'scope', 'assertion', 'source', 'collectedBy', 'collectedOn', 'validDays', 'freshness', 'ageDays', 'weight', 'subcategoryIds', 'note'],
  ];
  const assessed = new Map<string, EvidenceAssessment>();
  for (const r of report.results) {
    for (const a of r.evidence) if (!assessed.has(a.evidenceId)) assessed.set(a.evidenceId, a);
  }
  for (const e of pack.evidence) {
    const a = assessed.get(e.id);
    rows.push([
      e.id,
      e.title,
      e.type,
      e.scope,
      e.assertion,
      e.source,
      e.collectedBy ?? '',
      e.collectedOn,
      e.validDays,
      a?.freshness ?? '',
      a?.ageDays ?? '',
      a?.weight ?? '',
      e.subcategoryIds.join('; '),
      e.note ?? '',
    ]);
  }
  return rows;
}
