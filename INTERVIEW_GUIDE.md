# Interview guide — Tessera

_Purpose:_ preparation material written during the AI-assisted build. It describes how the code works and what happened while building it; it is not a record of the candidate's existing knowledge. Study it against the code before presenting the project.

## Core engine in two minutes

Tessera turns a list of evidence artifacts into a status per CSF 2.0 outcome. Each artifact has a collection date and a validity window; its weight decays from 1 (fresh) to 0.5 (aging, up to 1.5× the window) to 0 (stale). Scope halves the weight. Supporting weights sum to *coverage*; a status needs coverage ≥ 1 **and** two distinct evidence types to be *sufficient*, because a policy alone proves intent, not operation. Refuting artifacts that are still current make the outcome *contradicted* (if something also supports it) or *refuted*. A reviewer can overlay a decision, but the engine refuses decisions that would hide a contradiction or lack a substantive rationale, and records the refusal as a warning. Residual exposure is status exposure × profile priority; the gap register is sorted by it.

## One failure case worth telling

The bundled fixture referenced `ID.AM-08`, which is a real CSF 2.0 subcategory but not in the 25-item subset. The import validator rejected the app's own demo data at first paint — the browser audit caught it as a page error. The fix was to the fixture, and a test now asserts that the fixture validates and that each adversarial case (future-dated scan, contradicted backups, short override rationale) produces the intended status. Lesson: validate your own fixtures through the same gate as user input.

## A second failure case: a green result that meant nothing

The first accessibility scan reported zero violations — on a page that had failed to render its fixture. Nobody re-ran it after the fixture was fixed, and an independent scan later found ochre text at 3.49:1 and muted text at 4.23:1. The fix was to separate fill tokens from text tokens and to add a test that computes WCAG contrast from the stylesheet itself, so the check cannot silently pass on an empty page again. Lesson: a passing check is only evidence if you know what it actually examined.

## Why the tests look the way they do

- Boundary tests on freshness (exactly `validDays` is fresh; +1 day is aging) because off-by-one here silently changes a status.
- Determinism test (byte-identical report JSON) because exported reports are compared over time.
- Guardrail tests came from an external review: byte-accurate size limit, no silent truncation of input, not-applicable cannot zero a contradiction, all-N/A function is *not-assessed* rather than *low*. Each was written failing first.
- CSV tests include whitespace-prefixed formulas because spreadsheet clients trim before interpreting.

## Questions you should be able to answer

- Why two evidence *types* rather than two artifacts? (Independence of sources; a second screenshot of the same console is not corroboration.)
- Why is aging 1.5×? (Arbitrary but explicit; show where to change it and that the tests pin the behaviour.)
- Why is the score "not a NIST score"? (CSF 2.0 defines outcomes and Tiers for governance practice, not numeric control scoring. The heuristic is ours.)
- What would you add for production? Below.

## Production next steps

Persisted, versioned packs with an audit log; multi-reviewer separation (preparer ≠ approver); evidence content hashing (see Weft); informative-reference crosswalk to SP 800-53 Rev. 5 controls; configurable rule parameters stored with the report so old reports stay reproducible; a schema (JSON Schema) published for the pack and report formats; screen-reader testing.
