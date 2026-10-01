# AUDIT — Tessera

## Threat model

**Assets:** the in-memory evidence pack and the exported report. **Actors:** the single local user; a hostile pack file (imported JSON); a hostile spreadsheet consumer of the CSV. **Out of scope:** multi-user authorisation, server-side anything (there is no server), confidentiality of real evidence (none is accepted — metadata only, synthetic by design).

| Threat | Control | Residual |
|---|---|---|
| Oversized / deeply nested import causes DoS | File read refused above 512 KiB; UTF-8 byte count checked before `JSON.parse`; ≤ 500 artifacts, ≤ 200 decisions, ≤ 25 subcategory refs / priorities; strings length-capped | `JSON.parse` of ≤ 512 KiB is bounded; no recursive schema |
| Malformed/unknown fields | Hand-written validator rebuilds a clean object with only known keys; path-addressed issues; nothing applied on any issue | Validator is bespoke (no zod) — tested, but less battle-hardened |
| Script injection via imported strings | React escapes all text; no `dangerouslySetInnerHTML`; CSP `script-src 'self'` in `vercel.json` | `style-src 'unsafe-inline'` kept for React inline styles |
| CSV formula injection | Cells starting with `= + - @` (after optional whitespace/control chars) prefixed with `'`; all cells quoted | Consumers that strip the quote prefix differently may still interpret |
| Reviewer greenwashing | `accepted`/`not-applicable` need ≥ 40-char rationale, never apply over contradicted/refuted; refusals surfaced as warnings and tile markers; all-N/A functions report `not-assessed` | Rationale length is a weak proxy for substance |
| Stale state / silent data loss | Memory-only state, explicit "reset on refresh" notice, export pack any time | User can still forget to export |
| Supply chain | 2 runtime deps (react, react-dom) + OFL fonts; dev deps vite/vitest/typescript; lockfile committed; `npm audit` clean after vitest 4.1.11 | Advisory GHSA-82fw-gwwq-j7x9 was dev-only before the upgrade |

## Data flow

Bundled fixture JSON → `validatePackObject` → React state → `buildReport` (pure) → DOM. Import: `<input type=file>` → `FileReader` (size-gated) → `validatePack` → state. Export: `JSON.stringify`/`toCsv` → `Blob` → transient object URL → download. No fetch/XHR/WebSocket; no localStorage/sessionStorage/IndexedDB; no third-party scripts, fonts or trackers.

## Security headers (vercel.json)

`default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'` plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, restrictive `Permissions-Policy`, COOP/CORP same-origin.

## Dependency findings

See EVIDENCE.md. Final state: `found 0 vulnerabilities`.

## Unresolved limitations

- Not a NIST tool; heuristic scoring is custom and labelled as such in UI, report (`scoringNote`) and README.
- No evidence content or hashing (metadata only) — paired with Weft for integrity.
- Single-reviewer model; no identity, approval chain or audit log beyond the decision record.
- `vite preview`/Vercel static hosting only; headers are not applied by the Vite dev server.
- Accessibility verified with axe automation and keyboard checks only; no screen-reader session. An early '0 violations' result was measured on a broken (empty) page; the parent's independent scan found contrast failures, now fixed and guarded by `tests/contrast.test.ts`.
