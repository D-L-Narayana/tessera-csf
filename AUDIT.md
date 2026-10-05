# AUDIT — Tessera

## Threat model

**Assets:** the in-memory evidence pack, the optional browser-stored copy, and the exported report. **Actors:** the single local user; a hostile pack, policy or previous-report file (imported JSON); a hostile spreadsheet or Markdown consumer of the exports; a hostile or careless reviewer. **Out of scope:** multi-user authorisation, server-side anything (there is no server), confidentiality of real evidence (none is accepted — metadata only, synthetic by design).

| Threat | Control | Residual |
|---|---|---|
| Oversized / deeply nested import causes DoS | File read refused above 512 KiB; UTF-8 byte count checked before `JSON.parse`; ≤ 500 artifacts, ≤ 200 decisions, ≤ 25 subcategory refs / priorities; strings length-capped; previous-report import bounded the same way (≤ 200 results, known keys only) | `JSON.parse` of ≤ 512 KiB is bounded; no recursive schema |
| Malformed/unknown fields, control characters | Hand-written validator rebuilds a clean object with only known keys; path-addressed issues; control characters and blank strings rejected; nothing applied on any issue; seeded fuzz tests assert the validator never throws and is idempotent | Validator is bespoke (no zod) — tested, but less battle-hardened |
| Rule-policy tampering (a pack that lowers thresholds to look green) | Policy fields bounded (`POLICY_BOUNDS`), `not-applicable` exposure pinned to 0, monotonic weights enforced; every report embeds the policy it used and `policyIsDefault`; the UI labels a non-default policy; comparison warns when policies differ | A reader must look at the embedded policy; the tool cannot know which policy is "right" |
| Script injection via imported strings | React escapes all text; no `dangerouslySetInnerHTML`; no inline styles or scripts in the application; CSP `script-src 'self'; style-src 'self'` in `vercel.json`; build-output guard (`qa/check-dist.mjs`) fails on inline script/style/event handlers | CSP is enforced only when served with the production headers (Vercel, or `qa/serve-dist.mjs`) |
| CSV / Markdown injection | Cells starting with `= + - @ \|` (after optional whitespace/control chars) prefixed with `'`; all cells quoted; Markdown cells escape `\|`, `<`, `&` and newlines | Consumers that strip the quote prefix differently may still interpret |
| Reviewer greenwashing | `accepted`/`not-applicable` need a substantive rationale (policy minimum, default 40 chars), never apply over contradicted/refuted; an accepting reviewer who collected all current supporting evidence is refused (separation of duties); decisions lapse after the policy's validity window; refusals surfaced as warnings and tile markers; all-N/A functions report `not-assessed` | Rationale length is a weak proxy for substance; the collector field is self-declared metadata |
| Stale state / silent data loss | History-backed state with Undo/Redo; confirm before destructive actions (remove, load demo, start empty, import); unsaved-changes prompt on page leave; export pack any time | A user can still ignore the prompt |
| Browser storage exposure | Storage is opt-in, feature-detected, unencrypted and labelled as such; same 512 KiB bound; restored packs are re-validated; "Forget saved session" deletes the copy | Anyone with access to the browser profile can read the synthetic data |
| Supply chain | 2 runtime deps (react, react-dom) + OFL fonts; dev deps vite/vitest/typescript; lockfile committed; CI runs `npm audit --audit-level=high`; browser QA tooling is loaded from outside the repository and is not a dependency | Advisory GHSA-82fw-gwwq-j7x9 was dev-only before the vitest upgrade |

## Data flow

Bundled fixture JSON → `validatePackObject` → React state (history) → `buildReport` (pure) → DOM. Import: `<input type=file>` → `FileReader` (size-gated) → `validatePack` → state. Previous report: `FileReader` → `validatePriorReport` → comparison only (never touches the pack). Browser storage (opt-in): `saveSession` (bounded) → `localStorage`; restore → `loadSession` → `validatePackObject` → state. Export: `JSON.stringify` / `toCsv` / `reportToMarkdown` → `Blob` → transient object URL → download. No fetch/XHR/WebSocket; no third-party scripts, fonts or trackers.

## Security headers (vercel.json)

`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'` plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, restrictive `Permissions-Policy`, COOP/CORP same-origin, `Strict-Transport-Security`, immutable caching for hashed `/assets/` and `no-cache` for the HTML entry. `tests/deploy.test.ts` guards these values; `qa/serve-dist.mjs` serves `dist/` with exactly these headers so the browser workflow runs under the enforced CSP and records any `securitypolicyviolation` event.

## Dependency findings

See EVIDENCE.md. Final state: `found 0 vulnerabilities`.

## Unresolved limitations

- Not a NIST tool; heuristic scoring is custom and labelled as such in UI, report (`scoringNote`, embedded `policy`) and README.
- No evidence content or hashing (metadata only) — paired with Weft for integrity.
- Single-reviewer model; no identity, approval chain or audit log beyond the decision record and the self-declared collector.
- Static hosting only; headers are not applied by the Vite dev server (use `npm run qa:serve` against a build to test them).
- Accessibility verified with axe automation and keyboard checks only; no screen-reader session. Axe runs in a separately identified instrumentation context (CSP bypassed for the injected engine only); the application flow itself is exercised under the enforced CSP.
