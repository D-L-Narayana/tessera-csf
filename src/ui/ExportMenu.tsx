// Export menu: six downloads of the current pack and report. The list of downloads is a pure function (testable in
// Node); browser APIs are only touched inside the click handler.
import { evidenceInventoryRows, gapRegisterRows, reportToCsvRows, toCsv } from '../engine/csv';
import { reportToMarkdown } from '../engine/markdown';
import type { EvidencePack, Report } from '../engine/types';
import { downloadText } from './files';

export type ExportKind = 'pack' | 'report-json' | 'report-csv' | 'gaps-csv' | 'evidence-csv' | 'summary-md';

export interface ExportItem {
  kind: ExportKind;
  label: string;
  filename: string;
  mime: 'application/json' | 'text/csv' | 'text/markdown';
  /** CSV downloads start with a UTF-8 byte-order mark so spreadsheet apps read them as UTF-8. */
  bom: boolean;
  text: () => string;
}

/** Filenames are stamped with the pack's evaluation date (YYYYMMDD); text is generated lazily on click. */
export function exportItems(pack: EvidencePack, report: Report): ExportItem[] {
  const stamp = pack.profile.asOf.replace(/-/g, '');
  return [
    { kind: 'pack', label: 'Export pack', filename: `tessera-pack-${stamp}.json`, mime: 'application/json', bom: false, text: () => JSON.stringify(pack, null, 2) },
    { kind: 'report-json', label: 'Export report JSON', filename: `tessera-report-${stamp}.json`, mime: 'application/json', bom: false, text: () => JSON.stringify(report, null, 2) },
    { kind: 'report-csv', label: 'Export report CSV', filename: `tessera-report-${stamp}.csv`, mime: 'text/csv', bom: true, text: () => toCsv(reportToCsvRows(report)) },
    { kind: 'gaps-csv', label: 'Export gap register CSV', filename: `tessera-gaps-${stamp}.csv`, mime: 'text/csv', bom: true, text: () => toCsv(gapRegisterRows(report)) },
    { kind: 'evidence-csv', label: 'Export evidence inventory CSV', filename: `tessera-evidence-${stamp}.csv`, mime: 'text/csv', bom: true, text: () => toCsv(evidenceInventoryRows(pack, report)) },
    { kind: 'summary-md', label: 'Export summary (Markdown)', filename: `tessera-summary-${stamp}.md`, mime: 'text/markdown', bom: false, text: () => reportToMarkdown(report, pack) },
  ];
}

interface Props {
  pack: EvidencePack;
  report: Report;
  /** Called after each download with the export kind, so the host can clear its unsaved-changes flag. */
  onExported?: (kind: string) => void;
}

export function ExportMenu({ pack, report, onExported }: Props) {
  const items = exportItems(pack, report);
  return (
    <div className="btnrow" role="group" aria-label="Export">
      {items.map((item) => (
        <button
          key={item.kind}
          type="button"
          onClick={() => {
            downloadText(item.filename, item.text(), item.mime, { bom: item.bom });
            onExported?.(item.kind);
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
