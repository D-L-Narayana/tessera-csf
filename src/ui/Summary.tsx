import { useId } from 'react';
import type { Report } from '../engine/types';
import { functionSummary, overrideSummary, statusDistribution } from './registerLogic';
import './register.css';

interface Props {
  report: Report;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** SVG attribute numbers: at most three decimals, no trailing zeros ("0", "24", "33.333"). */
const num = (v: number) => String(Math.round(v * 1000) / 1000);

/** Executive summary computed from the report: status distribution, per-function lines, overrides and gap count. */
export function Summary({ report }: Props) {
  const headingId = useId();
  const total = report.results.length;
  const distribution = statusDistribution(report.results);
  const segments: { status: string; x: number; width: number }[] = [];
  let x = 0;
  for (const d of distribution) {
    if (d.count === 0 || total === 0) continue;
    const width = (d.count / total) * 100;
    segments.push({ status: d.status, x, width });
    x += width;
  }
  const chartLabel = `Status distribution: ${distribution.map((d) => `${d.count} ${d.status}`).join(', ')}`;
  const functions = functionSummary(report);
  const overrides = overrideSummary(report);

  return (
    <section className="summary" aria-labelledby={headingId}>
      <div className="summary__head">
        <h2 id={headingId}>Summary</h2>
        <p className="summary__meta">{`${report.generatedFor} · as of ${report.asOf} · ${report.subset} · ${report.policyIsDefault ? 'default rule policy' : 'custom rule policy'}`}</p>
      </div>

      <div className="summary__grid">
        <div className="summary__block">
          <h3>Status distribution</h3>
          <svg className="summary__chart" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label={chartLabel}>
            {segments.map((s) => (
              <rect key={s.status} x={num(s.x)} y={0} width={num(s.width)} height={8} className={`summary__bar summary__bar--${s.status}`} />
            ))}
          </svg>
          <ul className="summary__statuses">
            {distribution.map((d) => (
              <li key={d.status}>
                <span className={`summary__swatch summary__swatch--${d.status}`} aria-hidden="true" />
                {`${d.count} ${d.status}`}
              </li>
            ))}
          </ul>
        </div>

        <div className="summary__block">
          <h3>By function</h3>
          <ul className="summary__functions">
            {functions.map((f) => (
              <li key={f.fn}>
                <span className={`fn fn--${f.fn}`}>{f.fn}</span>
                {` ${f.functionName} — ${f.sufficient}/${f.count} sufficient · ${plural(f.gaps, 'gap')} · ${plural(f.warnings, 'warning')} · `}
                <span className={`band band--${f.band}`}>{f.band === 'not-assessed' ? 'not assessed' : f.band}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="summary__line">{`Overrides: ${overrides.valid} valid, ${overrides.invalid} invalid · ${plural(overrides.refusedActions, 'refused reviewer action')}`}</p>
      <p className="summary__line">{`${report.gaps.length} of ${total} outcomes are in the gap register.`}</p>
      <p className="small muted">{report.disclaimer}</p>
    </section>
  );
}
