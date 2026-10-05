# Compare with a previous report

The **Compare with a previous report** section places the current evaluation next to a report JSON that was
exported earlier (for example last quarter's `tessera-report-<date>.json`) and lists, outcome by outcome, what
improved, what regressed and what merely changed status. It answers the question the deterministic engine was
built for — "are we better or worse evidenced than last time?" — without any server or stored history: the
previous report is a file the team keeps, and the comparison is recomputed in the browser from that file and
the pack currently loaded.

The section is read-only with respect to the pack. Importing a previous report never changes evidence,
decisions, the profile or the rule policy; it only adds a view. **Clear comparison** removes that view again.

## Accepted input

The importer accepts the JSON produced by **Export report JSON** (`schema: "tessera.report/1"`). Only the fields
needed for a delta are read; everything else in the file — the evidence assessments, the rule traces, rollups,
gaps, the scoring note and disclaimer — is ignored and dropped before the data reaches memory.

| Field | Rule |
|---|---|
| whole file | at most 512 KiB (524,288 bytes) measured in UTF-8, the same limit as pack import; must parse as a JSON object (a leading byte-order mark is tolerated) |
| `schema` | exactly `tessera.report/1` |
| `asOf` | ISO date `YYYY-MM-DD` that round-trips (so `2026-02-30` is rejected) |
| `generatedFor` | string of 1 to 160 characters (the profile name) |
| `results` | array of at most 200 result objects |
| `results[i].subcategoryId` | one of the 25 subcategory ids in the catalog; no id may appear twice |
| `results[i].status` | one of the eight statuses (`sufficient`, `partial`, `weak`, `none`, `contradicted`, `refuted`, `accepted-risk`, `not-applicable`) |
| `results[i].computedStatus` | optional; when present, one of the eight statuses |
| `results[i].residual` | finite number from 0 to 3 |
| `results[i].priority` | 1, 2 or 3 |
| `policy` | kept verbatim when it is a JSON object (reports from version 0.2 onward embed the rule policy they were computed with); any other value is dropped |

Validation follows the same posture as pack import: it never throws, every problem is reported with the path of
the offending field (for example `results[3].status — must be one of …`), at most 50 issues are reported, and a
rejected file changes nothing — the notice at the top of the page lists the issues and any comparison already on
screen stays as it was. Files that are too large are refused before they are parsed.

## Change classification

Outcomes are matched by subcategory id. For each id the comparison records the status and residual on both sides
and a `residualDelta` = current residual − previous residual, rounded to two decimals.

| Change | Meaning |
|---|---|
| `regressed` | residual rose (the rounded delta is positive) |
| `improved` | residual fell (the rounded delta is negative) |
| `changed` | residual is the same but the status differs — for example `none` becoming `contradicted` at the same exposure, which deserves attention even though the number did not move |
| `unchanged` | same residual and same status |
| `added` | present only in the current evaluation; the delta is the current residual |
| `removed` | present only in the previous report; the delta is minus the previous residual |

Because the engine rounds residuals to two decimals, a positive or negative delta always corresponds to a real
residual move; the classification uses the rounded delta so that the sign shown in the table always agrees with
the chip beside it.

Rows are ordered so that what needs attention comes first: `regressed`, then `changed`, `improved`, `added`,
`removed` and finally `unchanged`; within a group by the size of the delta (largest first) and then by
subcategory id. The result is fully deterministic — the same two reports always produce the same comparison,
whatever order the previous report listed its results in.

The summary line reads `<n> improved · <n> regressed · <n> unchanged`; a second line gives the `changed`,
`added` and `removed` counts. Unchanged rows are hidden by default and shown with **Show unchanged outcomes**.
Deltas carry an explicit sign (`+0.50`, `−1.00`, `0.00`) and every change is written out in words in its chip,
so the table does not rely on colour. Each outcome in the table is a link that opens that outcome's drawer.

## Warnings

The comparison is only meaningful when both sides were produced the same way. Four conditions are flagged above
the table whenever they hold:

| Warning | When |
|---|---|
| `profile differs: "<previous>" vs "<current>"` | the two reports were generated for different profile names |
| `previous report is not older than the current evaluation (asOf <previous> vs <current>)` | the previous report's `asOf` is the same as or later than the current evaluation date |
| `previous report carries no rule policy (schema before 0.2); thresholds may differ` | the previous report was exported before reports embedded their rule policy, so the thresholds behind its residuals are unknown |
| `rule policy differs between the two reports` | both reports carry a policy and they are not the same (compared as canonical JSON, independent of key order) |

A warning does not block the comparison; it tells the reader that the deltas may reflect a change in rules or
scope rather than a change in evidence.

## Limits

- Only statuses and residuals are compared. The comparison does not know which artifacts were added, refreshed or
  removed between the two reports; open the outcome's drawer and its rule trace for that.
- Residuals come from this project's custom educational heuristic (see the README, "Algorithm"). They are not a
  NIST score, tier or maturity rating, and a delta between two of them is not a measure of security.
- Nothing is uploaded or stored. The previous report is held in memory for the session only and is discarded by
  **Clear comparison** or a page reload.
- Everything shown is a view over synthetic evidence in an educational prototype: not a certification,
  attestation, audit opinion or compliance conclusion.

## How it is tested

`tests/compare.test.ts` exercises the validator (size, JSON, schema, `asOf`, `generatedFor`, result count,
unknown ids, statuses, residual and priority bounds, duplicates, unknown-key dropping, the 50-issue cap, hostile
input) and the comparison (self-comparison of an exported fixture report is entirely `unchanged`; decreases,
increases, equal-residual status changes, added and removed outcomes; sort order; each warning; determinism and
sign formatting). `tests/compare-ui.test.tsx` renders the section in Node and checks the heading, button and
empty-state strings, the hidden file input, the label association of the toggle, the summary line, status spans,
signed deltas, text chips, the hidden-row note, and the absence of inline styles.
