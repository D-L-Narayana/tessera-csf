// Horizon panel: evidence crossing a freshness boundary, decisions lapsing and outcomes projected to change within a
// chosen number of days after the evaluation date. Pure rendering over forecast(); the only local state is the horizon.
import { useId, useMemo, useState } from 'react';
import { CATALOG } from '../engine/catalog';
import { DEFAULT_HORIZON_DAYS, HORIZONS, forecast, type HorizonDays } from '../engine/forecast';
import type { EvidencePack } from '../engine/types';
import './horizon.css';

interface Props {
  pack: EvidencePack;
  onSelect: (id: string) => void;
}

const FN_BY_ID = new Map(CATALOG.map((s) => [s.id, s.fn] as const));

function OutcomeId({ id }: { id: string }) {
  const fn = FN_BY_ID.get(id);
  return <span className={fn ? `fn fn--${fn}` : 'fn'}>{id}</span>;
}

const inDays = (n: number): string => `in ${n} d`;

export function Horizon({ pack, onSelect }: Props) {
  const [days, setDays] = useState<HorizonDays>(DEFAULT_HORIZON_DAYS);
  const headingId = useId();
  const selectId = useId();
  const evidenceHeadId = useId();
  const decisionsHeadId = useId();
  const outcomesHeadId = useId();
  const fc = useMemo(() => forecast(pack, days), [pack, days]);
  const totalEvidence = pack.evidence.length;
  const totalOutcomes = CATALOG.length;
  const nEvidence = fc.evidence.length;
  const nDecisions = fc.decisions.length;
  const nOutcomes = fc.outcomes.length;

  return (
    <section className="horizon__panel" aria-labelledby={headingId}>
      <div className="pane-head horizon__head">
        <div>
          <h2 id={headingId}>Horizon</h2>
          <p className="pane-help">
            What stops being evidenced between {fc.asOf} and {fc.horizonDate}: artifacts crossing a freshness boundary, reviewer decisions lapsing, and the outcomes that would change as a result. Select a row to open the outcome.
          </p>
        </div>
        <div className="horizon__controls">
          <label htmlFor={selectId}>Horizon (days)</label>
          <select
            id={selectId}
            value={days}
            onChange={(e) => {
              const v = Number(e.target.value);
              const next = HORIZONS.find((h) => h === v);
              if (next) setDays(next);
            }}
          >
            {HORIZONS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="horizon__grid">
        <div className="horizon__group" role="group" aria-labelledby={evidenceHeadId}>
          <div className="horizon__group-head">
            <h3 id={evidenceHeadId}>Evidence expiring</h3>
            <span className="chip horizon__count" aria-hidden="true">{nEvidence}</span>
          </div>
          {nEvidence === 0 ? (
            <p className="empty">Nothing crosses a freshness boundary within {days} days.</p>
          ) : (
            <>
              <p className="muted small">
                {nEvidence} of {totalEvidence} artifacts {nEvidence === 1 ? 'crosses' : 'cross'} a freshness boundary by {fc.horizonDate}.
              </p>
              <ul className="horizon__list">
                {fc.evidence.map((e) => {
                  const [target, ...others] = e.subcategoryIds;
                  return (
                    <li key={e.evidenceId} className="horizon__row">
                      <button type="button" className="linkish horizon__link" onClick={() => onSelect(target)}>
                        <span className="horizon__id">{e.evidenceId}</span> <span className="horizon__title">{e.title}</span> for <OutcomeId id={target} />
                      </button>
                      <div className="horizon__meta">
                        <span className={`chip chip--${e.freshness}`}>{e.freshness}</span>
                        <span className="chip">{e.type}</span>
                        {e.agingOn !== null && e.daysToAging !== null && (
                          <span>
                            aging on {e.agingOn} ({inDays(e.daysToAging)})
                          </span>
                        )}
                        {e.staleOn !== null && e.daysToStale !== null && (
                          <span>
                            stale on {e.staleOn} ({inDays(e.daysToStale)})
                          </span>
                        )}
                        {others.length > 0 && <span>also {others.join(', ')}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <div className="horizon__group" role="group" aria-labelledby={decisionsHeadId}>
          <div className="horizon__group-head">
            <h3 id={decisionsHeadId}>Decisions lapsing</h3>
            <span className="chip horizon__count" aria-hidden="true">{nDecisions}</span>
          </div>
          {nDecisions === 0 ? (
            <p className="empty">No applied decision lapses within {days} days.</p>
          ) : (
            <>
              <p className="muted small">
                {nDecisions} applied {nDecisions === 1 ? 'decision lapses' : 'decisions lapse'} by {fc.horizonDate}; each needs a re-review before then.
              </p>
              <ul className="horizon__list">
                {fc.decisions.map((d) => (
                  <li key={d.subcategoryId} className="horizon__row">
                    <button type="button" className="linkish horizon__link" onClick={() => onSelect(d.subcategoryId)}>
                      <OutcomeId id={d.subcategoryId} /> {d.verdict} by {d.reviewer}
                    </button>
                    <div className="horizon__meta">
                      <span>decided {d.decidedOn}</span>
                      <span>
                        lapses on {d.lapsesOn} ({inDays(d.daysToLapse)})
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="horizon__group" role="group" aria-labelledby={outcomesHeadId}>
          <div className="horizon__group-head">
            <h3 id={outcomesHeadId}>Outcomes projected to change</h3>
            <span className="chip horizon__count" aria-hidden="true">{nOutcomes}</span>
          </div>
          {nOutcomes === 0 ? (
            <p className="empty">No outcome is projected to change within {days} days.</p>
          ) : (
            <>
              <p className="muted small">
                {nOutcomes} of {totalOutcomes} outcomes {nOutcomes === 1 ? 'changes' : 'change'} status or residual by {fc.horizonDate}.
              </p>
              <ul className="horizon__list">
                {fc.outcomes.map((o) => (
                  <li key={o.subcategoryId} className="horizon__row">
                    <button type="button" className="linkish horizon__link" onClick={() => onSelect(o.subcategoryId)}>
                      <OutcomeId id={o.subcategoryId} /> {o.statusNow} → {o.statusAtHorizon}
                    </button>
                    <div className="horizon__meta">
                      <span className={`chip horizon__change horizon__change--${o.change}`}>{o.change}</span>
                      <span>
                        residual {o.residualNow.toFixed(2)} → {o.residualAtHorizon.toFixed(2)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      <p className="muted small horizon__note">
        Projections assume no new evidence is added and no decision is changed. Boundary dates follow the freshness heuristic of this educational prototype; they are not compliance deadlines.
      </p>
    </section>
  );
}
