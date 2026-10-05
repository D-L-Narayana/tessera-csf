# Interview guide — Tessera

_Purpose:_ preparation material written during the AI-assisted build. It describes how the code works and what happened while building it; it is not a record of the candidate's existing knowledge. Study it against the code before presenting the project.

## Core engine in two minutes

Tessera turns a list of evidence artifacts into a status per CSF 2.0 outcome. Each artifact has a collection date and a validity window; its weight decays from 1 (fresh) to 0.5 (aging, up to 1.5× the window) to 0 (stale). Scope halves the weight. Supporting weights sum to *coverage*; a status needs coverage ≥ 1 **and** two distinct evidence types to be *sufficient*, because a policy alone proves intent, not operation. Refuting artifacts that are still current make the outcome *contradicted* (if something also supports it) or *refuted*. A reviewer can overlay a decision, but the engine refuses decisions that would hide a contradiction, lack a substantive rationale, or come from the person who collected all the supporting evidence — and records the refusal as a warning. Residual exposure is status exposure × profile priority; the gap register is sorted by it. Every threshold lives in one rule policy that travels with the report.

## One failure case worth telling

The bundled fixture referenced `ID.AM-08`, which is a real CSF 2.0 subcategory but not in the 25-item subset. The import validator rejected the app's own demo data at first paint — the browser audit caught it as a page error. The fix was to the fixture, and a test now asserts that the fixture validates and that each adversarial case (future-dated scan, contradicted backups, short override rationale) produces the intended status. Lesson: validate your own fixtures through the same gate as user input.

## A second failure case: a green result that meant nothing

The first accessibility scan reported zero violations — on a page that had failed to render its fixture. Nobody re-ran it after the fixture was fixed, and an independent scan later found ochre text at 3.49:1 and muted text at 4.23:1. The fix was to separate fill tokens from text tokens and to add a test that computes WCAG contrast from the stylesheet itself, so the check cannot silently pass on an empty page again. Lesson: a passing check is only evidence if you know what it actually examined.

## A third failure case: the next id was already taken

The 0.1 drawer numbered new artifacts by `evidence.length + 1`. Remove any artifact from the demo and the next addition collided with an existing id; the validator correctly refused it, but the user had no way out. The 0.2 fix derives the next id from the highest existing suffix and is pinned by a test that removes EV-005 and expects EV-023. Lesson: counts are not identifiers.

## Why the tests look the way they do

- Boundary tests on freshness (exactly `validDays` is fresh; +1 day is aging) because off-by-one here silently changes a status.
- Determinism test (byte-identical report JSON) because exported reports are compared over time — and since 0.2 the app performs that comparison itself.
- Guardrail tests came from an external review: byte-accurate size limit, no silent truncation of input, not-applicable cannot zero a contradiction, all-N/A function is *not-assessed* rather than *low*. Each was written failing first.
- CSV tests include whitespace-prefixed formulas because spreadsheet clients trim before interpreting; 0.2 adds the `|` trigger.
- A fixture snapshot pins that the default rule policy reproduces every 0.1 status, so the policy refactor could not change behaviour unnoticed.
- Seeded fuzzing (300 random valid packs, 300 mutated ones) asserts the validator never throws, is idempotent, and that engine invariants hold — properties that example-based tests cannot cover.
- UI tests render components to static markup in Node and assert the exact control names the browser workflow uses, plus the absence of inline styles, because the production CSP is `style-src 'self'`.

## What changed in 0.2 (and why)

- **Rule policy embedded in reports.** Every threshold moved from constants into `src/engine/policy.ts`. A report now carries the exact policy it was computed with, so an old export can be reproduced after the defaults change. The default policy reproduces the 0.1 behaviour; that is pinned by a fixture snapshot test.
- **Separation of duties.** Artifacts may record who collected them. If the person accepting a weak/partial outcome collected *all* of its current supporting evidence, the override is refused and the computed status stands. It is deliberately metadata-only: the tool can only reason about what was recorded.
- **Horizon.** Freshness and decision validity are dates, so the engine can say *when* an artifact turns aging or stale and when a decision lapses, and re-evaluate the unchanged pack at a future date to show which outcomes will change if nobody acts.
- **Compare.** Determinism was justified by "reports are compared over time"; now the app does the comparison, with warnings when the profile, the date order or the rule policy differ.
- **Editing, undo, confirm, opt-in persistence.** The 0.1 drawer could add and remove but not edit. State is now history-backed, destructive actions confirm, and the user may keep a copy in browser storage — re-validated on restore because storage is just another untrusted input.
- **Dark scheme, print, keyboard mosaic.** `index.html` already declared `color-scheme: light dark` without dark styles. Contrast is now computed from the stylesheet for both schemes, including tile fills, and the mosaic is one tab stop with arrow-key navigation.
- **Exports and schemas.** Gap-register and evidence-inventory CSVs, a Markdown summary, and published JSON Schemas with drift tests against the fixture and the engine output.
- **QA under the production CSP.** `style-src 'unsafe-inline'` was dropped because the application has no inline styles; the browser workflow now runs against a server that applies the exact `vercel.json` headers and records CSP violations, console refusals and foreign requests.

## Questions you should be able to answer

- Why two evidence *types* rather than two artifacts? (Independence of sources; a second screenshot of the same console is not corroboration.)
- Why is aging 1.5×? (Arbitrary but explicit; it is now a policy field, the tests pin the default, and the report records whatever was used.)
- Why is the score "not a NIST score"? (CSF 2.0 defines outcomes and Tiers for governance practice, not numeric control scoring. The heuristic is ours.)
- Why embed the policy in the report instead of versioning the code? (Reports are the artefact people keep; the policy is what makes a number meaningful.)
- Why does separation of duties ignore artifacts without a collector? (No regression for existing packs; the rule must never invent provenance.)
- Why does a lapsed `gap` verdict make an outcome *improve* in the horizon view, and is that desirable? (Decisions age symmetrically; the horizon shows the consequence so the reviewer re-decides rather than letting a finding silently expire.)
- Why is comparison a warning, not an error, when the policies differ? (The user may legitimately be comparing across a policy change; the tool's job is to make that visible.)
- Why validate what comes out of `localStorage`? (Anything the app did not compute in this session is input; storage can be edited by other code on the origin or by the user.)
- Why run axe in a separate browser context? (The engine must be injected as a script; doing that under the application's CSP would require weakening it. The application flow is tested with the real CSP, and the instrumentation context is labelled in the output.)
- What would you add for production? Below.

## Production next steps

Persisted, versioned packs with an audit log; multi-reviewer separation enforced by identity rather than a self-declared collector field; evidence content hashing (see Weft); informative-reference crosswalk to SP 800-53 Rev. 5 controls; screen-reader testing; a cross-browser matrix.
