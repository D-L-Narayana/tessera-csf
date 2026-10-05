// Session hooks: the unsaved-changes guard and opt-in debounced persistence. The logic lives in small
// pure factories (createSessionSaver, createPersistenceController, attachBeforeUnload) that are tested in
// Node; the hooks only connect them to React effects. No browser API is touched during render.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EvidencePack } from '../engine/types';
import { clearSession, loadSession, saveSession, type KeyValueStore, type SavedSession, type SaveResult } from './storage';

export const SAVE_DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------------------------------------
// Debounced saver

export interface SessionSaver {
  /** Queue the latest state; the write happens once the debounce elapses without another schedule. */
  schedule(pack: EvidencePack, selected: string | null): void;
  /** Write the queued state now (no-op when nothing is queued). */
  flush(): void;
  /** Drop the queued state without writing. */
  cancel(): void;
  pending(): boolean;
}

export interface SessionSaverOptions {
  store: KeyValueStore;
  now: () => string;
  delayMs?: number;
  onResult: (r: SaveResult) => void;
}

export function createSessionSaver(opts: SessionSaverOptions): SessionSaver {
  const delay = opts.delayMs ?? SAVE_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queued: { pack: EvidencePack; selected: string | null } | null = null;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }
  function write(): void {
    const job = queued;
    queued = null;
    if (!job) return;
    opts.onResult(saveSession(opts.store, job.pack, job.selected, opts.now));
  }

  return {
    schedule(pack, selected) {
      queued = { pack, selected };
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        write();
      }, delay);
    },
    flush() {
      clearTimer();
      write();
    },
    cancel() {
      clearTimer();
      queued = null;
    },
    pending: () => queued !== null,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Persistence controller (consent-aware wrapper around the saver)

export interface PersistenceState {
  lastSavedAt?: string;
  lastError?: string;
}

export interface PersistenceController {
  /** Called with every state change; writes only while enabled. Disabling drops pending writes but keeps the stored copy. */
  update(pack: EvidencePack, selected: string | null, enabled: boolean): void;
  flush(): void;
  /** Remove the stored session, drop pending writes and reset the reported state. */
  forget(): void;
  dispose(): void;
}

export interface PersistenceControllerOptions {
  store: KeyValueStore | null;
  now: () => string;
  delayMs?: number;
  onState: (s: PersistenceState) => void;
}

export function createPersistenceController(opts: PersistenceControllerOptions): PersistenceController {
  const store = opts.store;
  let state: PersistenceState = {};
  const emit = (next: PersistenceState): void => {
    state = next;
    opts.onState(state);
  };
  const saver = store
    ? createSessionSaver({
        store,
        now: opts.now,
        delayMs: opts.delayMs,
        onResult: (r) => {
          if (r.ok) emit({ lastSavedAt: r.savedAt, lastError: undefined });
          else emit({ lastSavedAt: state.lastSavedAt, lastError: r.error }); // the previous good copy is still stored
        },
      })
    : null;

  return {
    update(pack, selected, enabled) {
      if (!saver) return;
      if (enabled) saver.schedule(pack, selected);
      else saver.cancel(); // consent withdrawn: nothing further is written; the stored copy stays until Forget
    },
    flush() {
      saver?.flush();
    },
    forget() {
      saver?.cancel();
      if (store) clearSession(store);
      emit({ lastSavedAt: undefined, lastError: undefined });
    },
    dispose() {
      saver?.cancel();
    },
  };
}

/** Start-up helper: the validated saved session, or null when there is no store or nothing acceptable is stored. */
export function restoreSession(store: KeyValueStore | null): SavedSession | null {
  if (!store) return null;
  const r = loadSession(store);
  return r.ok ? r.session : null;
}

// ---------------------------------------------------------------------------------------------------------
// Unsaved-changes guard

export interface BeforeUnloadLikeEvent {
  preventDefault(): void;
  returnValue: unknown;
}

export interface UnloadTarget {
  addEventListener(type: 'beforeunload', listener: (e: BeforeUnloadLikeEvent) => void): void;
  removeEventListener(type: 'beforeunload', listener: (e: BeforeUnloadLikeEvent) => void): void;
}

/** Asks the browser to show its generic "leave page?" prompt. The text is never shown by modern browsers. */
export function beforeUnloadHandler(e: BeforeUnloadLikeEvent): void {
  e.preventDefault();
  e.returnValue = '';
}

/** Subscribe only while dirty; returns the cleanup that removes the same listener. */
export function attachBeforeUnload(target: UnloadTarget, dirty: boolean): () => void {
  if (!dirty) return () => {};
  target.addEventListener('beforeunload', beforeUnloadHandler);
  return () => target.removeEventListener('beforeunload', beforeUnloadHandler);
}

export function useBeforeUnload(dirty: boolean): void {
  useEffect(() => attachBeforeUnload(window, dirty), [dirty]);
}

// ---------------------------------------------------------------------------------------------------------
// Persistence hook

export interface PersistedSessionOptions {
  pack: EvidencePack;
  selected: string | null;
  enabled: boolean;
  store: KeyValueStore | null;
}

export interface PersistedSession {
  lastSavedAt?: string;
  lastError?: string;
  forget(): void;
}

export function usePersistedSession({ pack, selected, enabled, store }: PersistedSessionOptions): PersistedSession {
  const [state, setState] = useState<PersistenceState>({});
  const controller = useRef<PersistenceController | null>(null);

  useEffect(() => {
    const c = createPersistenceController({ store, now: () => new Date().toISOString(), onState: setState });
    controller.current = c;
    // A pending debounced write must not be lost when the tab closes or is backgrounded: pagehide covers
    // navigation, visibilitychange covers mobile browsers that discard hidden tabs without firing pagehide.
    const onPageHide = (): void => c.flush();
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') c.flush();
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      c.dispose();
      controller.current = null;
    };
  }, [store]);

  useEffect(() => {
    controller.current?.update(pack, selected, enabled);
  }, [pack, selected, enabled, store]);

  const forget = useCallback((): void => {
    controller.current?.forget();
  }, []);

  return { lastSavedAt: state.lastSavedAt, lastError: state.lastError, forget };
}
