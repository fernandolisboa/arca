export interface PickOptions {
  /** MIME types or extensions, as `<input accept>` takes them. */
  readonly accept?: readonly string[];
  readonly multiple?: boolean;
}

/** Choosing existing files. Must start from a user gesture. */
export interface FilePicking {
  /** The chosen files; empty when the person cancels. */
  pick(options?: PickOptions): Promise<readonly File[]>;
}

/** Photographing or scanning a paper document. Must start from a user gesture. */
export interface DocumentCapture {
  /** The captured image or scan; `undefined` when the person cancels. */
  capture(): Promise<File | undefined>;
}
