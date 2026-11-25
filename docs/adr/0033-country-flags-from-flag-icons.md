# ADR-0033: Country flags come from the flag-icons package, as files of the app

- Status: Accepted
- Date: 2026-11-20
- Amends: [ADR-0010](0010-stack-revised.md) (one more client dependency); [spec 0006](../specs/0006-design-system-and-theming.md) (the flag set its Flags pattern left to choose, which it expected as an amendment to [ADR-0020](0020-themeable-ui.md))

## Context

On 2026-11-20 the owner asked for each country's flag beside its name wherever a country appears. Windows ships no flag emoji and shows the two letters of the country code instead (seen in the owner's screenshots of the app on Windows), and the content security policy allows images from the app's own origin only, so a flag CDN is out. The catalog is open (any country of the dataset may get a route), so the app needs a flag for every ISO 3166-1 alpha-2 code, not a hand-picked few.

## Decision

The web app depends on [`flag-icons`](https://github.com/lipis/flag-icons) ([MIT](https://github.com/lipis/flag-icons/blob/main/LICENSE), read 2026-11-20; SVG files only, no runtime code used), pinned in the workspace catalog like every dependency. `apps/web/src/flags.ts` maps a country code to its 4x3 SVG through Vite's `import.meta.glob`, each flag emitted as its own hashed file under `assets/flags/`; `CountryFlag` in `apps/web/src/country-flag.tsx` is the only component that draws one.

- A flag is decoration: an empty `alt`, always next to the country's name, never the only way a country is named. A code the set lacks, or a file that fails to load, shows nothing.
- Flags are never inlined into the script and never precached: a screen shows a handful of the 271 files (2.7 MB in all, in version 7.6.0). The browser's HTTP cache keeps the ones already seen; offline, an unseen flag is simply absent.
- A native select cannot draw images in its options, so a country is chosen in `CountryField` (`apps/web/src/forms/country-field.tsx`; since 2026-11-25 a wrapper of `SearchPicker` in `packages/ui`, which draws the flag through its `lead` slot): a field that opens a modal `<dialog>` with a search box over the countries in a grid, each with its flag. The owner chose it over a native select with the flag in the field (project thread, 2026-11-20), giving up the phone's own picker for flags on every option and a search. The browser's dialog keeps the focus inside, closes on Escape and returns the focus; arrows walk the options, and Enter in the search takes the first match.

The flag code lives in `apps/web`, not in `packages/ui` where [ADR-0020](0020-themeable-ui.md) keeps icons: the lookup needs the app's bundler to emit the files, and `packages/ui` is built by the TypeScript compiler alone. `packages/ui` only offers the slots a flag goes into (`lead` on `Disclosure`).

## Consequences

- No third party receives a request: the files are served from the app's origin, so the data-flow table and the content security policy do not change.
- The build output grows by the flag files; the script grows only by the map of their names.
- Which flag a code gets, including for disputed territories, is the package's choice. The country dataset, not the flag set, still decides which countries exist.
- A flag's address names its country (`assets/flags/pt-<hash>.svg`), so the host's request log shows which flags a browser fetched, with no identifier beside them. Accepted: the host is the app's own origin, which already serves the screens those flags sit on, and no other party sees the request.
- Replacing the set is a change to `flags.ts` and to the folder name the build and the precache list share in `apps/web/vite.config.ts`.
