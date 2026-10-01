import { useState } from 'react';
import type { Decision, Evidence, EvidencePack, EvidenceType, Priority, Subcategory, SubcategoryResult, Verdict } from '../engine/types';

interface Props {
  sub: Subcategory;
  result: SubcategoryResult;
  pack: EvidencePack;
  minRationale: number;
  evidenceTypes: readonly EvidenceType[];
  onAddEvidence: (e: Evidence) => string | null;
  onRemoveEvidence: (id: string) => void;
  onDecision: (d: Decision | null) => void;
  onPriority: (p: Priority) => void;
  onClose: () => void;
}

export function Drawer({ sub, result, pack, minRationale, evidenceTypes, onAddEvidence, onRemoveEvidence, onDecision, onPriority, onClose }: Props) {
  const related = pack.evidence.filter((e) => e.subcategoryIds.includes(sub.id));
  const existing = pack.decisions.find((d) => d.subcategoryId === sub.id);

  return (
    <div className="drawer">
      <div className="drawer__top">
        <div>
          <p className="eyebrow">
            <span className={`fn fn--${sub.fn}`}>{sub.functionName}</span> · {sub.categoryName} ({sub.category})
          </p>
          <h2 className="drawer__id">{sub.id}</h2>
          <p className="drawer__statement">{sub.statement}</p>
        </div>
        <button type="button" className="ghost" onClick={onClose} aria-label="Close outcome details">
          Close
        </button>
      </div>

      <dl className="facts">
        <div>
          <dt>Status</dt>
          <dd>
            <span className={`status status--${result.status}`}>{result.status}</span>
            {result.computedStatus !== result.status && <span className="muted small"> (computed: {result.computedStatus})</span>}
          </dd>
        </div>
        <div>
          <dt>Coverage</dt>
          <dd>
            {result.coverage.toFixed(2)} from {result.distinctTypes} type{result.distinctTypes === 1 ? '' : 's'}
          </dd>
        </div>
        <div>
          <dt>Residual</dt>
          <dd>
            <span className={`band band--${result.band}`}>{result.residual.toFixed(2)}</span> <span className="muted small">{result.band}</span>
          </dd>
        </div>
        <div>
          <dt>
            <label htmlFor="prio">Priority</label>
          </dt>
          <dd>
            <select id="prio" value={result.priority} onChange={(e) => onPriority(Number(e.target.value) as Priority)}>
              <option value={1}>1 — low</option>
              <option value={2}>2 — standard</option>
              <option value={3}>3 — critical outcome</option>
            </select>
          </dd>
        </div>
      </dl>

      {result.warnings.length > 0 && (
        <div className="warnbox" role="alert">
          <strong>Reviewer action refused:</strong>
          <ul>
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {result.remediation && (
        <p className="remediation">
          <strong>Remediation.</strong> {result.remediation}
        </p>
      )}

      <details className="trace" open>
        <summary>How this status was derived ({result.reasons.length} steps)</summary>
        <ol>
          {result.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ol>
      </details>

      <section aria-labelledby="ev-h">
        <h3 id="ev-h">Evidence ({related.length})</h3>
        {related.length === 0 ? (
          <p className="empty">No evidence references this outcome yet. Add one below.</p>
        ) : (
          <ul className="evlist">
            {related.map((e) => {
              const a = result.evidence.find((x) => x.evidenceId === e.id)!;
              return (
                <li key={e.id} className={`ev ev--${a.freshness} ev--${e.assertion}`}>
                  <div className="ev__head">
                    <span className="ev__id">{e.id}</span>
                    <span className={`chip chip--${a.freshness}`}>{a.freshness}</span>
                    <span className={`chip chip--${e.assertion}`}>{e.assertion}</span>
                    <span className="chip">{e.type}</span>
                    <span className="chip">{e.scope}</span>
                    <span className="chip">weight {a.weight}</span>
                  </div>
                  <div className="ev__title">{e.title}</div>
                  <div className="muted small">
                    {e.source} · collected {e.collectedOn} · valid {e.validDays} d · age {a.ageDays} d
                    {e.subcategoryIds.length > 1 && <> · also {e.subcategoryIds.filter((x) => x !== sub.id).join(', ')}</>}
                  </div>
                  {e.note && <div className="ev__note">{e.note}</div>}
                  <button type="button" className="ghost small" onClick={() => onRemoveEvidence(e.id)}>
                    Remove {e.id}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <AddEvidence sub={sub} asOf={pack.profile.asOf} types={evidenceTypes} onAdd={onAddEvidence} nextIndex={pack.evidence.length + 1} />
      </section>

      <DecisionForm key={existing ? existing.verdict + existing.rationale : 'none'} sub={sub} existing={existing} minRationale={minRationale} asOf={pack.profile.asOf} onDecision={onDecision} />
    </div>
  );
}

function AddEvidence({ sub, asOf, types, onAdd, nextIndex }: { sub: Subcategory; asOf: string; types: readonly EvidenceType[]; onAdd: (e: Evidence) => string | null; nextIndex: number }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<EvidenceType>('policy');
  const [collectedOn, setCollectedOn] = useState(asOf);
  const [validDays, setValidDays] = useState(90);
  const [scope, setScope] = useState<'full' | 'partial'>('full');
  const [assertion, setAssertion] = useState<'supports' | 'refutes'>('supports');
  const [source, setSource] = useState('grc.example');
  const [error, setError] = useState<string | null>(null);

  function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const id = `EV-${String(nextIndex).padStart(3, '0')}`;
    const err = onAdd({ id, title: title.trim(), type, subcategoryIds: [sub.id], collectedOn, validDays, scope, assertion, source: source.trim() });
    setError(err);
    if (!err) setTitle('');
  }

  return (
    <form className="addform" onSubmit={submit} aria-label={`Add evidence for ${sub.id}`}>
      <h4>Add evidence for {sub.id}</h4>
      <div className="grid2">
        <label>
          <span>Title</span>
          <input required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Access review export Q3" />
        </label>
        <label>
          <span>Source system</span>
          <input required maxLength={160} value={source} onChange={(e) => setSource(e.target.value)} />
        </label>
        <label>
          <span>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as EvidenceType)}>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Collected on</span>
          <input type="date" required value={collectedOn} onChange={(e) => setCollectedOn(e.target.value)} />
        </label>
        <label>
          <span>Valid for (days)</span>
          <input type="number" min={1} max={3650} required value={validDays} onChange={(e) => setValidDays(Number(e.target.value))} />
        </label>
        <label>
          <span>Scope</span>
          <select value={scope} onChange={(e) => setScope(e.target.value as 'full' | 'partial')}>
            <option value="full">full</option>
            <option value="partial">partial</option>
          </select>
        </label>
        <label>
          <span>Assertion</span>
          <select value={assertion} onChange={(e) => setAssertion(e.target.value as 'supports' | 'refutes')}>
            <option value="supports">supports the outcome</option>
            <option value="refutes">refutes the outcome</option>
          </select>
        </label>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit">Add evidence</button>
    </form>
  );
}

function DecisionForm({ sub, existing, minRationale, asOf, onDecision }: { sub: Subcategory; existing?: Decision; minRationale: number; asOf: string; onDecision: (d: Decision | null) => void }) {
  const [verdict, setVerdict] = useState<Verdict>(existing?.verdict ?? 'accepted');
  const [reviewer, setReviewer] = useState(existing?.reviewer ?? '');
  const [rationale, setRationale] = useState(existing?.rationale ?? '');
  const needsLong = verdict === 'accepted' || verdict === 'not-applicable';
  const short = needsLong && rationale.trim().length < minRationale;

  return (
    <form
      className="decision"
      onSubmit={(e) => {
        e.preventDefault();
        onDecision({ subcategoryId: sub.id, reviewer: reviewer.trim(), verdict, rationale: rationale.trim(), decidedOn: asOf });
      }}
      aria-label={`Reviewer decision for ${sub.id}`}
    >
      <h3>Reviewer decision</h3>
      <div className="grid2">
        <label>
          <span>Reviewer</span>
          <input required maxLength={80} value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="handle, e.g. r.kaur" />
        </label>
        <label>
          <span>Verdict</span>
          <select value={verdict} onChange={(e) => setVerdict(e.target.value as Verdict)}>
            <option value="accepted">accepted — evidence is adequate</option>
            <option value="needs-more">needs more — hold at partial</option>
            <option value="gap">gap — mark weak regardless of evidence</option>
            <option value="not-applicable">not applicable — scope out (needs rationale)</option>
          </select>
        </label>
      </div>
      <label>
        <span>
          Rationale{' '}
          <span className={short ? 'counter counter--short' : 'counter'}>
            {rationale.trim().length}
            {needsLong ? ` / ${minRationale} min for ${verdict}` : ''}
          </span>
        </span>
        <textarea required maxLength={2000} rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} />
      </label>
      <p className="muted small">Accepting a non-sufficient outcome, or scoping it out, is an override: it is recorded as such, needs at least {minRationale} characters, and is refused while evidence is contradicted or refuted. Accepting an outcome with no current evidence records <em>accepted-risk</em>, which stays in the gap register. Decisions expire after 365 days.</p>
      <div className="btnrow">
        <button type="submit">Record decision</button>
        {existing && (
          <button type="button" className="ghost" onClick={() => onDecision(null)}>
            Clear decision
          </button>
        )}
      </div>
    </form>
  );
}
