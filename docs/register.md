# Gap register and executive summary

The gap register is the working list at the bottom of the workbench; the summary is the executive-readable
roll-up shown above the mosaic. Both are computed from the same `tessera.report/1` object that the exports use,
so what is on screen is what leaves the browser. Everything here describes an educational prototype on synthetic
data: residual exposure is this project's own heuristic, not a NIST score, and nothing in either view is a
certification, attestation or audit opinion.

## What the register lists

- **Base list.** By default the register lists `report.gaps`: every outcome whose status is not `sufficient` and
  not `not-applicable` (so `partial`, `weak`, `none`, `contradicted`, `refuted` and `accepted-risk`), in the
  report's order — residual exposure descending, then outcome id.
- **Include sufficient and not-applicable outcomes.** Ticking this checkbox switches the base list to all 25
  results (`report.results`) so closed outcomes can be reviewed with the same filters. It is off by default; with
  an empty profile the register therefore still lists all 25 outcomes unfiltered.
- **Selecting a row.** The outcome id in each row is a button that opens that outcome in the drawer; the selected
  outcome's row carries the `is-selected` class.
- **Rank column (`#`).** The position of the row in the *current* view. It is renumbered whenever a filter or
  sort changes, so it is a reading aid, not a stable identifier — use the outcome id for that.

## Filters

The filter bar is a `search` landmark labelled "Filter gap register". All filters combine with AND.

| Control | Values | Rule |
|---|---|---|
| **Function** | All, GV, ID, PR, DE, RS, RC | Outcome's CSF function, looked up in the catalog |
| **Status** | All plus the eight statuses | Exact match on the effective status (after reviewer overlay) |
| **Band** | All, low, moderate, high | Exact match on the residual band |
| **Search** | free text | Case-insensitive substring match against the outcome id, category name, function name, status and remediation text. Leading/trailing whitespace is ignored; a blank query matches everything |
| **Include sufficient and not-applicable outcomes** | checkbox | Switches the base list (see above) |

Examples with the bundled demo: `pr.ds` lists the Data Security outcomes that are in the register; `data security`
lists the same outcomes by category name; `stale` lists the outcomes whose remediation asks for stale artifacts to be
re-collected.

A **Clear filters** button appears whenever any filter or the include toggle is active and resets all of them.

## Sorting

Three column headers are buttons; the `<th>` carries `aria-sort` (`ascending`, `descending` or `none`) so the
current order is exposed to assistive technology.

| Header | Key | First click | Tie-break |
|---|---|---|---|
| Outcome | outcome id | ascending | — |
| Status | canonical status order: sufficient, partial, weak, none, contradicted, refuted, accepted-risk, not-applicable | ascending | outcome id ascending |
| Residual | residual exposure | descending | outcome id ascending |

Clicking the active header reverses its direction; clicking another header starts that key in its natural
direction. The default order (Residual descending) reproduces the report's own gap order exactly. Sorting is
stable and never mutates the report. `priority` is also available as a sort key in `registerLogic.ts`
(descending first, ties by id) for other surfaces, although the register shows priority inside the Residual column
rather than as a separate sortable header.

## Counts and empty states

- Above the table: **"Showing N of M outcomes."** — N is the number of rows after filtering, M is the size of
  the base list (gaps, or all results when closed outcomes are included).
- When the base list is empty (every outcome is sufficient or not applicable and the include toggle is off):
  **"Every outcome in the subset is sufficient or not applicable. Export the report to keep the trace."**
- When the base list is not empty but no row survives the filters:
  **"No outcomes match the current filters."**

## Responsive behaviour

The table keeps its native markup at every width. A visually hidden `<caption>` names the table and states the
row count and the active sort ("Gap register: N outcomes sorted by residual exposure, descending." in the
default view). Each `<td>` carries a `data-label` attribute with its column
name (`#`, `Outcome`, `Status`, `Residual`, `Remediation`). At viewport widths of 600 px and below
(`src/ui/register.css`), the table, body, rows and cells switch to block layout so each outcome reads as a card,
the column name is drawn before each value from `data-label`, and the header row is hidden visually while
remaining available to assistive technology. Nothing scrolls horizontally in the card layout. The filter bar
collapses to two columns with the search field spanning both.

## Executive summary

`Summary` renders one section (heading "Summary") from the report:

- **Profile line.** Profile name, evaluation date (`asOf`), the subset label and whether the report was computed
  with the default rule policy or a custom one.
- **Status distribution.** One inline SVG stacked bar (`viewBox="0 0 100 8"`) with a `<rect>` per status that has
  at least one outcome; `x` and `width` are percentages of all 25 results, written as SVG attributes rather than
  styled widths so the page needs no inline styles. The SVG has `role="img"` and an `aria-label` of the form
  "Status distribution: N sufficient, N partial, N weak, …" covering all eight statuses. A text list follows with
  the same eight counts, zeros included, so colour is never the only cue and the numbers are available without
  the graphic.
- **By function.** One line per CSF function in the form
  `GV Govern — S/6 sufficient · G gaps · W warnings · <band>` (the numbers depend on the pack), where
  - `sufficient` and `band` come from the report's function roll-ups (band is `not assessed` when every outcome
    in the function is scoped out),
  - `gaps` is the number of that function's outcomes present in the gap register,
  - `warnings` is the number of that function's outcomes with at least one engine warning.
- **Overrides.** `Overrides: V valid, I invalid · R refused reviewer actions`, where
  - *valid* counts outcomes with `override` and `overrideValid` (an accepted outcome that became `sufficient`, or
    an acceptance with no current evidence recorded as `accepted-risk`),
  - *invalid* counts outcomes with `override` but not `overrideValid` (for example a rationale that is too short,
    or an acceptance refused under the separation-of-duties rule),
  - *refused reviewer actions* is the total number of warnings across all outcomes: stale or future-dated
    decisions ignored, acceptances or scope-outs refused while evidence is contradicted or refuted, rationales
    that were too short, and separation-of-duties refusals.
- **Gap count.** `G of 25 outcomes are in the gap register.`
- **Disclaimer.** The report's own disclaimer sentence, verbatim.

All numbers are recomputed from the report on every change; the summary never stores anything.

## Content-security-policy notes

Neither component emits `style` attributes, `<style>` elements or raw HTML. Proportional widths exist only as SVG
numeric attributes; colours come from class rules in `register.css` that reference the tokens in `styles.css`.
The components therefore work under `style-src 'self'`.

## How it is tested

- `tests/register-logic.test.ts` exercises the pure helpers in `src/ui/registerLogic.ts` against the bundled demo
  pack and an empty profile: the default list equals the report's gaps, each filter alone and in combination,
  case-insensitive query matching on id, category and remediation, the include toggle, stable sorting with id
  tie-breaks for every key, the eight-entry status distribution summing to 25, the per-function summary against the
  report's own roll-ups and gap list, and the override counts.
- `tests/register-ui.test.tsx` renders `GapRegister`, `GapRegisterView` and `Summary` with `react-dom/server` and
  checks the landmarks and headings, the exact control labels, `aria-sort` on the sortable headers, the count
  sentence, both empty-state sentences, `data-label` on every cell, row counts for the demo and for an empty
  profile, the accessible SVG bar and its text fallback, the function and override lines, and that no inline
  styles are emitted.
