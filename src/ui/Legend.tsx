const FUNCTIONS: [string, string][] = [
  ['GV', 'Govern'],
  ['ID', 'Identify'],
  ['PR', 'Protect'],
  ['DE', 'Detect'],
  ['RS', 'Respond'],
  ['RC', 'Recover'],
];

export function Legend() {
  const items: [string, string][] = [
    ['sufficient', 'Sufficient: coverage ≥ 1.0 from two or more evidence types'],
    ['partial', 'Partial: enough weight but a single evidence type'],
    ['weak', 'Weak: some current evidence, coverage below 1.0'],
    ['none', 'None: no current evidence (may have stale artifacts)'],
    ['contradicted', 'Contradicted: current evidence both supports and refutes'],
    ['refuted', 'Refuted: only refuting evidence'],
    ['accepted-risk', 'Accepted risk: reviewer accepted with no current evidence — stays a gap'],
    ['not-applicable', 'Not applicable (reviewer decision)'],
  ];
  return (
    <div className="legend-block">
      <dl className="legend" aria-label="Status pattern legend">
        {items.map(([k, label]) => (
          <div key={k} className="legend__item">
            <dt>
              <span className={`tile tile--legend pat--${k}`} aria-hidden="true" />
            </dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
      <p id="legend-fn-h" className="legend__heading">Function colours</p>
      <dl className="legend legend--functions" aria-labelledby="legend-fn-h">
        {FUNCTIONS.map(([fn, name]) => (
          <div key={fn} className="legend__item">
            <dt>
              <span className={`legend__swatch fn--${fn}`} aria-hidden="true" />
              <span className={`fn fn--${fn}`}>{fn}</span>
            </dt>
            <dd>{name}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
