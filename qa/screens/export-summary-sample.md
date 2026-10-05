# Tessera report — Harbourline Logistics (synthetic demo profile)

_Educational prototype using synthetic evidence — not a certification, attestation or audit opinion. See Notes._

- As of: 2026-10-01
- Framework: NIST CSF 2.0 (CSWP 29, 2024-02-26)
- Subset: 25 of 106 subcategories (educational subset)
- Outcomes: 25 (6 sufficient, 19 in the gap register, 0 not applicable)
- Evidence artifacts: 22 · Reviewer decisions: 7 · Reviewer warnings: 4

## Rule policy

Computed with the default policy (`tessera.policy/1`).

| Parameter | Value |
| --- | --- |
| agingMultiplier | 1.5 |
| decisionValidDays | 365 |
| minOverrideRationale | 40 |
| sufficientCoverage | 1 |
| minDistinctTypes | 2 |
| separationOfDuties | true |

## Functions

| Function | Sufficient | Assessed | Mean residual | Band |
| --- | ---: | ---: | ---: | --- |
| GV — Govern | 0/6 | 6 | 1.30 | moderate |
| ID — Identify | 2/5 | 5 | 1.32 | moderate |
| PR — Protect | 3/8 | 8 | 1.16 | moderate |
| DE — Detect | 0/2 | 2 | 2.50 | high |
| RS — Respond | 1/2 | 2 | 0.65 | low |
| RC — Recover | 0/2 | 2 | 1.30 | moderate |

## Gap register

19 of 25 outcomes are not sufficiently evidenced, ranked by residual exposure (priority × status exposure).

| # | Outcome | Status | Priority | Residual | Band | Remediation |
| ---: | --- | --- | ---: | ---: | --- | --- |
| 1 | DE.CM-01 — Continuous Monitoring | none | 3 | 3.00 | high | No current evidence: all 1 artifact(s) are stale (EV-006). Re-collect them before the outcome can count. |
| 2 | ID.RA-01 — Risk Assessment | none | 3 | 3.00 | high | No current evidence: all 1 artifact(s) are stale (EV-009). Re-collect them before the outcome can count. |
| 3 | PR.DS-11 — Data Security | contradicted (1 warning) | 3 | 3.00 | high | Resolve contradiction: EV-005 refute the outcome. Investigate the refuting artifact before accepting any supporting evidence. |
| 4 | DE.AE-02 — Adverse Event Analysis | none | 2 | 2.00 | high | No evidence recorded. Identify an owner and collect at least two artifact types (for example a policy plus a configuration or log sample). |
| 5 | ID.RA-05 — Risk Assessment | none | 2 | 2.00 | high | No evidence recorded. Identify an owner and collect at least two artifact types (for example a policy plus a configuration or log sample). |
| 6 | PR.PS-01 — Platform Security | none | 2 | 2.00 | high | No evidence recorded. Identify an owner and collect at least two artifact types (for example a policy plus a configuration or log sample). |
| 7 | RC.RP-01 — Incident Recovery Plan Execution | none | 2 | 2.00 | high | No evidence recorded. Identify an owner and collect at least two artifact types (for example a policy plus a configuration or log sample). |
| 8 | GV.OC-03 — Organizational Context | weak | 2 | 1.60 | moderate | Plan refresh for aging evidence: EV-011. Add a second evidence type (currently only: procedure). Increase coverage from 0.5 to at least 1.0 (full-scope current artifacts count 1.0). |
| 9 | GV.SC-04 — Cybersecurity Supply Chain Risk Management | weak | 2 | 1.60 | moderate | Add a second evidence type (currently only: attestation). Increase coverage from 0.5 to at least 1.0 (full-scope current artifacts count 1.0). |
| 10 | GV.SC-07 — Cybersecurity Supply Chain Risk Management | weak | 2 | 1.60 | moderate | Plan refresh for aging evidence: EV-015. Increase coverage from 0.75 to at least 1.0 (full-scope current artifacts count 1.0). |
| 11 | PR.IR-01 — Technology Infrastructure Resilience | weak | 2 | 1.60 | moderate | Add a second evidence type (currently only: ticket). Increase coverage from 0.5 to at least 1.0 (full-scope current artifacts count 1.0). |
| 12 | GV.PO-01 — Policy | partial (invalid override; 1 warning) | 2 | 1.00 | moderate | Add a second evidence type (currently only: policy). Reviewer override needs a substantive rationale or must be withdrawn. |
| 13 | GV.RM-02 — Risk Management Strategy | none (1 warning) | 1 | 1.00 | moderate | No current evidence: all 1 artifact(s) are stale (EV-019). Re-collect them before the outcome can count. |
| 14 | GV.RR-02 — Roles, Responsibilities, and Authorities | partial | 2 | 1.00 | moderate | Add a second evidence type (currently only: policy). |
| 15 | ID.IM-02 — Improvement | partial | 2 | 1.00 | moderate | Add a second evidence type (currently only: report). |
| 16 | PR.DS-01 — Data Security | partial (invalid override; 1 warning) | 2 | 1.00 | moderate | Add a second evidence type (currently only: configuration). Reviewer override refused under separation of duties. Independent evidence or a different reviewer is required. |
| 17 | RS.AN-03 — Incident Analysis | partial | 2 | 1.00 | moderate |  |
| 18 | RC.CO-03 — Incident Recovery Communication | accepted-risk (override) | 1 | 0.60 | low | Accepted risk without evidence (reviewer m.okafor, 2026-09-30). This stays an open gap: collect at least one current artifact or formally scope the outcome out; the acceptance lapses after 365 days. |
| 19 | PR.AT-01 — Awareness and Training | partial | 1 | 0.50 | low | Add a second evidence type (currently only: report). |

## Notes

Scoring note: Residual exposure, coverage weights and status thresholds (including the accepted-risk exposure of 0.6) are a custom educational heuristic defined in this project (README → Algorithm); the exact values used for this report are in its embedded policy object (the project defaults, schema tessera.policy/1). They are not a NIST score, tier or maturity rating; CSF 2.0 does not define numeric scoring.

Decision policy: Reviewer decisions are valid for 365 days from decidedOn and never when dated after the evaluation date; stale decisions are ignored with a warning. Accepting a non-sufficient outcome or scoping it out needs a rationale of at least 40 characters and is refused while evidence is contradicted or refuted. Under separation of duties, an accepted override is refused when the reviewer also collected every current supporting artifact. Accepting an outcome that has no current evidence records accepted-risk, which remains in the gap register; it never produces 'sufficient'.

Disclaimer: Educational prototype using synthetic evidence. Output is a readiness view against a 25-subcategory subset of NIST CSF 2.0; it is not a certification, attestation, audit opinion or legal/compliance conclusion.

---

Generated by Tessera (educational prototype) for Harbourline Logistics (synthetic demo profile) as of 2026-10-01.
