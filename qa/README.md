# qa/ — verification scripts and artifacts

Everything in this directory is portable: the scripts use Node built-ins, load Playwright and axe optionally,
contain no machine-specific paths, and write results with relative paths only.

| Path | What it is |
|---|---|
| `serve-dist.mjs` | Static server for `dist/` that sends the **production headers from `vercel.json`** (CSP, HSTS, nosniff, DENY, caching). Never relaxed. |
| `check-dist.mjs` | Build-output gate (also run in CI): no inline script/style, relative asset URLs, JS gzip budget, licence file, schemas parse, CSS url() targets, data: URLs vs CSP. |
| `workflow.mjs` | Browser workflow under the **enforced CSP**: the 16 original checks plus the 0.2 workflows, exports, dark/print screenshots, CSP-violation / foreign-request / header assertions. |
| `axe-audit.mjs` | axe-core WCAG 2.0/2.1 A+AA audit at 1440 / 768 / 375 (optionally dark), in a separately labelled **instrumentation context**. |
| `screens/` | Latest workflow run: screenshots `01`–`09` (`08` dark scheme, `09` print), `workflow-results.json`, `headers.json` (response headers of `/`, the JS and CSS assets and a woff2 font), `export-sample.csv`, `export-summary-sample.md`. |
| `audit/` | Latest light-scheme axe audit (`/` and `/#/RC.CO-03`, 1440 / 768 / 375). |
| `audit-dark/` | Latest dark-scheme axe audit (`/`, 1440 / 768 / 375). |
| `audit-de/` | 0.1 deep-link audit (`#/DE.CM-01`) kept for history. |
| `red-engine.txt`, `green-engine.txt` | Verbatim RED/GREEN vitest output from the original test-first history. |

## 1. Build and gate the output

```bash
npm ci
npm run build                 # tsc + vite → dist/
node qa/check-dist.mjs        # exit 1 on any FAIL row
```

`check-dist` options: `--dist <dir>` (default `dist`), `--budget-kb <n>` or `BUDGET_JS_GZIP_KB=<n>` (default 120),
`--config <vercel.json>` (source of the CSP used for the data: URL check).

| Row | PASS when |
|---|---|
| `index.html present` | `dist/index.html` exists |
| `no inline <script>` | every `<script>` has `src` |
| `no <style> element` / `no style= attribute` / `no inline event handlers` / `no <base> element` | none present (CSP is `style-src 'self'`, `base-uri 'none'`) |
| `asset URLs relative` | every script/stylesheet/preload/icon/media URL starts with `./` (the bundle must work from any sub-path) |
| `referenced assets exist` | each `./…` reference resolves to a file in `dist/` |
| `JS gzip budget` | gzip total of `dist/assets/*.js` ≤ budget |
| `THIRD_PARTY_LICENSES.txt` | the licence file was copied from `public/` |
| `schemas parse` | every `dist/schemas/*.json` parses (WARN, not FAIL, when the directory is absent) |
| `CSS url() targets exist` | relative `url()` references in `dist/assets/*.css` (the self-hosted woff2/woff fonts) resolve |
| `data: URLs in CSS` | INFO only — lists `mime ×count` |
| `data: URLs vs production CSP` | each data: MIME type is allowed by the matching directive (`img-src data:` is; `font-src` is not) |

## 2. Serve with the production headers

```bash
node qa/serve-dist.mjs --port 6120           # prints: serving dist on http://127.0.0.1:6120
```

Options: `--port` (6120), `--host` (127.0.0.1), `--dist` (dist), `--config` (vercel.json). The server applies every
`headers` rule whose `source` matches the request path (later rules override earlier ones per header), follows
`cleanUrls` (`/` → `index.html`, `/name` → `name.html`, `/name.html` → 308 to `/name`), serves correct MIME types
(`text/javascript`, `font/woff2`, …), supports HEAD, answers 404 for anything outside `dist/`, and stops on
SIGINT/SIGTERM. `vite preview` does **not** apply `vercel.json`; use this server for header and CSP checks.

## 3. Browser QA (Playwright is not a repo dependency)

Install Playwright once in a scratch directory outside the repo and point `NODE_PATH` at it. Browsers come from
Playwright's default cache or from `PLAYWRIGHT_BROWSERS_PATH`:

```bash
mkdir -p ../qa-tools && (cd ../qa-tools && npm init -y >/dev/null && npm i playwright @axe-core/playwright)
(cd ../qa-tools && npx playwright install chromium)      # skip when PLAYWRIGHT_BROWSERS_PATH already has it
export NODE_PATH=$PWD/../qa-tools/node_modules
# export PLAYWRIGHT_BROWSERS_PATH=/path/to/ms-playwright    # only when the browsers live elsewhere

node qa/serve-dist.mjs --port 6120 &                      # terminal 1 (or background)
node qa/workflow.mjs  --url http://127.0.0.1:6120/ --out qa/screens
node qa/axe-audit.mjs --url http://127.0.0.1:6120/ --out qa/audit
node qa/axe-audit.mjs --url http://127.0.0.1:6120/ --out qa/audit-dark --dark
```

Both scripts exit **2** with the message *"Install playwright (and @axe-core/playwright) in a scratch directory and
point NODE_PATH at its node_modules; browsers come from Playwright's default cache or PLAYWRIGHT_BROWSERS_PATH"*
when the library or the browser is missing — that is an environment problem, not a test result.

### 3.1 `workflow.mjs` — what each check asserts

Runs at 1440×1000 under the enforced CSP (no bypass), then a 375-wide context for the deep link. Dialogs
(`confirm`, `beforeunload`) are recorded and accepted. Results: `qa/screens/workflow-results.json`
(`[{ name, pass, detail? }]`), response headers: `qa/screens/headers.json`. Exit 1 on any failure.

| Check | Asserts |
|---|---|
| fonts load under font-src self | after `document.fonts.ready`, `document.fonts.check('12px Fraunces')` is true and no `FontFace` is in `error` |
| drawer shows PR.DS-11 / status contradicted / reviewer acceptance refused banner | the default selection is the contradicted fixture with a visible refusal `.warnbox` |
| edit evidence | **Edit EV-004** → heading **Edit evidence EV-004** → new Title → **Save changes** → the drawer list shows the new title |
| remove confirm dialog recorded | **Remove EV-004** raises a `confirm` dialog (recorded, accepted) and the artifact disappears |
| undo restores evidence | **Undo** brings EV-004 back |
| hash deep link / stale remediation text | selecting DE.CM-01 sets `#/DE.CM-01`; remediation mentions stale evidence |
| status recomputed after add / two types -> sufficient | adding a fresh log-sample moves DE.CM-01 to `partial`; a procedure makes it `sufficient` |
| short N/A refused / substantive N/A accepted | `not-applicable` with "n/a" is refused with the "substantive" message; a ≥ 40-character rationale is accepted |
| import rejected with details | malformed pack JSON produces an error notice with path-addressed items |
| csv has header + 25 rows / report schema | report CSV has 26 CRLF lines; report JSON is `tessera.report/1` with 25 results |
| empty gap register has 25 gaps | **Start empty** lists 25 gaps |
| keyboard selects tile | focusing the first tile and pressing Enter opens GV.OC-03 |
| horizon lists EV-003 at 90 days | **Horizon (days)** 60 does not list EV-003; 90 does (aging on 2026-12-22) |
| compare self import → all unchanged | importing the just-exported report in **Compare with a previous report** yields "… 25 unchanged" |
| policy min rationale 10 → GV.PO-01 sufficient | **Rule policy** → **Minimum override rationale (characters)** = 10 → GV.PO-01 becomes `sufficient` |
| custom policy badge shown / policy reset restores default | the **custom policy** badge is visible; **Reset to defaults** returns GV.PO-01 to `partial` and hides it |
| gap register filter by function | **Function** = GV lists only GV outcomes |
| summary present | the **Summary** heading with an accessible visual (`role="img"` or `<meter>`) |
| markdown export downloaded | **Export summary (Markdown)** — last line starts with `Generated by Tessera (educational prototype)` |
| gap register CSV rows = gaps+1 | **Export gap register CSV** line count = `report.gaps.length + 1` |
| evidence inventory CSV has header | **Export evidence inventory CSV** header has ≥ 5 columns; rows = `pack.evidence.length + 1` |
| session checkbox present / session persistence opt-in saves and forgets | **Keep this session in this browser** exists; nothing is in `localStorage` before opt-in; checking writes `tessera.session/1`; **Forget saved session** clears it |
| dark scheme screenshot | `emulateMedia({ colorScheme: 'dark' })` changes the page background → `08-dark.png` |
| print screenshot | `emulateMedia({ media: 'print' })` hides `.profile__actions` → `09-print.png` |
| no page/console errors / no failed requests | no `pageerror`/`console.error`; no network failures or HTTP ≥ 400 (favicon excluded) |
| mobile no horizontal overflow | `scrollWidth ≤ 375` at `#/PR.DS-11` |
| no CSP violations | zero `securitypolicyviolation` events (registered with `addInitScript`) and zero "Refused to …" console lines on both pages |
| no foreign requests | every request targets the served origin |
| index and asset headers | `/`: CSP byte-equal to `vercel.json`, nosniff, DENY, no-referrer, HSTS present, `Cache-Control: no-cache`; first `/assets/*.js` and `*.css`: correct `Content-Type`, same CSP, `immutable`; a `/assets/*.woff2` response is 200 `font/woff2` |

### 3.2 `axe-audit.mjs` — options and output

`--url` (default `http://127.0.0.1:6120/`), `--out` (default `qa/audit`), `--paths` comma list (default
`/,/#/RC.CO-03`), `--dark` (emulates `prefers-color-scheme: dark`, adds `-dark` to entry names),
`--axe-source <axe.min.js>` (see below). Tags: `wcag2a`, `wcag2aa`, `wcag21aa`. Viewports: 1440 / 768 / 375.

Output `<out>/browser-audit.json` keeps the shape of the earlier audits — an array of
`{ name, status, url, errors, failedRequests, layout, violations, incompleteChecks }` — plus `path`, `colorScheme`,
`context`, `engine`, `axeVersion`, `tags`, `horizontalOverflow`. Screenshots are `<out>/<name>.png`. Exit 1 when any
page has a violation, a page error or horizontal overflow.

**Instrumentation context.** axe must inject its script, so every audit page is opened in a context created with
`bypassCSP: true` and recorded as `"context": "axe-instrumentation (bypassCSP: true; application CSP unchanged on
the server)"`. The served headers are untouched; CSP enforcement is measured by `workflow.mjs`, which never bypasses it.

**Without `@axe-core/playwright`.** If only a copy of axe-core's `axe.min.js` is available (for example
`node_modules/axe-core/axe.min.js` from any scratch install), pass `--axe-source <path>`: the file is injected with
`page.addScriptTag`, `window.axe.run(document, { runOnly: { type: 'tag', values: [...] } })` is evaluated, and the
output records `"engine": "axe-source: axe.min.js"` plus `axeVersion` from `window.axe.version`. With the library it
records `"engine": "@axe-core/playwright"`.

## 4. Continuous integration

`.github/workflows/verify.yml` runs on Node 20 and 22 (`npm ci --no-fund` → `npm run typecheck` → `npm test` →
`npm run build` → `node qa/check-dist.mjs` → `npm audit --audit-level=high`) with read-only permissions, SHA-pinned
actions and cancel-in-progress concurrency. The browser scripts are not run in CI (no Playwright dependency); they
are run before a release against the built `dist/` and their artifacts are committed here.

`tests/deploy.test.ts` guards the configuration itself: the CSP directives and security headers in `vercel.json`,
the cache rules, `serve-dist` header resolution and request handling, `check-dist` findings, the workflow matrix and
step order, and the portability of these scripts (no private paths, CSP bypass only in the audit script).
