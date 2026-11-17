/** Why a cited page was not read. Fixed codes only: they reach stored stages and the logs. */
export const fetchFailures = [
  'refused_url',
  'redirect_refused',
  'too_many_redirects',
  'address_refused',
  'lookup_failed',
  'http_status',
  'unsupported_type',
  'no_text',
  'pdf_no_text',
  'pdf_unreadable',
  'too_large',
  'timeout',
  'network',
] as const;
export type FetchFailure = (typeof fetchFailures)[number];
