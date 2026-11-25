/** What a document guide entry says, in the screen's language (ADR-0039). */
export interface DocumentGuideWording {
  /** The office or channel that issues the document. */
  readonly office: string;
  /** How to ask for it. */
  readonly request: string;
  /** How its apostille is obtained, where the sources say. */
  readonly apostille?: string;
}

/**
 * The document guides' wording (ADR-0039), keyed by issuing country and document kind, apart from
 * the main catalog: it carries costs and deadlines the reviewed file's sources back, so a change
 * here goes to the same reviewers and needs a new numbered guide file (`wordingSha256`). Empty
 * until a guide is researched.
 */
export const documentGuide: Readonly<
  Record<string, Readonly<Record<string, DocumentGuideWording>>>
> = {};
