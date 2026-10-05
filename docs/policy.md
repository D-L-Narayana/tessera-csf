# Rule policy (`tessera.policy/1`)

Every threshold the engine uses lives in one object, the *rule policy*. A pack may carry its own policy (`pack.policy`);
when it does not, the engine uses the built-in defaults, which are the heuristic documented in the README ("Algorithm").
Every report embeds the policy it was computed with (`report.policy`) together with `report.policyIsDefault`, so a report
can be reproduced later even if the defaults change.

Everything on this page is this project's own educational heuristic. It is not a NIST score, tier or maturity rating —
CSF 2.0 does not define numeric scoring — and nothing here is a certification, attestation or audit opinion.

## Fields, defaults and bounds

| Field | Default | Bounds | What it controls |
|---|---|---|---|
| `schema` | `tessera.policy/1` | fixed | Schema tag; required whenever a policy is present |
| `agingMultiplier` | 1.5 | 1 – 5 | An artifact is `fresh` while `age ≤ validDays`, `aging` while `age ≤ validDays × agingMultiplier`, and `stale` after that (or when dated in the future) |
| `freshnessWeights` | fresh 1, aging 0.5, stale 0 | each 0 – 1; fresh ≥ aging ≥ stale | Weight factor by freshness |
| `scopeWeights` | full 1, partial 0.5 | each 0 – 1; full ≥ partial | Weight factor by scope. A supporting artifact's weight is freshness factor × scope factor (rounded to three decimals); refuting artifacts carry no weight |
| `sufficientCoverage` | 1 | 0.1 – 10 | Coverage (sum of supporting weights) an outcome needs before it can be `partial` or `sufficient`; below it the outcome is `weak` |
| `minDistinctTypes` | 2 | 1 – 7 | Distinct supporting evidence types needed for `sufficient`; with fewer types the outcome stops at `partial` |
| `exposure` | none 1, refuted 1, contradicted 1, weak 0.8, partial 0.5, sufficient 0.15, accepted-risk 0.6, not-applicable 0 | each 0 – 1; `not-applicable` must be 0 | Residual exposure = exposure(status) × priority |
| `bands` | moderate 0.75, high 1.75 | each 0.01 – 3; moderate < high | residual < moderate → `low`; < high → `moderate`; otherwise `high` (also used for the function rollups) |
| `minOverrideRationale` | 40 | 0 – 2000 | Characters (after trimming) a rationale needs to accept a non-sufficient outcome or to scope one out |
| `decisionValidDays` | 365 | 1 – 3650 | A decision applies while `asOf − decidedOn ≤ decisionValidDays` and never when dated after `asOf`; otherwise it is ignored with a `stale decision` warning and the computed status stands |
| `separationOfDuties` | true | boolean | Enables the guardrail described below |

The import validator (see `validation.md`) rejects policies outside these bounds and rebuilds accepted policies in the key
order shown above, so comparing a policy with the defaults is reliable. A pack without a `policy` field validates and
evaluates exactly as it did before policies existed.

## What changes when the policy changes

The policy applies to every outcome at once. The trace shown in the drawer ("How this status was derived") quotes the
thresholds that were actually used — for example "aging up to 1.5× validDays", "sufficient needs coverage ≥ 1 from ≥ 2
types", "rationale needs ≥ 40 characters" and "limit 365" for decision validity — so a reader can tell which rule produced a
status without opening the policy object. Remediation text follows the policy as well: the coverage target, the number of
evidence types still missing and the number of days after which an accepted risk lapses are all taken from the policy in
force.

## Separation of duties

Evidence may record who collected it (`collectedBy`). When `separationOfDuties` is on, an `accepted` verdict on an outcome
whose computed status is `weak` or `partial` is refused if **every current supporting artifact** (an artifact with weight
above zero) was collected by the reviewer who is accepting it. Collector and reviewer are compared after trimming and
without regard to letter case.

- **Refused.** The result keeps its computed status; `override` is `true`, `overrideValid` is `false` and `overrideIssue` is
  `self-review`. The warning reads `override refused: reviewer <reviewer> also collected all current supporting evidence
  (separation of duties)`, and the remediation adds "Independent evidence or a different reviewer is required." The
  `override` column of the CSV export reads `invalid`.
- **Not applied** when any current supporting artifact has no `collectedBy` (packs without provenance evaluate exactly as
  before), when at least one current supporting artifact names a different collector, when the computed status is already
  `sufficient` (accepting the computed result is not an override), or on the accepted-risk path (computed `none`: there is
  no current evidence to have collected).
- Stale artifacts and refuting artifacts do not count either way: only current supporting evidence can provide
  independence.
- A rationale that is too short is reported first (`overrideIssue: 'short-rationale'`, warning `override rationale too
  short; computed status kept`); the separation check runs only on rationales that are long enough.

## Report embedding

`buildReport` adds two fields to `tessera.report/1`: `policy`, the full policy used (in canonical key order), and
`policyIsDefault`. The report's `decisionPolicy` and `scoringNote` texts are generated from the same policy, so they
describe the validity window, the rationale minimum, the accepted-risk exposure and whether the separation-of-duties rule
was in force. Reports stay byte-deterministic for identical input, with or without a custom policy.

The **Rule policy** panel in the app edits the fields teams tune most often — aging multiplier, decision validity, minimum
override rationale, sufficient coverage, distinct evidence types and separation of duties — and clamps every value to the
bounds above. A **custom policy** badge appears whenever the policy differs from the defaults; **Reset to defaults**
removes `pack.policy`. Weights, exposure factors and bands can be set in the pack JSON. Exporting a pack keeps its policy,
and re-importing it reproduces the same report.

For code that calls the engine directly: `effectivePolicy(pack)` returns the policy in force, `canonicalPolicy(p)`
rebuilds a policy in canonical key order, `isDefaultPolicy(p)` compares it with the defaults, and `clampPolicyField`
applies the bounds used by the panel. `MIN_OVERRIDE_RATIONALE` and `DECISION_VALID_DAYS` remain exported as aliases of the
default values; the engine itself reads the pack's effective policy.

## How it is tested

`tests/policy.test.ts` checks that the default policy reproduces the baseline status of every outcome in the bundled
fixture, that each field changes exactly what it should (aging multiplier, freshness and scope weights, decision validity,
rationale length, distinct types, coverage threshold, bands, exposure), that reports embed the policy and the generated
texts correctly, that key order does not affect default detection, and that output stays deterministic.
`tests/separation-of-duties.test.ts` covers the refused and allowed cases listed above, including the CSV column.
`tests/policy-ui.test.tsx` renders the panel to static markup and checks the exact labels, the `min`/`max`/`step`
attributes, the badge, the label–input association and the absence of inline styles.
