// Opt-in browser persistence for the current session. Nothing here runs unless the user ticks the box,
// and nothing read back from storage is trusted: the pack is re-validated, the selection is sanitised,
// and anything else is rejected with a reason. No network, no encryption (documented in docs/session.md).
import { CATALOG_IDS } from '../engine/catalog';
import type { EvidencePack, ValidationIssue } from '../engine/types';
import { MAX_PACK_BYTES, utf8Bytes, validatePackObject } from '../engine/validate';

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export const SESSION_KEY = 'tessera.session/1';
const PROBE_KEY = 'tessera.session/probe';

export interface SavedSession {
  schema: 'tessera.session/1';
  savedAt: string; // ISO 8601 UTC date-time, exactly as Date#toISOString() writes it
  pack: EvidencePack;
  selected: string | null; // subcategory id from the catalog, or null
}

export type SaveResult = { ok: true; bytes: number; savedAt: string } | { ok: false; error: string };
export type LoadResult = { ok: true; session: SavedSession } | { ok: false; reason: string };

const SUBCATEGORY_ID = /^[A-Z]{2}\.[A-Z]{2}-\d{2}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Probe window.localStorage with a set/remove pair. Null when absent or throwing (private mode, sandboxed previews, disabled storage). */
export function detectStorage(): KeyValueStore | null {
  try {
    if (typeof window === 'undefined') return null;
    const candidate: unknown = (window as unknown as Record<string, unknown>).localStorage;
    if (!candidate || typeof candidate !== 'object') return null;
    const raw = candidate as KeyValueStore;
    if (typeof raw.getItem !== 'function' || typeof raw.setItem !== 'function' || typeof raw.removeItem !== 'function') return null;
    raw.setItem(PROBE_KEY, '1');
    raw.removeItem(PROBE_KEY);
    // Wrap so the methods keep their receiver (calling a detached localStorage method throws in browsers).
    return {
      getItem: (k) => raw.getItem(k),
      setItem: (k, v) => raw.setItem(k, v),
      removeItem: (k) => raw.removeItem(k),
    };
  } catch {
    return null;
  }
}

function isTimestamp(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_DATE_TIME.test(v)) return false;
  const t = Date.parse(v);
  return Number.isFinite(t) && new Date(t).toISOString() === v;
}

function sanitizeSelected(v: unknown): string | null {
  return typeof v === 'string' && SUBCATEGORY_ID.test(v) && CATALOG_IDS.has(v) ? v : null;
}

function describeIssues(issues: ValidationIssue[]): string {
  const shown = issues.slice(0, 5).map((i) => (i.path ? `${i.path}: ${i.message}` : i.message));
  const more = issues.length - shown.length;
  return shown.join('; ') + (more > 0 ? `; …and ${more} more` : '');
}

function describeError(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.slice(0, 200);
}

/**
 * Serialise and store the session. Refuses (without writing) when the pack would not load back, when the
 * payload exceeds MAX_PACK_BYTES, or when the clock is unusable; store exceptions (quota) become ok:false.
 */
export function saveSession(store: KeyValueStore, pack: EvidencePack, selected: string | null, now: () => string): SaveResult {
  // Only store what will load back, so a saved copy is never silently replaced by an unloadable one.
  const check = validatePackObject(pack);
  if (!check.ok) return { ok: false, error: 'pack failed validation: ' + describeIssues(check.issues) };
  const savedAt = now();
  if (!isTimestamp(savedAt)) return { ok: false, error: 'the clock did not produce a usable timestamp' };
  const session: SavedSession = { schema: 'tessera.session/1', savedAt, pack: check.pack, selected: sanitizeSelected(selected) };
  const text = JSON.stringify(session);
  const bytes = utf8Bytes(text);
  if (bytes > MAX_PACK_BYTES) {
    return { ok: false, error: `session too large to keep in this browser: ${bytes} bytes exceeds the ${MAX_PACK_BYTES}-byte limit` };
  }
  try {
    store.setItem(SESSION_KEY, text);
  } catch (err) {
    return { ok: false, error: 'browser storage refused the write: ' + describeError(err) };
  }
  return { ok: true, bytes, savedAt };
}

/** Read and distrust: size bound, JSON, schema tag, timestamp, then the pack through validatePackObject. */
export function loadSession(store: KeyValueStore): LoadResult {
  let text: string | null;
  try {
    text = store.getItem(SESSION_KEY);
  } catch (err) {
    return { ok: false, reason: 'saved session could not be read: ' + describeError(err) };
  }
  if (text === null || text === undefined) return { ok: false, reason: 'no saved session' };
  if (typeof text !== 'string') return { ok: false, reason: 'saved session is not valid JSON' };
  if (text.length > MAX_PACK_BYTES || utf8Bytes(text) > MAX_PACK_BYTES) {
    return { ok: false, reason: `saved session too large: limit is ${MAX_PACK_BYTES} bytes` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'saved session is not valid JSON' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'saved session has an unexpected schema' };
  const o = raw as Record<string, unknown>;
  if (o.schema !== 'tessera.session/1') return { ok: false, reason: 'saved session has an unexpected schema' };
  if (!isTimestamp(o.savedAt)) return { ok: false, reason: 'saved session has an invalid timestamp' };
  const check = validatePackObject(o.pack);
  if (!check.ok) return { ok: false, reason: 'saved session pack failed validation: ' + describeIssues(check.issues) };
  // The validator's clean object replaces whatever was stored; unknown keys never reach application state.
  return { ok: true, session: { schema: 'tessera.session/1', savedAt: o.savedAt, pack: check.pack, selected: sanitizeSelected(o.selected) } };
}

export function clearSession(store: KeyValueStore): void {
  try {
    store.removeItem(SESSION_KEY);
  } catch {
    // The browser refused the removal; there is nothing further the application can do about it.
  }
}
