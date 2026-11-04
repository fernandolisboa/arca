import type { DeviceDescription } from '@arca/api-contract/routes';
import type { Database } from '@arca/db';
import { sql } from 'drizzle-orm';
import type { Notices } from '../email/notices.js';

/**
 * Records the families a passkey signed in from and reports whether this sign-in is from a
 * browser or a system not seen before for it (spec 0003, R7). Synced passkeys sign in anywhere,
 * so the passkey alone says nothing about the device. A passkey starts with the families of the
 * device that registered or added it, which the new-passkey notice covers.
 */
export async function recordPasskeyClient(
  db: Database,
  credentialId: string,
  { browser, os }: DeviceDescription,
): Promise<boolean> {
  const result = await db.execute<{ unseen: boolean }>(sql`
    WITH prior AS (
      SELECT browser, os FROM auth.passkey_client WHERE credential_id = ${credentialId}
    ), recorded AS (
      INSERT INTO auth.passkey_client (credential_id, browser, os)
      VALUES (${credentialId}, ${browser}, ${os})
      ON CONFLICT DO NOTHING
    )
    SELECT EXISTS (SELECT FROM prior)
       AND (NOT EXISTS (SELECT FROM prior WHERE browser = ${browser})
         OR NOT EXISTS (SELECT FROM prior WHERE os = ${os})) AS unseen`);
  return result.rows[0]?.unseen === true;
}

/** After a passkey sign-in: one notice for a new browser or system family, none for a repeat. */
export async function noticeNewSignIn(
  { db, notices }: { readonly db: Database; readonly notices: Notices },
  sign: {
    readonly credentialId: string;
    readonly device: DeviceDescription;
    readonly email: string;
    readonly at: Date;
  },
): Promise<void> {
  if (!(await recordPasskeyClient(db, sign.credentialId, sign.device))) return;
  try {
    await notices.send({ kind: 'new_sign_in', to: sign.email, at: sign.at, device: sign.device });
  } catch (error) {
    // Forgotten again, so the next sign-in from this family retries the notice.
    await db.execute(sql`
      DELETE FROM auth.passkey_client
       WHERE credential_id = ${sign.credentialId}
         AND browser = ${sign.device.browser} AND os = ${sign.device.os}`);
    throw error;
  }
}
