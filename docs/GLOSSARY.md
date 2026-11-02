# Glossary

One English term in code and docs, one pt-BR label in the interface. Add a row before using a new domain term. A term that no screen shows says "Internal, no UI label" in the label column.

| Term (code and docs) | pt-BR UI label | Meaning |
| --- | --- | --- |
| Case | Caso | Everything Arca knows about one family: people, relationships, assets, aspirations, plan |
| Person | Pessoa | An individual in a case |
| Relationship | Vínculo | A typed link between two people (spouse, ex-spouse, partner, parent, child, sibling, in-law); stored as spouse, partner and parent edges, the rest derived |
| Unit | Unidade | The group that moves together under one route: a principal applicant plus the dependents that route covers. Computed per route |
| Principal applicant | Requerente principal | The person whose eligibility a route is evaluated on |
| Dependent | Dependente | A person covered through the principal applicant, as defined by the route |
| Destination | Destino | A country a person accepts moving to |
| Route | Rota | A legal pathway to live in a country (a visa, residence permit or citizenship path) |
| Route version | Versão da rota | An immutable snapshot of a route's rules, with its sources, effective date and pinned country sets and official-domain lists |
| Rule | Regra | The requirements, assessments, dependents, costs and durations of one route version |
| Ancestor | Ascendente | A parent, grandparent or earlier forebear of the principal, whether or not in the case; read in descent rules |
| Lineage | Linha de ascendência | The chain of people from an ancestor down to the principal |
| Rule case | Caso de teste da regra | One table-driven test entry for a route version, in its cases file; not a family's case |
| Official-domain list | Internal, no UI label | A versioned list of hosts that count as official for a country or international body |
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
| Action point | Ponto de ação | Where a step actually happens: link, phone, office, partner |
| Fact | Dado | A typed value about a person or unit that rules read, such as an age at a date; derived from the case in code |
| Requirement | Requisito | A condition of a route version, evaluated as true, false or unknown, with a source |
| Assessment | Critério subjetivo | A judgment factor of a route version, such as national importance; shown with its evidence, never as pass or fail |
| Country set | Grupo de países | A versioned, sourced list of countries a rule refers to, such as treaty countries |
| Proposed version | Versão proposta | A route version in the knowledge catalog that is neither active nor rejected |
| Correction | Correção | A route version that fixes a data error in an earlier one, named by its `corrects` field; once in effect, the version it fixes is no longer selected |
| Official source | Fonte oficial | A source on a host the knowledge base lists as official for a country or an international body |
| Secondary source | Fonte secundária | A non-official source cited beside an official one, never instead of it |
| Stale source | Fonte desatualizada | A source not re-verified in the last 90 days; evaluations that cite it say the rule needs re-checking |
| Activation | Ativação | An approver's passkey approval of one route version, bound to its content hash; counts only after its notice and veto window |
| Rejection | Recusa | An approver's passkey decision that a version, proposed or active, will never be used; once it counts, selection skips it |
| Veto | Veto | An approver's passkey cancellation of a pending decision before it counts; final |
| Approver | Aprovador | A person on the reviewed approver list who may activate, reject or veto knowledge-base versions with a pinned passkey |
| Decision | Decisão | An approver's activation, rejection or veto, stored with its passkey assertion |
| Notice | Aviso de segurança | The message every approver gets for every decision; the veto window runs from it |
| Step-up | Confirmação com chave de acesso | A fresh passkey verification for one sensitive action, bound to that action |
| Content hash | Internal, no UI label | SHA-256 of the canonical JSON of a version and every file it pins; what a decision is bound to |
| Passkey | Chave de acesso | The WebAuthn credential a person signs in and confirms sensitive actions with |
| Knowledge catalog | Internal, no UI label | The validated, hashed route data that `packages/knowledge` builds and the API bundles; not the pnpm catalog of dependency versions |
| Approver list | Internal, no UI label | The reviewed, versioned file in the repository that names the approvers and pins their credentials; designed with consultancy core slice 3 |
| Credential | Credencial | A passkey or security key pinned for an approver: the everyday credential or the offline credential |
| Everyday credential | Chave de acesso | An approver's synced passkey, usually the phone's, for rule decisions and vetoes; it is a passkey, so it shares that label, and screens tell it apart only from the offline credential |
| Offline credential | Chave de segurança | An approver's hardware security key, device-bound and attested, the only credential that may propose an approver-list change, besides the recovery path |
| Recovery path | Internal, no UI label | The delayed, notified way to restore an approver who lost every credential; never rests on Git or email alone |
| Activation screen | Tela de ativação | Where an approver reviews a proposed version as data and activates or rejects it |
| Research task | Pesquisa pendente | The request opened when the knowledge base cannot answer a question; a research agent works it into a proposal |
| Possible dependent | Possível dependente | A person a route might cover, pending unknown facts |
| Candidate | Internal, no UI label | The person a dependent rule is being evaluated for |
| Expression | Internal, no UI label | The JSON tree of a requirement, cost or condition, evaluated by the engine |
| Closed route version | Rota encerrada | A route version with status `closed`: the route no longer accepts applications, cited by its `closureSources` |
| Former country | País extinto | A state that no longer exists, with an ISO 3166-3 code, allowed only in citizenship and ancestry facts |
| Owner | Responsável | The founder, who owns the repository and is the first approver; "founder" in product docs means the same person |
| Active version | Versão ativa | A route version whose activation counts and that has no rejection, pending or counted; the only kind the engine evaluates for a case |
| Decisive missing fact | Dado decisivo pendente | An unknown fact whose answer could change an evaluation's status |
| Eligible | Elegível | Evaluation status: every requirement holds |
| Not eligible | Não elegível | Evaluation status: a requirement does not hold |
| Missing information | Faltam informações | Evaluation status: no requirement fails, but some are unknown |
| Needs assessment | Depende de critério subjetivo | Evaluation status: every requirement holds and the route has judgment factors |
| Pending activation | Versão aguardando ativação | Evaluation status: the version in effect has not been activated yet |
| Unavailable | Indisponível | Evaluation status: no version in effect, or the route is closed |
| Knowledge base | Base de conhecimento | Sourced, versioned rules and information about routes, documents, steps and pitfalls |
| Knowledge item | Item da base | One sourced entry in the knowledge base |
| Research agent | Internal, no UI label | The agent that proposes route versions from official sources as pull requests |
| Rule watcher | Vigia de regras | Scheduled job that detects rule changes and proposes updates |
| Fixture route | Internal, no UI label | A made-up route on a user-assigned country code (`QM` to `QZ`, except `QO` and `QU`) that proves the schema in tests; never shown to users |
| Synthetic family | Internal, no UI label | An invented case snapshot in `eval/families`, shared by rule cases and AI evaluation; never real data |
| Source-of-funds trail | Trilha da origem dos recursos | Documented chain from an asset to the money used in a route |
| Apostille | Apostila | Hague Convention certification of a public document |
| Sworn translation | Tradução juramentada | Official translation required by some destinations |
| Vault | Cofre | Client-side encrypted document storage |
