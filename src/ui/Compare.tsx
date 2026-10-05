// Compare the current evaluation with a previously exported report. Read-only with respect to the pack:
// the prior report lives in this component's state, the comparison is derived during render, and the file is
// read in the browser only (no network, no storage). Browser APIs are touched inside handlers only.
import { useId, useMemo, useRef, useState } from 'react';
import { CATALOG } from '../engine/catalog';
import { compareReports, formatDelta, validatePriorReport, type Comparison, type OutcomeDelta, type PriorReport } from '../engine/compare';
import type { Report } from '../engine/types';
import { MAX_PACK_BYTES } from '../engine/validate';
import { readTextFile } from './files';
import './compare.css';

export type CompareNotice = { kind: 'info' | 'error' | 'success'; text: string; details?: string[] };

interface Props {
  report: Report;
  onSelect: (id: string) => void;
  onNotice?: (n: CompareNotice) => void;
  /** Optional starting point (tests, demos). Normal use imports the previous report through the button. */
  initialPrior?: PriorReport;
}

const BY_ID = new Map(CATALOG.map((s) => [s.id, s] as const));

export function Compare({ report, onSelect, onNotice, initialPrior }: Props) {
  const [prior, setPrior] = useState<PriorReport | null>(initialPrior ?? null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const toggleId = useId();

  const comparison = useMemo(() => (prior ? compareReports(prior, report) : null), [prior, report]);

  async function onImport(file: File | undefined) {
    if (!file) return;
    try {
      const text = await readTextFile(file, MAX_PACK_BYTES);
      const r = validatePriorReport(text);
      if (!r.ok) {
        onNotice?.({
          kind: 'error',
          text: `Previous report rejected: ${r.issues.length} issue(s).`,
          details: r.issues.map((i) => `${i.path || 'report'} — ${i.message}`),
        });
        return;
      }
      setPrior(r.report);
      onNotice?.({ kind: 'success', text: `Loaded the previous report for "${r.report.generatedFor}" as of ${r.report.asOf} (${r.report.results.length} outcomes). The current pack was not changed.` });
    } catch (err) {
      onNotice?.({ kind: 'error', text: err instanceof Error ? err.message : 'The previous report could not be read.' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function clear() {
    setPrior(null);
    setShowUnchanged(false);
    onNotice?.({ kind: 'info', text: 'Cleared the comparison.' });
  }

  return (
    <section className="compare" aria-labelledby={headingId}>
      <div className="pane-head">
        <h2 id={headingId}>Compare with a previous report</h2>
        <p className="pane-help">
          Load a report JSON exported from an earlier review to see, outcome by outcome, what improved or regressed. The file is read in this browser only and the current pack is never modified.
        </p>
      </div>
      <div className="compare__actions">
        <button type="button" onClick={() => fileRef.current?.click()}>Import previous report JSON</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-hidden="true" tabIndex={-1} onChange={(e) => void onImport(e.target.files?.[0])} />
        {comparison && (
          <>
            <span className="compare__toggle">
              <input id={toggleId} type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} />
              <label htmlFor={toggleId}>Show unchanged outcomes</label>
            </span>
            <button type="button" className="ghost" onClick={clear}>Clear comparison</button>
          </>
        )}
      </div>
      {comparison ? (
        <ComparisonView comparison={comparison} onSelect={onSelect} showUnchanged={showUnchanged} />
      ) : (
        <p className="empty">Import a previously exported report JSON to see which outcomes improved or regressed.</p>
      )}
    </section>
  );
}

interface ViewProps {
  comparison: Comparison;
  onSelect: (id: string) => void;
  showUnchanged: boolean;
}

function deltaDirection(d: OutcomeDelta): 'up' | 'down' | 'zero' {
  if (d.residualDelta > 0) return 'up';
  if (d.residualDelta < 0) return 'down';
  return 'zero';
}

/** Pure presentation of a Comparison; the parent owns import, toggle and clear. */
export function ComparisonView({ comparison, onSelect, showUnchanged }: ViewProps) {
  const { before, after, deltas, counts, warnings } = comparison;
  const visible = showUnchanged ? deltas : deltas.filter((d) => d.change !== 'unchanged');
  const hiddenCount = showUnchanged ? 0 : counts.unchanged;
  const hiddenNote = `${hiddenCount} unchanged outcome${hiddenCount === 1 ? '' : 's'} hidden — tick "Show unchanged outcomes" to list them.`;

  return (
    <div className="compare__view">
      <dl className="compare__periods">
        <div>
          <dt>Previous report</dt>
          <dd><strong>{before.asOf}</strong> · {before.generatedFor}</dd>
        </div>
        <div>
          <dt>Current evaluation</dt>
          <dd><strong>{after.asOf}</strong> · {after.generatedFor}</dd>
        </div>
      </dl>

      {warnings.length > 0 && (
        <div className="compare__warnings">
          <p><strong>Read the deltas with care:</strong></p>
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="compare__summary">{`${counts.improved} improved · ${counts.regressed} regressed · ${counts.unchanged} unchanged`}</p>
      <p className="muted small">{`${counts.changed} changed status at equal residual · ${counts.added} only in the current evaluation · ${counts.removed} only in the previous report`}</p>

      {visible.length === 0 ? (
        <p className="empty">{`No outcome changed between the two reports.${hiddenCount > 0 ? ' ' + hiddenNote : ''}`}</p>
      ) : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Comparison table">
          <table className="compare__table">
            <thead>
              <tr>
                <th scope="col">Outcome</th>
                <th scope="col">Before</th>
                <th scope="col">After</th>
                <th scope="col">Residual Δ</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((d) => {
                const s = BY_ID.get(d.subcategoryId);
                return (
                  <tr key={d.subcategoryId} className={`compare__row compare__row--${d.change}`}>
                    <td>
                      <button type="button" className="linkish" onClick={() => onSelect(d.subcategoryId)}>
                        <span className={`fn fn--${s?.fn ?? 'GV'}`}>{d.subcategoryId}</span>
                      </button>
                      {s && <div className="muted small">{s.categoryName}</div>}
                    </td>
                    <td>
                      {d.before ? <span className={`status status--${d.before}`}>{d.before}</span> : <span className="muted small">not in previous report</span>}
                      {d.residualBefore !== undefined && <div className="muted small">{d.residualBefore.toFixed(2)}</div>}
                    </td>
                    <td>
                      {d.after ? <span className={`status status--${d.after}`}>{d.after}</span> : <span className="muted small">not in current evaluation</span>}
                      {d.residualAfter !== undefined && <div className="muted small">{d.residualAfter.toFixed(2)}</div>}
                    </td>
                    <td>
                      <span className={`compare__delta compare__delta--${deltaDirection(d)}`}>{formatDelta(d.residualDelta)}</span>
                    </td>
                    <td>
                      <span className={`chip compare__chip compare__chip--${d.change}`}>{d.change}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {visible.length > 0 && hiddenCount > 0 && <p className="muted small">{hiddenNote}</p>}
    </div>
  );
}
