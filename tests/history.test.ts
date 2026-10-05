// Undo/redo history (generic, pure) and the export fingerprint used for the unsaved-changes guard.
import { describe, expect, it } from 'vitest';
import type { EvidencePack } from '../src/engine/types';
import { canRedo, canUndo, createHistory, push, redo, replace, undo } from '../src/ui/history';
import { fingerprint, isDirty } from '../src/ui/dirty';
import { ev, pack } from './helpers/pack';

describe('history: push / undo / redo', () => {
  it('starts with no past, no future and the default limit of 50', () => {
    const h = createHistory('a');
    expect(h).toEqual({ past: [], present: 'a', future: [], limit: 50 });
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it('push appends the present to the past and clears the future', () => {
    const h1 = push(createHistory('a'), 'b');
    expect(h1).toEqual({ past: ['a'], present: 'b', future: [], limit: 50 });
    expect(canUndo(h1)).toBe(true);
    const h2 = push(h1, 'c');
    expect(h2.past).toEqual(['a', 'b']);
    expect(h2.present).toBe('c');
    const back = undo(h2);
    expect(canRedo(back)).toBe(true);
    const branched = push(back, 'd');
    expect(branched).toEqual({ past: ['a', 'b'], present: 'd', future: [], limit: 50 });
    expect(canRedo(branched)).toBe(false);
  });

  it('undo moves the present to the future and redo brings it back', () => {
    const h = push(push(createHistory('a'), 'b'), 'c');
    const u1 = undo(h);
    expect(u1).toEqual({ past: ['a'], present: 'b', future: ['c'], limit: 50 });
    const u2 = undo(u1);
    expect(u2).toEqual({ past: [], present: 'a', future: ['b', 'c'], limit: 50 });
    const r1 = redo(u2);
    expect(r1).toEqual({ past: ['a'], present: 'b', future: ['c'], limit: 50 });
    const r2 = redo(r1);
    expect(r2).toEqual(h);
  });

  it('trims the oldest entries beyond the limit', () => {
    let h = createHistory(0, 3);
    for (let i = 1; i <= 5; i++) h = push(h, i);
    expect(h.past).toEqual([2, 3, 4]);
    expect(h.present).toBe(5);
    expect(h.limit).toBe(3);
    // Undo can only go back as far as the retained past.
    let u = h;
    for (let i = 0; i < 10; i++) u = undo(u);
    expect(u.present).toBe(2);
    expect(u.future).toEqual([3, 4, 5]);
  });

  it('undo and redo at the bounds are no-ops that return an equal structure', () => {
    const empty = createHistory('a');
    expect(undo(empty)).toEqual(empty);
    expect(undo(empty)).toBe(empty);
    expect(redo(empty)).toEqual(empty);
    expect(redo(empty)).toBe(empty);
    const withPast = push(empty, 'b');
    expect(redo(withPast)).toBe(withPast);
    const withFuture = undo(withPast);
    expect(undo(withFuture)).toBe(withFuture);
  });

  it('canUndo / canRedo reflect past and future', () => {
    const h0 = createHistory(pack());
    const h1 = push(h0, pack([ev({ id: 'EV-001' })]));
    expect([canUndo(h0), canRedo(h0)]).toEqual([false, false]);
    expect([canUndo(h1), canRedo(h1)]).toEqual([true, false]);
    const back = undo(h1);
    expect([canUndo(back), canRedo(back)]).toEqual([false, true]);
  });

  it('pushing the identical present is a no-op (no phantom undo step)', () => {
    const p = pack();
    const h = createHistory(p);
    expect(push(h, p)).toBe(h);
    expect(canUndo(push(h, p))).toBe(false);
  });

  it('replace swaps the present without recording a step but still discards the redo branch', () => {
    const h = undo(push(push(createHistory('a'), 'b'), 'c'));
    expect(h).toEqual({ past: ['a'], present: 'b', future: ['c'], limit: 50 });
    const r = replace(h, 'B');
    expect(r).toEqual({ past: ['a'], present: 'B', future: [], limit: 50 });
    expect(replace(r, 'B')).toBe(r);
  });

  it('never mutates the history it is given and clamps a nonsensical limit', () => {
    const h = push(createHistory('a'), 'b');
    const snapshot = JSON.stringify(h);
    push(h, 'c');
    replace(h, 'z');
    undo(h);
    redo(undo(h));
    expect(JSON.stringify(h)).toBe(snapshot);
    expect(createHistory('a', -5).limit).toBe(0);
    expect(createHistory('a', Number.NaN).limit).toBe(50);
    expect(createHistory('a', 2.9).limit).toBe(2);
    expect(push(createHistory('a', 0), 'b')).toEqual({ past: [], present: 'b', future: [], limit: 0 });
  });
});

describe('fingerprint / isDirty', () => {
  function permuted(p: EvidencePack): EvidencePack {
    // Same data, every object key written in a different order (and nested maps reversed).
    const text = JSON.stringify({
      decisions: p.decisions.map((d) => ({ decidedOn: d.decidedOn, rationale: d.rationale, verdict: d.verdict, reviewer: d.reviewer, subcategoryId: d.subcategoryId })),
      evidence: p.evidence.map((e) => ({
        note: e.note,
        source: e.source,
        assertion: e.assertion,
        scope: e.scope,
        validDays: e.validDays,
        collectedOn: e.collectedOn,
        subcategoryIds: e.subcategoryIds,
        type: e.type,
        title: e.title,
        id: e.id,
      })),
      profile: { priorities: Object.fromEntries(Object.entries(p.profile.priorities).reverse()), asOf: p.profile.asOf, name: p.profile.name },
      schema: p.schema,
    });
    return JSON.parse(text) as EvidencePack;
  }

  const base = pack(
    [ev({ id: 'EV-001', note: 'first' }), ev({ id: 'EV-002', type: 'report', subcategoryIds: ['PR.DS-11', 'GV.PO-01'] })],
    [{ subcategoryId: 'GV.PO-01', reviewer: 'R. Reviewer', verdict: 'gap', rationale: 'No artefact yet.', decidedOn: '2026-10-01' }],
    { priorities: { 'PR.DS-11': 3, 'GV.PO-01': 1 } },
  );

  it('is equal across key-order-permuted clones at every level', () => {
    const other = permuted(base);
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(base)); // plain JSON differs…
    expect(fingerprint(other)).toBe(fingerprint(base)); // …the fingerprint does not
    expect(fingerprint(base)).toBe(fingerprint(JSON.parse(JSON.stringify(base)) as EvidencePack));
  });

  it('changes when any field changes, including nested values and array order', () => {
    const fp = fingerprint(base);
    const changedDays = JSON.parse(JSON.stringify(base)) as EvidencePack;
    changedDays.evidence[0].validDays = 366;
    expect(fingerprint(changedDays)).not.toBe(fp);
    const changedPriority = JSON.parse(JSON.stringify(base)) as EvidencePack;
    changedPriority.profile.priorities['PR.DS-11'] = 2;
    expect(fingerprint(changedPriority)).not.toBe(fp);
    const reordered = JSON.parse(JSON.stringify(base)) as EvidencePack;
    reordered.evidence.reverse();
    expect(fingerprint(reordered)).not.toBe(fp);
    const removedNote = JSON.parse(JSON.stringify(base)) as EvidencePack;
    delete removedNote.evidence[0].note;
    expect(fingerprint(removedNote)).not.toBe(fp);
  });

  it('treats an explicitly undefined optional field like an absent one and is itself canonical JSON of the pack', () => {
    const a = pack([ev({ id: 'EV-001' })]);
    const b = pack([ev({ id: 'EV-001', note: undefined })]);
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(fingerprint(a).length).toBeGreaterThan(0);
    expect(JSON.parse(fingerprint(a))).toEqual(a);
    expect(fingerprint(a)).toBe(fingerprint(JSON.parse(fingerprint(a)) as EvidencePack));
  });

  it('isDirty is true with no export, false right after export, true after a change', () => {
    expect(isDirty(base, null)).toBe(true);
    const exported = fingerprint(base);
    expect(isDirty(base, exported)).toBe(false);
    expect(isDirty(permuted(base), exported)).toBe(false);
    const changed = JSON.parse(JSON.stringify(base)) as EvidencePack;
    changed.profile.name = 'Renamed profile';
    expect(isDirty(changed, exported)).toBe(true);
    expect(isDirty(base, '')).toBe(true);
  });
});
