# Glossary

One English term in code and docs, one pt-BR label in the interface. Add a row before using a new domain term.

| Term (code and docs) | pt-BR UI label | Meaning |
| --- | --- | --- |
| Case | Caso | Everything Arca knows about one family: people, relationships, assets, aspirations, plan |
| Person | Pessoa | An individual in a case |
| Relationship | Vínculo | A typed link between two people (spouse, ex-spouse, partner, parent, child, sibling, in-law) |
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
| Knowledge base | Base de conhecimento | Sourced, versioned facts about routes, documents, steps and pitfalls |
| Knowledge item | Item da base | One sourced fact in the knowledge base |
| Rule watcher | Vigia de regras | Scheduled job that detects rule changes and proposes updates |
| Source-of-funds trail | Trilha da origem dos recursos | Documented chain from an asset to the money used in a route |
| Apostille | Apostila | Hague Convention certification of a public document |
| Sworn translation | Tradução juramentada | Official translation required by some destinations |
| Vault | Cofre | Client-side encrypted document storage |
| Account | Conta | A person's sign-in identity: an email address, passkeys and sessions. A case person may have no account |
| Invite | Convite | A single-use link, sent by email, that lets someone create an account |
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
| Personal-data registry | (technical only) | The list of every table with personal data and how each is erased and exported |
| Erasure tombstone | (technical only) | A record of an erased account kept with the backups so a restore does not bring it back |
| Account deletion | Exclusão da conta | Erasing an account and its data after a 7-day window the person can cancel |
| Pending deletion | Exclusão pendente | The 7-day state after a deletion request, when sign-in only offers to cancel it |
| Erasure | (technical only) | The workflow that deletes an account's rows and stored objects once its deletion is due; crypto-shredding is erasing by destroying the only key |
| Vault unlock | Desbloqueio do cofre | Opening the vault on a device with a passkey, valid for 15 minutes |
| Recovery passkey | Nova chave de acesso (recuperação) | A passkey registered through recovery, inactive for 24 hours and cancellable by any active passkey |
| Identity rotation | Troca da chave do cofre | Replacing a vault identity with a new one and re-encrypting the documents encrypted to it |
| Restore drill | (technical only) | The quarterly rehearsal that restores a backup into a throwaway branch and checks it |
| Unconfirmed account | Conta aguardando confirmação | An invited account its inviter has not confirmed yet; it cannot invite, create cases, upload or share documents, or use AI features |
| Project owner | (technical only) | The person who runs Arca and approves owner-only steps (setup, restores, knowledge-base changes) |
| Owner | Dono | The account that owns a document or row; in the docs, "owner" alone means this, and the operator is always the project owner |
| Fingerprint | Impressão digital da chave | A short code derived from a person's vault recipient, compared in person before trusting it for sharing |
| Restricted session | Sessão restrita | A session that can only show the pending-recovery warning and cancel the recovery, until the recovery passkey activates |
| Data export | Exportação dos dados | A file with all of an account's data, built on request |
| Notification channel | Canal de notificação | A place an account receives notices: email or one device's push subscription |
| Real-data gate | (technical only) | The checklist that must be complete before production accepts family data |
| Lineage mark | (technical only) | The database comment that proves a preview did not branch from production |
| Outbox | Caixa de saída de teste | Where non-production environments keep emails instead of sending them; never in production |
