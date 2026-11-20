# ADR-0033: Country flags come from the flag-icons package, as files of the app

- Status: Accepted
- Date: 2026-11-20
- Amends: [ADR-0010](0010-stack-revised.md) (one more client dependency)

## Context

On 2026-11-20 the owner asked for each country's flag beside its name wherever a country appears. Flag emoji do not render on Windows, which shows two letters instead, and the content security policy allows images from the app's own origin only, so a flag CDN is out. The catalog is open (any country of the dataset may get a route), so the app needs a flag for every ISO 3166-1 alpha-2 code, not a hand-picked few.

## Decision

The web app depends on [`flag-icons`](https://github.com/lipis/flag-icons) (MIT, SVG files only, no runtime code used), pinned in the workspace catalog like every dependency. `apps/web/src/flags.ts` maps a country code to its 4x3 SVG through Vite's `import.meta.glob`, each flag emitted as its own hashed file under `assets/flags/`; `CountryFlag` in `apps/web/src/country-flag.tsx` is the only component that draws one.

- A flag is decoration: an empty `alt`, always next to the country's name, never the only way a country is named. A code the set lacks, or a file that fails to load, shows nothing.
- Flags are never inlined into the script and never precached: a screen shows a handful of some 270 files (2.7 MB in all). The browser's HTTP cache keeps the ones already seen; offline, an unseen flag is simply absent.
- A country select stays a native select, which phones open as their own picker and which cannot draw images in its options; the chosen country's flag shows inside the field.

## Consequences

- No third party receives a request: the files are served from the app's origin, so the data-flow table and the content security policy do not change.
- The build output grows by the flag files; the script grows only by the map of their names.
- Which flag a code gets, including for disputed territories, is the package's choice. The country dataset, not the flag set, still decides which countries exist.
- Replacing the set is a change to `flags.ts` alone.
