# Theme, patterns, keyboard and print

How Tessera draws the mosaic in the light and dark colour schemes, how status is encoded without relying on colour,
how the mosaic is operated from the keyboard, and what changes when the page is printed. Everything here is verified
by `tests/contrast.test.ts`, `tests/theme.test.ts` and `tests/mosaic-ui.test.tsx`, which read `src/ui/styles.css`,
`index.html` and the rendered components directly — the numbers below are what those tests compute.

## Colour schemes

`index.html` declares `<meta name="color-scheme" content="light dark">` and `src/ui/styles.css` sets
`color-scheme: light dark` on `:root`, so form controls, scrollbars and the page canvas follow the operating-system
preference. One token set serves both schemes: the light values live on `:root`; a dark set redefines the same tokens
inside `@media (prefers-color-scheme: dark)`. Components never use literal colours — only tokens — so a scheme is a
single block of variable overrides. There is no manual toggle; the browser's `prefers-color-scheme` decides.

Roles: `--paper` (panels), `--ground` (page canvas), `--ink`/`--ink-2`/`--ink-3` (text, strong to muted), six function
hues (`--gv --id --pr --de --rs --rc`), text-safe variants (`--de-text`, `--warn-text`) for the ochre hue that is too light
to be text, semantic `--good`/`--bad`/`--warn`, and fill-only tokens (`--tile-base`, `--bad-fill`, panel and chip
backgrounds). Function hues are *text* in `.fn`/`.row__code` and *fills* in tiles, so in the dark scheme they are
lightened enough to read as text while the tile fills mix a smaller share of the hue towards the dark `--tile-base`.

### Token values

| token | light | dark | role |
|---|---|---|---|
| `--ground` | `#e9ecef` | `#141821` | page canvas |
| `--paper` | `#f7f8f9` | `#1c222d` | panels, drawer, table |
| `--ink` | `#121a26` | `#f0f3f7` | primary text, tile ids |
| `--ink-2` | `#44506a` | `#bcc5d1` | secondary text |
| `--ink-3` | `#56627a` | `#9fabba` | muted text, table headers |
| `--line` | `#c9d0d9` | `#3a4453` | panel borders (decorative) |
| `--stone` | `#cbd2da` | `#2d3542` | stale chip, not-applicable stripes |
| `--stone-2` | `#b4bcc7` | `#4e5a6d` | dots of the none pattern, stale border |
| `--focus` | `#1f5fbf` | `#8ab8ff` | focus ring |
| `--gv` | `#5b4b8a` | `#aa9bd9` | Govern |
| `--id` | `#2d5f8b` | `#74a6d6` | Identify |
| `--pr` | `#276b5c` | `#62b096` | Protect |
| `--de` | `#b07a1f` | `#b07a1f` | Detect — fill only |
| `--de-text` | `#8a5a10` | `#e3b25c` | Detect as text |
| `--rs` | `#8e3b46` | `#ea9ba6` | Respond |
| `--rc` | `#4f6a2c` | `#93b065` | Recover |
| `--good` | `#276b5c` | `#62b096` | sufficient, fresh, low band |
| `--bad` | `#8e3b46` | `#ea9ba6` | contradicted/refuted text, high band |
| `--warn` | `#b07a1f` | `#96630f` | borders and accepted-risk stripes — fill only |
| `--warn-text` | `#8a5a10` | `#e3b25c` | partial/weak/moderate text |
| `--tile-base` | `#ffffff` | `#161a22` | surface the status fills are mixed towards |
| `--tile-mix` | 72% | 50% | share of the hue in a sufficient tile |
| `--tile-mix-partial` / `--tile-mix-faint` | 62% / 25% | 44% / 10% | strong / faint stripe of a partial tile |
| `--tile-mix-weak` | 45% | 40% | hue stripe of a weak tile |
| `--bad-fill` | `#8e3b46` | `#7a2f3a` | refuted and contradicted tile fill |
| `--button-hover` | `#22304a` | `#d9dfe8` | primary button hover |
| `--row-selected-bg` | `#eef2f8` | `#28334a` | selected register row |
| `--warnbox-bg` | `#f8e9eb` | `#3b2127` | refused-action box |
| `--remediation-bg` | `#f1ebdc` | `#33301f` | remediation box |
| `--refute-bg` | `#fbf3f4` | `#2b1f23` | refuting evidence card |
| `--chip-fresh-bg` / `--chip-aging-bg` | `#dcebe6` / `#f1e6cf` | `#1b3029` / `#3b3120` | freshness chips |
| `--chip-refutes-bg` / `--chip-supports-bg` | `#f3d9dc` / `#dde6f0` | `#3a1f25` / `#22344a` | assertion chips |

## Contrast guarantees

Target: WCAG 2.1 AA, 4.5:1 for all text, in both schemes. The tests parse the stylesheet, resolve each token per
scheme, and compute the ratio with the WCAG relative-luminance formula. `color-mix(in srgb, C p%, B)` is replicated
exactly as browsers resolve it in 8-bit sRGB — per channel `round(C·p + B·(1−p))` — so the tile fills are checked
against the real rendered colour, not an approximation. Measured ratios:

### Text tokens on the two surfaces

| token | on `--paper` light | on `--ground` light | on `--paper` dark | on `--ground` dark |
|---|---|---|---|---|
| `--ink` | 16.44 | 14.74 | 14.34 | 15.96 |
| `--ink-2` | 7.59 | 6.81 | 9.15 | 10.19 |
| `--ink-3` | 5.77 | 5.17 | 6.84 | 7.62 |
| `--gv` | 7.01 | 6.28 | 6.38 | 7.10 |
| `--id` | 6.33 | 5.67 | 6.21 | 6.91 |
| `--pr` | 5.91 | 5.30 | 6.21 | 6.91 |
| `--de-text` | 5.56 | 4.99 | 8.20 | 9.12 |
| `--rs` | 6.90 | 6.18 | 7.40 | 8.24 |
| `--rc` | 5.76 | 5.16 | 6.56 | 7.31 |
| `--good` | 5.91 | 5.30 | 6.21 | 6.91 |
| `--bad` | 6.90 | 6.18 | 7.40 | 8.24 |
| `--warn-text` | 5.56 | 4.99 | 8.20 | 9.12 |
| `--focus` | 5.73 | 5.14 | 7.89 | 8.78 |

### Tile ids (`--ink`) on the status fills

| function hue | sufficient fill, light | ratio | sufficient fill, dark | ratio | partial strong stripe light / dark | weak stripe light / dark |
|---|---|---|---|---|---|---|
| `--gv` | `#897dab` | 4.65 | `#605b7e` | 5.73 | 5.79 / 6.53 | 8.22 / 7.11 |
| `--id` | `#688cab` | 4.93 | `#45607c` | 5.86 | 6.09 / 6.63 | 8.45 / 7.24 |
| `--pr` | `#63948a` | 5.11 | `#3c655c` | 5.88 | 6.26 / 6.68 | 8.59 / 7.28 |
| `--de` | `#c69f5e` | 7.09 | `#634a21` | 7.45 | 8.20 / 8.26 | 10.22 / 8.85 |
| `--rs` | `#ae727a` | 4.57 | `#805b64` | 5.24 | 5.66 / 6.05 | 8.07 / 6.61 |
| `--rc` | `#809467` | 5.28 | `#556544` | 5.66 | 6.45 / 6.47 | 8.78 / 7.06 |

The light-scheme fills are unchanged from the original palette (72% hue over white); the dark scheme lowers the hue
share to 50% so the near-white ink keeps ≥ 4.5:1 on every hue.

### Other text/background pairs

| foreground | background | where | light | dark |
|---|---|---|---|---|
| white id | `--bad-fill` | refuted tile, contradicted stripes | 7.33 | 9.15 |
| `--ink` | `--warn` | accepted-risk stripes | 4.70 | 4.62 |
| `--ink-2` | `--ground` | none tile | 6.81 | 10.19 |
| `--ink-2` | `--stone` / `--paper` | not-applicable stripes | 5.29 / 7.59 | 7.09 / 9.15 |
| `--good` | `--chip-fresh-bg` | fresh chip | 5.10 | 5.44 |
| `--warn-text` | `--chip-aging-bg` | aging chip | 4.78 | 6.55 |
| `--bad` | `--chip-refutes-bg` | refutes chip | 5.51 | 6.94 |
| `--id` | `--chip-supports-bg` | supports chip | 5.33 | 4.93 |
| `--ink-2` | `--stone` | stale chip | 5.29 | 7.09 |
| `--ink` | `--warnbox-bg` / `--remediation-bg` / `--refute-bg` | drawer boxes | 14.85 / 14.70 / 16.00 | 13.17 / 11.92 / 14.26 |
| `--ink-2`, `--ink-3` | `--refute-bg` | refuting evidence card | 7.39, 5.62 | 9.10, 6.81 |
| `--paper` | `--ink` / `--button-hover` | primary button, hover | 16.44 / 12.42 | 14.34 / 11.91 |
| every text token above | `--row-selected-bg` | selected register row | ≥ 5.26 | ≥ 4.91 |

Lowest text pairing: 4.57 (light, Respond sufficient tile) and 4.62 (dark, accepted-risk stripes). Both are above the
4.5 floor and both are asserted by tests, so a palette edit that drops below it fails the suite.

## Status is a pattern, colour is the function

Each tile shows the subcategory number; the function (GV, ID, PR, DE, RS, RC) is the hue of the row border, the row
code and the tile, and the **status is a geometric pattern**, so two tiles of the same function with different statuses
never differ by colour alone:

| status | pattern |
|---|---|
| sufficient | solid fill of the function hue |
| partial | wide 45° stripes of the hue in two strengths |
| weak | thin 45° hue stripes on paper |
| none | small dots on the page canvas |
| contradicted | red cross-hatch (both diagonals), white id with a dark halo |
| refuted | solid red (`--bad-fill`), white id |
| accepted-risk | ochre 135° stripes on paper |
| not-applicable | thin horizontal grey stripes on paper, muted id |

Priority is shown as one to three dots in the tile's lower-left corner; a `!` in the top-right corner marks a refused or
pending reviewer action. None of this is the only channel: every tile's accessible name reads
`"<id>: <status>, residual <n.nn> (<band>), priority <p>"` plus `", has reviewer warning"` when applicable, the drawer
states the status in words, and the gap register lists it in text. The legend under the mosaic describes each pattern in
text and shows the six function colours with their names.

The function colours and the patterns are this project's own encoding, not NIST's.

## Keyboard map for the mosaic

The 25 tiles form one composite widget with a roving tabindex: exactly one tile is in the Tab sequence (the selected
outcome, or the first tile, GV.OC-03, when nothing is selected). A visually hidden hint, "Use arrow keys to move between
tiles", describes the grid for assistive technology. Each function is a labelled group (`role="group"` named by its
heading), and every tile is a real `<button>` with `aria-pressed` for the current selection.

| key | effect |
|---|---|
| Tab / Shift+Tab | enters the mosaic on the focusable tile and leaves it with the next press |
| → / ← | next / previous tile in reading order, continuing across categories and function rows |
| ↓ / ↑ | the tile at the same position in the next / previous function row, clamped to that row's last tile |
| Home / End | first tile (GV.OC-03) / last tile (RC.CO-03) |
| Enter / Space | select the focused tile and open its drawer (native button activation) |

Arrow keys only move focus; selection stays with Enter/Space or a click, so moving through the grid does not re-render
the drawer at every step. At the edges of the grid focus stays put. Each tile carries `data-tile-id="<id>"` so the
application can return focus to the outcome a reviewer came from when the drawer closes.

## Print

`@media print` turns the page into an executive-readable hand-out:

- Black text on white (`--ink: #000000`, `--paper`/`--ground`/`--tile-base: #ffffff`), with every dark-scheme token
  re-pinned to its light value, so a dark-mode browser prints the light palette.
- Hidden: skip link, pack actions, the add-evidence and decision forms, notices, every button that is not a tile
  (outcome ids and sortable column headers keep their text), and session/export/policy controls.
- Tiles and legend swatches keep their fills (`print-color-adjust: exact`), transitions and the selected-tile lift
  are off, and rows, evidence cards and table rows avoid page breaks.
- The drawer is static (no sticky position, no scroll box), the workbench is a single column, and the open
  derivation trace stays expanded.
- The gap register starts on a new page.

The printed register reflects the filters that were active on screen; the filter controls print as static boxes
showing their values, so the hand-out states which subset it contains. The profile name and the "Evaluate as of" date
print the same way.

## How it is tested

- `tests/contrast.test.ts` — the original token checks (kept verbatim) plus: every text token against both surfaces in
  the dark scheme; `--ink` on the sufficient fill, the partial strong stripe and the weak stripe for all six hues in
  both schemes (color-mix replicated); white on `--bad-fill`; ink on the accepted-risk and not-applicable stripes; the
  five chip pairs; drawer boxes; buttons; every text token on the selected register row; and structural guards that the
  rules use the tokens rather than literal colours.
- `tests/theme.test.ts` — `color-scheme: light dark` in CSS and HTML, the dark block redefines every token, the
  background tokens and mix percentages exist in both schemes, fills never mix with literal white, no background uses a
  hard-coded hex, no `!important`, `.sr-only` exists, the print block hides the right selectors, keeps tiles, drawer,
  register and footer, re-pins all tokens, and sets page-break and colour-adjust rules.
- `tests/mosaic-ui.test.tsx` — renders the mosaic with the demo pack: 25 `data-tile-id` buttons, exactly one
  `tabindex="0"` and 24 `tabindex="-1"`, six labelled groups, the accessible-name pattern, the hidden hint, no inline
  styles; the pure keyboard map for arrows, Home/End and ignored keys; and the legend's eight patterns plus six
  function swatches.

## Known limits

- The fills depend on `color-mix()`, available in browsers released since 2023; the status is always available in text.
- The contradicted tile's white id sits on a dense cross-hatch; it reads through a dark halo (`text-shadow`) and the
  pairing against the dark stripes is 7.33 (light) / 9.15 (dark), but the light gaps between stripes are not a 4.5:1
  background on their own. The status is stated in the tile's name, in the drawer and in the register.
- Stripe-to-stripe contrast inside the partial and weak patterns is about 2:1 by design (the patterns differ in
  geometry, not only in tone); it is reported, not asserted, because it is not text.
- Panel borders (`--line`) are decorative and below the 3:1 non-text guideline in both schemes; focus is shown with a
  separate 3px ring that is ≥ 5.1:1 on both surfaces.
