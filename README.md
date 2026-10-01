# Tessera — CSF 2.0 outcome-evidence mapper

**Educational prototype. Synthetic data only. Not a certification, attestation, audit opinion or legal/compliance conclusion.**

Tessera answers one question for a small security team: *which of our target outcomes are actually evidenced right now, and why not?* It maps evidence artifacts to a 25-subcategory educational subset of the **NIST Cybersecurity Framework (CSF) 2.0** (NIST CSWP 29, February 26, 2024), scores evidence freshness, detects contradictory evidence, records reviewer decisions with guardrails, and produces a ranked gap register that can be exported as JSON or CSV.

The mosaic is the main view: one tile per subcategory, colour = CSF Function, pattern = evidence status. Selecting a tile opens a drawer with the full rule trace ("how this status was derived"), every artifact with its age and weight, and the reviewer decision form.

## Key workflows

1. **Review the readiness mosaic** for the loaded profile and date ("Evaluate as of" is editable; the whole evaluation recomputes).
2. **Open an outcome** → read the derivation trace → see fresh/aging/stale artifacts, refutations and contradictions.
3. **Add or remove evidence** for the selected outcome (validated: type, scope, assertion, collection date, validity window).
4. **Record a reviewer decision** — accepted / needs-more / gap / not-applicable. Accepting a non-sufficient outcome or scoping it out is an *override*: it requires a ≥ 40-character rationale and is refused while evidence is contradicted or refuted. Refusals are shown in the drawer and flagged on the tile.
5. **Set outcome priority** (1–3) from the target profile; residual exposure scales with it.
6. **Work the gap register** (ranked by residual exposure, with generated remediation text).
7. **Import / export** a pack (`tessera.pack/1`) to continue later; export the report (`tessera.report/1`) as JSON or a formula-safe CSV.

## Quickstart

```bash
npm ci
npm test          # vitest, 76 tests (48 engine + 28 theme-contrast)
npm run build     # tsc + vite → dist/
npm run preview   # http://127.0.0.1:6120/
```

Node ≥ 20.19. No backend, no environment variables, no network calls at runtime.

## Algorithm (custom educational heuristic — not a NIST score)

CSF 2.0 defines outcomes, not numeric scoring. Every number below is this project's own, documented rule set.

| Step | Rule |
|---|---|
| Freshness | `age = asOf − collectedOn`. `fresh` if `age ≤ validDays`; `aging` if `age ≤ 1.5 × validDays`; otherwise `stale`. Future-dated artifacts are `stale` (negative age) — a data-entry error must not count as current. |
| Weight | supporting artifact weight = freshness factor (fresh 1, aging 0.5, stale 0) × scope factor (full 1, partial 0.5). Refuting artifacts carry no weight; current ones (fresh/aging) trigger contradiction/refutation. |
| Computed status | `refuted` if only current evidence refutes; `contradicted` if current evidence both supports and refutes; otherwise `none` (coverage 0), `weak` (0 < coverage < 1), `partial` (coverage ≥ 1 but one evidence type), `sufficient` (coverage ≥ 1 and ≥ 2 distinct types). Stale refutations are ignored and noted in the trace. The two-type rule is metadata-only: two rows describing the same artifact under two types satisfy it; the tool has no artifact content to tell them apart. |
| Decision freshness | A decision is valid for `DECISION_VALID_DAYS = 365` days from `decidedOn` and never when dated after `asOf`. Stale decisions are ignored with a `stale decision` warning and must be re-made; the computed status stands. |
| Reviewer overlay | `gap` → `weak` (unless already none/contradicted/refuted). `needs-more` → caps at `partial`. `accepted` on `weak`/`partial` = override to `sufficient`, needs ≥ 40 chars, never applies over contradicted/refuted. `accepted` on `none` (no current evidence) → `accepted-risk`: explicitly not sufficient, stays in the gap register with its own remediation text. `not-applicable` needs ≥ 40 chars and never applies over contradicted/refuted. Refused actions are returned as `warnings`. |
| Residual exposure | `exposure(status) × priority`: none/refuted/contradicted 1.0, weak 0.8, accepted-risk 0.6, partial 0.5, sufficient 0.15, not-applicable 0. Bands: low < 0.75 ≤ moderate < 1.75 ≤ high. |
| Function rollup | mean residual over *assessed* outcomes; a function where everything is scoped out reports `not-assessed`, never "low risk". |
| Gap register | all outcomes not sufficient / not-applicable (so `accepted-risk` is listed), sorted by residual desc then id. |

Known false positives / unsupported cases: a correctly current artifact with a mistyped date becomes stale; two artifacts of the same type never reach sufficient even if independently strong (by design: single-source); evidence quality (who produced it, sampling) is not modelled; the subset omits 81 subcategories.

## Architecture

```
src/engine/catalog.ts   25 CSF 2.0 subcategories (ids + outcome statements, transcribed from CSWP 29)
src/engine/types.ts     pack / report schemas
src/engine/evaluate.ts  pure decision engine (freshness, status, overlay, residual, rollup, CSV)
src/engine/validate.ts  bounded, path-addressed import validation (512 KiB UTF-8, ≤ 500 artifacts, ≤ 25 refs)
src/ui/*                React 19 presentation (App, Mosaic, Drawer), no engine logic
src/fixtures/           synthetic Harbourline Logistics pack with adversarial cases
tests/engine.test.ts    48 vitest tests (engine + validation + fixture)
tests/contrast.test.ts  28 WCAG 2.1 AA contrast checks on theme text tokens
qa/                     RED/GREEN runs, browser audit, workflow script, screenshots
```

State is in memory only (reset on refresh by design; previews run in restricted environments without storage APIs). Deep links use the URL hash (`#/PR.DS-11`). Fonts (Fraunces, Public Sans; OFL-1.1) are self-hosted via @fontsource. `vercel.json` sets CSP, nosniff, frame denial and referrer policy.

## Tests

`npm test` runs 76 tests: 28 guard theme text-token contrast (≥ 4.5:1 on both surfaces); 48 cover freshness boundaries, weighting, contradiction/refutation, reviewer guardrails (including the parent-review regressions: byte-accurate size limit, no silent truncation, not-applicable cannot hide contradictions, all-N/A rollups are not-assessed), residual bands, determinism, CSV formula-injection (including leading whitespace), and the bundled fixture. RED/GREEN evidence is in `EVIDENCE.md` and `qa/`.

## Data handling

Everything is synthetic: `.example` systems, fictional reviewers, fictional company. Imports are validated against bounds before use; nothing is sent anywhere; downloads use transient blob URLs. CSV cells beginning with `= + - @` (even after whitespace) are prefixed with `'`.

## Limitations

- 25 of 106 subcategories; crosswalk/informative references are not included.
- Heuristic scoring is a teaching device, not a maturity model or Tier.
- No multi-user workflow, authentication or persistence.
- Evidence content is metadata only (no file upload); see **Weft** in the same track for content hashing.

## JD evidence (truthful framing)

Demonstrates: security-framework assessment vocabulary (CSF 2.0 Functions/Categories/Subcategories), control-evidence reasoning, GRC-style review decisions with rationale, executive-readable gap register, test-first TypeScript, accessible UI. It does **not** demonstrate ServiceNow/RSA Archer/OneTrust product experience, a real assessment engagement, or any certification.

## AI-assistance disclosure

Built in October 2026 with substantial AI assistance: an AI coding agent drafted the design plan, code, tests and documentation and executed the verification recorded in `EVIDENCE.md`. This does not by itself establish the candidate's understanding; the candidate should review the code and be able to explain it (see `INTERVIEW_GUIDE.md`) before presenting it. Framework text was transcribed from primary NIST publications; heuristic rules and paraphrases were written for this project and are labelled as such.

## References

- NIST CSF 2.0, NIST CSWP 29 (Feb 26, 2024): https://doi.org/10.6028/NIST.CSWP.29
- NIST CSF 2.0 landing page: https://www.nist.gov/cyberframework
