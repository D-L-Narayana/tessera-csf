# Evidence — Tessera

Measured on 2026-10-01 in the build sandbox (Node v20.20.1, npm 10.8.2, Linux). Commands and outputs are reproduced verbatim where shown; nothing below is estimated.

## Test-first (RED → GREEN)

1. `tests/engine.test.ts` written first against the planned API (`src/engine/evaluate.ts`, `src/engine/validate.ts`).
2. First run: `Error: Cannot find module '../src/engine/evaluate'` (module missing).
3. Stub exports added so the suite could collect: **30 failed | 1 passed (31)** — only the catalog test could pass because the catalog existed. Verbatim list in `qa/red-engine.txt`.
4. Engine implemented → **29 passed, 2 failed**: both failures were a spec inconsistency in the status thresholds (`partial` vs `weak` for coverage 0.5). Resolved by fixing the engine rule (weak = coverage < 1; partial = coverage ≥ 1 with one type), not the tests.
5. Parent source review raised four points; regression tests were added **before** each fix and seen failing:
   - size limit counted UTF-16 length not UTF-8 bytes → `expected 'file is not valid JSON' to match /too large/i`
   - `subcategoryIds.slice(0,25)` / `priorities.slice(0,200)` silently truncated → `expected true to be false`
   - not-applicable could greenwash contradicted evidence → `expected 'not-applicable' to be 'contradicted'`
   - all-N/A function rolled up as low risk → `expected undefined to be +0` (new `assessed`/`not-assessed` fields)
   - CSV leading-whitespace formula cases → `expected false to be true`
6. Bundled fixture test added and failed first (`ID.AM-08` is not in the 25-subcategory subset; the validator caught a real fixture defect) → fixture corrected.

Final: `npm test`

```
 Test Files  2 passed (2)
      Tests  76 passed (76)
```

(48 engine/validation tests + 28 theme-contrast tests.)

## Build

`npm ci` → `added 97 packages`. `npm run build` → `tsc -p tsconfig.json && vite build` → `✓ built`, `dist/` 660 KB including self-hosted woff/woff2 fonts; JS bundle 266 kB (82.6 kB gzip).

## Dependency audit

Initial `npm audit`: 2 moderate (GHSA-82fw-gwwq-j7x9, `@vitest/mocker` redirect-mock path traversal; dev-only, not shipped). Upgraded to `vitest@4.1.11` (required `--legacy-peer-deps` because npm 10.8.2 crashes on vitest 4 peer resolution — `Cannot read properties of null (reading 'edgesOut')`). After upgrade: `found 0 vulnerabilities`; `npm ci` from the committed lockfile works.

## Browser QA

Preview served at `http://127.0.0.1:6120/` (vite preview).

- `tools/browser_audit.mjs` (parent harness; Playwright + axe, wcag2a/wcag2aa/wcag21aa). **Correction of an earlier claim:** the first audit run reported 0 violations, but at that moment the bundled fixture failed validation (page error, item 6) so almost nothing rendered — the "0 violations" was measured on an empty page and was not re-run after the fixture fix. The parent's independent scan of the built assets then found `color-contrast` failures across 3 viewports (ochre `#b07a1f` on paper 3.49:1; muted ink `#6b7790` 4.23:1). Root cause: text roles reused the tile-fill hue and a too-light muted token; the build was not stale — the source itself was non-compliant.
  Fix, test-first: `tests/contrast.test.ts` (28 tests) computes WCAG 2.1 relative-luminance contrast for every text-role token against both surfaces and asserts the text-role CSS rules use text-safe tokens. RED: **10 failed | 18 passed** (`--ink-3`, `--pr`, `--rc`, `--good` on the ground surface, and the new `--de-text`/`--warn-text` tokens). GREEN after retinting (`--ink-3 #56627a`, `--pr/--good #276b5c`, `--rc #4f6a2c`, new `--de-text`/`--warn-text #8a5a10` for text while `--de`/`--warn` stay fill/border-only): **70 passed (70)** across both files.
  Re-audit with the parent's explicit `CHROMIUM_EXECUTABLE_PATH` (chromium-1217) on the rebuilt `dist/`: **0 violations, 0 page errors, no overflow at 1440 / 768 / 375** for the default view (`qa/audit/`) and for the `#/DE.CM-01` deep link exercising the ochre Detect function text (`qa/audit-de/`).
- `qa/workflow.mjs` (own Playwright script): **16/16 checks pass** — default contradicted outcome with refused acceptance banner; hash deep link; stale remediation; add evidence recomputes partial → sufficient; short not-applicable refused then substantive accepted; import of malformed pack rejected with path-addressed details; CSV export = header + 25 rows; report JSON schema; empty profile → 25 gaps; keyboard Enter selects tile; no console/page errors; mobile 375 no horizontal overflow. Screenshots `qa/screens/01…07`, results `qa/screens/workflow-results.json`.

## Sixth-Fable review fixes (test-first)

Review `selection/sixth-fable-review.md` §Assurance, repro `ts-adverse.mjs`: zero evidence + `accepted` decision dated 2020 → `sufficient`, residual 0.3, out of the gap register. Six regression tests written first — RED **6 failed | 42 passed** (`qa/red-engine.txt`). Fix: `DECISION_VALID_DAYS = 365` (decisions older than that, or dated after `asOf`, are ignored with a `stale decision` warning; boundary tested at 365/366 days); `accepted` on `none` now yields the new status `accepted-risk` (exposure 0.6, stays in the gap register, own remediation text) and never `sufficient`; report carries `decisionPolicy`; README documents the two-type rule as metadata-only. Fixture gained an accepted-risk (RC.CO-03) and a stale 2024 acceptance (GV.RM-02). GREEN **76 passed (76)** (48 engine + 28 contrast). Build ✓; workflow 16/16; axe 0 at 3 viewports on the default view and `#/RC.CO-03`.

## Facts usable in a resume bullet (measured)

- 76 unit tests, test-first, including 12 engine regression tests and a 28-test WCAG contrast guard, all driven by external review.
- 25 CSF 2.0 subcategories across all six Functions, statements transcribed from NIST CSWP 29.
- 0 axe WCAG 2.1 AA violations at 3 viewports on the final build (after a contrast correction found by independent review); 0 npm audit findings.
- Import validator bounded at 512 KiB UTF-8 / 500 artifacts / 25 refs with path-addressed errors.

## Not measured / not claimed

No user study, no real organisation data, no performance benchmark, no cross-browser matrix (Chromium headless only).
