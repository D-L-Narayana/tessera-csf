// Generic, pure undo/redo history. Every function returns a new structure (or the same one when nothing
// changes) and never mutates its input, so it composes with React state updaters.

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  limit: number; // maximum number of retained past states (undo depth)
}

export const DEFAULT_HISTORY_LIMIT = 50;

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_HISTORY_LIMIT;
  return Math.max(0, Math.floor(limit));
}

export function createHistory<T>(present: T, limit = DEFAULT_HISTORY_LIMIT): History<T> {
  return { past: [], present, future: [], limit: normalizeLimit(limit) };
}

/** Record a new present. The old present joins the past (oldest entries trimmed beyond the limit) and the redo branch is discarded. */
export function push<T>(h: History<T>, next: T): History<T> {
  if (Object.is(next, h.present)) return h;
  const past = h.limit > 0 ? [...h.past, h.present].slice(-h.limit) : [];
  return { past, present: next, future: [], limit: h.limit };
}

/** Swap the present without recording an undo step (for coalescing continuous edits). The redo branch is still discarded. */
export function replace<T>(h: History<T>, next: T): History<T> {
  if (Object.is(next, h.present)) return h;
  return { past: h.past, present: next, future: [], limit: h.limit };
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  const present = h.past[h.past.length - 1];
  return { past: h.past.slice(0, -1), present, future: [h.present, ...h.future], limit: h.limit };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  const [present, ...future] = h.future;
  return { past: [...h.past, h.present], present, future, limit: h.limit };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}
