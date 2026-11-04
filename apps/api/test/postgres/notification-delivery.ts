import type { Notices } from '../../src/email/notices.js';
import { createDelivery, deliverNow } from '../../src/notification/delivery.js';
import { createNotifier, type Notifier } from '../../src/notification/notifier.js';
import type { AuthTestDatabase } from './auth-database.js';

/** The API's notifier on app_api, delivering at once on app_jobs, so a test sees the email. */
export function deliveringNotifier(testDatabase: AuthTestDatabase, notices: Notices): Notifier {
  const delivery = createDelivery({
    jobsDb: testDatabase.jobsDb,
    authDb: testDatabase.authDb,
    notices,
  });
  return createNotifier({
    db: testDatabase.apiDb,
    startDelivery: (accountId, messageId) => deliverNow(delivery, accountId, messageId),
  });
}
