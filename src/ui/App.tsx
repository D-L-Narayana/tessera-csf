import { useEffect, useMemo, useRef, useState } from 'react';
import { CATALOG, CSF_VERSION, SUBSET_LABEL } from '../engine/catalog';
import { buildReport } from '../engine/evaluate';
import { effectivePolicy, type RulePolicy } from '../engine/policy';
import { MAX_PACK_BYTES, validatePack, validatePackObject } from '../engine/validate';
import type { Decision, Evidence, EvidencePack, Priority, SubcategoryResult } from '../engine/types';
import { EVIDENCE_TYPES } from '../engine/types';
import demoPack from '../fixtures/harbourline-pack.json';
import { readTextFile } from './files';
import { Mosaic } from './Mosaic';
import { Drawer } from './Drawer';
import { GapRegister } from './GapRegister';
import { Legend } from './Legend';
import { Summary } from './Summary';
import { Horizon } from './Horizon';
import { Compare } from './Compare';
import { PolicyPanel } from './PolicyPanel';
import { ExportMenu } from './ExportMenu';
import { SessionBar } from './SessionBar';
import { canRedo, canUndo, createHistory, push, redo, undo, type History } from './history';
import { fingerprint, isDirty } from './dirty';
import { detectStorage, loadSession, type KeyValueStore } from './storage';
import { useBeforeUnload, usePersistedSession } from './useSession';
import './app.css';

export type Notice = { kind: 'info' | 'error' | 'success'; text: string; details?: string[] } | null;

function emptyPack(): EvidencePack {
  return {
    schema: 'tessera.pack/1',
    profile: { name: 'Untitled profile', asOf: new Date().toISOString().slice(0, 10), priorities: {} },
    evidence: [],
    decisions: [],
  };
}

function loadDemo(): EvidencePack {
  const r = validatePackObject(demoPack);
  if (!r.ok) throw new Error('Bundled demo pack failed validation: ' + r.issues.map((i) => i.path + ' ' + i.message).join('; '));
  return r.pack;
}

/** Deep link `#/PR.DS-11`. Safe during render in environments without `location` (server rendering in tests). */
function readHash(): string | null {
  if (typeof location === 'undefined') return null;
  const m = /^#\/([A-Z]{2}\.[A-Z]{2}-\d{2})$/.exec(location.hash);
  return m && CATALOG.some((s) => s.id === m[1]) ? m[1] : null;
}

const DISCARD_PROMPT = 'You have changes that are not exported or saved in this browser. Replace the current session? Undo can still bring it back.';

export default function App() {
  const [hist, setHist] = useState<History<EvidencePack>>(() => createHistory(loadDemo()));
  const pack = hist.present;
  const [selected, setSelected] = useState<string | null>(() => readHash() ?? 'PR.DS-11');
  const [notice, setNotice] = useState<Notice>({ kind: 'info', text: 'Loaded the bundled synthetic demo pack (Harbourline Logistics). Nothing here is real evidence.' });
  const [exportedFp, setExportedFp] = useState<string | null>(() => fingerprint(hist.present));
  const [reviewer, setReviewer] = useState('');
  const [store, setStore] = useState<KeyValueStore | null>(null);
  const [persistEnabled, setPersistEnabled] = useState(false);
  const [storedSession, setStoredSession] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const report = useMemo(() => buildReport(pack), [pack]);
  const byId = useMemo(() => new Map(report.results.map((r) => [r.subcategoryId, r])), [report]);
  const policy = effectivePolicy(pack);
  const dirty = isDirty(pack, exportedFp);

  // Storage is probed once, in an effect (never during render). A saved session is restored only when the user kept
  // one; a stored copy that fails validation is reported and left for "Forget saved session" to delete.
  useEffect(() => {
    const s = detectStorage();
    setStore(s);
    if (!s) return;
    const r = loadSession(s);
    if (r.ok) {
      setHist(createHistory(r.session.pack));
      setExportedFp(null); // the restored copy exists only in this browser: it counts as not exported
      setPersistEnabled(true);
      setStoredSession(true);
      if (!readHash() && r.session.selected) setSelected(r.session.selected);
      setNotice({ kind: 'info', text: `Restored the session saved in this browser (${r.session.savedAt.slice(0, 16).replace('T', ' ')} UTC). Use "Forget saved session" to delete it.` });
    } else if (r.reason !== 'no saved session') {
      setStoredSession(true);
      setNotice({ kind: 'error', text: `A session saved in this browser was found but not restored: ${r.reason}. The demo pack is loaded instead; "Forget saved session" deletes the stored copy.` });
    }
  }, []);

  useEffect(() => {
    const onHash = () => setSelected(readHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const session = usePersistedSession({ pack, selected, enabled: persistEnabled, store });
  useBeforeUnload(dirty && !persistEnabled);

  function setPack(next: EvidencePack | ((p: EvidencePack) => EvidencePack)) {
    setHist((h) => push(h, typeof next === 'function' ? next(h.present) : next));
  }

  /** Replace the whole pack (load demo / start empty / import) as one undoable step; a reproducible pack counts as exported. */
  function replacePack(next: EvidencePack) {
    setHist((h) => push(h, next));
    setExportedFp(fingerprint(next));
  }

  function confirmDiscard(): boolean {
    return !dirty || window.confirm(DISCARD_PROMPT);
  }

  function select(id: string | null) {
    setSelected(id);
    const target = id ? '#/' + id : '#';
    if (location.hash !== target) window.history.replaceState(null, '', target);
  }

  function closeDrawer() {
    const previous = selected;
    select(null);
    if (previous) {
      // Return focus to the tile the drawer came from (tiles render data-tile-id).
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-tile-id="${previous}"]`)?.focus());
    }
  }

  function updateProfile(patch: Partial<EvidencePack['profile']>) {
    setPack((p) => ({ ...p, profile: { ...p.profile, ...patch } }));
  }

  function setPriority(id: string, priority: Priority) {
    setPack((p) => ({ ...p, profile: { ...p.profile, priorities: { ...p.profile.priorities, [id]: priority } } }));
  }

  function setPolicy(next: RulePolicy | null) {
    setPack((p) => {
      const rest: EvidencePack = { schema: p.schema, profile: p.profile, evidence: p.evidence, decisions: p.decisions };
      return next ? { ...rest, policy: next } : rest;
    });
    setNotice(
      next
        ? { kind: 'info', text: 'Rule policy changed. Every status was recomputed; the policy is stored in the pack and embedded in exported reports.' }
        : { kind: 'info', text: 'Rule policy reset to the documented defaults.' },
    );
  }

  function addEvidence(e: Evidence): string | null {
    if (pack.evidence.some((x) => x.id === e.id)) return `Evidence id ${e.id} already exists.`;
    const check = validatePackObject({ ...pack, evidence: [...pack.evidence, e] });
    if (!check.ok) return check.issues.map((i) => `${i.path}: ${i.message}`).join(' ');
    setPack(check.pack);
    setNotice({ kind: 'success', text: `Added ${e.id} to ${e.subcategoryIds.join(', ')}.` });
    return null;
  }

  function updateEvidence(e: Evidence): string | null {
    if (!pack.evidence.some((x) => x.id === e.id)) return `Evidence id ${e.id} no longer exists.`;
    const check = validatePackObject({ ...pack, evidence: pack.evidence.map((x) => (x.id === e.id ? e : x)) });
    if (!check.ok) return check.issues.map((i) => `${i.path}: ${i.message}`).join(' ');
    setPack(check.pack);
    setNotice({ kind: 'success', text: `Saved changes to ${e.id}. The mosaic recomputed.` });
    return null;
  }

  function removeEvidence(id: string) {
    setPack((p) => ({ ...p, evidence: p.evidence.filter((e) => e.id !== id) }));
    setNotice({ kind: 'info', text: `Removed ${id}. The mosaic recomputed. Undo restores it.` });
  }

  function setDecision(d: Decision | null, subcategoryId: string) {
    setPack((p) => ({
      ...p,
      decisions: [...p.decisions.filter((x) => x.subcategoryId !== subcategoryId), ...(d ? [d] : [])],
    }));
    setNotice(d ? { kind: 'success', text: `Recorded ${d.verdict} for ${subcategoryId}.` } : { kind: 'info', text: `Cleared the decision for ${subcategoryId}.` });
  }

  async function onImport(file: File | undefined) {
    if (!file) return;
    try {
      const text = await readTextFile(file, MAX_PACK_BYTES);
      const r = validatePack(text);
      if (!r.ok) {
        setNotice({ kind: 'error', text: `Import rejected: ${r.issues.length} issue(s). Nothing was changed.`, details: r.issues.map((i) => `${i.path || 'pack'} — ${i.message}`) });
        return;
      }
      replacePack(r.pack);
      setNotice({ kind: 'success', text: `Imported ${r.pack.evidence.length} evidence items and ${r.pack.decisions.length} decisions from ${file.name}.` });
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Import failed.' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function onExported(kind: string) {
    if (kind === 'pack') {
      setExportedFp(fingerprint(pack));
      setNotice({ kind: 'success', text: 'Exported the pack. Import it later to continue this review.' });
    } else {
      setNotice({ kind: 'success', text: `Exported ${kind}.` });
    }
  }

  const selectedResult: SubcategoryResult | undefined = selected ? byId.get(selected) : undefined;
  const selectedSub = selected ? CATALOG.find((s) => s.id === selected) : undefined;

  return (
    <div className="app">
      <a className="skip" href="#mosaic">Skip to mosaic</a>
      <header className="masthead">
        <div className="masthead__title">
          <h1>Tessera</h1>
          <p className="masthead__sub">
            Outcome-evidence mapper for <strong>{CSF_VERSION}</strong> — {SUBSET_LABEL}. Educational prototype on synthetic data; not a certification.
          </p>
        </div>
        <form className="profile" onSubmit={(e) => e.preventDefault()}>
          <label>
            <span>Profile name</span>
            <input value={pack.profile.name} maxLength={160} onChange={(e) => updateProfile({ name: e.target.value })} />
          </label>
          <label>
            <span>Evaluate as of</span>
            <input type="date" value={pack.profile.asOf} onChange={(e) => e.target.value && updateProfile({ asOf: e.target.value })} />
          </label>
          <div className="profile__actions" role="group" aria-label="Pack actions">
            <button type="button" onClick={() => { if (!confirmDiscard()) return; replacePack(loadDemo()); select('PR.DS-11'); setNotice({ kind: 'info', text: 'Reloaded the synthetic demo pack.' }); }}>Load demo pack</button>
            <button type="button" onClick={() => { if (!confirmDiscard()) return; replacePack(emptyPack()); select(null); setNotice({ kind: 'info', text: 'Started an empty profile. Pick a tile and add evidence, or import a pack.' }); }}>Start empty</button>
            <button type="button" onClick={() => { if (confirmDiscard()) fileRef.current?.click(); }}>Import pack JSON</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-hidden="true" tabIndex={-1} onChange={(e) => void onImport(e.target.files?.[0])} />
          </div>
          <ExportMenu pack={pack} report={report} onExported={onExported} />
        </form>
      </header>

      <SessionBar
        dirty={dirty}
        storageAvailable={store !== null}
        persistEnabled={persistEnabled}
        lastSavedAt={session.lastSavedAt}
        lastError={session.lastError}
        storedSession={storedSession}
        canUndo={canUndo(hist)}
        canRedo={canRedo(hist)}
        onTogglePersist={(v) => {
          setPersistEnabled(v);
          if (v) setStoredSession(true);
          setNotice(
            v
              ? { kind: 'info', text: 'This session will be kept in this browser (unencrypted, synthetic data only) until you press "Forget saved session".' }
              : { kind: 'info', text: 'Saving to this browser is paused. The last saved copy stays until you press "Forget saved session".' },
          );
        }}
        onForget={() => { session.forget(); setPersistEnabled(false); setStoredSession(false); setNotice({ kind: 'info', text: 'Deleted the session saved in this browser.' }); }}
        onUndo={() => setHist((h) => undo(h))}
        onRedo={() => setHist((h) => redo(h))}
      />

      {notice && (
        <div className={`notice notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <p>{notice.text}</p>
          {notice.details && (
            <ul>
              {notice.details.slice(0, 12).map((d, i) => (
                <li key={i}>{d}</li>
              ))}
              {notice.details.length > 12 && <li>…and {notice.details.length - 12} more</li>}
            </ul>
          )}
        </div>
      )}

      <Summary report={report} />

      <PolicyPanel policy={policy} onChange={setPolicy} />

      <main className="workbench">
        <section className="mosaic-pane" id="mosaic" aria-labelledby="mosaic-h">
          <div className="pane-head">
            <h2 id="mosaic-h">Outcome mosaic</h2>
            <p className="pane-help">One tile per subcategory. Pattern encodes status; colour encodes CSF function. Select a tile to see the derivation.</p>
          </div>
          <Mosaic results={byId} selected={selected} onSelect={select} rollups={report.rollups} />
          <Legend />
        </section>

        <aside className="drawer-pane">
          {selectedResult && selectedSub ? (
            <Drawer
              key={selectedSub.id}
              sub={selectedSub}
              result={selectedResult}
              pack={pack}
              policy={policy}
              evidenceTypes={EVIDENCE_TYPES}
              defaultReviewer={reviewer}
              onReviewerChange={setReviewer}
              onAddEvidence={addEvidence}
              onUpdateEvidence={updateEvidence}
              onRemoveEvidence={removeEvidence}
              onDecision={(d) => setDecision(d, selectedSub.id)}
              onPriority={(p) => setPriority(selectedSub.id, p)}
              onClose={closeDrawer}
            />
          ) : (
            <div className="drawer drawer--empty">
              <h2>No outcome selected</h2>
              <p>Choose a tile in the mosaic. The drawer shows the exact rule trace, every evidence item with its freshness, and the reviewer decision for that outcome.</p>
            </div>
          )}
        </aside>
      </main>

      <div className="planning">
        <Horizon pack={pack} onSelect={select} />
        <Compare report={report} onSelect={select} onNotice={setNotice} />
      </div>

      <GapRegister report={report} selected={selected} onSelect={select} />

      <footer className="foot">
        <p>
          Session state lives in memory and resets on refresh unless you choose to keep it in this browser; export a pack to keep it anywhere else. Reviewer decisions are valid for {policy.decisionValidDays} days from their date and are ignored (with a warning) when stale or future-dated. Subcategory text from NIST CSWP 29 (Feb 26, 2024). Function colours and the status patterns are this project's own encoding, not NIST's.
        </p>
      </footer>
    </div>
  );
}
