/** A message as the EmailSender port takes it: plain text and one recipient (spec 0003, R8). */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/** Where production has no sending domain or key (spec 0003, R9), nothing may be sent. */
export class EmailNotConfiguredError extends Error {
  override name = 'EmailNotConfiguredError';
}

/** The provider refused the message; only its status is kept, never the response body. */
export class EmailRejectedError extends Error {
  override name = 'EmailRejectedError';
  readonly status: number;

  constructor(status: number) {
    super(`the email provider answered ${String(status)}`);
    this.status = status;
  }
}

export const unconfiguredSender: EmailSender = {
  send: () => Promise.reject(new EmailNotConfiguredError('no sending domain is configured')),
};
