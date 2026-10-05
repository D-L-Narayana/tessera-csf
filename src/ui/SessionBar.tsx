// Session toolbar: undo/redo, export status, and the opt-in "keep in this browser" control.
// Pure presentation; every decision (what is dirty, whether storage exists) is made by the caller.
import { useId } from 'react';
import './session.css';

export interface SessionBarProps {
  dirty: boolean;
  storageAvailable: boolean;
  persistEnabled: boolean;
  lastSavedAt?: string;
  lastError?: string;
  /** True when a stored session exists (restored or rejected at start-up), so Forget is offered even before the first save. */
  storedSession?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onTogglePersist: (v: boolean) => void;
  onForget: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function SessionBar(props: SessionBarProps) {
  const checkboxId = useId();
  const privacyId = useId();
  const unavailableId = useId();
  const showForget = props.persistEnabled || Boolean(props.lastSavedAt) || Boolean(props.storedSession);
  const describedBy = props.storageAvailable ? privacyId : `${privacyId} ${unavailableId}`;

  return (
    <div className="session__bar" role="toolbar" aria-label="Session">
      <div className="session__group">
        <button type="button" className="ghost small" onClick={props.onUndo} disabled={!props.canUndo}>Undo</button>
        <button type="button" className="ghost small" onClick={props.onRedo} disabled={!props.canRedo}>Redo</button>
      </div>
      <p className={`session__status small ${props.dirty ? 'session__status--dirty' : 'session__status--clean'}`}>
        {props.dirty ? 'Unsaved changes' : 'All changes exported'}
      </p>
      <div className="session__persist">
        <input
          id={checkboxId}
          type="checkbox"
          checked={props.persistEnabled}
          disabled={!props.storageAvailable}
          aria-describedby={describedBy}
          onChange={(e) => props.onTogglePersist(e.target.checked)}
        />
        <label htmlFor={checkboxId}>Keep this session in this browser</label>
        {!props.storageAvailable && <span id={unavailableId} className="small muted">Browser storage is not available here.</span>}
        {props.lastSavedAt && <span className="small muted">Saved {props.lastSavedAt}</span>}
        {props.lastError && <span className="small session__error" role="status">Not saved: {props.lastError}</span>}
        {showForget && (
          <button type="button" className="ghost small" onClick={props.onForget}>Forget saved session</button>
        )}
      </div>
      <p id={privacyId} className="session__privacy small muted">Stored unencrypted in this browser only. Synthetic data only.</p>
    </div>
  );
}
