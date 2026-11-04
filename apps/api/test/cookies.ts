/** The cookies a response set, as a browser would send them back; cleared ones are left out. */
export function cookiesFrom(...responses: Response[]): string {
  return responses
    .flatMap((response) => response.headers.getSetCookie())
    .filter((cookie) => !/max-age=0/i.test(cookie))
    .map((cookie) => cookie.split(';')[0] ?? '')
    .filter((pair) => !pair.endsWith('='))
    .join('; ');
}
