import type { DeploymentEnvironment } from '../../config.js';
import { type SourceFetcher, httpsSourceFetcher } from './fetcher.js';

/** For a development server that asks for it, such as the e2e build: reads nothing, anywhere. */
export const offlineFetcher: SourceFetcher = {
  fetch: (url) => Promise.resolve({ ok: false, failure: 'network', status: null, chain: [url] }),
};

/** The fetcher a deployment reads cited pages with: the real one, unless a local server is offline. */
export function pageFetcherFor(environment: DeploymentEnvironment, offline = false): SourceFetcher {
  return environment === 'development' && offline ? offlineFetcher : httpsSourceFetcher();
}
