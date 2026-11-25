/** What a document guide entry says, in the screen's language (ADR-0039). */
export interface DocumentGuideWording {
  readonly office: string;
  readonly request: string;
  /** Only where the sources say how the apostille is obtained. */
  readonly apostille?: string;
}

/**
 * The document guides' wording (ADR-0039), keyed by issuing country and document kind, apart from
 * the main catalog: it carries costs and deadlines the reviewed file's sources back, so a change
 * here goes to the same reviewers and changes the guide file's `wordingSha256`. Empty
 * until a guide is researched.
 */
export const documentGuide: Readonly<
  Record<string, Readonly<Record<string, DocumentGuideWording>>>
> = {};
