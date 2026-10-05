# The outcome drawer

The drawer opens when a tile is selected. It shows how the status of one subcategory was derived, lists
every evidence artifact that references it, and holds the two data-entry forms: evidence (add or edit)
and the reviewer decision. This page describes the rules those forms apply. Everything is evaluated in the
browser against the pack in memory; nothing is sent anywhere.

## Evidence list

Each artifact shows its freshness, assertion, type, scope and weight chips, the source, collection date,
validity period and age, who collected it when recorded, any other outcomes it references, its note, and
the two dates on which it crosses a freshness boundary:

- **aging on** = `collectedOn` + `validDays` + 1 day — the first day the artifact no longer counts as fresh;
- **stale on** = `collectedOn` + ⌊`validDays` × `agingMultiplier`⌋ + 1 day — the first day it stops counting at all.

`agingMultiplier` comes from the rule policy (1.5 by default), so `EV-007` (collected 2026-09-05, valid 45
days) turns aging on 2026-10-21 and stale on 2026-11-12. Dates are computed with UTC calendar arithmetic
and never depend on the clock of the machine; an unparsable date renders as an empty value instead of
throwing.

Every artifact has two buttons:

- **Edit EV-nnn** switches the evidence form into edit mode for that artifact.
- **Remove EV-nnn** asks for confirmation first — *"Remove EV-nnn? This cannot be undone except with
  Undo."* — and only removes the artifact when the confirmation is accepted. The confirmation runs inside
  the click handler, so rendering the drawer never touches browser dialogs.

## Evidence form

One form serves both adding and editing. Its heading reads **Add evidence for `<outcome>`** or
**Edit evidence `<id>`**, and the submit button reads **Add evidence** or **Save changes** (with a
**Cancel edit** button beside it while editing).

| Field | Rules |
|---|---|
| Id | Assigned automatically and shown read-only (`Id: EV-023`). When editing, the id is preserved. |
| Title | Required, at most 160 characters. |
| Source system | Required, at most 160 characters. |
| Collected by | Optional, at most 80 characters. Who produced the artifact; enables the separation-of-duties guardrail described in `policy.md`. |
| Type | One of the seven evidence types (policy, procedure, configuration, log-sample, report, attestation, ticket). |
| Collected on | ISO date; defaults to the evaluation date when adding. |
| Valid for (days) | Integer from 1 to 3650. |
| Scope | `full` or `partial`. |
| Assertion | `supports` or `refutes` the outcome. |
| Note | Optional, at most 2000 characters. |
| Also applies to | One checkbox per *other* subcategory in the subset (24). The artifact always references the outcome whose drawer is open, so the total stays within the validator's limit of 25 references per artifact. |

Text fields are trimmed; a blank note or collector is omitted from the record rather than stored as an
empty string. The subcategory references are written in catalog order with the drawer's outcome first.

### Identifier rule

The next id is `EV-` followed by the highest numeric suffix among existing ids of the form `EV-<digits>`
plus one, zero-padded to at least three digits (`EV-001` for an empty pack, `EV-1000` after `EV-999`).
Ids with any other shape are ignored when computing the next number. Because the rule looks at the highest
number rather than at the count of artifacts, removing an item never causes the next addition to collide
with an existing id.

### Validation before saving

Before the host application is asked to store anything, the draft is validated in context: the pack is
copied, the draft is appended (or substituted for the artifact being edited), and the copy is run through
the same bounded pack validator used for imports. The form shows either *"Evidence id EV-nnn already
exists."* (when adding under an id that is taken — editing an artifact under its own id is allowed) or the
validator's path-addressed issues, for example `evidence[22].collectedOn: must be an ISO date (YYYY-MM-DD)`.
Errors appear in an alert paragraph under the fields; the pack is unchanged until the draft is valid.

If the drawer is rendered without an update handler, saving an edit reports *"Editing is not available in
this view."* instead of silently discarding the change.

## Reviewer decision

The decision form keeps the **Reviewer**, **Verdict** and **Rationale** fields and the **Record decision**
/ **Clear decision** buttons. The reviewer field starts from the outcome's existing decision, otherwise from
the default reviewer the application remembers for the session.

The rationale counter and the guardrail text use the rule policy in force: the minimum override rationale
length (40 characters by default) and the decision validity period (365 days by default). The form states
the dating rule explicitly — *"This decision will be dated `<asOf>` and lapses on `<asOf + validity + 1>`."*
— because a decision is always dated with the evaluation date, not with today's date.

### Decision preview

The **Decision preview** region is updated live as the fields change. It evaluates the outcome exactly as
the engine would if the draft replaced the outcome's current decision: the pack is copied, the draft is
substituted, and the single subcategory is re-evaluated with the same code path that produces the report.
The preview shows the resulting status (and the computed status when they differ), the residual and band,
and every refusal the engine would raise — for example *"acceptance ignored while evidence is
contradicted"* or *"override rationale too short; computed status kept"*. When nothing would be refused it
says so. The preview never changes the pack; only **Record decision** does.

## Accessibility

Every control is associated with its label through generated ids, so several drawers or forms can exist on
one page without duplicate ids. The preview region is a polite live region with a visible heading; the
evidence list heading receives focus after a removal so keyboard users are not left on a vanished button,
and cancelling or saving an edit returns focus to the artifact's **Edit** button.

## How this is tested

`tests/drawer-logic.test.ts` covers the pure rules in isolation: the identifier rule (including removal,
non-matching ids, empty packs and padding beyond three digits), the preview against the engine for
contradicted, short-rationale and valid-override drafts, draft validation (duplicate ids when adding versus
editing, validator paths), boundary-date arithmetic across month, year and leap-day boundaries, and the
form helpers. `tests/drawer-ui.test.tsx` renders the drawer and both forms to static markup with the bundled
synthetic fixture and asserts the headings, labels, buttons, boundary dates, preview content, policy-derived
numbers, unique ids and the absence of inline styles.

All data shown in the examples above is synthetic. The drawer is part of an educational prototype; it is not
a certification, attestation or audit tool.
