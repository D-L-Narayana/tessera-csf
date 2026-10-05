# Session safety: undo/redo, the unsaved-changes guard, and opt-in browser persistence

Tessera keeps the review in memory. Three small mechanisms make that harder to lose by accident without
changing the browser-local, no-backend design: an undo/redo history, an unsaved-changes guard, and an
**opt-in** copy of the session in the browser's own storage. Everything below works on synthetic data only;
none of it is a certification, attestation or audit opinion.

## Undo and redo

- Every change to the pack (profile fields, priorities, evidence added/edited/removed, decisions recorded or
  cleared, importing a pack, loading the demo, starting empty) is one undo step. Loading the demo or starting
  empty by mistake is therefore recoverable with **Undo**.
- Depth: the last **50** states are retained; older ones are dropped. **Redo** is available after an undo
  until the next change, which discards the redo branch.
- The history is a pure structure (`src/ui/history.ts`): `createHistory`, `push`, `replace` (swap the present
  without recording a step, for coalescing continuous edits), `undo`, `redo`, `canUndo`, `canRedo`. Pushing
  the identical state is a no-op, and undo/redo at the bounds return the same structure.

## Unsaved-changes guard

- The session bar shows **Unsaved changes** while the pack differs from the last state that was safe to lose,
  and **All changes exported** otherwise.
- "Safe to lose" is decided by a fingerprint, not by a flag: the canonical JSON of the pack (object keys sorted
  at every level, `undefined` fields dropped, array order kept — `src/ui/dirty.ts`). The fingerprint of the
  last safe state is compared with the current pack, so undoing back to that state is clean again and
  key-order differences never count as changes.
- Safe states: the freshly loaded demo, an empty profile and a just-imported pack (each can be reproduced from
  the bundle or the file), and the pack as it was at the last **Export pack**. Report exports (JSON, CSV,
  Markdown) do not count, because a report cannot be re-imported as a pack. A session restored from browser
  storage starts as unsaved: it exists nowhere but in this browser.
- While the state is dirty, a `beforeunload` handler asks the browser to show its generic "leave this page?"
  prompt; the handler is removed as soon as the state is clean again. Destructive actions (load demo, start
  empty, import) ask for confirmation when the state is dirty.

## Opt-in persistence ("Keep this session in this browser")

Nothing is written unless the box is ticked. Nothing read back is trusted.

### What is stored

| | |
|---|---|
| Where | `window.localStorage` of the site's origin, key `tessera.session/1` |
| Format | JSON `{ "schema": "tessera.session/1", "savedAt": "<ISO 8601 UTC date-time>", "pack": <evidence pack>, "selected": "<subcategory id>" or null }` |
| Size | at most 524,288 bytes (the same `MAX_PACK_BYTES` bound as pack import); larger sessions are refused, not truncated |
| Encryption | none. The copy is readable by anyone with access to the browser profile and by any script running on the same origin. The bar says so: "Stored unencrypted in this browser only. Synthetic data only." |

### When it is written

- Only when the checkbox is ticked **and** the browser passed a feature probe (a set/remove of a probe key
  inside `try`/`catch`). Private modes, sandboxed previews and disabled storage make the probe fail; the
  checkbox is then disabled with the text "Browser storage is not available here."
- Writes are debounced: 300 ms after the last change (pack or selected outcome). A pending write is flushed
  on `pagehide` so an edit made just before closing the tab is not lost.
- A write is refused, leaving the previous stored copy untouched, when the pack would not pass import
  validation (for example an empty profile name while typing), when the serialised session exceeds the size
  bound, or when the browser throws (quota exceeded). The bar then shows "Not saved: <reason>".
- Unticking the box stops further writes but does **not** delete the stored copy; only **Forget saved
  session** does.

### Validation on load

At start-up the stored value goes through `loadSession` (`src/ui/storage.ts`), which rejects, with a reason:

1. a value above the size bound (never parsed);
2. text that is not valid JSON;
3. anything that is not an object tagged `"schema": "tessera.session/1"`;
4. a `savedAt` that is not an ISO 8601 UTC date-time;
5. a pack that fails `validatePackObject` — the same bounded validator used for file import. The pack placed
   in application state is the validator's clean object, so unknown keys stored alongside it are dropped.

`selected` is kept only when it is one of the 25 subcategory ids of the subset; anything else becomes null.
When the stored session is accepted it replaces the bundled demo as the starting state, the checkbox stays
ticked (the earlier consent still stands) and the notice says when it was saved. A rejected session is
ignored (the app starts normally with the demo) and can be removed with **Forget saved session**.

### Forgetting

**Forget saved session** removes the key, drops any pending write and clears the "Saved <time>" text. The
button is shown whenever persistence is on, a save has happened in this page, or a stored session was found
at start-up. Clearing the browser's site data has the same effect.

## Session bar

`SessionBar` (`src/ui/SessionBar.tsx`, styles in `src/ui/session.css`) is a toolbar labelled "Session" with
**Undo**, **Redo** (disabled when not possible), the status text, the persistence checkbox with its
explanation, "Saved <time>", "Not saved: <reason>", **Forget saved session**, and the privacy line. Status is
always conveyed as text; colour only reinforces it. The component uses no inline styles.

## How it is tested

- `tests/session.test.ts` — save/load round trip against an in-memory store; every rejection reason; unknown
  keys dropped on load; selection sanitised; oversized session refused with the byte limit; a throwing (quota)
  store returns `ok: false`; `clearSession`; `detectStorage` in Node, with a working store, with a missing or
  throwing `localStorage`; the debounced saver (coalescing, cancel, flush) and the consent-aware controller
  (no writes while disabled, withdrawal keeps the stored copy, Forget, error reporting, flush, dispose) with
  fake timers.
- `tests/history.test.ts` — push/undo/redo semantics, redo cleared on push, limit trimming, no-ops at the
  bounds, `canUndo`/`canRedo`, `replace`, immutability; fingerprint equality across key-order-permuted clones,
  sensitivity to every field and to array order, `isDirty` before and after export.
- `tests/session-ui.test.tsx` — the exact strings and states of the session bar rendered in Node, label/input
  association, disabled checkbox with explanation, no inline styles, no duplicate ids; the `beforeunload`
  handler and subscription logic; the hooks rendering without a `window`.
