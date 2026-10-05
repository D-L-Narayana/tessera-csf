# Tessera — CSF 2.0 outcome-evidence mapper

[Open the public educational demo](https://dln-tessera.vercel.app). State is browser-local and, unless you opt in to keeping it in your browser, resets on refresh; use synthetic inputs only.

**Educational prototype. Synthetic data only. Not a certification, attestation, audit opinion or legal/compliance conclusion.**

Tessera answers one question for a small security team: *which of our target outcomes are actually evidenced right now, and why not?* It maps evidence artifacts to a 25-subcategory educational subset of the **NIST Cybersecurity Framework (CSF) 2.0** (NIST CSWP 29, February 26, 2024), scores evidence freshness, detects contradictory evidence, records reviewer decisions with guardrails, and produces a ranked gap register that can be exported as JSON, CSV or Markdown.

The mosaic is the main view: one tile per subcategory, colour = CSF Function, pattern = evidence status. Selecting a tile opens a drawer with the full rule trace ("how this status was derived"), every artifact with its age, weight and the dates on which it turns aging and stale, and the reviewer decision form with a live preview of what the decision will do.

## Key workflows

1. **Review the readiness mosaic** for the loaded profile and date ("Evaluate as of" is editable; the whole evaluation recomputes). The **Summary** above the mosaic gives the status distribution, per-function counts and the number of refused reviewer actions.
2. **Open an outcome** → read the derivation trace → see fresh/aging/stale artifacts, refutations and contradictions. The mosaic is keyboard-navigable (arrow keys, Home/End) and every status is encoded by pattern and text, never by colour alone.
3. **Add, edit or remove evidence** for the selected outcome (validated: type, scope, assertion, collection date, validity window, optional note, optional collector, other outcomes the artifact also applies to). Removing asks for confirmation; **Undo/Redo** cover every change.
4. **Record a reviewer decision** — accepted / needs-more / gap / not-applicable — after checking the **Decision preview**. Accepting a non-sufficient outcome or scoping it out is an *override*: it requires a substantive rationale (40 characters by default), is refused while evidence is contradicted or refuted, and is refused when the reviewer also collected all of the current supporting evidence (**separation of duties**). Refusals are shown in the drawer and flagged on the tile.
5. **Set outcome priority** (1–3) from the target profile; residual exposure scales with it.
6. **Tune the rule policy** (optional): aging multiplier, decision validity, minimum rationale, sufficiency thresholds, separation of duties. The policy is stored in the pack and embedded in every exported report, so a report can always be reproduced; a non-default policy is labelled "custom policy".
7. **Look ahead with the Horizon** (30/60/90/180 days): which artifacts turn aging or stale, which decisions lapse, and which outcomes are projected to change if nothing is done.
8. **Compare with a previous report**: import a report JSON exported earlier and see which outcomes improved, regressed or changed, with warnings when the profile, dates or rule policy differ.
9. **Work the gap register** (ranked by residual exposure, with generated remediation text) — filter by function, status, band or free text; sort; include closed outcomes.
10. **Import / export**: pack (`tessera.pack/1`) to continue later; report (`tessera.report/1`) as JSON, formula-safe CSV (full results, gap register, evidence inventory) or a Markdown summary. JSON Schemas for both formats are published under `/schemas/`.
11. **Keep the session in this browser** (opt-in, unencrypted, synthetic data only): the pack is re-validated on every restore and can be forgotten with one click. Leaving the page with unexported changes prompts first.

The bundled demo pack (Harbourline Logistics, synthetic) deliberately contains adversarial cases: a contradicted outcome, a future-dated artifact, a stale 2024 acceptance, a too-short override rationale, an acceptance with no evidence and a self-reviewed override refused under separation of duties.

## Quickstart

```bash
npm ci
npm test             # vitest, 690 tests across 25 files
npm run build        # tsc + vite → dist/
npm run check:dist   # build-output guard: no inline script/style, relative URLs, size budget, schemas present
npm run qa:serve     # http://127.0.0.1:6120/ with the production vercel.json headers (CSP enforced)
```

Node ≥ 20.19 (CI runs 20 and 22). No backend, no environment variables, no network calls at runtime. `docs/` explains each feature; `docs/qa.md` describes the browser workflow and accessibility audit scripts in `qa/`.

## Algorithm (custom educational heuristic — not a NIST score)

CSF 2.0 defines outcomes, not numeric scoring. Every number below is this project's own, documented rule set. All thresholds live in one **rule policy** (`tessera.policy/1`, see `docs/policy.md`); the defaults are listed here and every report embeds the policy it was computed with.

| Step | Rule (default policy) |
|---|---|
| Freshness | `age = asOf − collectedOn`. `fresh` if `age ≤ validDays`; `aging` if `age ≤ 1.5 × validDays`; otherwise `stale`. Future-dated artifacts are `stale` (negative age) — a data-entry error must not count as current. |
| Weight | supporting artifact weight = freshness factor (fresh 1, aging 0.5, stale 0) × scope factor (full 1, partial 0.5). Refuting artifacts carry no weight; current ones (fresh/aging) trigger contradiction/refutation. |
| Computed status | `refuted` if only current evidence refutes; `contradicted` if current evidence both supports and refutes; otherwise `none` (coverage 0), `weak` (0 < coverage < 1), `partial` (coverage ≥ 1 but one evidence type), `sufficient` (coverage ≥ 1 and ≥ 2 distinct types). Stale refutations are ignored and noted in the trace. The two-type rule is metadata-only: two rows describing the same artifact under two types satisfy it; the tool has no artifact content to tell them apart. |
| Decision freshness | A decision is valid for 365 days from `decidedOn` and never when dated after `asOf`. Stale decisions are ignored with a `stale decision` warning and must be re-made; the computed status stands. |
| Reviewer overlay | `gap` → `weak` (unless already none/contradicted/refuted). `needs-more` → caps at `partial`. `accepted` on `weak`/`partial` = override to `sufficient`, needs ≥ 40 chars, never applies over contradicted/refuted. `accepted` on `none` (no current evidence) → `accepted-risk`: explicitly not sufficient, stays in the gap register with its own remediation text. `not-applicable` needs ≥ 40 chars and never applies over contradicted/refuted. Refused actions are returned as `warnings`. |
| Separation of duties | When every current supporting artifact records a `collectedBy` equal to the accepting reviewer, the override is refused (`overrideIssue: self-review`) and the computed status stands. Artifacts without `collectedBy` do not trigger the rule — it is metadata-only and only as good as the recorded collector. |
| Residual exposure | `exposure(status) × priority`: none/refuted/contradicted 1.0, weak 0.8, accepted-risk 0.6, partial 0.5, sufficient 0.15, not-applicable 0. Bands: low < 0.75 ≤ moderate < 1.75 ≤ high. |
| Function rollup | mean residual over *assessed* outcomes; a function where everything is scoped out reports `not-assessed`, never "low risk". |
| Gap register | all outcomes not sufficient / not-applicable (so `accepted-risk` is listed), sorted by residual desc then id. |
| Horizon | an artifact turns aging on `collectedOn + validDays + 1` and stale on `collectedOn + ⌊validDays × 1.5⌋ + 1`; a decision lapses on `decidedOn + 365 + 1`. Projections re-evaluate the unchanged pack at the horizon date. |

Known false positives / unsupported cases: a correctly current artifact with a mistyped date becomes stale; two artifacts of the same type never reach sufficient even if independently strong (by design: single-source); evidence quality (who produced it, sampling) is not modelled beyond the optional collector field; the subset omits 81 subcategories.

## Architecture

```
src/engine/catalog.ts    25 CSF 2.0 subcategories (ids + outcome statements, transcribed from CSWP 29)
src/engine/types.ts      pack / report schemas
src/engine/policy.ts     rule policy (tessera.policy/1): defaults, bounds, canonical form
src/engine/evaluate.ts   pure decision engine (freshness, status, overlay incl. separation of duties, residual, rollup)
src/engine/validate.ts   bounded, path-addressed import validation (512 KiB UTF-8, ≤ 500 artifacts, ≤ 25 refs, policy bounds)
src/engine/forecast.ts   horizon: boundary dates, lapsing decisions, projected outcome changes
src/engine/compare.ts    bounded import of a previous report and per-outcome deltas
src/engine/csv.ts        formula-safe CSV (results, gap register, evidence inventory)
src/engine/markdown.ts   Markdown summary export
src/ui/*                 React 19 presentation (App, Mosaic, Drawer + forms, Summary, Horizon, Compare, PolicyPanel,
                         GapRegister, ExportMenu, SessionBar), no engine logic; storage/history/dirty helpers are pure
src/fixtures/            synthetic Harbourline Logistics pack with adversarial cases
public/schemas/          JSON Schemas for tessera.pack/1 and tessera.report/1
tests/                   vitest suites (engine, validation, fuzz, forecast, compare, exports, schemas, UI markup, contrast, deploy)
qa/                      portable QA: serve-dist (production headers), check-dist, browser workflow, axe audit; recorded runs
docs/                    reader-facing feature documentation
```

State is in memory (history-backed for undo/redo) and resets on refresh unless the user opts in to browser storage; anything restored from storage is re-validated first. Deep links use the URL hash (`#/PR.DS-11`). Fonts (Fraunces, Public Sans; OFL-1.1) are self-hosted via @fontsource. `vercel.json` sets a strict CSP (`script-src 'self'; style-src 'self'`, no inline styles anywhere in the app), nosniff, frame denial, referrer policy, HSTS and immutable caching for hashed assets; `qa/serve-dist.mjs` replays exactly those headers locally so the browser checks run under the enforced policy. The UI follows the system colour scheme (light and dark, both contrast-tested) and has a print layout.

## Tests

`npm test` runs 690 tests: 48 engine + 154 contrast (the 28 original light-scheme checks plus 126 for the dark scheme and the status-pattern tile fills) + 66 theme/print + 16 mosaic markup + 40 rule policy and separation of duties + 59 validator hardening and seeded fuzz + 34 horizon + 40 compare + 33 drawer editing and decision preview + 59 session, history and dirty tracking + 48 gap register and summary + 52 exports and JSON Schemas + 36 deployment and QA tooling + 5 whole-app composition. Each feature was written test-first; the RED/GREEN evidence for the original build and for this upgrade is in `EVIDENCE.md` and `qa/`.

## Data handling

Everything is synthetic: `.example` systems, fictional reviewers, fictional company. Imports (packs and previous reports) are validated against bounds before use; nothing is sent anywhere; downloads use transient blob URLs. CSV cells beginning with `= + - @ |` (even after whitespace) are prefixed with `'`; CSV downloads carry a UTF-8 byte-order mark for spreadsheet clients. Browser storage is used only after the user ticks "Keep this session in this browser"; the stored copy is unencrypted, limited to the same 512 KiB bound, re-validated on restore and deleted with "Forget saved session".

## Limitations

- 25 of 106 subcategories; crosswalk/informative references are not included.
- Heuristic scoring is a teaching device, not a maturity model or Tier; changing the rule policy changes every status, which is why the policy travels with the report.
- Single-reviewer model; separation of duties relies on the recorded collector and cannot verify identities.
- No multi-user workflow or authentication; persistence is a single opt-in browser copy.
- Evidence content is metadata only (no file upload); see **Weft** in the same track for content hashing.

## JD evidence (truthful framing)

Demonstrates: security-framework assessment vocabulary (CSF 2.0 Functions/Categories/Subcategories), control-evidence reasoning, GRC-style review decisions with rationale, executive-readable gap register, test-first TypeScript, accessible UI. It does **not** demonstrate ServiceNow/RSA Archer/OneTrust product experience, a real assessment engagement, or any certification.

## AI-assistance disclosure

Built in October 2026 with substantial AI assistance: an AI coding agent drafted the design plan, code, tests and documentation and executed the verification recorded in `EVIDENCE.md`. The 0.2 upgrade (rule policy, separation of duties, horizon, comparison, editing, session safety, theme, exports, QA) was produced the same way and has not had independent human review. This does not by itself establish the candidate's understanding; the candidate should review the code and be able to explain it (see `INTERVIEW_GUIDE.md`) before presenting it. Framework text was transcribed from primary NIST publications; heuristic rules and paraphrases were written for this project and are labelled as such.

## References

- NIST CSF 2.0, NIST CSWP 29 (Feb 26, 2024): https://doi.org/10.6028/NIST.CSWP.29
- NIST CSF 2.0 landing page: https://www.nist.gov/cyberframework
