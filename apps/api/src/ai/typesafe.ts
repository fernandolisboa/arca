/** Pinned in code, as Anthropic's host is. */
export const typesafeBaseUrl = 'https://api.typesafe.ai/v1';

/** One request that spends no tokens and proves the key works: listing the models. */
export const typesafeKeyProbe = (key: string): [string, RequestInit] => [
  `${typesafeBaseUrl}/models`,
  { headers: { authorization: `Bearer ${key}` } },
];
