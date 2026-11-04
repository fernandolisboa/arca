import { test, type Page } from '@playwright/test';

/**
 * The one expected failed request: the session check, which answers 401 when signed out and an
 * error on the server with no database.
 */
function isSignedOutSessionCheck(text: string, url: string): boolean {
  return text.startsWith('Failed to load resource') && new URL(url).pathname === '/v1/session';
}

/** Console errors, uncaught errors and CSP or Trusted Types violations seen by the page. */
export function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (isSignedOutSessionCheck(message.text(), message.location().url)) return;
    problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  return problems;
}

/** Reports CSP and Trusted Types violations as console errors, so `watchProblems` sees them. */
export function reportViolations(): void {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => {
        console.error(
          `CSP violation: ${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}:${String(event.lineNumber)}:${String(event.columnNumber)} ${event.sample}`,
        );
      });
    });
  });
}
