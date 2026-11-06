/**
 * Whether a response is a page stored where a file should be: what a deployment that lacks a
 * file answers with its `index.html`, which a browser would otherwise load as that file.
 */
export function isPageInPlaceOfFile(url: string, contentType: string | null): boolean {
  const isPage = contentType?.startsWith('text/html') === true;
  return isPage && !new URL(url).pathname.endsWith('.html');
}
