// Evidence form for the outcome drawer: adds a new artifact or edits an existing one (id preserved).
// Validation runs on the hypothetical pack before the host handler is called, so errors are path-addressed.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CATALOG } from '../engine/catalog';
import type { Evidence, EvidencePack, EvidenceType, Subcategory } from '../engine/types';
import { buildEvidenceDraft, evidenceDraftIssues, nextEvidenceId } from './drawerLogic';
import './drawer.css';

interface Props {
  sub: Subcategory;
  pack: EvidencePack;
  types: readonly EvidenceType[];
  /** When set, the form edits this artifact instead of adding a new one. */
  editing?: Evidence;
  /** Returns an error message to show, or null on success. */
  onSubmit: (e: Evidence) => string | null;
  onCancel?: () => void;
}

export function EvidenceForm({ sub, pack, types, editing, onSubmit, onCancel }: Props) {
  const base = useId();
  const fid = (name: string) => `${base}-${name}`;
  const [title, setTitle] = useState(editing?.title ?? '');
  const [source, setSource] = useState(editing?.source ?? 'grc.example');
  const [collectedBy, setCollectedBy] = useState(editing?.collectedBy ?? '');
  const [type, setType] = useState<EvidenceType>(editing?.type ?? types[0] ?? 'policy');
  const [collectedOn, setCollectedOn] = useState(editing?.collectedOn ?? pack.profile.asOf);
  const [validDays, setValidDays] = useState(String(editing?.validDays ?? 90));
  const [scope, setScope] = useState<Evidence['scope']>(editing?.scope ?? 'full');
  const [assertion, setAssertion] = useState<Evidence['assertion']>(editing?.assertion ?? 'supports');
  const [note, setNote] = useState(editing?.note ?? '');
  const [also, setAlso] = useState<string[]>(editing ? editing.subcategoryIds.filter((x) => x !== sub.id) : []);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Focus the first field when an edit starts (effects never run in static server rendering).
  const editingKey = editing?.id;
  useEffect(() => {
    if (editingKey) titleRef.current?.focus();
  }, [editingKey]);

  const evidenceId = editing ? editing.id : nextEvidenceId(pack.evidence.map((e) => e.id));
  const others = CATALOG.filter((s) => s.id !== sub.id);

  function toggle(id: string) {
    setAlso((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const draft = buildEvidenceDraft({
      id: evidenceId,
      subcategoryId: sub.id,
      alsoApplies: also,
      title,
      source,
      collectedBy,
      type,
      collectedOn,
      validDays: Number(validDays),
      scope,
      assertion,
      note,
    });
    const err = evidenceDraftIssues(draft, pack, editing?.id) ?? onSubmit(draft);
    setError(err);
    if (!err && !editing) {
      setTitle('');
      setNote('');
      setAlso([]);
    }
  }

  return (
    <form className="addform" onSubmit={submit} aria-labelledby={fid('heading')}>
      <h4 id={fid('heading')}>{editing ? `Edit evidence ${editing.id}` : `Add evidence for ${sub.id}`}</h4>
      <p className="evform__id">
        Id: {evidenceId}
        <span className="muted small"> {editing ? '· the id stays the same when you save' : '· assigned automatically; ids are never reused'}</span>
      </p>
      <div className="grid2">
        <label htmlFor={fid('title')}>
          <span>Title</span>
          <input id={fid('title')} ref={titleRef} required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Access review export Q3" />
        </label>
        <label htmlFor={fid('source')}>
          <span>Source system</span>
          <input id={fid('source')} required maxLength={160} value={source} onChange={(e) => setSource(e.target.value)} />
        </label>
        <label htmlFor={fid('collectedBy')}>
          <span>
            Collected by <span className="muted">(optional)</span>
          </span>
          <input id={fid('collectedBy')} maxLength={80} value={collectedBy} onChange={(e) => setCollectedBy(e.target.value)} placeholder="handle, e.g. m.okafor" />
        </label>
        <label htmlFor={fid('type')}>
          <span>Type</span>
          <select id={fid('type')} value={type} onChange={(e) => setType(e.target.value as EvidenceType)}>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={fid('collectedOn')}>
          <span>Collected on</span>
          <input id={fid('collectedOn')} type="date" required value={collectedOn} onChange={(e) => setCollectedOn(e.target.value)} />
        </label>
        <label htmlFor={fid('validDays')}>
          <span>Valid for (days)</span>
          <input id={fid('validDays')} type="number" min={1} max={3650} step={1} required value={validDays} onChange={(e) => setValidDays(e.target.value)} />
        </label>
        <label htmlFor={fid('scope')}>
          <span>Scope</span>
          <select id={fid('scope')} value={scope} onChange={(e) => setScope(e.target.value as Evidence['scope'])}>
            <option value="full">full</option>
            <option value="partial">partial</option>
          </select>
        </label>
        <label htmlFor={fid('assertion')}>
          <span>Assertion</span>
          <select id={fid('assertion')} value={assertion} onChange={(e) => setAssertion(e.target.value as Evidence['assertion'])}>
            <option value="supports">supports the outcome</option>
            <option value="refutes">refutes the outcome</option>
          </select>
        </label>
      </div>
      <label htmlFor={fid('note')}>
        <span>
          Note <span className="muted">(optional, up to 2000 characters)</span>
        </span>
        <textarea id={fid('note')} maxLength={2000} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <fieldset className="evform__also">
        <legend>Also applies to</legend>
        <p className="muted small evform__hint">
          This artifact always references {sub.id}. Tick any other outcome it also evidences (an artifact can reference every outcome in the subset, 25 at most).
        </p>
        <div className="evform__options">
          {others.map((s) => (
            <label key={s.id} className="evform__option" htmlFor={fid(s.id)}>
              <input id={fid(s.id)} type="checkbox" value={s.id} checked={also.includes(s.id)} onChange={() => toggle(s.id)} />
              <span>
                <span className="evform__code">{s.id}</span> <span className="evform__cat">{s.categoryName}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="btnrow">
        <button type="submit">{editing ? 'Save changes' : 'Add evidence'}</button>
        {editing && (
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel edit
          </button>
        )}
      </div>
    </form>
  );
}
