# ADR-0020: Themeable UI with self-hosted fonts, Lucide icons and CSS motion

- Status: Accepted
- Date: 2026-11-03
- Amends: [ADR-0010](0010-stack-revised.md) (the UI row)
- Spec: [0006](../specs/0006-design-system-and-theming.md)

## Context

Spec 0001 shipped placeholder tokens: one teal palette, the system font and dark mode from `prefers-color-scheme`. The owner reviewed three visual directions on 2026-11-03 and asked for more than one: each person picks a color theme, light or dark, a font pair, a corner shape and a navigation layout in Settings, plus text size and high contrast. He also asked for icons, animation and fonts with character, so the app does not look generic.

This needs four things ADR-0010 does not settle: how themes are applied, where fonts come from, which icon set, and how motion is built.

## Decision

- **Themes are CSS custom properties.** Each axis is an attribute on `<html>`: `data-theme` (`paper`, `notebook`, `serene`, `panel`), `data-mode` (`light`, `dark`, `system`), `data-font` (nine pairs, from `expressive` to `technical`), `data-corners` (`square`, `soft`, `round`), `data-contrast` (`standard`, `high`), `data-text-size` and `data-motion` (`on`, `off`), plus the navigation attributes below; spec 0006 lists them all. Identifiers are English; the pt-BR names people see (Papel, Caderno, Sereno, Painel and so on) come from i18n. Tailwind 4 `@theme` tokens point at those properties, so components use one set of class names (`bg-surface`, `rounded-card`) and never branch on the theme.
- **Theme values live in TypeScript.** `packages/ui/src/theme/` defines every palette, font pair and radius set as typed data. A script generates `themes.css` from it; a test fails when the committed file is stale. Adding a theme is a data change in that module.
- **Contrast is a test.** For every theme and mode, a unit test computes WCAG 2.x contrast for the text and background pairs listed in spec 0006 and fails below 4.5:1, or below 7:1 with high contrast on (spec 0006). No theme ships that fails it.
- **Navigation layout is a shell prop, chosen by width.** Below 768 px the person picks a fixed dock, a floating dock or a menu button; from 768 px, a top bar, a side column, a floating dock or a menu button. A floating dock can be dragged and snaps to the bottom, left or right edge. The breakpoint is a CSS width, never the operating system (CLAUDE.md platform rules).
- **Fonts are self-hosted from Fontsource.** `@fontsource-variable/*` packages for Bricolage Grotesque, DM Sans, Fraunces, Source Sans 3, Instrument Sans, Space Grotesk, Manrope, Work Sans, Nunito, Atkinson Hyperlegible Next, Inter and IBM Plex Sans, and `@fontsource/*` for IBM Plex Mono, Instrument Serif, Young Serif and OpenDyslexic (added 2026-11-11), all OFL-1.1 (npm registry, checked 2026-11-03 and 2026-11-11). We generate their `@font-face` rules from the theme data (latin and latin-ext only; OpenDyslexic ships latin alone, so its one file has no `unicode-range`) and import them statically, so the app stays one chunk, and browsers fetch a file only when a theme uses it. No request goes to Google Fonts: it would send the person's IP to a third party and widen the content security policy. OFL-1.1 is not on the license allow-list yet, so a policy pull request adds it before the fonts land; it is a permissive font license whose conditions (do not sell the fonts alone, rename modified versions) do not bind an app that uses them unmodified.
- **Icons are `lucide-react`** (ISC, npm registry, checked 2026-11-03), imported per icon inside `packages/ui` only, so the bundle carries only the icons used and apps never import an icon library directly.
- **Motion is CSS.** Transitions and keyframes from duration and easing tokens, plus the View Transitions API for route changes where the browser has it. No animation library. Motion stops when `data-motion="off"` or when the system asks for reduced motion.
- **Preferences are per person.** Until accounts exist, the shell stores them on the device and a small same-origin boot script applies them before first paint; there is no inline script, so the CSP of spec 0001 does not change. Once accounts exist, they sync with the account through the API, and an administrator can change the global defaults; a person stores only the axes they set (even to a value equal to the default) and can clear each one, so a new global default reaches everyone who never picked that axis. They are display settings, not case data.
- **Accessibility is tested with `@axe-core/playwright`** in the end-to-end suite (dev only). It and `axe-core` are MPL-2.0, so they enter through exact-version license exceptions, like lightningcss.

## Alternatives

- **One fixed look.** Simpler, but the owner asked for choice, and the cost is one data module and a test.
- **Google Fonts CDN.** No packages to update, but it leaks the IP of every visitor to Google and needs a CSP exception.
- **Framer Motion or Motion One.** Richer choreography, but everything in spec 0006 is reachable with CSS, so the library would be weight without a use (YAGNI).
- **Heroicons or Phosphor.** Both fine. Lucide has more icons than Heroicons (about 1,600 against about 300, per each project's site, checked 2026-11-03), 2 px strokes that match the mockups, and per-icon imports.
- **Lazy-loaded font pairs.** Smaller first download, but dynamic imports split the bundle, which breaks the service worker's `skipWaiting` assumption in spec 0001. Static `@font-face` rules give the same on-demand file loading without chunks.

## Consequences

- Every component must use tokens; a hard-coded color, radius or font is a review finding.
- Each new theme adds one palette per mode and must pass the contrast test.
- Four navigation layouts on wide screens, three on phones and three dock edges mean several shell variants to test in Playwright at each breakpoint.
- Sixteen runtime packages (fifteen fonts and `lucide-react`; a sixteenth font, `@fontsource/opendyslexic`, joined on 2026-11-11) and two test packages (`@axe-core/playwright`, `axe-core`) enter the dependency list. None has install scripts; none has runtime dependencies except `@axe-core/playwright`, which depends on `axe-core`; all publish with provenance (npm registry, checked 2026-11-03).

## Versions

| Package | Version (checked 2026-11-03, lucide-react 2026-11-04) | License |
| --- | --- | --- |
| `lucide-react` | 1.62.0 (newest past the seven-day cooldown) | ISC |
| `@fontsource-variable/bricolage-grotesque`, `dm-sans`, `fraunces`, `inter`, `ibm-plex-sans`, `instrument-sans`, `space-grotesk`, `manrope`, `work-sans`, `nunito`, `atkinson-hyperlegible-next` | 5.3.0 | OFL-1.1 |
| `@fontsource-variable/source-sans-3` | 5.3.1 | OFL-1.1 |
| `@fontsource/ibm-plex-mono`, `instrument-serif`, `young-serif`, `opendyslexic` (added 2026-11-11) | 5.3.0 | OFL-1.1 |
| `@axe-core/playwright`, `axe-core` | 4.14 | MPL-2.0 |
