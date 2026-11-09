# Arca

The domain language of Arca, an immigration consultancy in an app for one family. One English term in code and docs, one pt-BR label in the interface.

## Language

This repo keeps its glossary as a table, not the `**Term**:` list of the `domain-modeling` skill's format: add a row before using a new domain term, with its pt-BR label, and list words to avoid in the meaning cell when a synonym tempts. A term that no screen shows says "Internal, no UI label" in the label column.

| Term (code and docs) | pt-BR UI label | Meaning |
| --- | --- | --- |
| Case | Caso | Everything Arca knows about one family: people, relationships, assets, aspirations, plan |
| Person | Pessoa | An individual in a case |
| Relationship | Vínculo | A typed link between two people (spouse, ex-spouse, partner, parent, child, sibling, in-law); stored as spouse, partner and parent edges, the rest derived |
| Unit | Unidade | The group that moves together under one route: a principal applicant plus the dependents that route covers. Computed per route |
| Principal applicant | Requerente principal | The person whose eligibility a route is evaluated on |
| Dependent | Dependente | A person covered through the principal applicant, as defined by the route |
| Native national | Internal, no UI label | Someone who has held a country's citizenship since birth: by birth, or by descent or another basis acquired on the birth date, never by naturalization, marriage or investment. Read by the fact `person.citizenshipsFromBirth` |
| Destination | Destino | A country a person accepts moving to |
| Route | Rota | A legal pathway to live in a country (a visa, residence permit or citizenship path) |
| Route version | Versão da rota | An immutable snapshot of a route's rules, with its sources, effective date and pinned country sets and official-domain lists |
| Rule | Regra | The requirements, assessments, dependents, costs and durations of one route version |
| Ancestor | Ascendente | A parent, grandparent or earlier forebear of the principal, whether or not in the case; read in descent rules |
| Lineage | Linha de ascendência | The chain of people from an ancestor down to the principal |
| Rule summary | Resumo feito pela IA | A model's plain-text reading of one route version for an admin, with points to check; an aid to review that never decides and never reaches members; stored once per content, prompt and model, and shared by admins |
| Rule case | Caso de teste da regra | One table-driven test entry for a route version, in its cases file; not a family's case |
| Official-domain list | Lista de sites oficiais | A versioned list of hosts that count as official for a country or international body |
| Evaluation | Avaliação | The result of applying a route version to a person or unit |
| Evaluation engine | Internal, no UI label | The pure functions in `packages/domain` that select a version, compute the unit and evaluate requirements |
| Case snapshot | Internal, no UI label | The engine's structured, free-text-free view of a case at one moment (`CaseSnapshot`) |
| Completeness marker | Internal, no UI label | A person's flag that their spouses, partners, children or parents are all recorded; without it, unrecorded people may exist |
| Aspiration | Anseio | What a person wants, accepts, refuses and prioritizes |
| Deal-breaker | Inegociável | A condition that rules a route or destination out for a person |
| Execution mode | Modo de execução | How a step is presented: self-service, guided, delegated or family |
| Self-service | Autoatendimento | The person completes the step directly, usually via a prefilled link |
| Guided | Guiado | The app walks the person through the step and checks each stage |
| Delegated | Delegado | The step goes to a professional or partner, with the case summary ready |
| Family (mode) | Em família | The step is assigned to a relative in the case who offered to help |
| Action point | Ponto de ação | Where a step actually happens: link, phone, office, partner; says whether the step can be done online |
| Family area | Área da família | The screen with the people in a case, who has an account, invites and who may upload documents for whom; grants no access by itself |
| Guided questions | Perguntas guiadas | The step-by-step questions per person that fill the case, each setting one part of it (a fact, a completeness marker, dependence, an asset or a relationship's details); "Não sei" leaves it unknown |
| Free-text intake | Contar com suas palavras | Filling the case from the member's own description of the family, through an intake draft the member reviews (spec 0008) |
| Intake draft | Rascunho | The answers proposed from a member's own description of the family, which the member reviews person by person and fact by fact before anything is saved (spec 0008); the text itself is never stored |
| Playback | Resumo do caso | The case read back in plain sentences, each linked to the question that sets it, so the person can correct it |
| Keeper | Quem cuida dos dados | The one account that writes a person's facts and decides who sees them: the person, or whoever added someone without an account; not the data-protection controller |
| Case member | Participante do caso | An account in a case; it sees the case's people and relationships, and keeps the people it added |
| In the planning | Entra no planejamento | A person of the case the routes are evaluated for (`caseMember` in the code); a relative outside it, such as a grandparent who stays, is only described |
| Asset | Bem | Something of value owned by one or more people of the case, with each owner's share; a co-owner named by another keeper stays pending until their keeper confirms |
| Profile share | Compartilhamento de dados | A keeper letting a chosen member see a person's profile or, separately, their finances; not a document share |
| Case stage | Etapa do caso | Where a case stands on the home: telling about the family, the guided questions, then the routes; counted in the client from the case and its answers, never an eligibility decision |
| Progress | Progresso | Documents obtained and steps done out of what a person's or the family's chosen routes need, computed in code; unknowns shown apart |
| Shared analysis | Análise compartilhada | A comparison or recommendation an adult shares, read-only and revocable, with chosen people in the case; not a document share |
| Destination comparison | Comparar destinos | One adult's ranking of the countries that have a route, by criteria they weigh themselves; computed in code, private to that adult unless shared as a shared analysis ([ADR-0026](docs/adr/0026-destination-comparison-data.md)) |
| Criterion | Critério | One thing a destination comparison scores, such as safety or climate; knowledge data with a stable ID, scored from a country indicator or from the person's own rating |
| Personal criterion | Critério pessoal | A criterion of a comparison version that each adult scores with their own rating, such as climate; knowledge data, unlike an own criterion. Avoid "subjective criterion" |
| Own criterion | Critério próprio | A criterion an adult creates and names for their own comparison, scored only from their rating; case data, unlike a personal criterion. Avoid "custom criterion" |
| Weight | Peso | How much a criterion counts in one adult's comparison, from 0 (left out) to 5 |
| Rating | Sua nota | The one to five stars an adult gives a country on a personal criterion or an own criterion |
| Score | Nota | A country's result on one criterion, from 0 to 10, computed in code; unknown when the value or the rating is missing, never zero |
| Total score | Nota final | The weighted mean of a country's known scores, from 0 to 10 |
| Coverage | Dados conhecidos | The share of an adult's weight that a country's known scores carry; under half puts the country in "Poucos dados" |
| Few data | Poucos dados | The group of countries with less than half of an adult's weight known, listed after the ranked ones without a rank |
| Hidden country | País oculto | A country an adult left out of their comparison; still scored, listed last without a rank, and brought back with one tap; dropped on the next write once no route covers it |
| Country indicator | Indicador do país | A versioned, sourced knowledge file with one measured value per country, such as the homicide rate, with its year |
| Comparison version | Versão dos dados de comparação | A versioned knowledge file with the criteria and the country indicators they read; activated or rejected as a whole, like a route version |
| Guided tour | Tour guiado | The first-run walkthrough of the app and the hint shown the first time a screen opens; skippable and replayable |
| Fact | Dado | A typed value about a person or unit that rules read, such as an age at a date; derived from the case in code |
| Requirement | Requisito | A condition of a route version, evaluated as true, false or unknown, with a source |
| Assessment | Critério subjetivo | A judgment factor of a route version, such as national importance; shown with its evidence, never as pass or fail |
| Country set | Grupo de países | A versioned, sourced list of countries a rule refers to, such as treaty countries |
| Proposed version | Versão proposta | A route version in the knowledge catalog that is neither active nor rejected |
| Decision state | Internal, no UI label | Per version identity (route, number, content hash; or comparison, number, content hash, under a key no route can take): active, rejected or proposed. A version with no counted decision is proposed |
| Newer proposed version | Nova versão proposta | A version not yet active that selection would pick, at the evaluation date or later, instead of the version evaluated |
| Correction | Correção | A route version that fixes a data error in an earlier one, named by its `corrects` field; once in effect, the version it fixes is no longer selected |
| Official source | Fonte oficial | A source on a host the knowledge base lists as official for a country or an international body |
| Secondary source | Fonte secundária | A non-official source cited beside an official one, never instead of it |
| Stale source | Fonte desatualizada | A source not re-verified in the last 90 days; evaluations that cite it say the rule needs re-checking |
| Activation | Ativação | An admin's approval of one route version or comparison version, bound to its content hash; counts once stored ([ADR-0027](docs/adr/0027-admins-and-the-checked-batch-activation.md); earlier ones carry a step-up, [ADR-0022](docs/adr/0022-single-approver-activation.md)) |
| Rejection | Recusa | An admin's decision that a version, proposed or active, will never be used; once it counts, selection skips it |
| Admin | Administrador | An account that may activate or reject knowledge-base versions and give or take away the admin role; on the owner list, or holding an admin grant another admin gave from the family area. Replaces "approver" |
| Decision | Decisão | An admin's activation or rejection, stored with its author; decisions made before ADR-0027 also keep the step-up they consumed |
| Step-up | Confirmação com chave de acesso | A fresh passkey verification for one sensitive action, bound to that action |
| Content hash | Código do conteúdo | SHA-256 of the canonical JSON of a version and every file it pins; what a decision is bound to |
| Passkey | Chave de acesso | The WebAuthn credential a person signs in and confirms sensitive actions with |
| Knowledge catalog | Internal, no UI label | The validated, hashed route data that `packages/knowledge` builds and the API bundles; not the pnpm catalog of dependency versions |
| Admin grant | Internal, no UI label | An insert-only record that an admin gave the admin role to a confirmed account sharing a case with them (with a step-up), or took it away |
| Owner list | Internal, no UI label | The reviewed file in the repository that names, by account ID and per environment, the accounts that are always admins and cannot lose the role in the app; formerly the approver list |
| Activation screen | Tela de ativação | Where an admin reviews a proposed version as data, with its check report apart, and activates or rejects it |
| Independent check | Verificação independente | The model's report that compares a proposed route version, item by item, with the official sources it cites: matches, differs or could not be checked, each quote and value checked in code against the fetched page; never activates a version by itself and is never part of the content hash |
| Rule audit | Auditoria de regras | An authoring session's review of one route against the law, not only its cited pages: it re-reads the official sources whole, looks for later amendments, follows leads from other sites and looks for what the rule leaves out; only an official source changes a rule; it ends in a correction, a new version or a record of no change ([runbook](docs/runbooks/rule-audit.md)); avoid "independent check", which is the model's report at activation |
| Checked version | Conferida pela IA | A proposed route version whose current independent check report is clean: every item matches, with each quote and value checked in code; admins can activate all checked versions with one tap |
| Flagged version | Marcada para revisão | A proposed route version whose current check report is not clean: an item differs or could not be checked; decided one by one |
| Stale check | Verificação vencida | A route version whose reports no longer count: its content, country guide, prompt or model changed, or the newest report outlived its 30 days (one day after a failure); the next opening of the activation screen checks it again |
| Check start | Internal, no UI label | A recorded start of one route version's independent check; at most 20 in any 24 hours per environment, and dead after 30 minutes with no report |
| Fetch log | Internal, no UI label | A check report's record of each cited URL: read or the fixed failure code, final status, time, SHA-256 of the text sent and whether it was cut |
| Scripted checker | Internal, no UI label | The `RuleChecker` that development, previews, tests and e2e use until a model is configured; its reports are stored under the model `fake` and are never clean |
| Passage locator | Internal, no UI label | The step of the independent check that picks, from the outline of a cited page too long to send whole, the passages the check then reads for each item; a fast model in production, a scripted one that picks nothing elsewhere; it only chooses among verbatim passages of the page |
| Catalog check | Internal, no UI label | The manual run of the independent check on the newest version of every bundled route against its live official pages, which reports what matched and why the rest did not; it measures a change to the check and never gates one |
| Country guide | Internal, no UI label | The reviewed, versioned data file per country that the independent check loads, its per-country specialist: governing laws, how they change, known pitfalls; never a source and never a list of official hosts; lands in its own pull request; not a Claude Code skill |
| Rule report | Aviso de regra errada | A person's flag that a rule they were shown may be wrong; opens a research task. The button reads "Avisar regra errada" |
| Research task | Pesquisa pendente | The request opened when the knowledge base cannot answer a question; a research agent works it into a proposal, and, while none is built, a rule audit an admin asks for |
| Possible dependent | Possível dependente | A person a route might cover, pending unknown facts |
| Candidate | Internal, no UI label | The person a dependent rule is being evaluated for |
| Expression | Internal, no UI label | The JSON tree of a requirement, cost or condition, evaluated by the engine |
| Closed route version | Rota encerrada | A route version with status `closed`: the route no longer accepts applications, cited by its `closureSources` |
| Former country | País extinto | A state that no longer exists, with an ISO 3166-3 code, allowed only in citizenship and ancestry facts |
| Owner | Responsável | The founder, who owns the repository and is the first admin; "founder" in product docs means the same person |
| Active version | Versão ativa | A route version with a counted activation and no rejection; the only kind the engine evaluates for a case |
| Rejected version | Versão recusada | A route version with a counted rejection; selection skips it for good |
| Version settings | Configurações da versão | The fields of a route version other than its items: dates, currency, leap-day rule, reference dates, closure sources, tags and pins |
| Tag | Etiqueta | A free label of a route version, such as `investment`, hashed and activated with it |
| Pinned file | Arquivo fixado | A versioned data file a route version names by ID and number, such as a country list or an official-domain list |
| Decisive missing fact | Dado decisivo pendente | An unknown fact whose answer could change an evaluation's status |
| Eligible | Elegível | Evaluation status: every requirement holds |
| Not eligible | Não elegível | Evaluation status: a requirement does not hold |
| Missing information | Faltam informações | Evaluation status: no requirement fails, but some are unknown |
| Needs assessment | Depende de critério subjetivo | Evaluation status: every requirement holds and the route has judgment factors |
| Pending activation | Versão aguardando ativação | Evaluation status: the version in effect has not been activated yet |
| Unavailable | Indisponível | Evaluation status: no version in effect, or the route is closed |
| Knowledge base | Base de conhecimento | Sourced, versioned rules and information about routes, documents, steps and pitfalls; the admins' area for it is labelled "Regras" in navigation |
| Knowledge item | Item da base | One sourced entry in the knowledge base |
| Research agent | Internal, no UI label | The agent that would propose route versions from official sources as pull requests; not built: rule audits in authoring sessions do this work for now (ADR-0014) |
| Rule watcher | Vigia de regras | Scheduled job that detects rule changes and proposes updates; not built: the monthly rule audit covers this ground for now (ADR-0014) |
| Fixture route | Internal, no UI label | A made-up route on a user-assigned country code (`QM` to `QZ`, except `QO` and `QU`) that proves the schema in tests; never shown to users |
| Synthetic family | Internal, no UI label | An invented case snapshot in `eval/families`, shared by rule cases and AI evaluation; never real data |
| Intake evaluation case | Internal, no UI label | An invented pt-BR description with the draft expected from it, in `apps/api/test/eval/intake`; never real data |
| Source-of-funds trail | Trilha da origem dos recursos | Documented chain from an asset to the money used in a route |
| Apostille | Apostila | Hague Convention certification of a public document |
| Sworn translation | Tradução juramentada | Official translation required by some destinations |
| Vault | Cofre | Client-side encrypted document storage |
| Account | Conta | A person's sign-in identity: an email address, passkeys and sessions. A case person may have no account |
| Invite | Convite | A single-use link, sent by email, that lets someone create an account |
| Enrollment code | Código de cadastro | The one-time secret the owner generates on their own computer to create the first account; only its hash is in the repository |
| Recovery kit | Kit de recuperação | The printable page (or, behind a warning, a text file) in two parts, each shown once: the account recovery code at enrollment and the vault recovery secret when the vault is created |
| Step-up | Confirmação com chave de acesso | A fresh passkey verification for one purpose, bound to the action it approves (or, for vault unlock, opening a short window) |
| Security notice | Aviso de segurança | A message sent to every channel the account has (email first; devices once notifications exist) when something security-relevant happens to an account |
| Passkey | Chave de acesso | A WebAuthn credential that signs a person in; the only way to sign in |
| Recovery code | Código de recuperação | The secret in the recovery kit that, with the email link, restores account access |
| Vault recovery secret | Segredo de recuperação do cofre | The secret in the recovery kit that opens the vault when no passkey can |
| Device | Dispositivo | A browser or app where the person is signed in, shown in the device list through the passkey it uses, with the sessions that passkey signed in and each session's coarse browser and system description |
| Owner enrollment | Cadastro inicial | The one-time creation of the first account of an empty production database, with a single-use code |
| Designated adult | Adulto de confiança | An adult in the case whom a person names in advance to approve their account recovery (with the case model) |
| Vault identity | Chave do cofre | A person's private key that opens the documents encrypted to them; it never leaves a device in plaintext |
| Recipient | Destinatário | Anything a vault document or identity is encrypted to: another vault identity's public key, a passkey (through its PRF output) or the recovery secret |
| Vault envelope | Envelope do cofre | The vault identity encrypted to one unlock method: a passkey (PRF) or the vault recovery secret |
| Share | Compartilhamento | Giving another adult access to one document by encrypting it to their recipient too |
| Account link | Conexão entre contas | The confirmed connection between an inviter and the account they invited, which lets them share documents |
| Sharing state | Lista de compartilhamento | Shown when the owner confirms a change to it. The owner's own record of which recipients each document is encrypted to and which fingerprint is pinned for each person, tagged with the share key so the server cannot change it |
| Share key | (technical only) | A secret kept only inside a person's vault envelopes that tags their sharing state; replaced when the vault identity rotates |
| Personal-data registry | (technical only) | Every table's lifecycle decision: who owns its rows and how they are erased and exported, or why no account owns them |
| Account deletion | Exclusão da conta | Erasing an account and its data after a 7-day window the person can cancel |
| Pending deletion | Exclusão pendente | The 7-day state after a deletion request, when sign-in only offers to cancel it |
| Erasure | (technical only) | The workflow that deletes an account's rows and stored objects once its deletion is due; crypto-shredding is erasing by destroying the only key |
| Vault unlock | Desbloqueio do cofre | Opening the vault on a device with a passkey, valid for 15 minutes |
| Recovery passkey | Nova chave de acesso (recuperação) | A passkey registered through recovery, inactive for 24 hours and cancellable by any active passkey |
| Identity rotation | Troca da chave do cofre | Replacing a vault identity with a new one and re-encrypting the documents encrypted to it |
| Unconfirmed account | Conta aguardando confirmação | An invited account its inviter has not confirmed yet; it cannot invite, create cases, upload or share documents, or use AI features |
| Project owner | (technical only) | The person who runs Arca and approves owner-only steps (setup, restores, knowledge-base changes) |
| Owner | Dono | The account that owns a document or row; in product and data docs, "owner" alone means this; in operational steps (setup, deploys, backups, restores, incidents) "the owner" means the project owner, and security decisions always say "project owner" |
| Fingerprint | Impressão digital da chave | A short code derived from a person's vault recipient, compared in person before trusting it for sharing |
| Restricted session | Sessão restrita | A session that can only show a pending warning and cancel what waits: a recovery, until the recovery passkey activates, or a deletion, until it is due; with both pending, the recovery's restriction applies and the deletion's cancel stays open |
| Data export | Exportação dos dados | A file with all of an account's data, built on request |
| Notification channel | Canal de notificação | A place an account receives notices: email or one device's push subscription |
| Real-data gate | (technical only) | The checklist that must be complete before production accepts family data |
| Lineage mark | (technical only) | A comment on the migration runner's schema that marks a database as production or forked from it; a preview build that finds it fails |
| Outbox | Caixa de saída de teste | Where non-production environments keep emails instead of sending them; never in production |
