# Open questions

## Decisions for the founder

- [ ] Confirm the name (Arca, or an alternative) and check trademark availability in Brazil (INPI) and the U.S. (USPTO) before Phase 3.
- [x] Confirm the stack ([ADR-0003](adr/0003-stack.md)), accepted 2026-11-01; revised by [ADR-0010](adr/0010-stack-revised.md) the same day.
- [x] Repository visibility: public, decided 2026-11-01 ([ADR-0010](adr/0010-stack-revised.md)).
- [ ] Create the Neon project `arca` (`sa-east-1`, Postgres 18) and a project-scoped API key, then install the Neon-managed Vercel integration once the agent has prepared the branches and roles ([ADR-0012](adr/0012-automation-first-setup.md)); the deploy ticket of the foundations scaffold waits on it.
- [ ] Choose and register the production domain before Phase 1: passkeys are bound to it, and changing it later invalidates every passkey.
- [ ] Google Play account type: personal (needs a 12-tester, 14-day closed test before production) or organization (requires a company).
- [ ] iOS builds: a Mac with Xcode, or a cloud build service.
- [ ] Apple Developer Program enrollment: individual or organization (the seller name shown on the App Store follows it).

## Case 1 facts to gather (answers go into the app, not this repo)

- [ ] Countries each person accepts, with priority, and whether units may end up in different countries.
- [ ] Who holds title to each property, and whether the other parent has assets of their own.
- [ ] Estimated net value of the assets in BRL, after capital-gains tax.
- [ ] Country of birth of the parents and grandparents of all six adults.
- [ ] Operating companies anyone runs, and whether any employer has an entity outside Brazil.
- [ ] Who in the family may see what (finances, documents).

## Product questions

- [ ] Which partner types to seed first (destination lawyers, sworn translators, FX providers) and how to vet them.
- [ ] How the knowledge base is reviewed once there are many countries: founder only, or invited reviewers per country.
- [ ] Voice in the MVP intake, or text first.
