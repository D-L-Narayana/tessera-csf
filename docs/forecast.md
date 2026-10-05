# Horizon forecast

The **Horizon** panel answers one question for a review team: *what stops being evidenced soon?* It takes the pack
exactly as it is, picks a horizon of 30, 60, 90 or 180 days after the profile's evaluation date (`profile.asOf`) and
lists three things:

1. **Evidence expiring** — artifacts that cross a freshness boundary (fresh → aging, or aging → stale) inside the window.
2. **Decisions lapsing** — reviewer decisions that are applied today and stop being applied inside the window.
3. **Outcomes projected to change** — subcategories whose status or residual differs when the same pack is evaluated
   as of the horizon date.

Everything is computed by `src/engine/forecast.ts`, a pure module with no clock access: the only dates involved are the
ones in the pack, so the same pack always yields the same forecast. The panel (`src/ui/Horizon.tsx`) renders the result
and lets you pick the horizon.

## Boundary formulas

The engine's freshness rule (README → Algorithm) is: an artifact is *fresh* while `age ≤ validDays`, *aging* while
`age ≤ validDays × agingMultiplier`, and *stale* after that or when it is dated in the future. Ages are whole days
between `collectedOn` and the evaluation date. Decisions are applied while `0 ≤ age ≤ decisionValidDays`.

The forecast turns those rules into calendar dates. Each date is the **first day on which the new state applies**, which
is why every formula ends in `+ 1`:

| Boundary | Formula | Default policy |
|---|---|---|
| `agingOn` | `collectedOn + validDays + 1` days | — |
| `staleOn` | `collectedOn + floor(validDays × agingMultiplier) + 1` days | multiplier 1.5 |
| `lapsesOn` | `decidedOn + decisionValidDays + 1` days | 365 days |

`agingMultiplier` and `decisionValidDays` come from the pack's rule policy (`pack.policy`, see `policy.md`); without one
the defaults apply. Dates are added in UTC on `YYYY-MM-DD` strings (`addDays`), so month ends, year ends and leap days
behave as expected and no time zone or locale is involved. With a multiplier of exactly 1 the two evidence dates
coincide: the artifact goes straight from fresh to stale.

The floor matters. 45 valid days × 1.5 = 67.5, and the engine still treats day 67 as aging, so the artifact is stale
from day 68 — `floor(67.5) + 1`.

## What is listed

The window is `(asOf, horizonDate]`: a boundary counts when it falls strictly after the evaluation date and no later
than the horizon date. The horizon is clamped to 1…3650 days; the panel offers 30, 60, 90 (default) and 180.

**Evidence expiring**

- An artifact is listed when its `agingOn` or `staleOn` falls inside the window.
- Artifacts that are already stale at `asOf` are never listed — including future-dated ones, which the engine also
  treats as stale. Nothing is left for them to cross.
- `freshness` is the artifact's state at `asOf`. For an artifact that is already aging, `agingOn` and `daysToAging` are
  `null` and only the stale boundary is reported.
- `daysToAging` and `daysToStale` count days from `asOf`.
- Sorted by the next boundary (`agingOn`, or `staleOn` for an artifact that is already aging), then by id.
- Every subcategory the artifact references is kept; the panel opens the first and names the others.

**Decisions lapsing**

- Only decisions that are applied at `asOf` (age between 0 and `decisionValidDays`) can lapse. Decisions the engine
  already ignores — older than the validity window or future-dated — are not listed.
- A decision is listed when `lapsesOn ≤ horizonDate`.
- Sorted by `lapsesOn`, then subcategory id.

**Outcomes projected to change**

- The pack is evaluated twice with the full engine: once as of `asOf`, once with `profile.asOf` replaced by the horizon
  date. Nothing else is changed.
- Every subcategory whose status or residual differs is listed with both values.
- `change` is `worsens` when the residual rises, `improves` when it falls, and `same` when only the status changes (for
  example contradicted → refuted, which carry the same exposure).
- Sorted `worsens` first, then `improves`, then `same`; within a group by the size of the residual change, then id.

Because the projection re-runs the engine, it inherits every rule, including ones that are not boundaries: a
future-dated artifact or decision that becomes current before the horizon date starts to count, and a valid reviewer
override can hold an outcome at sufficient even though its computed status drops. Projections assume no new evidence
is added and no decision is changed in the meantime.

## Worked examples (bundled Harbourline fixture, as of 2026-10-01)

| Item | Dates | 30 d (to 2026-10-31) | 60 d (to 2026-11-30) | 90 d (to 2026-12-30) | 180 d (to 2027-03-30) |
|---|---|---|---|---|---|
| EV-007 patch report, collected 2026-09-05, valid 45 d | aging 2026-10-21 (in 20 d); stale 2026-11-12 (in 42 d: floor(67.5) + 1 = 68 days after collection) | listed (aging boundary) | listed (both boundaries) | listed | listed |
| EV-003 MFA export, collected 2026-09-22, valid 90 d | aging 2026-12-22 (in 82 d); stale 2027-02-05 | — | — (2026-12-22 is after 2026-11-30) | listed | listed |
| EV-002 recertification report, collected 2026-05-20, valid 90 d | already aging; stale 2026-10-03 (in 2 d) | listed first | listed | listed | listed |
| EV-006 and EV-019 (old), EV-009 (dated 2027-02-01) | stale at asOf | never | never | never | never |
| RS.AN-03 needs-more, decided 2026-09-30 | lapses 2027-10-01 (in 365 d) | — | — | — | — (listed from a 365-day horizon) |
| GV.RM-02 acceptance, decided 2024-11-15 | ignored at asOf (685 days old) | never | never | never | never |

Projected outcome changes at 90 days: **PR.PS-02** goes from sufficient (residual 0.45) to weak (2.40) because EV-007 is
stale by then and the remaining ticket EV-008 is a single partial-scope type; **PR.AA-05**, **ID.AM-01**, **PR.DS-01**
and **GV.OC-03** also worsen as EV-002, EV-012, EV-020 and EV-011 cross boundaries. At 180 days **PR.DS-11** changes from
contradicted to refuted with the same residual (EV-004 is stale while the refuting EV-005 is still current), so it is
reported as `same` and sorted last.

With a custom policy the dates move with it: `agingMultiplier: 3` puts EV-007's stale date at 2027-01-19
(`floor(45 × 3) + 1 = 136` days after collection), and `decisionValidDays: 10` makes RS.AN-03 lapse on 2026-10-11.

## The panel

- Heading **Horizon**; a select labelled **Horizon (days)** with 30/60/90/180 (default 90). Changing it only changes
  this panel — the profile's evaluation date is untouched.
- Three sub-headings — **Evidence expiring**, **Decisions lapsing**, **Outcomes projected to change** — each followed by
  a count sentence or an empty-state sentence such as "Nothing crosses a freshness boundary within 90 days."
- Every row is a button that opens the related outcome in the drawer. Evidence rows open the artifact's first
  subcategory and name the others. Function colour uses the shared `fn fn--XX` classes; freshness and the kind of change
  are shown as text chips, never by colour alone.
- The panel states its assumption: projections assume no new evidence is added and no decision is changed.

Like the rest of Tessera, this is an educational view over synthetic data. The dates are projections of the project's
own freshness heuristic, not compliance deadlines, and the result is not a certification, attestation or audit opinion.

## How it is tested

`tests/forecast.test.ts` covers `addDays` across month ends, year ends and the 2028 leap day; the fixture examples above
at every horizon; the window edges (a boundary falling on `asOf` is out, one falling on the horizon date is in); the
exclusion of stale, future-dated and already-ignored items; a gap verdict at its validity boundary whose outcome improves
when it lapses; the ordering of projected changes; custom policies; horizon clamping; determinism (two calls yield
identical JSON); and the empty pack. `tests/horizon-ui.test.tsx` renders the panel with `react-dom/server` and checks the
headings, the labelled select, the count and empty-state sentences, that every row is a button with an accessible name,
the function classes, and that no inline styles are emitted.
