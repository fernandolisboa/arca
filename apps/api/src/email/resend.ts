import { EmailRejectedError, type EmailSender } from './email.js';

export interface ResendSettings {
  readonly apiKey: string;
  /** The sender, on the verified sending domain (ADR-0015). */
  readonly from: string;
  readonly fetch?: typeof globalThis.fetch;
}

const endpoint = 'https://api.resend.com/emails';
const timeoutMs = 10_000;

/** Resend through its REST API, with no SDK (ADR-0015). Production only. */
export function resendSender({
  apiKey,
  from,
  fetch = globalThis.fetch,
}: ResendSettings): EmailSender {
  return {
    async send({ to, subject, text }) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      // The body is discarded unread: an error from the provider may echo the address.
      await response.body?.cancel();
      if (!response.ok) throw new EmailRejectedError(response.status);
    },
  };
}
