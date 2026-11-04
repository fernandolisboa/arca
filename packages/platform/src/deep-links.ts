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

/** An app path: one leading `/`, no backslash, no whitespace or control character. */
export function checkAppPath(path: string): void {
  // The URL parser drops tabs and newlines, so `/\t/host` would otherwise resolve to `//host`.
  // eslint-disable-next-line no-control-regex
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\s\x00-\x1f\x7f]/.test(path)) {
    throw new NotAnAppPathError('not an app path');
  }
}

/** The absolute link to an app path on an origin, refused unless it stays on that origin. */
export function appLink(path: string, origin: string): string {
  checkAppPath(path);
  const link = new URL(path, origin);
  if (link.origin !== new URL(origin).origin) throw new NotAnAppPathError('not an app path');
  return link.href;
}
