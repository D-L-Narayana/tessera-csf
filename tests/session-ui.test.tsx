// SessionBar markup contract (rendered statically in Node), hook render-safety and the beforeunload guard logic.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionBar, type SessionBarProps } from '../src/ui/SessionBar';
import type { KeyValueStore } from '../src/ui/storage';
import { attachBeforeUnload, beforeUnloadHandler, useBeforeUnload, usePersistedSession, type BeforeUnloadLikeEvent } from '../src/ui/useSession';
import { pack } from './helpers/pack';

const noop = () => {};
const base: SessionBarProps = {
  dirty: true,
  storageAvailable: true,
  persistEnabled: false,
  canUndo: true,
  canRedo: false,
  onTogglePersist: noop,
  onForget: noop,
  onUndo: noop,
  onRedo: noop,
};

function render(overrides: Partial<SessionBarProps> = {}): string {
  return renderToStaticMarkup(<SessionBar {...base} {...overrides} />);
}

function tag(html: string, pattern: RegExp): string {
  const m = pattern.exec(html);
  if (!m) throw new Error(`no match for ${pattern} in ${html}`);
  return m[0];
}

describe('SessionBar', () => {
  it('is a toolbar named Session with the exact control strings', () => {
    const html = render({ persistEnabled: true });
    expect(html).toMatch(/<div[^>]*role="toolbar"[^>]*aria-label="Session"/);
    expect(html).toMatch(/<button[^>]*>Undo<\/button>/);
    expect(html).toMatch(/<button[^>]*>Redo<\/button>/);
    expect(html).toMatch(/<button[^>]*>Forget saved session<\/button>/);
    expect(html).toContain('Keep this session in this browser');
    expect(html).toContain('Stored unencrypted in this browser only. Synthetic data only.');
  });

  it('associates the checkbox with its label through a generated id', () => {
    const html = render();
    const input = tag(html, /<input[^>]*type="checkbox"[^>]*>/);
    const id = /\sid="([^"]+)"/.exec(input)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<label for="${id}">Keep this session in this browser</label>`);
    expect(input).not.toContain('disabled');
    expect(html).not.toContain('Browser storage is not available here.');
  });

  it('disables the checkbox and explains why when storage is unavailable', () => {
    const html = render({ storageAvailable: false });
    const input = tag(html, /<input[^>]*type="checkbox"[^>]*>/);
    expect(input).toContain('disabled');
    expect(html).toContain('Browser storage is not available here.');
    const describedBy = /aria-describedby="([^"]+)"/.exec(input)?.[1] ?? '';
    const explanationId = /<[a-z]+ id="([^"]+)"[^>]*>Browser storage is not available here\./.exec(html)?.[1];
    expect(explanationId).toBeTruthy();
    expect(describedBy.split(' ')).toContain(explanationId);
    expect(html).toContain('Stored unencrypted in this browser only. Synthetic data only.');
  });

  it('shows "Unsaved changes" when dirty and "All changes exported" otherwise', () => {
    const dirty = render({ dirty: true });
    expect(dirty).toContain('Unsaved changes');
    expect(dirty).not.toContain('All changes exported');
    const clean = render({ dirty: false });
    expect(clean).toContain('All changes exported');
    expect(clean).not.toContain('Unsaved changes');
  });

  it('disables Undo / Redo exactly when they are not possible', () => {
    const none = render({ canUndo: false, canRedo: false });
    expect(tag(none, /<button[^>]*>Undo<\/button>/)).toContain('disabled');
    expect(tag(none, /<button[^>]*>Redo<\/button>/)).toContain('disabled');
    const both = render({ canUndo: true, canRedo: true });
    expect(tag(both, /<button[^>]*>Undo<\/button>/)).not.toContain('disabled');
    expect(tag(both, /<button[^>]*>Redo<\/button>/)).not.toContain('disabled');
  });

  it('shows the saved time verbatim when present', () => {
    expect(render({ lastSavedAt: '2026-10-05T06:00:00.000Z' })).toContain('Saved 2026-10-05T06:00:00.000Z');
    expect(render()).not.toContain('Saved ');
  });

  it('offers Forget only when persistence is on, a save exists, or a stored session was found', () => {
    expect(render({ persistEnabled: false })).not.toContain('Forget saved session');
    expect(render({ persistEnabled: true })).toContain('Forget saved session');
    expect(render({ persistEnabled: false, lastSavedAt: '2026-10-05T06:00:00.000Z' })).toContain('Forget saved session');
    expect(render({ persistEnabled: false, storedSession: true })).toContain('Forget saved session');
  });

  it('surfaces a refused save as text', () => {
    const html = render({ persistEnabled: true, lastError: 'session too large to keep in this browser' });
    expect(html).toContain('Not saved: session too large to keep in this browser');
    expect(render({ persistEnabled: true })).not.toContain('Not saved:');
  });

  it('reflects the checkbox state', () => {
    expect(tag(render({ persistEnabled: true }), /<input[^>]*type="checkbox"[^>]*>/)).toContain('checked');
    expect(tag(render({ persistEnabled: false }), /<input[^>]*type="checkbox"[^>]*>/)).not.toContain('checked');
  });

  it('uses no inline styles, no style elements and no duplicate ids', () => {
    const html = render({ persistEnabled: true, lastSavedAt: '2026-10-05T06:00:00.000Z', storageAvailable: false, lastError: 'x' });
    expect(html).not.toMatch(/ style=/);
    expect(html).not.toMatch(/<style/);
    const ids = [...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(html).toMatch(/class="[^"]*session__/);
  });
});

describe('beforeunload guard', () => {
  it('the handler prevents default and sets an empty returnValue (what browsers require for a prompt)', () => {
    const e: BeforeUnloadLikeEvent = { preventDefault: vi.fn(), returnValue: undefined };
    beforeUnloadHandler(e);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(e.returnValue).toBe('');
  });

  it('subscribes only while dirty and removes the same listener on cleanup', () => {
    const added: [string, unknown][] = [];
    const removed: [string, unknown][] = [];
    const target = {
      addEventListener: (type: string, listener: unknown) => added.push([type, listener]),
      removeEventListener: (type: string, listener: unknown) => removed.push([type, listener]),
    };
    const cleanClean = attachBeforeUnload(target, false);
    expect(added).toEqual([]);
    cleanClean();
    expect(removed).toEqual([]);
    const cleanDirty = attachBeforeUnload(target, true);
    expect(added.length).toBe(1);
    expect(added[0][0]).toBe('beforeunload');
    expect(added[0][1]).toBe(beforeUnloadHandler);
    expect(removed).toEqual([]);
    cleanDirty();
    expect(removed).toEqual([['beforeunload', beforeUnloadHandler]]);
  });
});

describe('session hooks render without touching browser APIs', () => {
  it('usePersistedSession and useBeforeUnload can render in a static tree (no window) and expose forget()', () => {
    const store: KeyValueStore = { getItem: () => null, setItem: noop, removeItem: noop };
    let forgetType = '';
    let initialSavedAt: string | undefined = 'unset';
    function Probe() {
      useBeforeUnload(true);
      const s = usePersistedSession({ pack: pack(), selected: 'PR.DS-11', enabled: true, store });
      forgetType = typeof s.forget;
      initialSavedAt = s.lastSavedAt;
      return <SessionBar {...base} lastSavedAt={s.lastSavedAt} lastError={s.lastError} />;
    }
    const html = renderToStaticMarkup(<Probe />);
    expect(html).toMatch(/role="toolbar"/);
    expect(forgetType).toBe('function');
    expect(initialSavedAt).toBeUndefined();
  });
});
