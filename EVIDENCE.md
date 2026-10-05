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

- An external Playwright + axe audit script (wcag2a/wcag2aa/wcag21aa), run from outside the repository. **Correction of an earlier claim:** the first audit run reported 0 violations, but at that moment the bundled fixture failed validation (page error, item 6) so almost nothing rendered — the "0 violations" was measured on an empty page and was not re-run after the fixture fix. The parent's independent scan of the built assets then found `color-contrast` failures across 3 viewports (ochre `#b07a1f` on paper 3.49:1; muted ink `#6b7790` 4.23:1). Root cause: text roles reused the tile-fill hue and a too-light muted token; the build was not stale — the source itself was non-compliant.
  Fix, test-first: `tests/contrast.test.ts` (28 tests) computes WCAG 2.1 relative-luminance contrast for every text-role token against both surfaces and asserts the text-role CSS rules use text-safe tokens. RED: **10 failed | 18 passed** (`--ink-3`, `--pr`, `--rc`, `--good` on the ground surface, and the new `--de-text`/`--warn-text` tokens). GREEN after retinting (`--ink-3 #56627a`, `--pr/--good #276b5c`, `--rc #4f6a2c`, new `--de-text`/`--warn-text #8a5a10` for text while `--de`/`--warn` stay fill/border-only): **70 passed (70)** across both files.
  Re-audit with an explicitly pinned Chromium build on the rebuilt `dist/`: **0 violations, 0 page errors, no overflow at 1440 / 768 / 375** for the default view (`qa/audit/`) and for a deep link (`qa/audit-de/`). The deep-link run was first made against `#/DE.CM-01` to exercise the ochre Detect function text; the committed `qa/audit-de/browser-audit.json` records the later `#/RC.CO-03` run, which overwrote it.
- `qa/workflow.mjs` (own Playwright script): **16/16 checks pass** — default contradicted outcome with refused acceptance banner; hash deep link; stale remediation; add evidence recomputes partial → sufficient; short not-applicable refused then substantive accepted; import of malformed pack rejected with path-addressed details; CSV export = header + 25 rows; report JSON schema; empty profile → 25 gaps; keyboard Enter selects tile; no console/page errors; mobile 375 no horizontal overflow. Screenshots `qa/screens/01…07`, results `qa/screens/workflow-results.json`.

## Independent review fixes (test-first)

An independent review of the assurance behaviour, with a reproduction script, showed: zero evidence + `accepted` decision dated 2020 → `sufficient`, residual 0.3, out of the gap register. Six regression tests written first — RED **6 failed | 42 passed** (`qa/red-engine.txt`). Fix: `DECISION_VALID_DAYS = 365` (decisions older than that, or dated after `asOf`, are ignored with a `stale decision` warning; boundary tested at 365/366 days); `accepted` on `none` now yields the new status `accepted-risk` (exposure 0.6, stays in the gap register, own remediation text) and never `sufficient`; report carries `decisionPolicy`; README documents the two-type rule as metadata-only. Fixture gained an accepted-risk (RC.CO-03) and a stale 2024 acceptance (GV.RM-02). GREEN **76 passed (76)** (48 engine + 28 contrast). Build ✓; workflow 16/16; axe 0 at 3 viewports on the default view and `#/RC.CO-03`.

## Facts usable in a resume bullet (measured)

- 76 unit tests, test-first, including 12 engine regression tests and a 28-test WCAG contrast guard, all driven by external review.
- 25 CSF 2.0 subcategories across all six Functions, statements transcribed from NIST CSWP 29.
- 0 axe WCAG 2.1 AA violations at 3 viewports on the final build (after a contrast correction found by independent review); 0 npm audit findings.
- Import validator bounded at 512 KiB UTF-8 / 500 artifacts / 25 refs with path-addressed errors.

## Not measured / not claimed

No user study, no real organisation data, no performance benchmark, no cross-browser matrix (Chromium headless only).

---

## 0.2 upgrade — measured results

Measured on 2026-10-05 in the build sandbox (Node v20.20.1, npm 10.8.2, Linux). Commands and outputs are reproduced from the recorded logs; nothing below is estimated.

### Baseline before any change

`npm ci --no-fund --ignore-scripts` → `added 99 packages`. `npm run typecheck` ✓. `npm test` → **76 passed (76)** in 2 files (48 engine + 28 contrast). `npm run build` ✓ (JS 268.42 kB, 83.28 kB gzip; CSS 10.61 kB, 3.15 kB gzip). `npm audit --audit-level=high` → `found 0 vulnerabilities`.

### Test-first (RED → GREEN) per work package

Each package wrote its tests first against a minimal API stub so the suite collected, recorded assertion failures for the missing behaviour, then implemented and recorded the passing run. An unresolved import or a compile error was not accepted as RED; every RED log below shows collected tests with assertion failures and zero import errors.

| Package | Test files | RED (collected → failing) | GREEN |
|---|---|---|---|
| Rule policy / separation of duties | `policy`, `separation-of-duties`, `policy-ui` | 19 → 12 failed · 11 → 6 failed · 10 → 9 failed | 19 · 11 · 10 (88 with the frozen 48 engine tests) |
| Validator hardening / fuzz | `validate-hardening`, `fuzz-invariants` | 53 → 47 failed · 6 → 2 failed | 53 · 6 (107 with the frozen 48) |
| Horizon forecast | `forecast`, `horizon-ui` | 21 → 21 failed · 13 → 12 failed | 21 · 13 |
| Compare with previous report | `compare`, `compare-ui` | 27 → 26 failed · 13 → 10 failed | 27 · 13 |
| Drawer editing / decision preview | `drawer-logic`, `drawer-ui` | 21 → 18 failed · 12 → 10 failed | 21 · 12 |
| Session persistence / undo | `session`, `history`, `session-ui` | 33 → 26 failed · 13 → 10 failed · 13 → 13 failed | 33 · 13 · 13 |
| Theme / mosaic keyboard / print | `contrast` (additive), `theme`, `mosaic-ui` | 151 → 100 failed · 65 → 62 failed · 16 → 11 failed | 154 · 66 · 16 |
| Gap register / summary | `register-logic`, `register-ui` | 29 → 24 failed · 19 → 17 failed | 29 · 19 |
| Exports / JSON Schemas | `exports`, `export-ui`, `schemas` | 27 → 26 failed · 6 → 6 failed · 19 → 19 failed | 27 · 6 · 19 |
| QA / CI / deployment | `deploy` | 36 → 31 failed (against the original `vercel.json`, workflow and `verify.yml`) | 36 |
| Whole-app composition (integration) | `app-ui` | 5 → 3 failed (before the panels were wired into `App.tsx`) | 5 |

The RED runs that passed a few tests did so where a stub trivially satisfied a negative assertion (for example "no inline styles" against an empty component) or where the baseline already behaved correctly; the failing assertions were the new behaviour. The `deploy` RED is the measured state of the original deployment configuration: `style-src 'self' 'unsafe-inline'`, no HSTS, no cache rules, a Node-20-only workflow.

The 48 original engine tests pass unchanged (one `describe` title was relabelled; no assertion was touched) and the 28 original contrast tests are a byte-for-byte prefix of the extended file. The bundled fixture gained two `collectedBy` fields and a self-reviewed `PR.DS-01` acceptance so the separation-of-duties refusal is visible in the demo; every status the frozen fixture test asserts is unchanged, and one forecast test was changed to derive the set of applied decisions from the fixture instead of hard-coding five identifiers.

### Final gates (integrated tree, run sequentially)

```
 Test Files  25 passed (25)
      Tests  690 passed (690)
```

`npm run typecheck` ✓ · `npm run build` ✓ (JS 327.72 kB, 100.55 kB gzip as reported by Vite; CSS 25.10 kB, 5.89 kB gzip) · `node qa/check-dist.mjs` ✓ (no inline script/style/handler, relative URLs, 98.0 kB gzip against the 120 kB budget by its own zlib measurement, licence file and both schemas present, 8 font `url()` targets resolve, no `data:` URLs) · `npm audit --audit-level=high` → `found 0 vulnerabilities`.

### Browser QA under the production CSP

`dist/` was served by `qa/serve-dist.mjs`, which applies the exact `vercel.json` headers (CSP without `unsafe-inline`, nosniff, DENY, no-referrer, HSTS, immutable asset caching, `no-cache` for the document). `qa/workflow.mjs`: **38/38 checks pass** — the original 16; header assertions on `/`, the compiled JS asset, the CSS asset and a woff2 font (`qa/screens/headers.json` records every response header; the CSP on all four is byte-equal to `vercel.json`); fonts load under `font-src 'self'`; zero `securitypolicyviolation` events and zero console CSP refusals; zero requests to foreign origins; edit evidence, confirm + undo, horizon (EV-003 absent at 60 days, present at 90), compare (self-import → 25 unchanged), policy (minimum rationale 10 turns GV.PO-01 sufficient; custom-policy badge; reset), gap register filter by function, summary, Markdown export (`qa/screens/export-summary-sample.md`), gap-register CSV (20 lines for 19 gaps) and evidence-inventory CSV (23 lines for 22 artifacts), session controls (nothing stored before opt-in; `tessera.session/1` saved and forgotten), dark-scheme and print renderings (`qa/screens/08-dark.png`, `09-print.png`). Results: `qa/screens/workflow-results.json`.

Accessibility: `qa/axe-audit.mjs` (axe-core 4.13.0, injected from a local bundle via `--axe-source` into a separately identified instrumentation context — recorded in each result as `axe-instrumentation (bypassCSP: true; application CSP unchanged on the server)`; the application flow above ran in a normal context under the enforced CSP). **0 violations, 0 page errors, no horizontal overflow** at 1440 / 768 / 375 for `/` and `/#/RC.CO-03` in the light scheme (`qa/audit/`) and for `/` in the dark scheme (`qa/audit-dark/`). Each page also reports one `color-contrast` result as *incomplete* (axe could not compute a ratio for some nodes and asks for manual review); the text-on-fill pairings it cannot measure — the status-pattern tile fills in both schemes — are checked arithmetically by `tests/contrast.test.ts`.

### Not measured / not claimed

No user study, no real organisation data, no performance benchmark beyond the gzip budget, no cross-browser matrix (Chromium headless only), no screen-reader session. The production headers were asserted against the local replay of `vercel.json`, not against the live deployment. The upgrade has not had independent human review.
