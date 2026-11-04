/**
 * Runs `work` for each account in turn. A failure for one does not hold back the others; the
 * first failure is thrown once all were tried, so the job reports it and its retry picks up the
 * accounts still owed.
 */
export async function forEachAccount(
  accountIds: readonly string[],
  work: (accountId: string) => Promise<unknown>,
): Promise<void> {
  const failures: unknown[] = [];
  for (const accountId of accountIds) {
    try {
      await work(accountId);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
}
