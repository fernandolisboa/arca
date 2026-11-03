# Spec 0006: Design system and theming

- Status: Ready for tickets
- Date: 2026-11-03
- Epic: cross-platform foundations ([ROADMAP.md](../ROADMAP.md#phase-1--family-mvp-web)); replaces the placeholder tokens of [spec 0001](0001-foundations-scaffold.md) R5 and keeps its CSP unchanged
- Decisions: [ADR-0020](../adr/0020-themeable-ui.md), [ADR-0010](../adr/0010-stack-revised.md), [ADR-0005](../adr/0005-platform-strategy.md)
- Mockups: the design canvas [Arca: design e telas](https://claude.ai/artifact/2ffxBDSVLLkWHsuiVHSJeP) (private to the owner; the board "Monte seu tema" is the live theme picker). This spec is the source of truth where they differ.

## Goal

One visual language for every screen, with the choices the owner asked for: three color themes, light and dark, four font pairs, three corner shapes and three navigation layouts on wide screens, chosen per person in Settings. Components read tokens only, so a new theme is a data change.

## Scope

**In:** theme data and generated CSS in `packages/ui`; the contrast test; fonts and icons; motion tokens; the `AppShell` with its navigation layouts; the shared patterns below; a Settings screen for appearance; Playwright checks per layout and breakpoint.

**Out:** syncing preferences with the account (comes with the identity epic, spec 0003); feature screens themselves (each feature's spec uses these patterns); native app icons and splash screens (Phase 4).

## Defaults

The owner picked these on 2026-11-03. Identifiers are English; the pt-BR labels come from the i18n catalog.

| Axis | Default | Other options |
| --- | --- | --- |
| Color theme | `notebook` | `serene`, `panel` |
| Mode | `dark` | `light`, `system` |
| Font pair | `expressive` | `editorial`, `clean`, `technical` |
| Corners | `square` | `soft`, `round` |
| Navigation from 768 px | `top` | `side`, `floating-dock` |
| Navigation below 768 px | `floating-dock` | `fixed-dock` |
| Motion | `on` | `off` (also forced off by `prefers-reduced-motion: reduce`) |

## Tokens

### Color

Every palette defines the same keys. `second` is the fill for non-leading bars; `logoRoof` is the roof of the ark mark.

| Key | notebook light | notebook dark | serene light | serene dark | panel light | panel dark |
| --- | --- | --- | --- | --- | --- | --- |
| `bg` | `#FAF6EF` | `#1E1A17` | `#F6F8F8` | `#0F1C20` | `#F4F5F7` | `#111418` |
| `surface` | `#FFFDF8` | `#29231F` | `#FFFFFF` | `#16272C` | `#FFFFFF` | `#1A1E24` |
| `ink` | `#2B2622` | `#F3EDE4` | `#14262B` | `#E8F0F1` | `#1B1F24` | `#E9ECF0` |
| `muted` | `#6B5F55` | `#C2B6A8` | `#4A5F65` | `#A3B6BA` | `#5A6470` | `#9AA4B0` |
| `line` | `#E6DCCB` | `#3D352E` | `#D9E2E4` | `#2A3F44` | `#DDE1E6` | `#2C323A` |
| `primary` | `#A8461F` | `#E58A60` | `#1D5B69` | `#6CC0D0` | `#2457D6` | `#7AA2FF` |
| `onPrimary` | `#FFFFFF` | `#1E1A17` | `#FFFFFF` | `#0F1C20` | `#FFFFFF` | `#111418` |
| `soft` | `#F1E8DA` | `#352D27` | `#E6EDEE` | `#1D3338` | `#E9ECF1` | `#222831` |
| `track` | `#EADFCD` | `#3D352E` | `#E6EDEE` | `#2A3F44` | `#E9ECF1` | `#2C323A` |
| `second` | `#8C7F73` | `#9C8F82` | `#8FA3A8` | `#6F878C` | `#9AA4B0` | `#5D6672` |
| `logoRoof` | `#F1C58E` | `#F1C58E` | `#F2C14E` | `#F2C14E` | `#FF9A5C` | `#FF9A5C` |
| `okBg` / `okInk` | `#E3EBD9` / `#34491F` | `#2C3A22` / `#BFD8A5` | `#DDF1E6` / `#145C36` | `#173A2A` / `#A6E2C1` | `#EAF6EF` / `#17603A` | `#173326` / `#9FDDB9` |
| `warnBg` / `warnInk` | `#F6DDCB` / `#7E3315` | `#45281A` / `#F4BE9F` | `#FCEFCF` / `#6B4A00` | `#3D3115` / `#F5D58A` | `#FDF0E6` / `#8A3A07` | `#3A2414` / `#FFC49E` |

Every palette also has `dangerBg` / `dangerInk`: `#FBE3E0` / `#9B1C1C` in light modes and `#3E1A19` / `#FFB4A8` in dark modes. `dangerInk` is also the color of error text on `bg` and `surface`.

Hover and pressed states on `primary` fills use `color-mix(in oklab, var(--primary) 88%, var(--ink))` and 76%, so no extra token is needed and contrast with `onPrimary` only grows.

**Rename from spec 0001.** `surface` (page) becomes `bg`; `surface-raised` (card) becomes `surface`; `brand` becomes `primary`; `brand-strong` becomes the hover rule above; `on-brand` becomes `onPrimary`; `ink-muted` becomes `muted`; `ok`, `warning` and `danger` as text become `okInk`, `warnInk` and `dangerInk`; `line` and `ink` keep their names.

**Contrast pairs** the test checks, each at least 4.5:1 in every palette: `ink` on `bg`, `surface`; `muted` on `bg`, `surface`, `soft`; `primary` on `bg`, `surface`, `soft`; `onPrimary` on `primary`; `okInk` on `okBg`; `warnInk` on `warnBg`; `dangerInk` on `dangerBg`, `bg`, `surface`. The values above pass; the lowest is 4.86:1, `primary` on `soft` in notebook light.

Non-text cues (bars on `track`, the dashed `line` border of unknown items) are below 3:1 in some palettes. That is acceptable only because each one repeats information the text already gives (the score, the words "Ainda não sabemos"); a cue that carries meaning alone must reach 3:1 and joins the test.

### Type

| Pair | Display (titles, numbers in hero cards) | Body | Numbers in tables |
| --- | --- | --- | --- |
| `expressive` | Bricolage Grotesque 600–700 | DM Sans 400–700 | DM Sans, tabular figures |
| `editorial` | Fraunces 500–600 | Source Sans 3 400–700 | Source Sans 3, tabular figures |
| `clean` | Inter 700 | Inter 400–600 | Inter, tabular figures |
| `technical` | IBM Plex Sans 600 | IBM Plex Sans 400–600 | IBM Plex Mono 500 |

Scale (rem at 16 px): 0.75 caption, 0.875 small, 1 body, 1.125 lead, 1.375 title, 1.75 page title, 2.25 hero. Body line height 1.5; titles 1.15–1.25. Body text never below 1 rem on phones; captions are for metadata only (sources, dates).

### Shape, space and motion

| Token | `square` | `soft` | `round` |
| --- | --- | --- | --- |
| `radius-card` | 4 px | 16 px | 28 px |
| `radius-control` | 4 px | 12 px | 999 px |
| `radius-chip` | 4 px | 999 px | 999 px |
| `radius-dock` | 6 px | 18 px | 999 px |

Spacing follows Tailwind's 4 px scale; `spacing-touch` stays 44 px and every control meets it.

Motion: `duration-fast` 150 ms (hover, press), `duration-base` 250 ms (theme change, toggles), `duration-slow` 450 ms (cards entering), `ease-out` `cubic-bezier(0.2, 0.8, 0.2, 1)`. Bars grow from zero on first paint with a 90 ms stagger per row, for the first six rows only; later rows start with the sixth. With motion off, every duration is 0 and looping animations do not render.

## Shell and navigation

- Four navigation items: home, countries, plan and documents. Their labels and icons are defined once and every layout renders the same list.
- **Below 768 px:** a bottom dock with icon over label. `fixed-dock` is attached to the bottom edge; `floating-dock` sits 14 px from the sides and 16 px above the safe area, with `radius-dock` and a shadow. Content gets bottom padding equal to the dock height plus the safe-area inset, so nothing hides behind it.
- **From 768 px:** `top` is a bar with the mark and the navigation items in a row; `side` is a 216 px column with the mark on top; `floating-dock` is a centered bar above the bottom edge. The active item uses `primary` on `soft`.
- Content column max width 1200 px on desktop; screens use a two-column grid from 1024 px where the spec of the screen says so.
- The shell keeps spec 0001's safe-area insets and skip link.

## Shared patterns

These come from the mockups and every feature reuses them:

- **Next action card:** `primary` background, a route line from origin city to destination with a moving dot (static with motion off), the step title in the display font, one line of where, how long and what it needs, and one button.
- **Ranking row:** position in the display font (`primary` for first), country flag, name, a bar on `track` (`primary` for first, `second` for the rest), score with tabular figures, formatted for the locale with `Intl.NumberFormat`.
- **Source line:** "Fonte: domain · verificado em" and the verification date, in caption size, under any requirement, fee, threshold or deadline (CLAUDE.md rule 1). The date is a plain calendar date from `packages/domain`, formatted for the locale with `Intl.DateTimeFormat` and no time-zone conversion, so it never shifts a day.
- **Status chips:** active version (`ok`), pending activation (`warn`), unknown (`soft` with `muted` text). Unknown items use a dashed border on their card and say a research task is open. Labels follow [GLOSSARY.md](../GLOSSARY.md).
- **Rule report:** the "Avisar regra errada" link on every route screen; it opens a research task (GLOSSARY.md).
- **Flags:** SVG flags rendered at 26 × 18 px with a 1 px `line` ring, bundled and served from the app's own origin, rendered as React components or `<img src>`, never injected as markup. The flag set is chosen with the country dataset in consultancy core slice 2, through an amendment to ADR-0020 and a supply-chain review; until then, the country code in a chip.

## Copy

All user-facing text goes through i18n (CLAUDE.md). pt-BR strings follow these rules, which the standards reviewer checks:

- Short, concrete sentences in the voice of a colleague: say what to do and why, with the number, place or deadline when there is one.
- No filler adjectives or hype ("incrível", "poderoso", "perfeito"), no "Descubra", "Explore", "jornada", "Bem-vindo(a) ao" or "Vamos lá".
- No em dashes or arrow chains in UI text; one idea per line.
- Say when Arca does not know ("Ainda não sabemos") instead of hedging.

When the authoring session has the `/super-copy` skill, it runs its pass that removes generated-sounding phrasing on new or changed strings; it is an aid, not a gate.

## Requirements

- **R1 Theme data.** `packages/ui/src/theme/` exports the palettes, font pairs, radius sets and motion tokens above as typed, readonly data, with a type that forces every palette to define every key, plus the identifier list of each of the seven axes. The existing components and `apps/web` move from the spec 0001 token names (`brand`, `ink-muted`, `surface-raised`) to these.
- **R2 Generated CSS.** A script writes `packages/ui/src/themes.css` with one block per `[data-theme][data-mode]` pair, one per `[data-font]` and one per `[data-corners]`, plus the system-mode blocks under `prefers-color-scheme`, the defaults on `:root` so a bare `<html>` still has every token, and `color-scheme` per mode (replacing spec 0001's `color-scheme: light dark`). `styles.css` maps Tailwind `@theme` tokens to those properties. The same script writes the allow-list the boot script in R7 reads. A test fails when either committed file differs from the script's output.
- **R3 Contrast test.** A Vitest suite computes WCAG 2.x contrast for every pair in [Contrast pairs](#color) in every palette and fails below 4.5:1.
- **R4 Fonts.** The Fontsource packages from ADR-0020, the latin and latin-ext subsets only, imported statically in the app entry with `font-display: swap`. Browsers download a font file only when a rule uses it, so non-default pairs cost a few KB of CSS until chosen, and the app stays one chunk (spec 0001's `skipWaiting` assumption holds). Font files are never inlined as `data:` URIs (`build.assetsInlineLimit` excludes `.woff2`), since `default-src 'self'` covers fonts and blocks `data:`. The service worker precaches the default pair's files only; other pairs load from the network and fall back to the system font offline. A Playwright check fails on any CSP violation while switching pairs.
- **R5 Icons.** `lucide-react` wrapped by an `Icon` component in `packages/ui` that takes a name from a fixed union, sets `aria-hidden` unless given a label, and uses `currentColor` at 2 px stroke. A lint rule blocks importing `lucide-react` outside `packages/ui`.
- **R6 Motion.** Duration and easing tokens; a `data-motion` attribute; a global rule that zeroes durations under `[data-motion="off"]` and under `prefers-reduced-motion: reduce`; page navigation uses `document.startViewTransition` when present and motion is on, and an instant swap otherwise; `::view-transition-*` animations are zeroed by the same rule.
- **R7 Preferences.** An `appearance` module in `apps/web` reads and writes the seven axes to `localStorage` under one versioned key, validated with Zod enums built from the identifier lists `@arca/ui` exports; unknown values fall back to defaults. Before first paint, a classic same-origin script (`/appearance-boot.js`, loaded in `<head>` without `defer` or `type=module`) applies them: it checks each value against the generated allow-list, calls `setAttribute` only for the fixed `data-*` names and the `theme-color` meta tag (the `appearance` module updates that tag on every change), uses no HTML sinks, and applies the defaults on any exception. No inline script, so the CSP is unchanged; the worker precaches the file with the shell. `index.html` carries the default attributes statically, and the web manifest's `theme_color` and `background_color` use the default palette's `bg`.
- **R8 AppShell.** `AppShell` takes the navigation items and the two layout preferences and renders the layouts in [Shell and navigation](#shell-and-navigation), switching at 768 px with CSS only. It shows only the items whose page exists, so until the features land it shows home alone and grows as pages are added; no placeholder pages.
- **R9 Settings screen.** Creates the Settings page, reachable from the profile button in the header, with an appearance section: one control group per axis with a live preview, the narrow-screen group showing only the dock options. Strings in the pt-BR catalog.
- **R10 Patterns.** `NextActionCard`, `RankingRow`, `SourceLine`, `StatusChip` in `packages/ui`, each with one Vitest render test that checks its content, keyboard reachability and screen-reader labels. Themes are covered by R3 and R11, not per component.
- **R11 End-to-end.** Playwright opens the home screen at 390, 820 and 1280 px in each navigation layout and checks: every navigation item reachable by keyboard, no horizontal scroll, nothing behind the dock, and `@axe-core/playwright` reports no violations in the default theme and in one light theme.

## Threat model for this slice

| Threat | Where | Control |
| --- | --- | --- |
| Tampering: a value written to `localStorage` by an attacker or an old version reaches the DOM | Boot script, `appearance` module | Allow-list from the theme data; `setAttribute` on fixed names only; Zod on read; defaults on any error |
| Elevation: an inline script weakens the CSP | `index.html` | No inline script; the boot script is a same-origin file under `script-src 'self'`; the native `<meta>` CSP needs no hash |
| Information disclosure: font or flag requests reveal visitors to a third party | Fonts, flags | Self-hosted Fontsource files and bundled flags; no external origin added to the CSP |
| Tampering: a compromised font or icon package | Supply chain | Packages with provenance and no install scripts, version cooldown and lockfile policy (ADR-0010); OFL-1.1 added to the license allow-list in its own policy pull request |
| Denial of service: a stale cached chunk after a deploy | Service worker | No code splitting for fonts (R4); the app stays one chunk |

Preferences are display settings, not personal data. When they sync with the account (spec 0003), they become per-account rows under row-level security.

## Definition of done

- R1 to R11 covered by tests; the contrast test and the generated-file freshness test run in CI.
- Playwright with `@axe-core/playwright` passes at 390, 820 and 1280 px in every navigation layout, with no CSP violation reported.
- Every new string is in the pt-BR catalog and follows [Copy](#copy).
- No hard-coded color, radius or font outside `packages/ui/src/theme/`.
- No personal data anywhere in the diff.

## Tickets

Order: a policy pull request first that adds `OFL-1.1` to `.github/policy/licenses.json` and exact-version `MPL-2.0` exceptions for `@axe-core/playwright` and `axe-core` (dev only, file-level copyleft, as for lightningcss); then R1 → R2 → R3, then R4, R5, R6 in parallel, then R8 → R7 → R9, then R10, R11. R1–R8 need nothing from identity; R9 adds the Settings page.
