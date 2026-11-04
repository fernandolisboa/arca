import { productionSite } from './production-site.js';

/**
 * `/.well-known/security.txt` (RFC 9116; spec 0004, R11). `expires` is renewed by a reviewed pull
 * request: a unit test fails 30 days before it, and so does the production smoke test, which also
 * runs weekly between deploys.
 */
export const securityContact = {
  contact: 'https://github.com/fernandolisboa/arca/security/advisories/new',
  expires: '2027-11-04T00:00:00.000Z',
  preferredLanguages: 'pt-BR, en',
  policy: 'https://github.com/fernandolisboa/arca/blob/main/SECURITY.md',
} as const;

export function securityTxt(host: string | null = productionSite.host): string {
  const { contact, expires, preferredLanguages, policy } = securityContact;
  const lines = [
    `Contact: ${contact}`,
    `Expires: ${expires}`,
    `Preferred-Languages: ${preferredLanguages}`,
    `Policy: ${policy}`,
  ];
  if (host !== null) lines.push(`Canonical: https://${host}/.well-known/security.txt`);
  return `${lines.join('\n')}\n`;
}
