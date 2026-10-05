import { useId, useState } from 'react';
import { POLICY_BOUNDS, canonicalPolicy, clampPolicyField, isDefaultPolicy, type NumericPolicyField, type RulePolicy } from '../engine/policy';
import './policy.css';

interface Props {
  policy: RulePolicy;
  /** Receives the full policy in canonical key order after every change; `null` means reset (remove `pack.policy`). */
  onChange: (p: RulePolicy | null) => void;
}

interface NumberField {
  key: NumericPolicyField;
  label: string;
  step: string;
  inputMode: 'decimal' | 'numeric';
  bounds: { readonly min: number; readonly max: number };
  hint: string;
}

const FIELDS: readonly NumberField[] = [
  {
    key: 'agingMultiplier',
    label: 'Aging multiplier',
    step: '0.1',
    inputMode: 'decimal',
    bounds: POLICY_BOUNDS.agingMultiplier,
    hint: 'An artifact is aging until its age exceeds validDays × this factor; after that it is stale and carries no weight.',
  },
  {
    key: 'decisionValidDays',
    label: 'Decision validity (days)',
    step: '1',
    inputMode: 'numeric',
    bounds: POLICY_BOUNDS.decisionValidDays,
    hint: 'Reviewer decisions older than this, or dated in the future, are ignored with a warning.',
  },
  {
    key: 'minOverrideRationale',
    label: 'Minimum override rationale (characters)',
    step: '1',
    inputMode: 'numeric',
    bounds: POLICY_BOUNDS.minOverrideRationale,
    hint: 'Accepting a non-sufficient outcome or scoping one out needs a rationale at least this long.',
  },
  {
    key: 'sufficientCoverage',
    label: 'Sufficient coverage',
    step: '0.1',
    inputMode: 'decimal',
    bounds: POLICY_BOUNDS.sufficientCoverage,
    hint: 'Weighted coverage an outcome needs before it can be partial or sufficient; below it the outcome is weak.',
  },
  {
    key: 'minDistinctTypes',
    label: 'Distinct evidence types for sufficient',
    step: '1',
    inputMode: 'numeric',
    bounds: POLICY_BOUNDS.minDistinctTypes,
    hint: 'Distinct supporting evidence types needed for sufficient; with fewer types the outcome stops at partial.',
  },
];

const HELP = 'Changing the policy changes every status; the policy is stored in the pack and the report.';

/** Text the user is currently typing into one number field. Shown only while it still refers to the policy value it started from. */
interface Draft {
  key: NumericPolicyField;
  text: string;
  forValue: number;
}

export function PolicyPanel({ policy, onChange }: Props) {
  const base = useId();
  const [draft, setDraft] = useState<Draft | null>(null);
  const custom = !isDefaultPolicy(policy);

  function emit(next: RulePolicy) {
    onChange(canonicalPolicy(next));
  }

  function emitNumber(key: NumericPolicyField, value: number) {
    if (value === policy[key]) return;
    const next: RulePolicy = { ...policy };
    next[key] = value;
    emit(next);
  }

  function onNumberChange(key: NumericPolicyField, text: string) {
    const typed = Number(text);
    const { min } = FIELDS.find((f) => f.key === key)!.bounds;
    if (text.trim() === '' || !Number.isFinite(typed) || typed < min) {
      // Mid-edit: empty, incomplete, or still below the minimum (e.g. the "0" of "0.5"). Show what was typed;
      // the policy keeps its current value and the field is clamped when it loses focus.
      setDraft({ key, text, forValue: policy[key] });
      return;
    }
    const clamped = clampPolicyField(key, typed);
    // When the bounds changed the number, show the clamped value immediately; otherwise keep the user's text as typed.
    setDraft(clamped === typed ? { key, text, forValue: clamped } : null);
    emitNumber(key, clamped);
  }

  function onNumberBlur(key: NumericPolicyField) {
    if (draft && draft.key === key && draft.text.trim() !== '') emitNumber(key, clampPolicyField(key, Number(draft.text)));
    setDraft(null);
  }

  function shownValue(key: NumericPolicyField): string {
    return draft && draft.key === key && draft.forValue === policy[key] ? draft.text : String(policy[key]);
  }

  return (
    <details className="policy__panel">
      <summary className="policy__summary">
        <span className="policy__title">Rule policy</span>
        {custom && (
          <>
            {' '}
            <span className="policy__badge">custom policy</span>
          </>
        )}
      </summary>
      <p className="policy__help" id={`${base}-help`}>
        {HELP}
      </p>
      <div className="policy__grid" role="group" aria-label="Rule policy thresholds" aria-describedby={`${base}-help`}>
        {FIELDS.map((f) => {
          const id = `${base}-${f.key}`;
          return (
            <div key={f.key} className="policy__field">
              <label className="policy__label" htmlFor={id}>
                {f.label}
              </label>
              <input
                className="policy__input"
                id={id}
                type="number"
                inputMode={f.inputMode}
                min={f.bounds.min}
                max={f.bounds.max}
                step={f.step}
                value={shownValue(f.key)}
                aria-describedby={`${id}-hint`}
                onChange={(e) => onNumberChange(f.key, e.target.value)}
                onBlur={() => onNumberBlur(f.key)}
              />
              <p className="policy__hint small muted" id={`${id}-hint`}>
                {f.hint} Range {f.bounds.min}–{f.bounds.max}.
              </p>
            </div>
          );
        })}
      </div>
      <div className="policy__check">
        <input
          className="policy__checkbox"
          id={`${base}-sod`}
          type="checkbox"
          checked={policy.separationOfDuties}
          aria-describedby={`${base}-sod-hint`}
          onChange={(e) => emit({ ...policy, separationOfDuties: e.target.checked })}
        />
        <label className="policy__label" htmlFor={`${base}-sod`}>
          Separation of duties
        </label>
        <p className="policy__hint small muted" id={`${base}-sod-hint`}>
          Refuse an accepted override when the reviewer also collected every current supporting artifact (needs “Collected by” on the evidence).
        </p>
      </div>
      <p className="policy__note">
        Freshness and scope weights, exposure factors and residual bands can be set in the pack JSON; the report embeds every value that was used.
      </p>
      <div className="policy__actions">
        <button
          type="button"
          className="ghost small"
          onClick={() => {
            setDraft(null);
            onChange(null);
          }}
        >
          Reset to defaults
        </button>
      </div>
    </details>
  );
}
