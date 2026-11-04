/**
 * Production's relying party and sending domain (spec 0003, R9), changed only by a reviewed pull
 * request. While either is null, or the Resend key is missing, production takes no new accounts
 * and sends no email. The sending domain is filled in once Resend has verified it, and only after
 * recovery sends its link behind the answer (spec 0003, R6), so a send's duration cannot show that
 * an address has an account.
 */
export interface ProductionSite {
  /** The full host, never its parent domain: passkeys are bound to it. */
  readonly host: string | null;
  readonly senderDomain: string | null;
}

export const productionSite: ProductionSite = {
  host: 'arca.filx.app',
  senderDomain: null,
};
