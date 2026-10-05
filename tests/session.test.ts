// Session persistence: opt-in storage adapter, bounded save, distrustful load, debounced saver and the
// persistence controller that backs usePersistedSession. Everything runs against fake stores in Node.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PACK_BYTES, validatePackObject } from '../src/engine/validate';
import type { EvidencePack } from '../src/engine/types';
import { SESSION_KEY, clearSession, detectStorage, loadSession, saveSession, type KeyValueStore, type SaveResult } from '../src/ui/storage';
import { SAVE_DEBOUNCE_MS, createPersistenceController, createSessionSaver, restoreSession, type PersistenceState } from '../src/ui/useSession';
import { AS_OF, ev, pack } from './helpers/pack';

const NOW = '2026-10-05T06:00:00.000Z';
const now = () => NOW;

interface MemoryStore extends KeyValueStore {
  readonly map: Map<string, string>;
  readonly writes: number;
  failing: boolean;
}

function quotaError(): Error {
  const err = new Error('The quota has been exceeded.');
  err.name = 'QuotaExceededError';
  return err;
}

function memoryStore(): MemoryStore {
  const map = new Map<string, string>();
  let writes = 0;
  return {
    map,
    failing: false,
    get writes() {
      return writes;
    },
    getItem(k) {
      if (this.failing) throw quotaError();
      return map.has(k) ? (map.get(k) as string) : null;
    },
    setItem(k, v) {
      if (this.failing) throw quotaError();
      writes += 1;
      map.set(k, String(v));
    },
    removeItem(k) {
      if (this.failing) throw quotaError();
      map.delete(k);
    },
  };
}

function throwingStore(): KeyValueStore {
  const fail = () => {
    throw quotaError();
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

function demo(): EvidencePack {
  return pack(
    [
      ev({ id: 'EV-001', subcategoryIds: ['PR.DS-11'] }),
      ev({ id: 'EV-002', type: 'report', subcategoryIds: ['PR.DS-11', 'PR.AA-05'], note: 'synthetic restore drill summary' }),
    ],
    [{ subcategoryId: 'GV.PO-01', reviewer: 'R. Reviewer', verdict: 'gap', rationale: 'No policy artefact has been collected yet.', decidedOn: AS_OF }],
    { priorities: { 'PR.DS-11': 3 } },
  );
}

function stored(store: MemoryStore, value: unknown): void {
  store.map.set(SESSION_KEY, typeof value === 'string' ? value : JSON.stringify(value));
}

function withWindow<T>(w: unknown, fn: () => T): T {
  const g = globalThis as unknown as { window?: unknown };
  const had = Object.prototype.hasOwnProperty.call(g, 'window');
  const previous = g.window;
  g.window = w;
  try {
    return fn();
  } finally {
    if (had) g.window = previous;
    else delete g.window;
  }
}

describe('saveSession / loadSession round trip', () => {
  it('saves under the session key and loads the same pack and selection back', () => {
    const store = memoryStore();
    const r = saveSession(store, demo(), 'PR.DS-11', now);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bytes).toBeGreaterThan(0);
    expect(r.savedAt).toBe(NOW);
    expect(store.map.has(SESSION_KEY)).toBe(true);
    const loaded = loadSession(store);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.session.schema).toBe('tessera.session/1');
    expect(loaded.session.savedAt).toBe(NOW);
    expect(loaded.session.selected).toBe('PR.DS-11');
    expect(loaded.session.pack).toEqual(demo());
  });

  it('reports the serialized size in UTF-8 bytes', () => {
    const store = memoryStore();
    const p = pack([ev({ id: 'EV-001', title: 'Sauvegarde — résumé' })]);
    const r = saveSession(store, p, null, now);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = store.map.get(SESSION_KEY) as string;
    expect(r.bytes).toBe(new TextEncoder().encode(text).byteLength);
    expect(r.bytes).toBeGreaterThan(text.length); // the em dash and the accents take more than one byte each
  });

  it('round-trips a null selection', () => {
    const store = memoryStore();
    expect(saveSession(store, demo(), null, now).ok).toBe(true);
    const loaded = loadSession(store);
    expect(loaded.ok && loaded.session.selected).toBe(null);
  });
});

describe('loadSession refuses what it cannot trust', () => {
  it('reports "no saved session" when the key is absent', () => {
    expect(loadSession(memoryStore())).toEqual({ ok: false, reason: 'no saved session' });
  });

  it('rejects corrupt JSON', () => {
    const store = memoryStore();
    stored(store, '{"schema":"tessera.session/1",');
    expect(loadSession(store)).toEqual({ ok: false, reason: 'saved session is not valid JSON' });
  });

  it('rejects an unexpected schema tag and non-object payloads', () => {
    const store = memoryStore();
    stored(store, { schema: 'tessera.session/2', savedAt: NOW, pack: demo(), selected: null });
    expect(loadSession(store)).toEqual({ ok: false, reason: 'saved session has an unexpected schema' });
    stored(store, { savedAt: NOW, pack: demo(), selected: null });
    expect(loadSession(store)).toEqual({ ok: false, reason: 'saved session has an unexpected schema' });
    stored(store, '[1,2,3]');
    expect(loadSession(store)).toEqual({ ok: false, reason: 'saved session has an unexpected schema' });
    stored(store, '"tessera.session/1"');
    expect(loadSession(store)).toEqual({ ok: false, reason: 'saved session has an unexpected schema' });
    stored(store, 'null');
    expect(loadSession(store)).toEqual({ ok: false, reason: 'saved session has an unexpected schema' });
  });

  it('rejects an invalid savedAt timestamp', () => {
    const store = memoryStore();
    for (const savedAt of ['yesterday', '', 1759644000000, null, '2026-13-45T99:99:99.000Z', '2026-10-05']) {
      stored(store, { schema: 'tessera.session/1', savedAt, pack: demo(), selected: null });
      expect(loadSession(store)).toEqual({ ok: false, reason: 'saved session has an invalid timestamp' });
    }
  });

  it('rejects a pack that fails validation and names the path', () => {
    const store = memoryStore();
    const bad = demo();
    bad.evidence[0].subcategoryIds = ['ZZ.ZZ-99'];
    stored(store, { schema: 'tessera.session/1', savedAt: NOW, pack: bad, selected: null });
    const r = loadSession(store);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('failed validation');
    expect(r.reason).toContain('evidence[0].subcategoryIds[0]');
    const noPack = memoryStore();
    stored(noPack, { schema: 'tessera.session/1', savedAt: NOW, selected: null });
    const missing = loadSession(noPack);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toContain('failed validation');
  });

  it("replaces the stored pack with the validator's clean object (unknown keys dropped)", () => {
    const store = memoryStore();
    const raw = demo() as EvidencePack & { extra?: unknown };
    raw.extra = { injected: true };
    (raw.evidence[0] as unknown as Record<string, unknown>).onload = 'alert(1)';
    (raw.profile as unknown as Record<string, unknown>).theme = 'dark';
    stored(store, { schema: 'tessera.session/1', savedAt: NOW, pack: raw, selected: null, surplus: 1 });
    const r = loadSession(store);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const clean = validatePackObject(JSON.parse(JSON.stringify(raw)));
    expect(clean.ok).toBe(true);
    if (!clean.ok) return;
    expect(r.session.pack).toEqual(clean.pack);
    expect(r.session.pack).not.toHaveProperty('extra');
    expect(r.session.pack.profile).not.toHaveProperty('theme');
    expect(Object.keys(r.session.pack.evidence[0])).not.toContain('onload');
    expect(Object.keys(r.session)).toEqual(['schema', 'savedAt', 'pack', 'selected']);
  });

  it('keeps a well-formed selected id from the subset and drops anything else', () => {
    const store = memoryStore();
    const cases: [unknown, string | null][] = [
      ['PR.DS-11', 'PR.DS-11'],
      ['bogus', null],
      ['ZZ.ZZ-99', null], // matches the shape but is not in the 25-subcategory subset
      [42, null],
      [null, null],
      [undefined, null],
    ];
    for (const [selected, expected] of cases) {
      stored(store, { schema: 'tessera.session/1', savedAt: NOW, pack: demo(), selected });
      const r = loadSession(store);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.session.selected).toBe(expected);
    }
  });

  it('refuses a stored value above the pack byte limit without parsing it', () => {
    const store = memoryStore();
    stored(store, '{"schema":"tessera.session/1","pad":"' + 'x'.repeat(MAX_PACK_BYTES) + '"}');
    const r = loadSession(store);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('too large');
  });

  it('reports a store whose getItem throws instead of propagating', () => {
    const r = loadSession(throwingStore());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('could not be read');
  });
});

describe('saveSession refusals', () => {
  it('refuses an oversized session and writes nothing', () => {
    const store = memoryStore();
    const big = pack(Array.from({ length: 300 }, (_, i) => ev({ id: `EV-${i + 1}`, note: 'n'.repeat(2000) })));
    const r = saveSession(store, big, null, now);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('too large');
    expect(r.error).toContain(String(MAX_PACK_BYTES));
    expect(store.writes).toBe(0);
    expect(store.map.size).toBe(0);
  });

  it('returns ok:false when the store throws (quota exceeded) instead of propagating', () => {
    const r = saveSession(throwingStore(), demo(), null, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('QuotaExceededError');
  });

  it('refuses a pack that would be rejected on reload rather than storing something unloadable', () => {
    const store = memoryStore();
    const p = demo();
    p.profile.name = '';
    const r = saveSession(store, p, null, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('profile.name');
    expect(store.map.size).toBe(0);
  });

  it('refuses when the clock does not produce a usable timestamp', () => {
    const store = memoryStore();
    const r = saveSession(store, demo(), null, () => 'not a timestamp');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('timestamp');
    expect(store.map.size).toBe(0);
  });

  it('stores the selection only when it is a subcategory of the subset', () => {
    const store = memoryStore();
    expect(saveSession(store, demo(), 'nonsense', now).ok).toBe(true);
    const loaded = loadSession(store);
    expect(loaded.ok && loaded.session.selected).toBe(null);
  });
});

describe('clearSession', () => {
  it('removes only the session key', () => {
    const store = memoryStore();
    store.map.set('other.app/1', 'keep');
    expect(saveSession(store, demo(), 'PR.DS-11', now).ok).toBe(true);
    clearSession(store);
    expect(store.map.has(SESSION_KEY)).toBe(false);
    expect(store.map.get('other.app/1')).toBe('keep');
    expect(loadSession(store)).toEqual({ ok: false, reason: 'no saved session' });
  });

  it('swallows a throwing store', () => {
    expect(() => clearSession(throwingStore())).not.toThrow();
  });
});

describe('detectStorage', () => {
  it('returns null when there is no window (Node) and never throws', () => {
    expect(detectStorage()).toBeNull();
  });

  it('returns a working store after a set/remove probe that leaves no key behind', () => {
    const backing = memoryStore();
    const store = withWindow({ localStorage: backing }, () => detectStorage());
    expect(store).not.toBeNull();
    expect(backing.map.size).toBe(0);
    expect(backing.writes).toBe(1); // the probe write
    store?.setItem('k', 'v');
    expect(backing.map.get('k')).toBe('v');
    expect(store?.getItem('k')).toBe('v');
    store?.removeItem('k');
    expect(backing.map.has('k')).toBe(false);
  });

  it('returns null when localStorage is missing or throws on access', () => {
    expect(withWindow({}, () => detectStorage())).toBeNull();
    expect(withWindow({ localStorage: throwingStore() }, () => detectStorage())).toBeNull();
    const poisoned = {};
    Object.defineProperty(poisoned, 'localStorage', {
      get() {
        throw new Error('SecurityError');
      },
    });
    expect(withWindow(poisoned, () => detectStorage())).toBeNull();
  });
});

describe('restoreSession', () => {
  it('returns null without a store, null for a rejected session and the session when valid', () => {
    expect(restoreSession(null)).toBeNull();
    const store = memoryStore();
    expect(restoreSession(store)).toBeNull();
    stored(store, { schema: 'tessera.session/1', savedAt: NOW, pack: { schema: 'tessera.pack/1' }, selected: null });
    expect(restoreSession(store)).toBeNull();
    expect(saveSession(store, demo(), 'GV.PO-01', now).ok).toBe(true);
    const s = restoreSession(store);
    expect(s?.pack).toEqual(demo());
    expect(s?.selected).toBe('GV.PO-01');
    expect(s?.savedAt).toBe(NOW);
  });
});

describe('debounced session saver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits 300 ms by default', () => {
    expect(SAVE_DEBOUNCE_MS).toBe(300);
  });

  it('coalesces rapid schedules into a single write of the latest state after the delay', () => {
    const store = memoryStore();
    const results: SaveResult[] = [];
    const saver = createSessionSaver({ store, now, onResult: (r) => results.push(r) });
    saver.schedule(pack([ev({ id: 'EV-001' })]), 'PR.AA-05');
    vi.advanceTimersByTime(100);
    saver.schedule(pack([ev({ id: 'EV-001' }), ev({ id: 'EV-002' })]), 'PR.DS-11');
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 1);
    expect(store.writes).toBe(0);
    expect(saver.pending()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(store.writes).toBe(1);
    expect(saver.pending()).toBe(false);
    expect(results).toEqual([{ ok: true, savedAt: NOW, bytes: expect.any(Number) }]);
    const loaded = loadSession(store);
    expect(loaded.ok && loaded.session.pack.evidence.map((e) => e.id)).toEqual(['EV-001', 'EV-002']);
    expect(loaded.ok && loaded.session.selected).toBe('PR.DS-11');
  });

  it('cancel drops a pending write and flush writes immediately', () => {
    const store = memoryStore();
    const results: SaveResult[] = [];
    const saver = createSessionSaver({ store, now, onResult: (r) => results.push(r) });
    saver.schedule(demo(), null);
    saver.cancel();
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 2);
    expect(store.writes).toBe(0);
    expect(results).toEqual([]);
    saver.schedule(demo(), 'PR.DS-11');
    saver.flush();
    expect(store.writes).toBe(1);
    expect(results.length).toBe(1);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 2);
    expect(store.writes).toBe(1); // the flushed timer does not fire again
    saver.flush(); // nothing pending: no extra write
    expect(store.writes).toBe(1);
  });

  it('reports refused writes through onResult', () => {
    const results: SaveResult[] = [];
    const saver = createSessionSaver({ store: throwingStore(), now, delayMs: 50, onResult: (r) => results.push(r) });
    saver.schedule(demo(), null);
    vi.advanceTimersByTime(50);
    expect(results.length).toBe(1);
    const first = results[0];
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.error).toContain('QuotaExceededError');
  });
});

describe('persistence controller (the logic behind usePersistedSession)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves after the debounce while enabled and reports lastSavedAt', () => {
    const store = memoryStore();
    const states: PersistenceState[] = [];
    const c = createPersistenceController({ store, now, onState: (s) => states.push(s) });
    c.update(demo(), 'PR.DS-11', true);
    expect(store.writes).toBe(0);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(store.writes).toBe(1);
    expect(states).toEqual([{ lastSavedAt: NOW, lastError: undefined }]);
    const loaded = loadSession(store);
    expect(loaded.ok && loaded.session.selected).toBe('PR.DS-11');
  });

  it('never writes while disabled, and withdrawing consent drops pending writes without deleting the stored copy', () => {
    const store = memoryStore();
    const c = createPersistenceController({ store, now, onState: () => {} });
    c.update(demo(), null, false);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 2);
    expect(store.writes).toBe(0);
    c.update(demo(), null, true);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(store.writes).toBe(1);
    c.update(pack([ev({ id: 'EV-009' })]), null, true); // pending…
    c.update(pack([ev({ id: 'EV-009' })]), null, false); // …then the box is unticked before the debounce fires
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 2);
    expect(store.writes).toBe(1); // the pending write was dropped
    expect(store.map.has(SESSION_KEY)).toBe(true); // the stored copy stays until Forget
    const loaded = loadSession(store);
    expect(loaded.ok && loaded.session.pack).toEqual(demo());
  });

  it('forget removes the stored session, drops pending writes and resets the state', () => {
    const store = memoryStore();
    const states: PersistenceState[] = [];
    const c = createPersistenceController({ store, now, onState: (s) => states.push(s) });
    c.update(demo(), null, true);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(states.at(-1)?.lastSavedAt).toBe(NOW);
    c.update(pack([ev({ id: 'EV-009' })]), null, true);
    c.forget();
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 2);
    expect(store.map.has(SESSION_KEY)).toBe(false);
    expect(store.writes).toBe(1);
    expect(states.at(-1)).toEqual({ lastSavedAt: undefined, lastError: undefined });
  });

  it('keeps the previous lastSavedAt but reports lastError when a later write is refused, then clears it on success', () => {
    const store = memoryStore();
    const states: PersistenceState[] = [];
    const c = createPersistenceController({ store, now, onState: (s) => states.push(s) });
    c.update(demo(), null, true);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    store.failing = true;
    c.update(pack([ev({ id: 'EV-009' })]), null, true);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(states.at(-1)?.lastSavedAt).toBe(NOW);
    expect(states.at(-1)?.lastError).toContain('QuotaExceededError');
    store.failing = false;
    c.update(pack([ev({ id: 'EV-010' })]), null, true);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(states.at(-1)).toEqual({ lastSavedAt: NOW, lastError: undefined });
  });

  it('flush writes a pending save immediately (used on pagehide so the last edit is not lost)', () => {
    const store = memoryStore();
    const c = createPersistenceController({ store, now, onState: () => {} });
    c.update(demo(), 'PR.DS-11', true);
    c.flush();
    expect(store.writes).toBe(1);
    const loaded = loadSession(store);
    expect(loaded.ok && loaded.session.selected).toBe('PR.DS-11');
    c.update(pack([ev({ id: 'EV-009' })]), null, false); // consent withdrawn: nothing is pending any more
    c.flush();
    expect(store.writes).toBe(1);
  });

  it('is inert without a store, and dispose cancels pending writes', () => {
    const states: PersistenceState[] = [];
    const none = createPersistenceController({ store: null, now, onState: (s) => states.push(s) });
    expect(() => {
      none.update(demo(), null, true);
      none.forget();
      none.dispose();
    }).not.toThrow();
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 2);
    expect(states.every((s) => s.lastSavedAt === undefined && s.lastError === undefined)).toBe(true);
    const store = memoryStore();
    const c = createPersistenceController({ store, now, onState: () => {} });
    c.update(demo(), null, true);
    c.dispose();
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 2);
    expect(store.writes).toBe(0);
  });
});
