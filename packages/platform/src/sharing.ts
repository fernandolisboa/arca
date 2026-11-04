export interface ShareContent {
  readonly title?: string;
  readonly text?: string;
  readonly url?: string;
  readonly files?: readonly File[];
}

/** Handing content to another app through the system's share sheet. */
export interface Sharing {
  /** `cancelled` when the person closes the share sheet. Must start from a user gesture. */
  share(content: ShareContent): Promise<'shared' | 'cancelled'>;
}

/** Files another app shared into Arca. */
export interface SharedFiles {
  /** The files shared since the last call, each returned once. */
  take(): Promise<readonly File[]>;
}
