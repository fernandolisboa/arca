import type { Page } from '@playwright/test';

/** Console errors, uncaught errors and CSP or Trusted Types violations seen by the page. */
export function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
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
