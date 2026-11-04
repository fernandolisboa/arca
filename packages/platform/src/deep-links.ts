/** Links into the app: the same paths on every platform (docs/ARCHITECTURE.md). */
export interface DeepLinks {
  /** The absolute link to an app path such as `/cases`. Refuses anything but a path. */
  linkTo(path: string): string;
  /** Calls the listener with each path the system opens the running app at; returns a stop function. */
  listen(listener: (path: string) => void): () => void;
}

/** The path was not an app path: a full URL, a protocol-relative one, or not starting with `/`. */
export class NotAnAppPathError extends Error {
  override name = 'NotAnAppPathError';
}

/** An app path: starts with one `/`, so it can never name another origin. */
export function checkAppPath(path: string): void {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new NotAnAppPathError('not an app path');
  }
}
