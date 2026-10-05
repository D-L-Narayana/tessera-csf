# Third-party notices — Tessera

| Component | Version | License | Source |
|---|---|---|---|
| React, React DOM | 19.x | MIT | https://github.com/facebook/react |
| Vite | 6.x (dev) | MIT | https://github.com/vitejs/vite |
| Vitest | 4.1.x (dev) | MIT | https://github.com/vitest-dev/vitest |
| TypeScript | 5.9 (dev) | Apache-2.0 | https://github.com/microsoft/TypeScript |
| @fontsource/fraunces (Fraunces by Undercase Type) | 5.x | SIL OFL 1.1 | https://github.com/undercasetype/Fraunces · https://fontsource.org/fonts/fraunces |
| @fontsource/public-sans (Public Sans, U.S. Web Design System) | 5.x | SIL OFL 1.1 | https://github.com/uswds/public-sans · https://fontsource.org/fonts/public-sans |

QA tooling is not a dependency of this repository: `qa/workflow.mjs` and `qa/axe-audit.mjs` load Playwright (Apache-2.0) and, when available, @axe-core/playwright or an axe-core bundle (MPL-2.0) from outside the project at run time; nothing from them is shipped in `dist/`.

Framework text: NIST Cybersecurity Framework 2.0, NIST CSWP 29 (Feb 26, 2024), https://doi.org/10.6028/NIST.CSWP.29 — a U.S. Government work not subject to copyright in the United States. Subcategory identifiers and outcome statements are transcribed; the 25-item selection, colours, patterns and scoring are this project's own.

No UI component libraries were used; the interface is hand-written semantic HTML/CSS. Font license files ship inside the respective `node_modules/@fontsource/*` packages and the OFL permits bundling the fonts in the built site.
