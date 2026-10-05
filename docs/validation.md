# Import validation

Everything Tessera reads from outside the running page — an imported pack, a saved session, a pack produced by
the policy editor or the evidence forms — goes through `src/engine/validate.ts` before it touches application
state. The validator is deliberately small and bespoke: it is the source of truth for what a `tessera.pack/1`
may contain, and the published JSON Schemas mirror it rather than the other way round.

## Guarantees

- **Never throws.** `validatePack(text)` and `validatePackObject(value)` return `{ ok: true, pack }` or
  `{ ok: false, issues }` for any input, including non-JSON text, truncated files, wrong types at any depth,
  10 000-character strings, `NaN`/`Infinity`-like tokens and deeply nested arrays.
- **Bounded before parsing.** The UTF-8 byte count is checked before `JSON.parse`, so a 512 KiB limit is a real
  limit and not a UTF-16 approximation.
- **Path-addressed issues.** Every issue names the field it concerns (`evidence[3].collectedOn`,
  `profile.priorities.PR.AA-05`, `policy.bands.high`). At most 50 issues are reported.
- **Unknown keys are dropped.** Accepted packs contain only the fields the engine knows about.
- **Canonical rebuild.** Accepted values are rebuilt key by key in a fixed order. Consequences:
  `validatePackObject(validatePackObject(x).pack)` deep-equals the first result (idempotence), a valid pack
  survives `JSON.stringify` → `validatePack` byte-identically, and a pack without a `policy` round-trips
  without one being added.
- **Backward compatible.** Baseline messages and paths are unchanged; a `tessera.pack/1` written before the
  rule policy existed validates exactly as it did.

## Bounds

| Constant | Value | Applies to |
|---|---|---|
| `MAX_PACK_BYTES` | 524 288 (512 KiB, UTF-8) | whole file |
| `MAX_EVIDENCE` | 500 | `evidence` items |
| `MAX_DECISIONS` | 200 | `decisions` items |
| `MAX_SUBCATEGORY_REFS` | 25 | `evidence[i].subcategoryIds` entries; `profile.priorities` entries |
| `MAX_ID` | 64 | `evidence[i].id` |
| `MAX_SHORT` | 160 | `evidence[i].title`, `evidence[i].source`, `profile.name` |
| `MAX_NAME` | 80 | `decisions[i].reviewer`, `evidence[i].collectedBy` |
| `MAX_SUBCATEGORY_ID` | 16 | `decisions[i].subcategoryId` |
| `MAX_TEXT` | 2000 | `evidence[i].note`, `decisions[i].rationale` |
| `MAX_VALID_DAYS` | 3650 | `evidence[i].validDays` (integer, minimum 1) |
| `MAX_ISSUES` | 50 | issues returned per validation |

### Rule policy (`pack.policy`, optional; `tessera.policy/1`)

Bounds come from `POLICY_BOUNDS` in `src/engine/policy.ts`. Every numeric field must be a finite JSON number.

| Field | Bound | Extra rule |
|---|---|---|
| `schema` | must be `tessera.policy/1` | |
| `agingMultiplier` | 1 … 5 | |
| `freshnessWeights.fresh/aging/stale` | 0 … 1 | `fresh ≥ aging ≥ stale` |
| `scopeWeights.full/partial` | 0 … 1 | `full ≥ partial` |
| `sufficientCoverage` | 0.1 … 10 | |
| `minDistinctTypes` | integer 1 … 7 | 7 is the number of evidence types |
| `exposure.<status>` | 0 … 1 | all eight statuses required; `exposure['not-applicable']` must be 0 |
| `bands.moderate/high` | 0.01 … 3 | `moderate < high` |
| `minOverrideRationale` | integer 0 … 2000 | |
| `decisionValidDays` | integer 1 … 3650 | |
| `separationOfDuties` | boolean | |

A pack whose `policy` fails any rule is rejected as a whole; the engine never runs with a partially valid policy.
`validatePolicyObject(raw)` validates a stand-alone policy object (used by the policy editor) and returns the
same issue paths, prefixed with `policy`.

## String rules

Three kinds of strings are distinguished:

| Kind | Fields | Rules |
|---|---|---|
| short | `title`, `source`, `profile.name`, `reviewer`, `collectedBy`, `subcategoryId` | length within bounds; no control characters (`U+0000`–`U+001F`, `U+007F`); not blank after trimming |
| id | `evidence[i].id` | short-string rules, plus no leading or trailing whitespace (ids are compared exactly) |
| long | `note`, `rationale` | may be empty; line feeds (`\n`) and tabs (`\t`) allowed; every other control character (including `\r`) rejected |

Leading or trailing spaces in a title, source or name are tolerated; blank-only values are not. Dates must be
real calendar dates in `YYYY-MM-DD` form (`2026-02-30` is rejected). Enumerations (`type`, `scope`,
`assertion`, `verdict`) must match exactly. `evidence[i].collectedBy` is optional; when present it follows the
short-string rules with the 80-character name bound and enables the separation-of-duties guardrail (see
`policy.md`).

## Rejection messages

| Path | Message |
|---|---|
| `` (empty) | `pack too large: limit is 524288 bytes` · `file is not valid JSON` · `file is not text` · `pack must be a JSON object` |
| `schema` | `schema must be 'tessera.pack/1'` |
| `profile`, `evidence[i]`, `decisions[i]`, `policy`, `policy.<section>` | `must be an object` |
| `evidence`, `decisions` | `must be an array` · `at most 500 evidence items are accepted` · `at most 200 decisions are accepted` |
| `profile.priorities` | `must be an object keyed by subcategory id` · `at most 25 priority entries (one per subcategory in the subset)` |
| `profile.priorities.<id>` | `unknown subcategory id` · `priority must be 1, 2 or 3` |
| any string field | `must be a string` · `must be at least 1 character(s)` · `must be at most N characters` · `must not contain control characters` · `must not be blank` |
| `evidence[i].id` | additionally `must not start or end with whitespace` · `duplicate evidence id <id>` |
| `evidence[i].subcategoryIds` | `must be a non-empty array` · `at most 25 subcategory references per evidence item` |
| `evidence[i].subcategoryIds[j]` | `unknown subcategory id in this subset: <id>` |
| `evidence[i].validDays` | `validDays must be an integer from 1 to 3650` |
| `evidence[i].type/scope/assertion`, `decisions[i].verdict` | `must be one of …` |
| `evidence[i].collectedOn`, `decisions[i].decidedOn`, `profile.asOf` | `must be an ISO date (YYYY-MM-DD)` |
| `decisions[i].subcategoryId` | `unknown subcategory id in this subset` · `duplicate decision for the same subcategory` |
| `policy.schema` | `schema must be 'tessera.policy/1'` |
| `policy.<number field>` | `must be a number` · `must be a finite number` · `must be between A and B` · `must be an integer from A to B` |
| `policy.freshnessWeights.aging` / `.stale` | `must not exceed freshnessWeights.fresh` / `must not exceed freshnessWeights.aging` |
| `policy.scopeWeights.partial` | `must not exceed scopeWeights.full` |
| `policy.exposure.not-applicable` | `must be 0` |
| `policy.bands.high` | `must be greater than bands.moderate` |
| `policy.separationOfDuties` | `must be a boolean` |

## Canonical order

Accepted objects are emitted in this key order, which is also the order the fixture and the exporters use:

- pack: `schema`, `profile`, `evidence`, `decisions`, then `policy` only when the input had one;
- profile: `name`, `asOf`, `priorities` (entries in input order);
- evidence item: `id`, `title`, `type`, `subcategoryIds` (de-duplicated, input order), `collectedOn`,
  `validDays`, `scope`, `assertion`, `source`, then `note` and `collectedBy` only when present;
- decision: `subcategoryId`, `reviewer`, `verdict`, `rationale`, `decidedOn`;
- policy: `schema`, `agingMultiplier`, `freshnessWeights { fresh, aging, stale }`, `scopeWeights { full, partial }`,
  `sufficientCoverage`, `minDistinctTypes`, `exposure { none, refuted, contradicted, weak, partial, sufficient,
  accepted-risk, not-applicable }`, `bands { moderate, high }`, `minOverrideRationale`, `decisionValidDays`,
  `separationOfDuties`.

The policy order is the order of `DEFAULT_POLICY`, so `isDefaultPolicy` (a `JSON.stringify` comparison) is
reliable for any validated policy regardless of the key order in the file. A negative zero is normalised to `0`
for the same reason.

## How it is tested

`tests/validate-hardening.test.ts` covers each rule above with exact paths and messages, idempotence, the
no-policy round trip, the bundled fixture and the baseline messages verbatim.

`tests/fuzz-invariants.test.ts` uses the seeded helpers in `tests/helpers/fuzz.ts`:

- `mulberry32(seed)` — a small deterministic generator, so every failing case is reproducible from its seed;
- `randomPack(rng, { maxEvidence, maxDecisions, withPolicy })` — valid, bounded packs: catalog ids only,
  dates from 2020 to 2027 (some after `asOf`), `validDays` 1 … 3650, random types, scopes and assertions,
  optional notes and collectors (reviewers sometimes coincide with collectors), decisions with 0 … 120-character
  rationales, random priorities and, on request, a random in-bounds policy;
- `mutateJson(rng, value)` — one to five random mutations of a deep copy: type swaps, key or element deletion,
  10 000-character strings, `NaN`/`Infinity` tokens and extreme numbers, deeply nested arrays, duplicated
  evidence or decisions, unknown keys, hostile strings (control characters, surrounding whitespace, lone
  surrogates, unknown ids) and malformed dates.

Invariants checked over hundreds of seeds: every random valid pack passes `validatePack`, round-trips
byte-identically and validates idempotently; `buildReport` always returns 25 results in catalog order with
statuses from the eight known values, residuals within 0 … 3 at two decimals, bands consistent with the
effective policy's thresholds and monotone in residual, gaps sorted by residual descending then id and
excluding `sufficient` and `not-applicable`, rollups summing to 25, and byte-identical JSON across repeated
calls and a `structuredClone`; every mutated fixture, raw non-JSON string and truncated JSON text yields a
boolean `ok` with bounded, well-formed issues and never an exception. Packs are kept small (at most 40
evidence items and 20 decisions) so the whole file runs in a few seconds on a single worker.

## Limits

The validator checks shape, bounds and character classes; it does not judge content. Zero-width or
bidirectional formatting characters are not control characters and are accepted. All of this concerns
synthetic, educational data: validation makes an import safe to evaluate, it does not make the evidence true.
