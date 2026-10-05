import { useId, useState } from 'react';
import { CATALOG } from '../engine/catalog';
import type { CsfFunction, Report, RiskBand, Status } from '../engine/types';
import { BANDS, DEFAULT_SORT, EMPTY_FILTER, FUNCTIONS, STATUSES, baseRows, filterRows, isFilterActive, nextSort, sortRows } from './registerLogic';
import type { RegisterFilter, SortKey, SortState } from './registerLogic';
import './register.css';

interface Props {
  report: Report;
  selected: string | null;
  onSelect: (id: string) => void;
}

export interface GapRegisterViewProps extends Props {
  filter: RegisterFilter;
  sort: SortState;
  onFilterChange: (f: RegisterFilter) => void;
  onSortChange: (s: SortState) => void;
}

const FUNCTION_NAMES: Record<CsfFunction, string> = Object.fromEntries(
  FUNCTIONS.map((fn) => [fn, CATALOG.find((s) => s.fn === fn)?.functionName ?? fn]),
) as Record<CsfFunction, string>;

const NO_GAPS = 'Every outcome in the subset is sufficient or not applicable. Export the report to keep the trace.';
const NO_MATCH = 'No outcomes match the current filters.';

/** Stateful register: owns the filter and sort state and renders the presentational view. */
export function GapRegister({ report, selected, onSelect }: Props) {
  const [filter, setFilter] = useState<RegisterFilter>(EMPTY_FILTER);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  return <GapRegisterView report={report} selected={selected} onSelect={onSelect} filter={filter} sort={sort} onFilterChange={setFilter} onSortChange={setSort} />;
}

/** Presentational register: every control reflects the given filter/sort and reports changes upwards. */
export function GapRegisterView({ report, selected, onSelect, filter, sort, onFilterChange, onSortChange }: GapRegisterViewProps) {
  const uid = useId();
  const ids = { fn: `${uid}-fn`, status: `${uid}-status`, band: `${uid}-band`, query: `${uid}-query`, closed: `${uid}-closed` };
  const includeClosed = filter.includeClosed === true;
  const base = baseRows(report, includeClosed);
  const rows = sortRows(filterRows(report, filter), sort.key, sort.dir);
  const active = isFilterActive(filter);
  const sortLabel = { id: 'outcome id', status: 'status', residual: 'residual exposure', priority: 'priority' }[sort.key];

  const patch = (p: Partial<RegisterFilter>) => onFilterChange({ ...filter, ...p });
  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' => (sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  const sortHeader = (key: SortKey, label: string) => {
    const state = ariaSort(key);
    return (
      <th scope="col" aria-sort={state}>
        <button type="button" className="register__sort" onClick={() => onSortChange(nextSort(sort, key))}>
          {label}
          <span className="register__sort-icon" aria-hidden="true">{state === 'ascending' ? '▲' : state === 'descending' ? '▼' : '↕'}</span>
        </button>
      </th>
    );
  };

  return (
    <section className="gaps" aria-labelledby="gaps-h">
      <div className="pane-head">
        <h2 id="gaps-h">Gap register</h2>
        <p className="pane-help">{`${report.gaps.length} of ${report.results.length} outcomes are not sufficiently evidenced, ranked by residual exposure (priority × status exposure).`}</p>
      </div>

      <form className="register__filters" role="search" aria-label="Filter gap register" onSubmit={(e) => e.preventDefault()}>
        <div className="register__field">
          <label htmlFor={ids.fn}>Function</label>
          <select id={ids.fn} value={filter.fn ?? ''} onChange={(e) => patch({ fn: (e.target.value || undefined) as CsfFunction | undefined })}>
            <option value="">All</option>
            {FUNCTIONS.map((fn) => (
              <option key={fn} value={fn}>{`${fn} — ${FUNCTION_NAMES[fn]}`}</option>
            ))}
          </select>
        </div>
        <div className="register__field">
          <label htmlFor={ids.status}>Status</label>
          <select id={ids.status} value={filter.status ?? ''} onChange={(e) => patch({ status: (e.target.value || undefined) as Status | undefined })}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="register__field">
          <label htmlFor={ids.band}>Band</label>
          <select id={ids.band} value={filter.band ?? ''} onChange={(e) => patch({ band: (e.target.value || undefined) as RiskBand | undefined })}>
            <option value="">All</option>
            {BANDS.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>
        <div className="register__field register__field--search">
          <label htmlFor={ids.query}>Search</label>
          <input id={ids.query} type="search" value={filter.query ?? ''} maxLength={160} placeholder="id, category, status or remediation" onChange={(e) => patch({ query: e.target.value })} />
        </div>
        <div className="register__check">
          <input id={ids.closed} type="checkbox" checked={includeClosed} onChange={(e) => patch({ includeClosed: e.target.checked })} />
          <label htmlFor={ids.closed}>Include sufficient and not-applicable outcomes</label>
        </div>
        <div className="register__actions">
          <p className="register__count" role="status">{`Showing ${rows.length} of ${base.length} outcomes.`}</p>
          {active && (
            <button type="button" className="ghost small" onClick={() => onFilterChange(EMPTY_FILTER)}>Clear filters</button>
          )}
        </div>
      </form>

      {base.length === 0 ? (
        <p className="empty">{NO_GAPS}</p>
      ) : rows.length === 0 ? (
        <p className="empty">{NO_MATCH}</p>
      ) : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Gap register table">
          <table className="register__table">
            <caption className="register__sr">{`Gap register: ${rows.length} outcomes sorted by ${sortLabel}, ${sort.dir === 'asc' ? 'ascending' : 'descending'}.`}</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                {sortHeader('id', 'Outcome')}
                {sortHeader('status', 'Status')}
                {sortHeader('residual', 'Residual')}
                <th scope="col">Remediation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g, i) => {
                const s = CATALOG.find((c) => c.id === g.subcategoryId)!;
                return (
                  <tr key={g.subcategoryId} className={g.subcategoryId === selected ? 'is-selected' : undefined}>
                    <td data-label="#">{i + 1}</td>
                    <td data-label="Outcome">
                      <button type="button" className="linkish" onClick={() => onSelect(g.subcategoryId)}>
                        <span className={`fn fn--${s.fn}`}>{s.id}</span>
                      </button>
                      <div className="muted small">{s.categoryName}</div>
                    </td>
                    <td data-label="Status">
                      <span className={`status status--${g.status}`}>{g.status}</span>
                      {g.override && <span className="small muted"> {g.overrideValid ? 'override' : 'invalid override'}</span>}
                    </td>
                    <td data-label="Residual">
                      <span className={`band band--${g.band}`}>{g.residual.toFixed(2)}</span>
                      <div className="muted small">priority {g.priority}</div>
                    </td>
                    <td data-label="Remediation" className="remed">{g.remediation}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
