import { maxNewRouteLinks } from '@arca/api-contract/client';

/** The links typed one per line, or undefined while one is not an https address or too many. */
export function parsedLinks(text: string): string[] | undefined {
  const links = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const valid = links.every((link) => URL.canParse(link) && new URL(link).protocol === 'https:');
  return valid && links.length <= maxNewRouteLinks ? links : undefined;
}
