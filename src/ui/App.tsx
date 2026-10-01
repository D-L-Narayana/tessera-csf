import { useEffect, useMemo, useRef, useState } from 'react';
import { CATALOG, CSF_VERSION, SUBSET_LABEL } from '../engine/catalog';
import { buildReport, reportToCsvRows, toCsv, MIN_OVERRIDE_RATIONALE } from '../engine/evaluate';
import { MAX_PACK_BYTES, validatePack, validatePackObject } from '../engine/validate';
import type { Decision, Evidence, EvidencePack, Priority, SubcategoryResult, Verdict } from '../engine/types';
import { EVIDENCE_TYPES } from '../engine/types';
import demoPack from '../fixtures/harbourline-pack.json';
import { downloadText, readTextFile } from './files';
import { Mosaic } from './Mosaic';
import { Drawer } from './Drawer';

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

function readHash(): string | null {
  const m = /^#\/([A-Z]{2}\.[A-Z]{2}-\d{2})$/.exec(location.hash);
  return m && CATALOG.some((s) => s.id === m[1]) ? m[1] : null;
}

export default function App() {
  const [pack, setPack] = useState<EvidencePack>(() => loadDemo());
  const [selected, setSelected] = useState<string | null>(() => readHash() ?? 'PR.DS-11');
  const [notice, setNotice] = useState<Notice>({ kind: 'info', text: 'Loaded the bundled synthetic demo pack (Harbourline Logistics). Nothing here is real evidence.' });
  const fileRef = useRef<HTMLInputElement>(null);

  const report = useMemo(() => buildReport(pack), [pack]);
  const byId = useMemo(() => new Map(report.results.map((r) => [r.subcategoryId, r])), [report]);

  useEffect(() => {
    const onHash = () => setSelected(readHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  function select(id: string | null) {
    setSelected(id);
    const target = id ? '#/' + id : '#';
    if (location.hash !== target) history.replaceState(null, '', target);
  }

  function updateProfile(patch: Partial<EvidencePack['profile']>) {
    setPack((p) => ({ ...p, profile: { ...p.profile, ...patch } }));
  }

  function setPriority(id: string, priority: Priority) {
    setPack((p) => ({ ...p, profile: { ...p.profile, priorities: { ...p.profile.priorities, [id]: priority } } }));
  }

  function addEvidence(e: Evidence): string | null {
    if (pack.evidence.some((x) => x.id === e.id)) return `Evidence id ${e.id} already exists.`;
    const check = validatePackObject({ ...pack, evidence: [...pack.evidence, e] });
    if (!check.ok) return check.issues.map((i) => `${i.path}: ${i.message}`).join(' ');
    setPack(check.pack);
    setNotice({ kind: 'success', text: `Added ${e.id} to ${e.subcategoryIds.join(', ')}.` });
    return null;
  }

  function removeEvidence(id: string) {
    setPack((p) => ({ ...p, evidence: p.evidence.filter((e) => e.id !== id) }));
    setNotice({ kind: 'info', text: `Removed ${id}. The mosaic recomputed.` });
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
      setPack(r.pack);
      setNotice({ kind: 'success', text: `Imported ${r.pack.evidence.length} evidence items and ${r.pack.decisions.length} decisions from ${file.name}.` });
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Import failed.' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const stamp = pack.profile.asOf.replace(/-/g, '');
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
            <button type="button" onClick={() => { setPack(loadDemo()); select('PR.DS-11'); setNotice({ kind: 'info', text: 'Reloaded the synthetic demo pack.' }); }}>Load demo pack</button>
            <button type="button" onClick={() => { setPack(emptyPack()); select(null); setNotice({ kind: 'info', text: 'Started an empty profile. Pick a tile and add evidence, or import a pack.' }); }}>Start empty</button>
            <button type="button" onClick={() => fileRef.current?.click()}>Import pack JSON</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-hidden="true" tabIndex={-1} onChange={(e) => void onImport(e.target.files?.[0])} />
            <button type="button" onClick={() => downloadText(`tessera-pack-${stamp}.json`, JSON.stringify(pack, null, 2))}>Export pack</button>
            <button type="button" onClick={() => downloadText(`tessera-report-${stamp}.json`, JSON.stringify(report, null, 2))}>Export report JSON</button>
            <button type="button" onClick={() => downloadText(`tessera-report-${stamp}.csv`, toCsv(reportToCsvRows(report)), 'text/csv')}>Export report CSV</button>
          </div>
        </form>
      </header>

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

      <main className="workbench">
        <section className="mosaic-pane" id="mosaic" aria-labelledby="mosaic-h">
          <div className="pane-head">
            <h2 id="mosaic-h">Outcome mosaic</h2>
            <p className="pane-help">One tile per subcategory. Pattern encodes status; colour encodes CSF function. Select a tile to see the derivation.</p>
          </div>
          <Mosaic results={byId} selected={selected} onSelect={select} rollups={report.rollups} />
          <Legend />
        </section>

        <aside className="drawer-pane" aria-live="polite">
          {selectedResult && selectedSub ? (
            <Drawer
              key={selectedSub.id}
              sub={selectedSub}
              result={selectedResult}
              pack={pack}
              minRationale={MIN_OVERRIDE_RATIONALE}
              evidenceTypes={EVIDENCE_TYPES}
              onAddEvidence={addEvidence}
              onRemoveEvidence={removeEvidence}
              onDecision={(d) => setDecision(d, selectedSub.id)}
              onPriority={(p) => setPriority(selectedSub.id, p)}
              onClose={() => select(null)}
            />
          ) : (
            <div className="drawer drawer--empty">
              <h2>No outcome selected</h2>
              <p>Choose a tile in the mosaic. The drawer shows the exact rule trace, every evidence item with its freshness, and the reviewer decision for that outcome.</p>
            </div>
          )}
        </aside>
      </main>

      <section className="gaps" aria-labelledby="gaps-h">
        <div className="pane-head">
          <h2 id="gaps-h">Gap register</h2>
          <p className="pane-help">{report.gaps.length} of {report.results.length} outcomes are not sufficiently evidenced, ranked by residual exposure (priority × status exposure).</p>
        </div>
        {report.gaps.length === 0 ? (
          <p className="empty">Every outcome in the subset is sufficient or not applicable. Export the report to keep the trace.</p>
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Gap register table">
            <table>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Status</th>
                  <th scope="col">Residual</th>
                  <th scope="col">Remediation</th>
                </tr>
              </thead>
              <tbody>
                {report.gaps.map((g, i) => {
                  const s = CATALOG.find((c) => c.id === g.subcategoryId)!;
                  return (
                    <tr key={g.subcategoryId} className={g.subcategoryId === selected ? 'is-selected' : ''}>
                      <td>{i + 1}</td>
                      <td>
                        <button type="button" className="linkish" onClick={() => select(g.subcategoryId)}>
                          <span className={`fn fn--${s.fn}`}>{s.id}</span>
                        </button>
                        <div className="muted small">{s.categoryName}</div>
                      </td>
                      <td>
                        <span className={`status status--${g.status}`}>{g.status}</span>
                        {g.override && <span className="small muted"> {g.overrideValid ? 'override' : 'invalid override'}</span>}
                      </td>
                      <td>
                        <span className={`band band--${g.band}`}>{g.residual.toFixed(2)}</span>
                        <div className="muted small">priority {g.priority}</div>
                      </td>
                      <td className="remed">{g.remediation}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="foot">
        <p>
          Session state lives in memory only and resets on refresh; export a pack to keep it. Reviewer decisions are valid for 365 days from their date and are ignored (with a warning) when stale or future-dated. Subcategory text from NIST CSWP 29 (Feb 26, 2024). Function colours and the status patterns are this project's own encoding, not NIST's.
        </p>
      </footer>
    </div>
  );
}

function Legend() {
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
  );
}

export type { Verdict };
