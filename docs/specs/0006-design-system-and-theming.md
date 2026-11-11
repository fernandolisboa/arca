# Spec 0006: Design system and theming

- Status: Ready for tickets
- Date: 2026-11-03
- Epic: cross-platform foundations ([ROADMAP.md](../ROADMAP.md#phase-1--family-mvp-web)); replaces the placeholder tokens of [spec 0001](0001-foundations-scaffold.md) R5 and keeps its CSP unchanged
- Decisions: [ADR-0020](../adr/0020-themeable-ui.md), [ADR-0010](../adr/0010-stack-revised.md), [ADR-0005](../adr/0005-platform-strategy.md)
- Mockups: the design canvas [Arca: design e telas](https://claude.ai/artifact/2ffxBDSVLLkWHsuiVHSJeP) (private to the owner; the board "Monte seu tema" is the live theme picker). This spec is the source of truth where they differ.

## Goal

One visual language for every screen, with the choices the owner asked for: four color themes, light and dark, ten font pairs, three corner shapes, four navigation layouts on wide screens and three on phones, the floating dock's edge, text size and high contrast, chosen per person in Settings. Components read tokens only, so a new theme is a data change.

## Scope

**In:** theme data and generated CSS in `packages/ui`; the contrast test; fonts and icons; motion tokens; the `AppShell` with its navigation layouts; the shared patterns below; a Settings screen for appearance; Playwright checks per layout and breakpoint.

**Out:** syncing preferences with the account (comes with the identity epic, spec 0003); feature screens themselves (each feature's spec uses these patterns); native app icons and splash screens (Phase 4).

## Defaults

The owner picked these on 2026-11-03 and revised them on 2026-11-06, when the first round of the visual refresh chose the "Papel" direction (the canvas [Arca: novo visual](https://claude.ai/artifact/Ta6giPWVFMYQnv5UFiyjEM), private to the owner): a white page, near-black type, color only in small details, soft cards and a top bar on wide screens. Identifiers are English; the pt-BR labels come from the i18n catalog.

| Axis | Default | Other options |
| --- | --- | --- |
| Color theme | `paper` | `notebook`, `serene`, `panel` |
| Mode | `light` | `dark`, `system` |
| Font pair | `clean` | `retro`, `expressive`, `editorial`, `elegant`, `geometric`, `friendly`, `readable`, `dyslexic`, `technical` |
| Corners | `soft` | `square`, `round` |
| Navigation from 768 px | `top` | `menu`, `side`, `floating-dock` |
| Navigation below 768 px | `menu` | `fixed-dock`, `floating-dock` |
| Dock edge (floating dock only) | `bottom` | `left`, `right` |
| Text size | `100` | `112`, `125`, `150` (percent of the root size) |
| Contrast | `standard` | `high` |
| Motion | `on` | `off` (also forced off by `prefers-reduced-motion: reduce`) |

**Global defaults.** These are the built-in defaults. Once accounts and roles exist, an administrator can change the defaults for everyone in Settings. A person's preferences store only the axes that person changed, and each axis resolves as: the person's choice, else the global default, else the built-in default. So changing a global default reaches everyone who never picked that axis, and no one who did. The global defaults are a server-side setting behind the API, changed only by an administrator and recorded in the audit log; they come with the spec that adds accounts and sync. Until then the built-in defaults apply.

These ten axes are the whole preference set. Each is one attribute on `<html>`: `data-theme`, `data-mode`, `data-font`, `data-corners`, `data-nav-wide`, `data-nav-narrow`, `data-dock-edge`, `data-text-size`, `data-contrast`, `data-motion`.

## Tokens

### Color

Every palette defines the same keys. `second` is the fill for non-leading bars. `accent` colors eyebrows, link underlines and the current step; it equals `primary` in every theme except `paper`, whose `primary` is its ink and whose accent is a warm amber.

The `paper` theme (added 2026-11-06):

| Key | paper light | paper dark |
| --- | --- | --- |
| `bg` / `surface` | `#FFFFFF` / `#FFFFFF` | `#141312` / `#1B1A18` |
| `ink` / `muted` | `#1A1A1D` / `#5C5959` | `#F3F1EE` / `#B5AFA9` |
| `line` / `soft` / `track` / `second` | `#ECEBEA` / `#F5F4F3` / `#ECEBEA` / `#A7A2A1` | `#2B2926` / `#24221F` / `#2B2926` / `#78716C` |
| `primary` / `onPrimary` / `accent` | `#1A1A1D` / `#FFFFFF` / `#945424` | `#F3F1EE` / `#141312` / `#F2B866` |
| `okBg` / `okInk` | `#E9F6EC` / `#166534` | `#12301F` / `#86EFAC` |
| `warnBg` / `warnInk` | `#FFFBEB` / `#945424` | `#2A2114` / `#F2C47E` |

On a white page, cards are told apart by a `line` border and the card shadow (`shadows.card` in the theme data, `0 1px 2px` at 4% black), not by a different fill. `cardClass` in `packages/ui` puts the two together, and new cards use it.

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
| `okBg` / `okInk` | `#E3EBD9` / `#34491F` | `#2C3A22` / `#BFD8A5` | `#DDF1E6` / `#145C36` | `#173A2A` / `#A6E2C1` | `#EAF6EF` / `#17603A` | `#173326` / `#9FDDB9` |
| `warnBg` / `warnInk` | `#F6DDCB` / `#7E3315` | `#45281A` / `#F4BE9F` | `#FCEFCF` / `#6B4A00` | `#3D3115` / `#F5D58A` | `#FDF0E6` / `#8A3A07` | `#3A2414` / `#FFC49E` |

Every palette also has `dangerBg` / `dangerInk`: `#FBE3E0` / `#9B1C1C` in light modes and `#3E1A19` / `#FFB4A8` in dark modes. `dangerInk` is also the color of error text on `bg` and `surface`.

Hover and pressed states on `primary` fills use `color-mix(in oklab, var(--primary) 88%, var(--primaryShift))` and 76%. `primaryShift` is the palette's `ink` in every theme but `paper`, where `primary` is the ink itself, so the fill moves toward `bg` instead. The contrast test computes both mixes and checks that `onPrimary` stays at 4.5:1 on them (7:1 with high contrast) and that the pressed fill differs visibly from `primary`.

**Rename from spec 0001.** `surface` (page) becomes `bg`; `surface-raised` (card) becomes `surface`; `brand` becomes `primary`; `brand-strong` becomes the hover rule above; `on-brand` becomes `onPrimary`; `ink-muted` becomes `muted`; `ok`, `warning` and `danger` as text become `okInk`, `warnInk` and `dangerInk`; `line` and `ink` keep their names.

**Contrast pairs** the test checks, each at least 4.5:1 in every palette: `ink` on `bg`, `surface`; `muted` on `bg`, `surface`, `soft`; `primary` on `bg`, `surface`, `soft`; `onPrimary` on `primary`; `accent` on `bg`, `surface`, `soft`; `okInk` on `okBg`; `warnInk` on `warnBg`; `dangerInk` on `dangerBg`, `bg`, `surface`. The values above pass; the lowest is 4.86:1, `primary` on `soft` in notebook light.

Non-text cues (bars on `track`, the dashed `line` border of unknown items) are below 3:1 in some palettes. That is acceptable only because each one repeats information the text already gives (the score, the words "Ainda não sabemos"); a cue that carries meaning alone must reach 3:1 and joins the test.

### Type

| Pair | Display (titles, numbers in hero cards) | Body | Numbers in tables |
| --- | --- | --- | --- |
| `expressive` | Bricolage Grotesque 600–700 | DM Sans 400–700 | DM Sans, tabular figures |
| `editorial` | Fraunces 500–600 | Source Sans 3 400–700 | Source Sans 3, tabular figures |
| `elegant` | Instrument Serif 400 | Instrument Sans 400–700 | Instrument Sans, tabular figures |
| `geometric` | Space Grotesk 500–700 | Manrope 400–700 | Space Grotesk, tabular figures |
| `retro` | Young Serif 400 | Work Sans 400–700 | Work Sans, tabular figures |
| `friendly` | Nunito 800 | Nunito 400–600 | Nunito, tabular figures |
| `readable` | Atkinson Hyperlegible Next 700 | Atkinson Hyperlegible Next 400 | Atkinson Hyperlegible Next, tabular figures |
| `dyslexic` | OpenDyslexic 700 | OpenDyslexic 400 | OpenDyslexic 400 (latin subset only) |
| `clean` | Inter 700 | Inter 400–600 | Inter, tabular figures |
| `technical` | IBM Plex Sans 600 | IBM Plex Sans 400–600 | IBM Plex Mono 500 |

Scale (rem at 16 px): 0.75 caption, 0.875 small, 1 body, 1.125 lead, 1.375 title, 1.75 page title, 2.25 hero. Body line height 1.5; titles 1.15–1.25. Body text never below 1 rem on phones; captions are for metadata only (sources, dates). Every size is in rem, so the text-size axis scales the whole scale; layouts reflow without horizontal scroll at 150% and at 200% browser zoom.

### High contrast

`data-contrast="high"` overrides, in every palette: `muted` becomes `ink`; `line` and `second` reach 3:1 against `bg` and `surface`; text on `soft` uses `ink`; `primary` used as text or as a fill switches to a per-palette `primaryHigh`, and `accent` to its own high value; and `okInk`, `warnInk` and `dangerInk` switch to per-palette high-contrast values. All are chosen so every text pair reaches 7:1 (WCAG AAA). R1 holds the values and R3 checks them.

### Shape, space and motion

| Token | `square` | `soft` | `round` |
| --- | --- | --- | --- |
| `radius-card` | 4 px | 16 px | 28 px |
| `radius-control` | 4 px | 8 px | 999 px |
| `radius-chip` | 4 px | 999 px | 999 px |
| `radius-dock` | 6 px | 18 px | 999 px |

Spacing follows Tailwind's 4 px scale; `spacing-touch` stays 44 px and every control meets it.

Motion: `duration-fast` 150 ms (hover, press), `duration-base` 250 ms (theme change, toggles), `duration-slow` 450 ms (cards entering), `ease-out` `cubic-bezier(0.2, 0.8, 0.2, 1)`. Bars grow from zero on first paint with a 90 ms stagger per row, for the first six rows only; later rows start with the sixth. With motion off, every duration is 0 and looping animations do not render.

### Mark

The mark is a house on a straight hull with a ramp down from an arched door, chosen by the owner on 2026-11-04. Its sources are [docs/brand/arca-mark.svg](../brand/arca-mark.svg) (light backgrounds) and [docs/brand/arca-mark-dark.svg](../brand/arca-mark-dark.svg) (dark backgrounds). It keeps its own wood palette in every color theme, because it must stay recognizable when the theme changes:

| Part | Light | Dark |
| --- | --- | --- |
| Hull | `#805840` | `#A67C63` |
| House | `#AE8546` | `#E9CB88` |
| Roof | `#5B4033` | `#C7845F` |
| Ramp | `#AD7853` | `#C59770` |
| Windows | `#F1DCA9` | `#F5E2B8` |

The door is a hole, so the background shows through. At 32 px and below the windows are dropped, as in `apps/web/public/favicon.svg`, which carries the light palette as fill attributes and switches to the dark one with a `prefers-color-scheme` style, so it still shows the light mark where that style is blocked. The PWA icons in `apps/web/public/icons/` put the light mark on a `#F7F1E8` tile; the maskable icon keeps it inside the safe zone, a centered circle 80% of the icon's width across. The mark palette lives in `packages/ui/src/theme/` as a fixed `mark` entry outside the per-palette keys. The shell renders the mark with a `Mark` component in `packages/ui` (R8), picking the light or dark palette from the resolved mode, `aria-hidden` because the name "Arca" sits beside it in the display font. Native icons and splash screens stay out of scope (Phase 4).

## Home

Added 2026-11-06 with the "Papel" direction. The home leads with where the case stands, then the way into each area:

- **Notices first.** A pending passkey, an unsaved recovery kit, a pending recovery or a pending deletion shows as a strip in the warn colors at the top. While a recovery or a deletion waits, the home shows only that, as before.
- **Greeting.** The weekday and date, then "Bom dia", "Boa tarde" or "Boa noite" by the device's hour, with the person's name in the case when there is one.
- **Next step card.** One card with the step title, a short body and one primary action, beside the case's stages as a numbered list: "Contar sobre a família" (done once a case exists), "Perguntas guiadas" (with "x de y" answered, "Não sei" included) and "Ver as rotas que servem" (once every question has an answer). The current stage carries `aria-current="step"` and the accent color; a done stage shows a check and says "(feita)" to screen readers. `nextStep` in `apps/web/src/home/next-step.ts` derives the stage from the case and its questions; it counts answers and decides nothing about eligibility.
- **Shortcut cards.** Cofre, Família (people in the case and how many others have an account, with "Convidar alguém") and, for an admin, Regras (versions waiting for a decision). Each card has an icon tile, a title, at most one figure, a short body and one link.
- **Footer.** Who is signed in, Dispositivos and the service status, as a colored dot and text with a visually hidden "Status do serviço" heading.
- **Navigation.** The shell lists Início, Família, Cofre and, for an admin, Regras.

## Shell and navigation

- The navigation items are the ones the Home section lists, growing as areas ship (R8). Their labels and icons are defined once and every layout renders the same list.
- **Below 768 px:** `fixed-dock` is attached to the bottom edge, icon over label. `floating-dock` sits 14 px from the screen edges with `radius-dock` and a shadow. `menu` is a top bar with the mark and a menu button. Content gets padding equal to the dock size plus the safe-area inset on the dock's side, so nothing hides behind it.
- **From 768 px:** `top` is a bar with the mark and the navigation items in a row; `side` is a 216 px column with the mark on top; `floating-dock` is a bar centered on its edge; `menu` is the same top bar as on phones. The active item uses `primary` on `soft`.
- **Floating dock edge.** The person drags the dock and it snaps to the nearest of bottom, left and right, with the edge saved as the `dock-edge` axis. On the left or right it stacks the items vertically. Dragging is never the only way: the same choice is in Settings, so keyboard and screen-reader users can make it.
- **Menu.** The menu button is the three-line icon alone, no text, with `aria-label` "Abrir menu" or "Fechar menu" and `aria-expanded`. It stays above the open panel and is its close control: the three lines morph into an X in `duration-base` (top and bottom lines rotate 45° to meet, the middle one fades), and back on close; with motion off it swaps instantly. It opens a panel (a full-width sheet below 768 px, a 340 px panel from the top right above) with labelled groups: navigation (the same items), account (profile, passkeys, appearance, notifications, once each page exists), help (rule report) and sign out, set apart in `dangerInk`. Focus is trapped across the menu button and the panel, with the button as the close control; the panel closes on Escape or from the menu button, and focus returns to the menu button.
- **More destinations.** A dock holds at most five items plus the Settings entry; anything more (for example a family area) goes in the menu's account group and, from 768 px, in the top bar or side column.
- **Settings entry.** Every layout has one: the last item of a dock, a gear button at the end of the top bar, the bottom of the side column, and the account group of the menu.
- Content column max width 1200 px on desktop; screens use a two-column grid from 1024 px where the spec of the screen says so.
- The shell keeps spec 0001's safe-area insets and skip link.

## Shared patterns

These come from the mockups and every feature reuses them:

- **Next action card** (for plan steps; the home's next-step card is its own layout, above): `primary` background, a route line from origin city to destination with a moving dot (static with motion off), the step title in the display font, one line of where, how long and what it needs, and one button.
- **Ranking row:** position in the display font (`primary` for first), country flag, name, a bar on `track` (`primary` for first, `second` for the rest), score with tabular figures, formatted for the locale with `Intl.NumberFormat`.
- **Source line:** "Fonte: domain · verificado em" and the verification date, in caption size, under any requirement, fee, threshold or deadline (CLAUDE.md rule 1). The date is a plain calendar date from `packages/domain`, formatted for the locale with `Intl.DateTimeFormat` and no time-zone conversion, so it never shifts a day.
- **Status chips:** active version (`ok`), pending activation (`warn`), a rule version with a point that differs from its source (`danger`, on `dangerBg` with `dangerInk`), unknown (`soft` with `muted` text). Unknown items use a dashed border on their card and say a research task is open. Labels follow [CONTEXT.md](../../CONTEXT.md).
- **Rule report:** the "Avisar regra errada" link on every route screen; it opens a research task (CONTEXT.md).
- **Coach mark (guided tour):** a spotlight on one element, dimming the rest with `bg` at 70%, and a card beside it with the step title, one or two lines, "x de n", and Skip, Back and Next (Done on the last step). Focus moves to the card and returns to the element; Escape skips. With motion off the spotlight jumps instead of gliding. It never covers the navigation it points at, and on phones the card docks above or below the target. A one-step hint shows Done alone, with no count and no Skip. The tour and the hints can be shown again from the Help category of Settings, which every layout reaches (the menu exists in only some). Which tours were shown is kept on the device, beside the appearance choices, as tour ids only ([#123](https://github.com/fernandolisboa/arca/issues/123)).
- **Scale choice:** a short whole-number scale, such as a comparison weight from 0 to 5, as one row of native radios inside a fieldset, each step a full-height touch target, the chosen one on `primary`.
- **Star rating:** one to five stars as native radios after a short visible caption such as "Sua nota", the chosen star and those before it filled in `accent`, each named in words for screen readers, with a quiet action that clears the rating.
- **Disclosure:** a titled card whose body folds behind its heading: the heading holds the toggle button (`aria-expanded`, `aria-controls`, a chevron that turns on the motion token, the 44 px touch target), the body is hidden with `hidden`, and the region is named by the title alone. An aside beside the title (such as a status chip) and a footer under the body stay visible when folded. A plain "ver detalhes" fold inside a card keeps native `<details>`.
- **Progress bar:** the ranking bar's track and fill, with a text label ("3 de 12") that carries the value, for per-person and family progress.
- **Flags:** SVG flags rendered at 26 × 18 px with a 1 px `line` ring, bundled and served from the app's own origin, rendered as React components or `<img src>`, never injected as markup. The flag set is chosen with the country dataset in consultancy core slice 2, through an amendment to ADR-0020 and a supply-chain review; until then, the country code in a chip.

## Copy

All user-facing text goes through i18n (CLAUDE.md). pt-BR strings follow these rules, which the standards reviewer checks:

- Short, concrete sentences in the voice of a colleague: say what to do and why, with the number, place or deadline when there is one.
- No filler adjectives or hype ("incrível", "poderoso", "perfeito"), no "Descubra", "Explore", "jornada", "Bem-vindo(a) ao" or "Vamos lá".
- No em dashes or arrow chains in UI text; one idea per line.
- Say when Arca does not know ("Ainda não sabemos") instead of hedging.

When the authoring session has the `/super-copy` skill, it runs its pass that removes generated-sounding phrasing on new or changed strings; it is an aid, not a gate.

## Requirements

- **R1 Theme data.** `packages/ui/src/theme/` exports the palettes, font pairs, radius sets and motion tokens above as typed, readonly data, with a type that forces every palette to define every key, plus the identifier list and default of each of the ten axes. The identifier lists and defaults are also exported from a dependency-free subpath, `@arca/ui/theme/ids`, with no React and no CSS, for the boot script and the build config. The existing components and `apps/web` move from the spec 0001 token names (`brand`, `ink-muted`, `surface-raised`) to these.
- **R2 Generated CSS.** A script writes `packages/ui/src/themes.css` with one block per `[data-theme][data-mode]` pair, one per `[data-font]` and one per `[data-corners]`, plus the `[data-mode="system"]` blocks under `prefers-color-scheme`, the high-contrast overrides, the text-size steps, the defaults on `:root` so a bare `<html>` still has every token, and `color-scheme` per mode (replacing spec 0001's `color-scheme: light dark`), and the `@font-face` rules of every pair, written from the theme data and pointing at the latin and latin-ext `.woff2` files each Fontsource package exports under `./files/*`, each with the `unicode-range` copied from the package's `unicode.json`, so a browser downloads the latin-ext file only when a page needs those characters. A package that ships only latin gets one rule per face with no `unicode-range`; a static family gets one rule per weight the pairs use. `styles.css` maps Tailwind `@theme` tokens to those properties. A test fails when the committed file differs from the script's output.
- **R3 Contrast test.** A Vitest suite computes WCAG 2.x contrast for every pair in [Contrast pairs](#color) in every palette and fails below 4.5:1, and below 7:1 for text pairs and 3:1 for `line` and `second` with high contrast on.
- **R4 Fonts.** The Fontsource packages from ADR-0020, through the `@font-face` rules R2 generates (latin and latin-ext only, or latin alone where the package ships nothing else, `font-display: swap`), never the packages' own CSS, which covers every subset. Browsers download a font file only when a rule uses it, so non-default pairs cost a few KB of CSS until chosen and add no lazy chunk. Font files are never inlined as `data:` URIs (`build.assetsInlineLimit` excludes `.woff2`), since `default-src 'self'` covers fonts and blocks `data:`. The precache list in `apps/web/vite.config.ts` excludes every `.woff2` except the default pair's; other pairs load from the network and fall back to the system font offline. A Playwright check fails on any CSP violation while switching pairs.
- **R5 Icons.** `lucide-react` wrapped by an `Icon` component in `packages/ui` that takes a name from a fixed union, sets `aria-hidden` unless given a label, and uses `currentColor` at 2 px stroke. A lint rule blocks importing `lucide-react` in `apps/web`; any other package would need a new, reviewed dependency to reach it. The menu toggle is its own `MenuToggle` component in `packages/ui`, three lines animated with CSS, not an `Icon`.
- **R6 Motion.** Duration and easing tokens; a `data-motion` attribute; a global rule that zeroes durations under `[data-motion="off"]` and under `prefers-reduced-motion: reduce`; page navigation uses `document.startViewTransition` when present; the same rule zeroes the `::view-transition-*` animations, so with motion off the swap is instant.
- **R7 Preferences.** An `appearance` module in `apps/web` reads and writes only the axes the person has set, including a value equal to the current default, to `localStorage` under one versioned key (clearing an axis removes it), validated against the identifier lists `@arca/ui` exports by one parser that the boot script shares (not Zod, which would weigh down the script that runs before first paint; the allow-list is as strict); unknown values fall back to defaults. Before first paint, a classic same-origin script (`/appearance-boot.js`, loaded in `<head>` without `defer` or `type=module`) applies them. It is built by the existing plugin in `apps/web/vite.config.ts` as an IIFE from a TypeScript source, as `sw.ts` is, so it stays under strict types, lint and tests. The source imports only `@arca/ui/theme/ids` and is built before the plugin computes the precache list; tests check that the file is in the precache list and contains no React. The plugin injects its tag only into the production `index.html`, and in development the `appearance` module applies the preferences on load. It accepts only allow-listed values, calls `setAttribute` only for the fixed `data-*` names and the `theme-color` meta tag (set from the `--arca-bg` the stylesheet resolved, which is why the script comes after the stylesheet; the `appearance` module updates it on every change and when the device's color scheme changes), uses no HTML sinks, and applies the defaults on any exception. A test feeds it tampered and unknown stored values and expects the defaults. No inline script, so the CSP is unchanged. `index.html` carries the default attributes statically, and the web manifest's `theme_color` and `background_color` use the default palette's `bg`.
- **R8 AppShell.** `AppShell` takes the navigation items and the layout preferences (wide, narrow, dock edge), including dragging the floating dock with snap and the menu panel, and renders the layouts in [Shell and navigation](#shell-and-navigation), switching at 768 px with CSS only. Its bars show the `Mark` described in [Mark](#mark); a test checks that the component's paths match `docs/brand/arca-mark.svg`. It shows only the items whose page exists, so until the features land it shows home alone and grows as pages are added; no placeholder pages.
- **R9 Settings screen.** Creates the Settings page, reached from the Settings entry in every layout, with appearance controls in categories (see the revision below): one control group per axis with a live preview and a "use default" option that clears the person's choice for that axis, plus one action per category that clears that category's axes; the narrow-screen group offers the docks and the menu, and the dock-edge group appears with the floating dock. Strings in the pt-BR catalog. Revised 2026-11-06: the page is split into categories, Aparência (colors, mode, fonts, corners), Navegação (narrow, wide, dock edge), Acessibilidade (text size, contrast, motion), Conta (security notices, data export, account deletion) and, for an approver, Base de conhecimento; a side menu from 1024 px and a wrapping row of buttons below it picks one, and `?section=` keeps the choice in the address. `apps/web/src/settings/sections.ts` places each axis in exactly one category, and a test checks none is left out.
- **R10 Patterns.** `NextActionCard`, `RankingRow`, `ProgressBar`, `SourceLine`, `StatusChip`, `CoachMark`, `ScaleChoice`, `StarRating` and `Disclosure` in `packages/ui`, each with one Vitest render test that checks its content, keyboard reachability and screen-reader labels. Themes are covered by R3 and R11, not per component.
- **R11 End-to-end.** Playwright opens the home screen at 390, 820 and 1280 px in each navigation layout and dock edge, and at text size 150%, and checks: every navigation item, the Settings entry and the menu reachable by keyboard, the menu closing from its button by keyboard and on Escape, with focus returned, no horizontal scroll, nothing behind the dock, and `@axe-core/playwright` reports no violations in the default theme and in one dark theme.

## Threat model for this slice

| Threat | Where | Control |
| --- | --- | --- |
| Tampering: a value written to `localStorage` by an attacker or an old version reaches the DOM | Boot script, `appearance` module | Allow-list from the theme data, by one parser shared with the boot script that reads own properties only; `setAttribute` on fixed names only; defaults on any error |
| Elevation: an inline script weakens the CSP | `index.html` | No inline script; the boot script is a same-origin file under `script-src 'self'`; the native `<meta>` CSP needs no hash |
| Information disclosure: font or flag requests reveal visitors to a third party | Fonts, flags | Self-hosted Fontsource files and bundled flags; no external origin added to the CSP |
| Tampering: a compromised font or icon package | Supply chain | Packages with provenance and no install scripts, version cooldown and lockfile policy (ADR-0010); OFL-1.1 added to the license allow-list in its own policy pull request |
| Denial of service: a stale cached chunk after a deploy | Service worker | No lazy chunk for fonts (R4); a lazy chunk lost across a deploy reloads the page once (spec 0001, R5) |

Preferences are display settings, not case data. On the device they identify no one. Once synced per account (in the spec that adds sync), they are personal data: per-account rows under row-level security, never in logs or analytics.

## Definition of done

- R1 to R11 covered by tests; the contrast test, the generated-file freshness test and the boot-script fallback test run in CI.
- Playwright with `@axe-core/playwright` passes at 390, 820 and 1280 px in every navigation layout, with no CSP violation reported.
- Every new string is in the pt-BR catalog and follows [Copy](#copy).
- No hard-coded color, radius or font outside `packages/ui/src/theme/`.
- No personal data anywhere in the diff.

## Tickets

Order: a policy pull request first that adds `OFL-1.1` to `.github/policy/licenses.json` and exact-version `MPL-2.0` exceptions for `@axe-core/playwright` and `axe-core` (dev only, file-level copyleft, as for lightningcss); then R1 → R2 → R3, then R4, R5, R6 in parallel, then R8 → R7 → R9, then R10, R11. R1–R8 need nothing from identity; R9 adds the Settings page.
