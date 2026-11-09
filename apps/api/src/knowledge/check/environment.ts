import type { DeploymentEnvironment } from '../../config.js';
import type { RuleCheckerChoice } from './checker.js';
import { claudeRuleCheckerChoice } from './claude-checker.js';
import { claudePassageLocator } from './claude-locator.js';
import { type SourceFetcher, httpsSourceFetcher } from './fetcher.js';
import { type PassageLocator, scriptedLocator } from './locator.js';
import { scriptedCheckerChoice } from './scripted-checker.js';

/** For a development server that asks for it, such as the e2e build: reads nothing, anywhere. */
export const offlineFetcher: SourceFetcher = {
  fetch: (url) => Promise.resolve({ ok: false, failure: 'network', status: null, chain: [url] }),
};

/** The fetcher a deployment reads cited pages with: the real one, unless a local server is offline. */
export function checkFetcherFor(
  environment: DeploymentEnvironment,
  offline = false,
): SourceFetcher {
  return environment === 'development' && offline ? offlineFetcher : httpsSourceFetcher();
}

/**
 * The checker a deployment uses: Claude in production, or none there without a key, so production
 * fetches nothing and the screen says the check is off; the scripted one, whose reports are never
 * clean, everywhere else, so no preview or local server spends model calls (ADR-0027).
 */
export function ruleCheckerFor(
  environment: DeploymentEnvironment,
  apiKey: string | undefined,
): RuleCheckerChoice | undefined {
  if (environment !== 'production') return scriptedCheckerChoice;
  return apiKey === undefined ? undefined : claudeRuleCheckerChoice({ apiKey });
}

/**
 * The locator a deployment picks a long page's passages with: Claude in production with a key, the
 * scripted one, which picks nothing and calls no model, everywhere else (ADR-0027).
 */
export function passageLocatorFor(
  environment: DeploymentEnvironment,
  apiKey: string | undefined,
): PassageLocator {
  return environment === 'production' && apiKey !== undefined
    ? claudePassageLocator({ apiKey })
    : scriptedLocator;
}
