import { productionSite } from './production-site.js';

/**
 * `/.well-known/security.txt` (RFC 9116; spec 0004, R11). `expires` is renewed by a reviewed pull
 * request; a test fails 30 days before it, so the file never goes stale in production.
 */
export const securityContact = {
  contact: 'https://github.com/fernandolisboa/arca/security/advisories/new',
  expires: '2027-11-04T00:00:00.000Z',
  preferredLanguages: 'pt-BR, en',
  policy: 'https://github.com/fernandolisboa/arca/blob/main/SECURITY.md',
} as const;

export function securityTxt(): string {
  const { contact, expires, preferredLanguages, policy } = securityContact;
  const lines = [
    `Contact: ${contact}`,
    `Expires: ${expires}`,
    `Preferred-Languages: ${preferredLanguages}`,
    `Policy: ${policy}`,
  ];
  if (productionSite.host !== null) {
    lines.push(`Canonical: https://${productionSite.host}/.well-known/security.txt`);
  }
  return `${lines.join('\n')}\n`;
}
