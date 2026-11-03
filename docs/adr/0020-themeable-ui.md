# ADR-0020: Themeable UI with self-hosted fonts, Lucide icons and CSS motion

- Status: Accepted
- Date: 2026-11-03
- Amends: [ADR-0010](0010-stack-revised.md) (the UI row)
- Spec: [0006](../specs/0006-design-system-and-theming.md)

## Context

Spec 0001 shipped placeholder tokens: one teal palette, the system font and dark mode from `prefers-color-scheme`. The owner reviewed three visual directions on 2026-11-03 and asked for more than one: each person picks a color theme, light or dark, a font pair, a corner shape and a navigation layout in Settings. He also asked for icons, animation and fonts with character, so the app does not look generic.

This needs four things ADR-0010 does not settle: how themes are applied, where fonts come from, which icon set, and how motion is built.

## Decision

- **Themes are CSS custom properties.** Each axis is an attribute on `<html>`: `data-theme` (`notebook`, `serene`, `panel`), `data-mode` (`light`, `dark`, or absent to follow the system), `data-font` (`expressive`, `editorial`, `clean`, `technical`), `data-corners` (`square`, `soft`, `round`) and `data-motion` (`on`, `off`). Identifiers are English; the pt-BR names people see (Caderno, Sereno, Painel and so on) come from i18n. Tailwind 4 `@theme` tokens point at those properties, so components use one set of class names (`bg-surface`, `rounded-card`) and never branch on the theme.
- **Theme values live in TypeScript.** `packages/ui/src/theme/` defines every palette, font pair and radius set as typed data. A script generates `themes.css` from it; a test fails when the committed file is stale. Adding a theme is a data change in that module.
- **Contrast is a test.** For every theme and mode, a unit test computes WCAG 2.x contrast for the text and background pairs listed in spec 0006 and fails below 4.5:1. No theme ships that fails it.
- **Navigation layout is a shell prop, chosen by width.** Below 768 px the shell always shows a bottom dock, fixed or floating. From 768 px it shows the person's choice: top menu, side menu or floating dock. The breakpoint is a CSS width, never the operating system (CLAUDE.md platform rules).
- **Fonts are self-hosted from Fontsource.** `@fontsource-variable/*` packages (OFL-1.1) for Bricolage Grotesque, DM Sans, Fraunces, Source Sans 3, Inter and IBM Plex Sans, and `@fontsource/ibm-plex-mono`. The default pair is bundled; the other pairs load on demand when chosen. No request goes to Google Fonts: it would send the person's IP to a third party and widen the content security policy.
- **Icons are `lucide-react`** (ISC), imported per icon inside `packages/ui` only, so the bundle carries only the icons used and apps never import an icon library directly.
- **Motion is CSS.** Transitions and keyframes from duration and easing tokens, plus the View Transitions API for route changes where the browser has it. No animation library. Motion stops when `data-motion="off"` or when the system asks for reduced motion.
- **Preferences are per person.** Until accounts exist, the shell stores them on the device. Once the identity epic lands, they sync with the account through the API. They are display settings, not case data.

## Alternatives

- **One fixed look.** Simpler, but the owner asked for choice, and the cost is one data module and a test.
- **Google Fonts CDN.** No packages to update, but it leaks the IP of every visitor to Google and needs a CSP exception.
- **Framer Motion or Motion One.** Richer choreography, but everything in spec 0006 is reachable with CSS, so the library would be weight without a use (YAGNI).
- **Heroicons or Phosphor.** Both fine. Lucide has the widest set, consistent 2 px strokes that match the mockups, and per-icon imports.

## Consequences

- Every component must use tokens; a hard-coded color, radius or font is a review finding.
- Each new theme adds one palette per mode and must pass the contrast test.
- Three navigation layouts on wide screens mean three shell variants to test in Playwright at each breakpoint.
- Seven font packages enter the dependency list. They are static files with no install scripts.
