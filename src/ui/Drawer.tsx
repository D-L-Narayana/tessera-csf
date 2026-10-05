// Outcome drawer: derivation trace, evidence list with edit/remove, add/edit form and reviewer decision.
import { useEffect, useId, useRef, useState } from 'react';
import type { RulePolicy } from '../engine/policy';
import type { Decision, Evidence, EvidencePack, EvidenceType, Priority, Subcategory, SubcategoryResult } from '../engine/types';
import { DecisionForm } from './DecisionForm';
import { EvidenceForm } from './EvidenceForm';
import { boundaryDates, removeConfirmMessage, resolveDrawerPolicy, submitEvidenceEdit } from './drawerLogic';
import './drawer.css';

interface Props {
  sub: Subcategory;
  result: SubcategoryResult;
  pack: EvidencePack;
  /** @deprecated Pass `policy` instead; still honoured for the rationale counter when no policy is given. */
  minRationale?: number;
  evidenceTypes: readonly EvidenceType[];
  /** Rule policy whose thresholds the drawer displays; defaults to the pack's policy or the engine defaults. */
  policy?: RulePolicy;
  /** Reviewer handle to prefill when the outcome has no decision yet. */
  defaultReviewer?: string;
  onAddEvidence: (e: Evidence) => string | null;
  /** Saves an edited artifact (same id). When absent, edits cannot be saved and the form says so. */
  onUpdateEvidence?: (e: Evidence) => string | null;
  onRemoveEvidence: (id: string) => void;
  onDecision: (d: Decision | null) => void;
  onPriority: (p: Priority) => void;
  onReviewerChange?: (r: string) => void;
  onClose: () => void;
}

export function Drawer({
  sub,
  result,
  pack,
  minRationale,
  evidenceTypes,
  policy: policyProp,
  defaultReviewer,
  onAddEvidence,
  onUpdateEvidence,
  onRemoveEvidence,
  onDecision,
  onPriority,
  onReviewerChange,
  onClose,
}: Props) {
  const prioId = useId();
  const evHeadingId = useId();
  const [editingId, setEditingId] = useState<string | null>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement | null>());
  const evHeading = useRef<HTMLHeadingElement>(null);

  const policy = resolveDrawerPolicy(pack, policyProp, minRationale);
  const related = pack.evidence.filter((e) => e.subcategoryIds.includes(sub.id));
  const existing = pack.decisions.find((d) => d.subcategoryId === sub.id);
  const editing = editingId ? related.find((e) => e.id === editingId) : undefined;

  // If the artifact under edit vanishes from the pack (removed elsewhere, undo), drop back to add mode.
  useEffect(() => {
    if (editingId && !editing) setEditingId(null);
  }, [editingId, editing]);

  function stopEditing(returnFocus: boolean) {
    const id = editingId;
    setEditingId(null);
    if (returnFocus && id) editButtons.current.get(id)?.focus();
  }

  function saveEdit(e: Evidence): string | null {
    const err = submitEvidenceEdit(onUpdateEvidence, e);
    if (!err) stopEditing(true);
    return err;
  }

  function remove(id: string) {
    if (!window.confirm(removeConfirmMessage(id))) return;
    if (editingId === id) setEditingId(null);
    evHeading.current?.focus();
    onRemoveEvidence(id);
  }

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
            <label htmlFor={prioId}>Priority</label>
          </dt>
          <dd>
            <select id={prioId} value={result.priority} onChange={(e) => onPriority(Number(e.target.value) as Priority)}>
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

      <section aria-labelledby={evHeadingId}>
        <h3 id={evHeadingId} ref={evHeading} tabIndex={-1}>
          Evidence ({related.length})
        </h3>
        {related.length === 0 ? (
          <p className="empty">No evidence references this outcome yet. Add one below.</p>
        ) : (
          <ul className="evlist">
            {related.map((e) => {
              const a = result.evidence.find((x) => x.evidenceId === e.id)!;
              const bounds = boundaryDates(e.collectedOn, e.validDays, policy.agingMultiplier);
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
                    {e.collectedBy && <> · collected by {e.collectedBy}</>}
                    {e.subcategoryIds.length > 1 && <> · also {e.subcategoryIds.filter((x) => x !== sub.id).join(', ')}</>}
                  </div>
                  <div className="muted small">
                    aging on {bounds.agingOn} · stale on {bounds.staleOn}
                  </div>
                  {e.note && <div className="ev__note">{e.note}</div>}
                  <div className="btnrow">
                    <button
                      type="button"
                      className="ghost small"
                      ref={(el) => {
                        if (el) editButtons.current.set(e.id, el);
                        else editButtons.current.delete(e.id);
                      }}
                      onClick={() => setEditingId(e.id)}
                    >
                      Edit {e.id}
                    </button>
                    <button type="button" className="ghost small" onClick={() => remove(e.id)}>
                      Remove {e.id}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <EvidenceForm
          key={editing ? `edit:${editing.id}` : 'add'}
          sub={sub}
          pack={pack}
          types={evidenceTypes}
          editing={editing}
          onSubmit={editing ? saveEdit : onAddEvidence}
          onCancel={editing ? () => stopEditing(true) : undefined}
        />
      </section>

      <DecisionForm
        key={existing ? existing.verdict + existing.rationale + existing.reviewer : 'none'}
        sub={sub}
        existing={existing}
        policy={policy}
        asOf={pack.profile.asOf}
        defaultReviewer={defaultReviewer}
        pack={pack}
        onDecision={onDecision}
        onReviewerChange={onReviewerChange}
      />
    </div>
  );
}
