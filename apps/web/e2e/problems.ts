import type { Page } from '@playwright/test';
import { signedOutOrigin } from './servers.js';

/**
 * The one expected failed request: the session check, which answers 401 when signed out, and
 * fails on the server with no database.
 */
function isExpectedSessionFailure(text: string, url: string): boolean {
  // Errors logged by scripts, such as the violation reporter, carry no URL.
  if (!text.startsWith('Failed to load resource') || !URL.canParse(url)) return false;
  const { origin, pathname } = new URL(url);
  if (pathname !== '/v1/session') return false;
  return text.includes('status of 401') || origin === signedOutOrigin;
}

/** Console errors, uncaught errors and CSP or Trusted Types violations seen by the page. */
export function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (isExpectedSessionFailure(message.text(), message.location().url)) return;
    problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  return problems;
}

/** Logs every CSP violation as a console error, so `watchProblems` sees it. */
export async function reportViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(
        `CSP violation: ${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}:${String(event.lineNumber)}:${String(event.columnNumber)} ${event.sample}`,
      );
    });
  });
}
