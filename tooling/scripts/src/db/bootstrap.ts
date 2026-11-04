import { clientFor, type ConnectionTarget } from './connection.ts';
import { checkDeploymentTarget, type Deployment } from './deployment-target.ts';

/** The roles whose passwords bootstrap.sql sets, each through a `'{{role}}'` placeholder. */
export const rolesWithPasswords = [
  'app_migrator',
  'app_api',
  'app_jobs',
  'app_auth',
  'app_audit',
  'app_backup',
] as const;
export type RoleWithPassword = (typeof rolesWithPasswords)[number];
export type RolePasswords = Readonly<Record<RoleWithPassword, string>>;

const placeholder = /'\{\{([a-z_]+)\}\}'/g;

/**
 * Generated passwords only: 32 to 128 base64url characters. The class has no quote or backslash,
 * so a password can never end the SQL string literal it is placed in.
 */
export const rolePasswordPattern = /^[A-Za-z0-9_-]{32,128}$/;

/**
 * Fills each `'{{role}}'` placeholder with that role's password (spec 0001, R7). `ALTER ROLE …
 * PASSWORD` takes no bind parameters, and Neon accepts only plaintext there, so the password is a
 * literal whose alphabet is checked first. Every role must appear exactly once.
 */
export function renderBootstrap(template: string, passwords: RolePasswords): string {
  const seen = new Set<string>();
  const rendered = template.replace(placeholder, (_match, role: string) => {
    if (!(rolesWithPasswords as readonly string[]).includes(role)) {
      throw new Error(`bootstrap.sql has a placeholder for ${role}, which has no password`);
    }
    if (seen.has(role)) throw new Error(`bootstrap.sql sets the password of ${role} twice`);
    seen.add(role);
    const password = passwords[role as RoleWithPassword];
    if (!rolePasswordPattern.test(password)) {
      throw new Error(`the ${role} password must be 32 to 128 base64url characters`);
    }
    return `'${password}'`;
  });
  const missing = rolesWithPasswords.filter((role) => !seen.has(role));
  if (missing.length > 0) {
    throw new Error(`bootstrap.sql does not set the password of ${missing.join(', ')}`);
  }
  if (rendered.includes('{{')) throw new Error('bootstrap.sql has a malformed placeholder');
  return rendered;
}

/**
 * Runs the rendered bootstrap as the database owner, in one transaction with
 * `createrole_self_grant` empty, so the owner gains no inherited or SET membership in the roles it
 * creates. In a Vercel build it first checks that the database belongs to that deployment. Errors
 * carry no statement text, so a password cannot reach the build log through them.
 */
export async function bootstrap(
  target: ConnectionTarget,
  renderedSql: string,
  deployment?: Deployment,
): Promise<void> {
  const client = clientFor(target, 'arca-bootstrap');
  await client.connect();
  try {
    await client.query('BEGIN');
    try {
      if (deployment !== undefined) {
        await checkDeploymentTarget(client, deployment, target.host, { mayMark: true });
      }
      await client.query("SET LOCAL createrole_self_grant = ''");
      await client.query(renderedSql);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    await client.end();
  }
}
