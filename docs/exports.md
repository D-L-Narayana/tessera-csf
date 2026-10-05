# Exports and JSON Schemas

Tessera keeps every review in memory; exports are how a review leaves the browser. All exports are generated
locally from the current pack and the report computed from it, downloaded through a transient blob URL, and never
sent anywhere. Everything exported describes synthetic, educational data: a readiness view against a
25-subcategory subset of NIST CSF 2.0, not a certification, attestation or audit opinion.

## The six exports

The **Export** group (`role="group"`, `aria-label="Export"`) offers six downloads. `<stamp>` is the profile's
evaluation date without dashes (for example `20261001` for an as-of date of 2026-10-01), so files from different
review dates sort naturally.

| Button | File | MIME type | Content |
|---|---|---|---|
| Export pack | `tessera-pack-<stamp>.json` | `application/json` | The pack (`tessera.pack/1`), pretty-printed with two spaces; re-importable |
| Export report JSON | `tessera-report-<stamp>.json` | `application/json` | The full report (`tessera.report/1`) including every trace line, the embedded rule policy and `policyIsDefault` |
| Export report CSV | `tessera-report-<stamp>.csv` | `text/csv` | One row per outcome (25 rows) |
| Export gap register CSV | `tessera-gaps-<stamp>.csv` | `text/csv` | One row per gap, in register order |
| Export evidence inventory CSV | `tessera-evidence-<stamp>.csv` | `text/csv` | One row per evidence artifact with its freshness at the as-of date |
| Export summary (Markdown) | `tessera-summary-<stamp>.md` | `text/markdown` | Executive-readable summary |

After each download the menu reports the export kind to the host application, which uses it to clear the
unsaved-changes indicator.

## JSON exports

Both JSON exports are `JSON.stringify(value, null, 2)` of the in-memory objects. A pack without a custom rule policy
is exported without a `policy` key, exactly as it was imported or built. The report embeds `policy` (the
`tessera.policy/1` it was computed with) and `policyIsDefault`, so an old report can be reproduced and compared even
after the project's defaults change. Report generation is deterministic: the same pack always produces
byte-identical JSON.

## CSV exports

### Common rules

- RFC 4180 shape: every cell is double-quoted, embedded quotes are doubled, rows end with CRLF, no trailing newline.
- Spreadsheet formula and command neutralisation: a cell whose first visible character is `=`, `+`, `-`, `@` or `|`
  is prefixed with an apostrophe (`'`). "First visible" means the check skips any leading whitespace and control
  characters, so `  =SUM(A1)`, a tab followed by `=cmd` or a NUL followed by `|cmd` are neutralised too. Cells that
  begin with a tab or a carriage return are prefixed as well. A `|` that does not lead the cell (for example in a
  title) is left alone.
- Byte-order mark: the CSV text itself contains no BOM (so it stays comparable across runs); the download adds a
  UTF-8 BOM so spreadsheet applications open non-ASCII characters correctly. The BOM is never doubled.
- Numbers are written as plain JavaScript numbers (`0.5`, `3`); missing optional values are empty cells.
- Multi-valued cells (`subcategoryIds`, `warnings`) are joined with `; `.

### Report CSV columns

The first twelve columns are the columns Tessera 0.1 exported, in the same order; the last four are new.

| # | Column | Meaning |
|---|---|---|
| 1 | `subcategory` | CSF 2.0 subcategory id, e.g. `PR.DS-11` |
| 2 | `function` | Function name (Govern, Identify, Protect, Detect, Respond, Recover) |
| 3 | `category` | Category name |
| 4 | `status` | Final status after the reviewer overlay |
| 5 | `computed` | Status computed from evidence alone |
| 6 | `coverage` | Weighted coverage (freshness × scope, summed over supporting artifacts) |
| 7 | `types` | Distinct evidence types with current weight |
| 8 | `priority` | Target-profile priority 1–3 |
| 9 | `residual` | Residual exposure = status exposure × priority |
| 10 | `band` | `low`, `moderate` or `high` |
| 11 | `override` | `valid`, `invalid` or empty (reviewer acceptance of a non-sufficient computed status) |
| 12 | `remediation` | Remediation sentence(s), empty for sufficient and not-applicable outcomes |
| 13 | `reviewer` | Reviewer of the recorded decision, if any |
| 14 | `verdict` | `accepted`, `gap`, `needs-more` or `not-applicable` |
| 15 | `decidedOn` | Decision date |
| 16 | `warnings` | Refused or noteworthy reviewer actions, joined with `; ` (e.g. a stale decision that was ignored) |

### Gap register CSV columns

`rank`, `subcategory`, `function`, `category`, `status`, `priority`, `residual`, `band`, `remediation` — one row per
entry of the report's gap register, ranked 1..n by residual exposure (ties broken by id). When every outcome is
sufficient or not applicable the file contains only the header row.

### Evidence inventory CSV columns

`id`, `title`, `type`, `scope`, `assertion`, `source`, `collectedBy`, `collectedOn`, `validDays`, `freshness`,
`ageDays`, `weight`, `subcategoryIds`, `note` — one row per artifact in pack order. `freshness`, `ageDays` and
`weight` are the values the engine assessed at the report's as-of date (the same for every outcome the artifact
references); refuting artifacts always have weight 0. `collectedBy` and `note` are empty when the artifact does not
record them.

## Markdown summary

Sections, in order:

1. `# Tessera report — <profile name>`, a one-line educational-prototype notice, then a list with the as-of date,
   framework, subset, outcome counts (sufficient / in the gap register / not applicable) and the number of
   artifacts, decisions and reviewer warnings.
2. **Rule policy** — whether the report used the default or a custom `tessera.policy/1`, and a table of
   `agingMultiplier`, `decisionValidDays`, `minOverrideRationale`, `sufficientCoverage`, `minDistinctTypes` and
   `separationOfDuties`. The complete policy is in the JSON report.
3. **Functions** — `Function | Sufficient | Assessed | Mean residual | Band`, one row per CSF function.
4. **Gap register** — `# | Outcome | Status | Priority | Residual | Band | Remediation`, one row per gap; the status
   cell notes overrides and the number of warnings.
5. **Notes** — the report's scoring note, decision policy and disclaimer, verbatim.
6. A horizontal rule and the footer `Generated by Tessera (educational prototype) for <profile> as of <asOf>.`

Escaping: every value that originates in the pack (profile name, category names, remediation text) is escaped before
it is placed in a line or table cell — `&` becomes `&amp;`, `<` becomes `&lt;`, `|` becomes `\|`, and line breaks
become spaces — so a crafted title cannot break the table or inject HTML into a renderer. Line endings are LF. The
output is deterministic for the same pack.

## JSON Schemas

Both export formats are described by JSON Schema (draft 2020-12) documents served from the deployment:

- `https://dln-tessera.vercel.app/schemas/tessera.pack.v1.schema.json` — `tessera.pack/1`
- `https://dln-tessera.vercel.app/schemas/tessera.report.v1.schema.json` — `tessera.report/1`

In the repository they live in `public/schemas/`, so a production build copies them to `dist/schemas/`.

What the schemas pin down:

- `additionalProperties: false` on every object; the only open-keyed object (`profile.priorities`) is bounded by
  `maxProperties: 25`, keys restricted to the 25 subcategory ids and values to `1 | 2 | 3`.
- Enumerations equal to the engine's: the seven evidence types, four verdicts, eight statuses, three bands (plus
  `not-assessed` for rollups), three freshness values, the two override issues and the 25 subcategory ids.
- Schema tags as constants (`tessera.pack/1`, `tessera.report/1`, `tessera.policy/1`).
- Bounds mirroring the import validator: profile name, title, source and framework/subset labels ≤ 160 characters;
  reviewer and `collectedBy` ≤ 80; evidence id ≤ 64; note and rationale ≤ 2000; `validDays` an integer from 1 to
  3650; at most 500 evidence items, 200 decisions and 25 subcategory references per artifact; dates as
  `YYYY-MM-DD` strings.
- The rule policy with every field required and each bound from the engine's `POLICY_BOUNDS` (`agingMultiplier`
  1–5, weights 0–1, `sufficientCoverage` 0.1–10, `minDistinctTypes` 1–7, exposure factors 0–1 with
  `not-applicable` fixed at 0, band thresholds 0.01–3, `minOverrideRationale` 0–2000, `decisionValidDays` 1–3650).
  Ordering constraints (fresh ≥ aging ≥ stale, full ≥ partial, moderate < high) are enforced by the validator, not
  expressible in the schema.
- Report structure: exactly 25 results and 6 rollups, gaps ≤ 25, residual 0–3, weight 0–1, `policy` and
  `policyIsDefault` required.

The schemas describe what Tessera exports and what its importer accepts; the importer remains the authority (it also
checks calendar validity of dates, duplicate ids and policy ordering constraints, and drops unknown keys).

## Limits

Exports inherit the pack bounds (512 KiB of JSON, ≤ 500 artifacts, ≤ 200 decisions). The report CSV always has 25
data rows; the gap register CSV at most 25; the evidence inventory at most 500. Files are produced in memory and
downloaded through a blob URL that is revoked immediately after the click.

## How this is tested

- `tests/exports.test.ts` — the CSV module reproduces the previous exporter byte-for-byte on the baseline cases and
  additionally neutralises a leading `|`; column layouts and row counts of all three CSV shapes; Markdown structure,
  escaping, verbatim notes and the exact footer; the BOM helper.
- `tests/schemas.test.ts` — both schema files parse; a compact draft-2020-12 walker checks that the bundled fixture
  pack and the report built from it conform, that every object key is declared and every `required` key present,
  and that enums and bounds equal the engine's constants (`EVIDENCE_TYPES`, `MAX_*`, `POLICY_BOUNDS`).
- `tests/export-ui.test.tsx` — the export menu renders the six named buttons in an `Export` group with no inline
  styles, and plans filenames, MIME types and BOM flags as documented.
