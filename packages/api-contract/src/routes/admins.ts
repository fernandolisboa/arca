import { z } from 'zod';
import type { RouteDefinition } from './index.js';

/*
 * The admin role (ADR-0027), shown and changed from the family area. Only an admin may use these
 * routes (403 not_admin). An admin gives the role to a confirmed account in their own case and
 * takes it away the same way; any other account, unknown or outside the case, is 404 not_found
 * alike, so a refusal says nothing about accounts the admin does not share a case with.
 */

/** One admin among the case's members: `owner` when the owner list names them, so never removable. */
export const CaseAdmin = z.object({ accountId: z.uuid(), owner: z.boolean() });
export type CaseAdmin = z.infer<typeof CaseAdmin>;

export const CaseAdmins = z.object({ admins: z.array(CaseAdmin) });
export type CaseAdmins = z.infer<typeof CaseAdmins>;

export const listCaseAdmins = {
  method: 'get',
  path: '/admins',
  operationId: 'listCaseAdmins',
  summary:
    "Which members of the admin's case are admins, and which of them the owner list names; 403 not_admin, 404 not_found outside a case",
  response: { description: 'The case members who are admins', schema: CaseAdmins },
} as const satisfies RouteDefinition<typeof CaseAdmins>;

export const AdminChangeRequest = z.strictObject({ accountId: z.uuid() });
export type AdminChangeRequest = z.infer<typeof AdminChangeRequest>;

export const AdminChangeResponse = z.object({});

export const grantAdmin = {
  method: 'post',
  path: '/admins/grant',
  operationId: 'grantAdmin',
  summary:
    "Gives the admin role to a confirmed member of the admin's case; needs a consumed admin_grant step-up of grantAdmin with the account as its target; an account that already is an admin is left as it is. 403 not_admin or step_up_required, 404 not_found",
  body: AdminChangeRequest,
  response: { description: 'The account is an admin', schema: AdminChangeResponse },
} as const satisfies RouteDefinition<typeof AdminChangeResponse>;

/** The step-up action of giving the role: bound to the grantee's account (ADR-0027). */
export const grantAdminAction = ({ accountId }: AdminChangeRequest) => ({
  action: grantAdmin.operationId,
  targets: [accountId],
});

export const removeAdmin = {
  method: 'post',
  path: '/admins/remove',
  operationId: 'removeAdmin',
  summary:
    "Takes the admin role away from a member of the admin's case, with no step-up; an account that is not an admin is left as it is. 403 not_admin, 404 not_found, 409 owner_list_admin for an account the owner list names",
  body: AdminChangeRequest,
  response: { description: 'The account is not an admin', schema: AdminChangeResponse },
} as const satisfies RouteDefinition<typeof AdminChangeResponse>;

export const adminRoutes = { listCaseAdmins, grantAdmin, removeAdmin } as const;
