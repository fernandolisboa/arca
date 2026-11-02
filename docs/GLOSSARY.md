# Glossary

One English term in code and docs, one pt-BR label in the interface. Add a row before using a new domain term.

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
| Route version | Versão da rota | An immutable snapshot of a route's rules, with source and effective dates |
| Evaluation | Avaliação | The result of applying a route version to a person or unit |
| Aspiration | Anseio | What a person wants, accepts, refuses and prioritizes |
| Deal-breaker | Inegociável | A condition that rules a route or destination out for a person |
| Execution mode | Modo de execução | How a step is presented: self-service, guided, delegated or family |
| Self-service | Autoatendimento | The person completes the step directly, usually via a prefilled link |
| Guided | Guiado | The app walks the person through the step and checks each stage |
| Delegated | Delegado | The step goes to a professional or partner, with the case summary ready |
| Family (mode) | Em família | The step is assigned to a relative in the case who offered to help |
| Action point | Ponto de ação | Where a step actually happens: link, phone, office, partner |
| Fact | Informação | A typed value about a person or unit that rules read, such as an age at a date; derived from the case in code |
| Requirement | Requisito | A condition of a route version, evaluated as true, false or unknown, with a source |
| Assessment | Critério subjetivo | A judgment factor of a route version, such as national importance; shown with its evidence, never as pass or fail |
| Country set | Grupo de países | A versioned, sourced list of countries a rule refers to, such as treaty countries |
| Proposed version | Versão proposta | A route version in the catalog that the owner has not activated yet |
| Activation | Ativação | The owner's passkey approval of one route version, bound to its content hash |
| Active version | Versão ativa | A route version with an activation; the only kind the engine evaluates for a case |
| Decisive missing fact | Informação que falta | An unknown fact whose answer could change an evaluation's status |
| Eligible | Elegível | Evaluation status: every requirement holds |
| Not eligible | Não elegível | Evaluation status: a requirement does not hold |
| Missing information | Faltam informações | Evaluation status: no requirement fails, but some are unknown |
| Needs assessment | Depende de critério subjetivo | Evaluation status: every requirement holds and the route has judgment factors |
| Pending activation | Regra aguardando ativação | Evaluation status: the version in effect has not been activated yet |
| Unavailable | Indisponível | Evaluation status: no version in effect, or the route is closed |
| Knowledge base | Base de conhecimento | Sourced, versioned rules and information about routes, documents, steps and pitfalls |
| Knowledge item | Item da base | One sourced entry in the knowledge base |
| Rule watcher | Vigia de regras | Scheduled job that detects rule changes and proposes updates |
| Source-of-funds trail | Trilha da origem dos recursos | Documented chain from an asset to the money used in a route |
| Apostille | Apostila | Hague Convention certification of a public document |
| Sworn translation | Tradução juramentada | Official translation required by some destinations |
| Vault | Cofre | Client-side encrypted document storage |
