# Tessera feature documentation

Reader-facing notes on how each part of Tessera behaves and how it is tested. The README gives the overview and the
algorithm; `EVIDENCE.md` records measured results; these pages explain the rules behind individual features.

| Page | Covers |
|---|---|
| `policy.md` | The rule policy (`tessera.policy/1`): every threshold the engine uses, defaults, bounds, how a report embeds the policy it was computed with, and the separation-of-duties guardrail |
| `validation.md` | Import validation bounds and rejection rules for packs, policies and evidence fields; fuzz and idempotence testing |
| `forecast.md` | The horizon view: when evidence turns aging or stale, when decisions lapse, and which outcomes are projected to change |
| `compare.md` | Comparing the current evaluation with a previously exported report |
| `drawer.md` | The outcome drawer: evidence editing, identifiers, multi-outcome artifacts, decision preview |
| `session.md` | Opt-in browser persistence, the unsaved-changes guard, undo/redo |
| `theme.md` | Colour schemes, status patterns, contrast guarantees, keyboard navigation in the mosaic, print layout |
| `register.md` | Gap register filters and sorting; the executive summary |
| `exports.md` | Export formats (JSON, CSV variants, Markdown), escaping rules, published JSON Schemas |
| `qa.md` | How the browser workflow and accessibility audit scripts are run, and what they check |

All pages describe synthetic, educational behaviour. Nothing here is a certification, attestation or compliance conclusion.
