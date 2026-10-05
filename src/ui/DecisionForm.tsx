// Reviewer decision form with a live preview: the draft is evaluated against the current pack before it
// is recorded, so refusals (contradicted evidence, short rationale, separation of duties) are visible first.
import { useId, useState } from 'react';
import type { RulePolicy } from '../engine/policy';
import type { Decision, EvidencePack, Subcategory, Verdict } from '../engine/types';
import { addDays, previewDecision } from './drawerLogic';
import './drawer.css';

interface Props {
  sub: Subcategory;
  existing?: Decision;
  policy: RulePolicy;
  asOf: string;
  defaultReviewer?: string;
  pack: EvidencePack;
  onDecision: (d: Decision | null) => void;
  onReviewerChange?: (r: string) => void;
}

export function DecisionForm({ sub, existing, policy, asOf, defaultReviewer, pack, onDecision, onReviewerChange }: Props) {
  const base = useId();
  const fid = (name: string) => `${base}-${name}`;
  const [verdict, setVerdict] = useState<Verdict>(existing?.verdict ?? 'accepted');
  const [reviewer, setReviewer] = useState(existing?.reviewer ?? defaultReviewer ?? '');
  const [rationale, setRationale] = useState(existing?.rationale ?? '');
  const minChars = policy.minOverrideRationale;
  const needsLong = verdict === 'accepted' || verdict === 'not-applicable';
  const short = needsLong && rationale.trim().length < minChars;
  const draft: Decision = { subcategoryId: sub.id, reviewer: reviewer.trim(), verdict, rationale: rationale.trim(), decidedOn: asOf };
  const preview = previewDecision(pack, sub.id, draft);
  const lapsesOn = addDays(asOf, policy.decisionValidDays + 1);

  return (
    <form
      className="decision"
      onSubmit={(e) => {
        e.preventDefault();
        onDecision(draft);
      }}
      aria-label={`Reviewer decision for ${sub.id}`}
    >
      <h3>Reviewer decision</h3>
      <div className="grid2">
        <label htmlFor={fid('reviewer')}>
          <span>Reviewer</span>
          <input
            id={fid('reviewer')}
            required
            maxLength={80}
            value={reviewer}
            onChange={(e) => {
              setReviewer(e.target.value);
              onReviewerChange?.(e.target.value);
            }}
            placeholder="handle, e.g. r.kaur"
          />
        </label>
        <label htmlFor={fid('verdict')}>
          <span>Verdict</span>
          <select id={fid('verdict')} value={verdict} onChange={(e) => setVerdict(e.target.value as Verdict)}>
            <option value="accepted">accepted — evidence is adequate</option>
            <option value="needs-more">needs more — hold at partial</option>
            <option value="gap">gap — mark weak regardless of evidence</option>
            <option value="not-applicable">not applicable — scope out (needs rationale)</option>
          </select>
        </label>
      </div>
      <label htmlFor={fid('rationale')}>
        <span>
          Rationale{' '}
          <span className={short ? 'counter counter--short' : 'counter'}>
            {rationale.trim().length}
            {needsLong ? ` / ${minChars} min for ${verdict}` : ''}
          </span>
        </span>
        <textarea id={fid('rationale')} required maxLength={2000} rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} />
      </label>
      <p className="decision__meta small">
        This decision will be dated {asOf} and lapses on {lapsesOn}.
      </p>
      <section className="decision__preview" aria-labelledby={fid('preview')} aria-live="polite">
        <h4 id={fid('preview')}>Decision preview</h4>
        <p>
          Recording this now would make {sub.id} <span className={`status status--${preview.status}`}>{preview.status}</span>
          {preview.status !== preview.computedStatus && <span className="muted small"> (computed: {preview.computedStatus})</span>}
          <span className="muted small">
            {' '}
            · residual {preview.residual.toFixed(2)} ({preview.band})
          </span>
        </p>
        {preview.warnings.length > 0 ? (
          <ul className="decision__refusals">
            {preview.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : (
          <p className="decision__ok small">No refusals: the decision would apply as entered.</p>
        )}
      </section>
      <p className="muted small">
        Accepting a non-sufficient outcome, or scoping it out, is an override: it is recorded as such, needs at least {minChars} characters, and is refused while evidence is contradicted or refuted.
        {policy.separationOfDuties && <> With separation of duties on, such an override is also refused when the reviewer collected all of the current supporting evidence.</>} Accepting an outcome with no current evidence records <em>accepted-risk</em>, which stays in the gap register. Decisions expire after {policy.decisionValidDays} days.
      </p>
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
