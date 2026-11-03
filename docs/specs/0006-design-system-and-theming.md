# Spec 0006: Design system and theming

- Status: Ready for tickets
- Date: 2026-11-03
- Epic: cross-platform foundations ([ROADMAP.md](../ROADMAP.md#phase-1--family-mvp-web)); replaces the placeholder tokens of [spec 0001](0001-foundations-scaffold.md) R5
- Decisions: [ADR-0020](../adr/0020-themeable-ui.md), [ADR-0010](../adr/0010-stack-revised.md), [ADR-0005](../adr/0005-platform-strategy.md)
- Mockups: the owner's design canvas "Arca: design e telas" (board "Monte seu tema" holds the live theme picker)

## Goal

One visual language for every screen, with the choices the owner asked for: three color themes, light and dark, four font pairs, three corner shapes and three navigation layouts on wide screens, chosen per person in Settings. Components read tokens only, so a new theme is a data change.

## Scope

**In:** theme data and generated CSS in `packages/ui`; the contrast test; fonts and icons; motion tokens; the `AppShell` with its navigation layouts; the shared patterns below; a Settings screen for appearance; Playwright checks per layout and breakpoint.

**Out:** syncing preferences with the account (comes with the identity epic, spec 0003); feature screens themselves (each feature's spec uses these patterns); native app icons and splash screens (Phase 4).

## Defaults

The owner picked these on 2026-11-03.

| Axis | Default | Other options |
| --- | --- | --- |
| Color theme | `notebook` (Caderno) | `serene` (Sereno), `panel` (Painel) |
| Mode | `dark` | `light`, `system` |
| Font pair | `expressive` (Expressiva) | `editorial`, `clean`, `technical` |
| Corners | `square` (Retos) | `soft` (Suaves), `round` (Redondos) |
| Navigation from 768 px | `top` (menu no topo) | `side`, `floating-dock` |
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

A danger pair (`dangerBg` / `dangerInk`) follows the same rule and is added with the first destructive action.

**Contrast pairs** the test checks, each at least 4.5:1 in every palette: `ink` on `bg`, `surface`; `muted` on `bg`, `surface`, `soft`; `primary` on `bg`, `surface`, `soft`; `onPrimary` on `primary`; `okInk` on `okBg`; `warnInk` on `warnBg`. The values above pass; the lowest is 4.86:1, `primary` on `soft` in notebook light.

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

Motion: `duration-fast` 150 ms (hover, press), `duration-base` 250 ms (theme change, toggles), `duration-slow` 450 ms (cards entering), `ease-out` `cubic-bezier(0.2, 0.8, 0.2, 1)`. Bars grow from zero on first paint with a 90 ms stagger per row. With motion off, every duration is 0 and looping animations do not render.

## Shell and navigation

- Four destinations: Início, Países, Plano, Documentos. Their labels and icons are defined once and every layout renders the same list.
- **Below 768 px:** a bottom dock with icon over label. `fixed-dock` is attached to the bottom edge; `floating-dock` sits 14 px from the sides and 16 px above the safe area, with `radius-dock` and a shadow. Content gets bottom padding equal to the dock height plus the safe-area inset, so nothing hides behind it.
- **From 768 px:** `top` is a bar with the mark and the destinations in a row; `side` is a 216 px column with the mark on top; `floating-dock` is a centered bar above the bottom edge. The active destination uses `primary` on `soft`.
- Content column max width 1200 px on desktop; screens use a two-column grid from 1024 px where the spec of the screen says so.
- The shell keeps spec 0001's safe-area insets and skip link.

## Shared patterns

These come from the mockups and every feature reuses them:

- **Next action card:** `primary` background, a route line from origin city to destination with a moving dot (static with motion off), the step title in the display font, one line of where, how long and what it needs, and one button.
- **Ranking row:** position in the display font (`primary` for first), country flag, name, a bar on `track` (`primary` for first, `second` for the rest), score with tabular figures and a decimal comma.
- **Source line:** "Fonte: domain · verificado em DD/MM/AAAA" in caption size under any requirement, fee, threshold or deadline (CLAUDE.md rule 1).
- **Status chips:** active rule (`ok`), waiting for approval (`warn`), unknown (`soft` with `muted` text). Unknown items use a dashed border on their card and say a research task is open.
- **Report a wrong rule:** a text link on every route screen.
- **Flags:** small SVG flags from a maintained ISO 3166 flag set, rendered at 26 × 18 px with a 1 px `line` ring. Picked with the country dataset in slice 2; until then, the country code in a chip.

## Copy

All user-facing text goes through i18n (CLAUDE.md). Before review, new or changed pt-BR strings get a pass with the `/super-copy` skill to strip phrasing that reads like generated text: short, concrete sentences, no filler adjectives, no "Descubra", "Explore" or "jornada".

## Requirements

- **R1 Theme data.** `packages/ui/src/theme/` exports the palettes, font pairs, radius sets and motion tokens above as typed, readonly data, with a type that forces every palette to define every key.
- **R2 Generated CSS.** A script writes `packages/ui/src/themes.css` with one block per `[data-theme][data-mode]` pair, one per `[data-font]` and one per `[data-corners]`, plus the system-mode blocks under `prefers-color-scheme`. `styles.css` maps Tailwind `@theme` tokens to those properties. A test fails when the committed file differs from the script's output.
- **R3 Contrast test.** A Vitest suite computes WCAG 2.x contrast for every pair in [Contrast pairs](#color) in every palette and fails below 4.5:1.
- **R4 Fonts.** The Fontsource packages from ADR-0020. The default pair is imported in the app entry; the others load through dynamic `import()` when a person picks them, with `font-display: swap`. No external font requests (the CSP keeps `font-src 'self'`).
- **R5 Icons.** `lucide-react` wrapped by an `Icon` component in `packages/ui` that takes a name from a fixed union, sets `aria-hidden` unless given a label, and uses `currentColor` at 2 px stroke. A lint rule blocks importing `lucide-react` outside `packages/ui`.
- **R6 Motion.** Duration and easing tokens; a `data-motion` attribute; a global rule that zeroes durations under `[data-motion="off"]` and under `prefers-reduced-motion: reduce`; route changes use `document.startViewTransition` when present and fall back to an instant swap.
- **R7 Preferences.** An `appearance` module in `apps/web` reads and writes the six axes to `localStorage` under one versioned key, applies them to `<html>` before first paint (an inline script in `index.html` allowed by the CSP hash), and falls back to the defaults on any read error. Values are validated with Zod; unknown values fall back to defaults.
- **R8 AppShell.** `AppShell` takes the navigation items and the two layout preferences and renders the layouts in [Shell and navigation](#shell-and-navigation), switching at 768 px with CSS only.
- **R9 Settings screen.** Aparência in Settings: one control group per axis with a live preview, the narrow-screen group showing only the dock options. Strings in the pt-BR catalog.
- **R10 Patterns.** `NextActionCard`, `RankingRow`, `SourceLine`, `StatusChip` in `packages/ui`, each with a Vitest render test per theme and corner set, and keyboard and screen-reader labels.
- **R11 End-to-end.** Playwright opens the home screen at 390, 820 and 1280 px in each navigation layout and checks: every destination reachable by keyboard, no horizontal scroll, nothing behind the dock, and `axe` reports no violations in the default theme and in one light theme.

## Tickets

Order: R1 → R2 → R3 (theme data first), then R4, R5, R6 in parallel, then R8 → R7 → R9, then R10, R11. R1–R6 and R8 need nothing from identity; R9 lands once Settings has a route.
