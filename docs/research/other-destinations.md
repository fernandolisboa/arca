# Other destinations

Checked 2026-11-01; the Uruguay, Argentina and Paraguay sections on 2026-11-07.

## Spain

The non-lucrative residence visa is now route version `es-non-lucrative` 1 in `packages/knowledge/data/routes`, verified against the BOE on 2026-11-06: Real Decreto 1155/2024, articles 61 and 62, with the IPREM of EUR 600 a month from Ley 31/2022, whose 2023 budget stays extended. A registered partner, a partner with children in common and adult children who need support show as possible, since the case does not record those facts. The digital nomad visa (Ley 14/2013, article 74 bis) waits: its income threshold, a percentage of the minimum wage, is set in instructions on inclusion.gob.es, which refuses automated reads.

| Fact | Source |
| --- | --- |
| Brazilians can apply for Spanish nationality after 2 years of legal, continuous residence (Ibero-American rule), instead of the general 10 | [Eurodicas](https://www.eurodicas.com.br/?p=173223) |
| Requires DELE A2 Spanish and the CCSE culture test; study permits do not count as residence | [Eurodicas](https://www.eurodicas.com.br/?p=173223), [Mercado & Eventos](https://www.mercadoeeventos.com.br/?p=616608) |
| The Democratic Memory Law ("Lei dos Netos") closed new applications in October 2025 | [Eurodicas](https://www.eurodicas.com.br/?p=236) |
| Golden visa abolished | **Unverified** |

## Uruguay

Mercosur permanent residence is now route version `uy-mercosur-permanent` 1 in `packages/knowledge/data/routes`, verified on 2026-11-07 against IMPO and the migration directorate's pages on gub.uy. Each listed national qualifies on their own nationality, so a Brazilian child qualifies as a Brazilian. A family member from outside the listed states comes in through family reunification: a spouse, a partner of five years or more, an unmarried child or stepchild, or a parent who depends on a principal from a state party to the 2002 Residence Agreements (Argentina, Bolivia, Brazil, Chile, Paraguay) is a dependent; anyone else in those relationships shows as possible. Accepted readings: art. 9.2 of the Agreements does not define family members and sets no age, so the route reads it as covering a dependent unmarried adult child and a dependent unmarried stepchild, while art. 10 of the migration law lists only children who are minors or adults with a disability; a later version should narrow this if the directorate does. The five years of a partnership count from the start of the union the case records, since it records no date for living together, which Ley 18.246 counts.

| Fact | Source |
| --- | --- |
| Nationals of Mercosur member and associated states who prove that nationality are permanent residents (Ley 18.250, art. 33, literal B, as worded by Ley 20.075, art. 169, in force from 2023-02-17, 120 days after promulgation on 2022-10-20; Ley 19.254 already gave the same right from 2014) | [Ley 18.250](https://www.impo.com.uy/bases/leyes/18250-2008), [Ley 20.075](https://www.impo.com.uy/bases/leyes/20075-2022) |
| The states covered, as the migration directorate lists them: Argentina, Bolivia, Brazil, Chile, Colombia, Ecuador, Guyana, Paraguay, Peru, Suriname and Venezuela. The statute says only "member and associated states", so an associated state the directorate does not list is not modeled | [DNM, Residencia legal](https://www.gub.uy/tramites/residencia-legal) |
| The procedure follows the reciprocity agreement with the applicant's state (Decreto 45/023, art. 8). The Residence Agreements give family members without a member state's nationality a residence like that of the person they depend on (art. 9.2), and the migration law guarantees reunification with parents, spouses, partners, unmarried minor children and adult children with a disability (art. 10) | [Decreto 45/023](https://www.impo.com.uy/bases/decretos/45-2023), [Ley 17.927](https://www.impo.com.uy/bases/leyes-internacional/17927-2005), [Ley 18.250](https://www.impo.com.uy/bases/leyes/18250-2008) |
| Not modeled: the Agreements count a naturalized national only after five years (art. 2); no fact reads how long a citizenship has been held, so the route reads every listed citizenship as enough, for the principal's own residence and for the dependents who come through art. 9.2 | [Ley 17.927](https://www.impo.com.uy/bases/leyes-internacional/17927-2005) |
| Not modeled: application with a valid passport or identity document; adults sign a sworn statement of no criminal record (arts. 45 and 46 of Ley 18.250) and present records from every country lived in for more than six months in the last five years; Uruguayan vaccination certificate; minors bring a birth certificate and their parents' authorization. The case records none of these | [Decreto 45/023, art. 2](https://www.impo.com.uy/bases/decretos/45-2023), [DNM, Permanente Mercosur](https://www.gub.uy/tramites/residencia-legal-permanente-mercosur) |
| Not modeled: the fee is 557.30 UI (indexed units) plus a 55.70 UI certificate; Brazilians and Paraguayans pay nothing under their reciprocity agreements. A cost per nationality in indexed units does not fit the cost schema yet | [DNM, Permanente Mercosur](https://www.gub.uy/tramites/residencia-legal-permanente-mercosur) |
| Not modeled: the ministry decides within 90 business days; a duration stage counts calendar time, not business days | [Ley 18.250, art. 33](https://www.impo.com.uy/bases/leyes/18250-2008) |

## Argentina

Temporary residence by nationality (Mercosur) is now route version `ar-mercosur-temporary` 1 in `packages/knowledge/data/routes`, verified on 2026-11-07 against the consolidated texts and the migration directorate's page on www.argentina.gob.ar. It grants two years, renewable. Each listed national qualifies on their own nationality if it is native, so a Brazilian child born a Brazilian qualifies as a Brazilian. A family member from anywhere comes in through family reunification with the temporary resident. Accepted readings: a citizenship counts as native when it is by birth, or by descent or another basis acquired on the birth date (the new fact `person.citizenshipsFromBirth`); a Brazilian citizenship by descent recorded with a later date shows as possible. A partner counts after two years from the start of the union the case records, since the case records neither the date living together began nor the registration; the registration only proves the union (Civil and Commercial Code, art. 511), so it is read as a document, like a marriage certificate, which no route checks yet. The spouse's children are read as joining the spouse, who is a temporary resident by reunification; no other chained relative is modeled.

| Fact | Source |
| --- | --- |
| Native nationals of the Mercosur states parties, Chile and Bolivia get temporary residence for two years, renewable with multiple entries (Ley 25.871, art. 23 l); the list of states is illustrative and covers every state party and associated state (Decreto 616/2010, art. 23 l) | [Ley 25.871](https://www.argentina.gob.ar/normativa/nacional/ley-25871-92016/actualizacion), [Decreto 616/2010](https://www.argentina.gob.ar/normativa/nacional/decreto-616-2010-167004/texto) |
| The states covered, as the migration directorate lists them: native nationals of Uruguay, Brazil, Paraguay, Bolivia, Chile, Peru, Ecuador, Colombia, Venezuela, Guyana and Suriname; or natives of another country naturalized for five years or more in Brazil, Paraguay, Uruguay, Bolivia, Chile, Colombia, Ecuador or Peru. Decreto 616/2010 counts every associated state, so an associated state the directorate does not list is not modeled | [DNM, residencia temporaria por nacionalidad Mercosur](https://www.argentina.gob.ar/servicio/obtener-una-residencia-temporaria-por-nacionalidad-mercosur) |
| Family reunification: the spouse, parent, or unmarried child under 18 not emancipated or adult child with a disability of a temporary resident gets temporary residence for the relative's term (Ley 25.871, art. 23 ñ, added by Decreto 366/2025, art. 6, in force from 2025-05-29; Decreto 616/2010, art. 23, last paragraph; art. 10). A registered stable union counts like a marriage (Disposición DNM 4880/2015, noted in the consolidated text) and needs two years of living together (Civil and Commercial Code, art. 510 e); its registration serves only as proof (art. 511) | [Ley 25.871](https://www.argentina.gob.ar/normativa/nacional/ley-25871-92016/actualizacion), [Decreto 366/2025](https://www.argentina.gob.ar/normativa/nacional/norma-413297/texto), [Código Civil y Comercial](https://www.argentina.gob.ar/normativa/nacional/ley-26994-235975/actualizacion) |
| Ages: a minor has not turned 18 (art. 25); only marriage emancipates (art. 27); a period of years with no equivalent day in its last month ends on that month's last day (art. 6), so a 29 February birthday counts on 28 February | [Código Civil y Comercial](https://www.argentina.gob.ar/normativa/nacional/ley-26994-235975/actualizacion) |
| Not modeled: a naturalized national's five years, since no fact reads how long a citizenship has been held, so a non-native citizenship of one of the eight states shows as possible; an adult child's disability, so adult children show as possible; a minor who married and is no longer married stays emancipated, which the case cannot tell apart from never married | [DNM](https://www.argentina.gob.ar/servicio/obtener-una-residencia-temporaria-por-nacionalidad-mercosur), [Código Civil y Comercial](https://www.argentina.gob.ar/normativa/nacional/ley-26994-235975/actualizacion) |
| Not modeled: passport or Mercosur travel document; Argentine criminal record (over 16) and records from every country lived in for more than a year in the last three years; proof of address and regular entry; the application is made from inside Argentina; for minors, a birth certificate and a parent's authorization; at entry, a sworn statement of health insurance (Ley 25.871, art. 35, as worded by Decreto 366/2025). The fee follows the directorate's table of migration fees, which is not read yet | [DNM](https://www.argentina.gob.ar/servicio/obtener-una-residencia-temporaria-por-nacionalidad-mercosur), [Ley 25.871](https://www.argentina.gob.ar/normativa/nacional/ley-25871-92016/actualizacion) |
| After two continuous years of temporary residence, a Mercosur or associated national can apply for permanent residence (Decreto 616/2010, art. 22 c); since Decreto 366/2025 the applicant must prove enough means to live on and no disqualifying criminal record (Ley 25.871, art. 22). Not a route yet | [Decreto 616/2010](https://www.argentina.gob.ar/normativa/nacional/decreto-616-2010-167004/texto), [Ley 25.871](https://www.argentina.gob.ar/normativa/nacional/ley-25871-92016/actualizacion) |

## Paraguay

Mercosur temporary residence is now route version `py-mercosur-temporary` 1 in `packages/knowledge/data/routes`, verified on 2026-11-07 against the laws on www.bacn.gov.py and the migration directorate's page on migraciones.gov.py. It grants two years, not renewable; the holder may then ask for Mercosur permanent residence (Ley 3578, art. 5), which is not a route yet. Each listed national qualifies on their own nationality if it is native, so a Brazilian child born a Brazilian qualifies as a Brazilian. A family member without a listed nationality comes in through art. 9.2 of the Residence Agreement: a spouse, an unmarried child or stepchild under 18, or a parent who depends on a principal native of a state that signed the agreement Paraguay approved by Ley 3578 (Argentina, Bolivia, Brazil, Chile, Uruguay) is a dependent; anyone else in those relationships shows as possible. Accepted readings: the agreement does not define family members, so the route takes the list in the migration law's reunification principle (Ley 6984, art. 4.10: parents, spouses, unmarried minor children, adult children with a disability) and reads a dependent stepchild as a child, as the Uruguay and Argentina versions do. That list names no partner, and Ley 6984 never mentions a stable union, so a partner is not a dependent, not even a possible one: a rule that can only answer "not known" cannot pass the cases' coverage check, and the law's text supports leaving partners out. A later version should add partners if the directorate admits them (see OPEN-QUESTIONS). The Civil Code's rule for periods of years (arts. 339 and 340, in the chapter on juristic acts) is read as the convention for ages too, so a 29 February birthday counts on 28 February.

| Fact | Source |
| --- | --- |
| Nationals of the agreement's states get temporary residence of up to two years (art. 4) and may turn it into permanent residence in the 90 days before it expires (art. 5); a national is one by origin or naturalized for five years (art. 2); family members without a state party's nationality get a residence like that of the person they depend on (art. 9.2) | [Ley 3578/2008](https://www.bacn.gov.py/leyes-paraguayas/1104/x) |
| The states covered, as the migration directorate lists them: Argentina, Brazil, Uruguay, Bolivia, Chile, Peru, Colombia and Ecuador. Two years, not renewable, unlike the general temporary residence of Ley 6984, art. 46, which can be extended once. Venezuela, Guyana and Suriname are not listed | [DNM, Residencia Temporaria Mercosur](https://migraciones.gov.py/residencia-temporaria-mercosur/) |
| Family reunification covers parents, spouses, unmarried minor children and adult children with a disability (Ley 6984, art. 4.10). The law was published on 2022-10-18 and binds from the next day (Civil Code, art. 1), which is the version's start | [Ley 6984/2022](https://www.bacn.gov.py/leyes-paraguayas/10973/x) |
| Ages: full capacity at 18 (Civil Code art. 36, as worded by Ley 2169/2003); a period of years ends on the same day number, or on the last day of a shorter month (arts. 339 and 340) | [Ley 2169/2003](https://www.bacn.gov.py/leyes-paraguayas/4845/x), [Código Civil, libro segundo](https://www.bacn.gov.py/leyes-paraguayas/5299/x) |
| Not modeled: a naturalized national's five years, since no fact reads how long a citizenship has been held, so a non-native citizenship of a listed state shows as possible; an adult child's disability, so unmarried adult children show as possible; whether art. 9.2 also binds Paraguay for principals from Peru, Colombia and Ecuador, which acceded later, so their family members show as possible | [Ley 3578/2008](https://www.bacn.gov.py/leyes-paraguayas/1104/x), [Ley 6984/2022](https://www.bacn.gov.py/leyes-paraguayas/10973/x) |
| Not modeled: identity document, birth and civil-status certificates, criminal records from the country of origin and Paraguay's police (from 14), proof of entry; minors sign with both parents, who hold or apply for residence at the same time. The fee is Gs. 2,341,540 (cash), which the version does not record yet | [DNM, Residencia Temporaria Mercosur](https://migraciones.gov.py/residencia-temporaria-mercosur/) |

## Germany

| Fact | Source |
| --- | --- |
| Naturalization after 5 years; the 3-year fast track was repealed on 2025-10-30; a proposal to raise it to 8 years was not law as of May 2026 | [MS in Germany](https://msingermany.com/blog/germany-immigration-rules-2026-changes) |
| Opportunity Card (Chancenkarte): up to one year to look for work without an offer, points-based | [VisaProcessInfos](https://www.visaprocessinfos.com/answers/germany-immigration-changes-2026) |
| EU Blue Card 2026: EUR 50,700 gross/year, or EUR 45,934.20 for shortage occupations, recent graduates and IT specialists | [VisaProcessInfos](https://www.visaprocessinfos.com/answers/germany-immigration-changes-2026) |

## Japan

| Fact | Source |
| --- | --- |
| Long-term resident status for Nikkei up to the third generation: renewable, no work restrictions | [WhereToEmigrate](https://wheretoemigrate.io/lanes/brazil-to-japan-work-visa-2026) |
| Fourth generation (yonsei) has a more restricted pathway | [Japan-Visa.com](https://japan-visa.com/visas/nikkei-4th-generation) |

## Mexico

| Fact | Source |
| --- | --- |
| Temporary resident visa by economic solvency: more than 180 days and up to 4 years, without remuneration from Mexico; card issued by INM within 30 days of arrival | [Embassy of Mexico in Belgium](https://embamex.sre.gob.mx/belgica/index.php/es/sercons/visas-es/22-seccion-consular/visas/609-temporary-resident-visa-based-on-economic-solvency) |
| Solvency thresholds are set in UMA units; UMA was MXN 117.31/day in 2026 | [Consulate of Mexico in São Paulo](https://consulmex.sre.gob.mx/saopaulo/index.php/mexicanos/tramites-menu?id=52) |

## To research

| Destination | Starting point |
| --- | --- |
| Chile | Mercosur Residence Agreement (**unverified** details per country) |
| Canada | Express Entry points system |
| Ireland | Critical Skills Employment Permit and general work permits |
| Australia, New Zealand | Points-based skilled visas |
| United Arab Emirates | Long-term residence through property investment |
