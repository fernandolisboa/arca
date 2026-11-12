import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { z } from 'zod';
import { apiBasePath, ErrorResponse, routes, type RouteDefinition } from '../routes/index.js';

/** Wraps a plain route definition for @hono/zod-openapi; the error shape is shared by every route. */
export function toOpenApiRoute<Schema extends z.ZodType>(route: RouteDefinition<Schema>) {
  return createRoute({
    method: route.method,
    path: route.path,
    operationId: route.operationId,
    summary: route.summary,
    request: {
      ...(route.body === undefined
        ? {}
        : { body: { required: true, content: { 'application/json': { schema: route.body } } } }),
      ...(route.query === undefined ? {} : { query: route.query }),
    },
    responses: {
      200: {
        description: route.response.description,
        content: {
          'application/json': { schema: route.response.schema },
        },
      },
      default: {
        description: 'Error',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
}

export const openApiRoutes = {
  health: toOpenApiRoute(routes.health),
  session: toOpenApiRoute(routes.session),
  signOut: toOpenApiRoute(routes.signOut),
  passkeySignInOptions: toOpenApiRoute(routes.passkeySignInOptions),
  passkeySignIn: toOpenApiRoute(routes.passkeySignIn),
  stepUpOptions: toOpenApiRoute(routes.stepUpOptions),
  stepUpVerify: toOpenApiRoute(routes.stepUpVerify),
  enrollOwner: toOpenApiRoute(routes.enrollOwner),
  registrationOptions: toOpenApiRoute(routes.registrationOptions),
  registrationVerify: toOpenApiRoute(routes.registrationVerify),
  recoveryKitStatus: toOpenApiRoute(routes.recoveryKitStatus),
  regenerateRecoveryKit: toOpenApiRoute(routes.regenerateRecoveryKit),
  confirmRecoveryKit: toOpenApiRoute(routes.confirmRecoveryKit),
  createInvite: toOpenApiRoute(routes.createInvite),
  listInvites: toOpenApiRoute(routes.listInvites),
  inviteDetails: toOpenApiRoute(routes.inviteDetails),
  confirmInvite: toOpenApiRoute(routes.confirmInvite),
  declineInvite: toOpenApiRoute(routes.declineInvite),
  listDevices: toOpenApiRoute(routes.listDevices),
  revokeSession: toOpenApiRoute(routes.revokeSession),
  revokePasskey: toOpenApiRoute(routes.revokePasskey),
  revokeOtherSessions: toOpenApiRoute(routes.revokeOtherSessions),
  addPasskeyOptions: toOpenApiRoute(routes.addPasskeyOptions),
  addPasskey: toOpenApiRoute(routes.addPasskey),
  recoveryStart: toOpenApiRoute(routes.recoveryStart),
  recoveryRedeem: toOpenApiRoute(routes.recoveryRedeem),
  recoveryOptions: toOpenApiRoute(routes.recoveryOptions),
  recoveryVerify: toOpenApiRoute(routes.recoveryVerify),
  auditEvents: toOpenApiRoute(routes.auditEvents),
  exportAccountData: toOpenApiRoute(routes.exportAccountData),
  requestAccountDeletion: toOpenApiRoute(routes.requestAccountDeletion),
  cancelAccountDeletion: toOpenApiRoute(routes.cancelAccountDeletion),
  vaultStatus: toOpenApiRoute(routes.vaultStatus),
  setUpVault: toOpenApiRoute(routes.setUpVault),
  vaultEnvelopes: toOpenApiRoute(routes.vaultEnvelopes),
  addVaultEnvelope: toOpenApiRoute(routes.addVaultEnvelope),
  rotateVaultIdentity: toOpenApiRoute(routes.rotateVaultIdentity),
  resealVaultRecovery: toOpenApiRoute(routes.resealVaultRecovery),
  resetVault: toOpenApiRoute(routes.resetVault),
  getSharingState: toOpenApiRoute(routes.getSharingState),
  storeSharingState: toOpenApiRoute(routes.storeSharingState),
  listAccountLinks: toOpenApiRoute(routes.listAccountLinks),
  notificationChannels: toOpenApiRoute(routes.notificationChannels),
  addPushChannel: toOpenApiRoute(routes.addPushChannel),
  removeNotificationChannel: toOpenApiRoute(routes.removeNotificationChannel),
  forgetPushChannel: toOpenApiRoute(routes.forgetPushChannel),
  createDocument: toOpenApiRoute(routes.createDocument),
  documentUploadUrl: toOpenApiRoute(routes.documentUploadUrl),
  confirmDocumentUpload: toOpenApiRoute(routes.confirmDocumentUpload),
  listDocuments: toOpenApiRoute(routes.listDocuments),
  documentDownloadUrl: toOpenApiRoute(routes.documentDownloadUrl),
  replaceDocuments: toOpenApiRoute(routes.replaceDocuments),
  confirmReplacements: toOpenApiRoute(routes.confirmReplacements),
  deleteDocuments: toOpenApiRoute(routes.deleteDocuments),
  getCase: toOpenApiRoute(routes.getCase),
  createCase: toOpenApiRoute(routes.createCase),
  addCasePerson: toOpenApiRoute(routes.addCasePerson),
  updateCasePerson: toOpenApiRoute(routes.updateCasePerson),
  removeCasePerson: toOpenApiRoute(routes.removeCasePerson),
  handOverCasePerson: toOpenApiRoute(routes.handOverCasePerson),
  addCaseMember: toOpenApiRoute(routes.addCaseMember),
  writeCaseProfile: toOpenApiRoute(routes.writeCaseProfile),
  writeCaseFinances: toOpenApiRoute(routes.writeCaseFinances),
  replaceCaseShares: toOpenApiRoute(routes.replaceCaseShares),
  addCaseRelationship: toOpenApiRoute(routes.addCaseRelationship),
  removeCaseRelationship: toOpenApiRoute(routes.removeCaseRelationship),
  addCaseAsset: toOpenApiRoute(routes.addCaseAsset),
  updateCaseAsset: toOpenApiRoute(routes.updateCaseAsset),
  removeCaseAsset: toOpenApiRoute(routes.removeCaseAsset),
  setCaseAssetOwner: toOpenApiRoute(routes.setCaseAssetOwner),
  confirmCaseAssetOwner: toOpenApiRoute(routes.confirmCaseAssetOwner),
  removeCaseAssetOwner: toOpenApiRoute(routes.removeCaseAssetOwner),
  getCaseQuestions: toOpenApiRoute(routes.getCaseQuestions),
  answerCaseQuestions: toOpenApiRoute(routes.answerCaseQuestions),
  getCasePlayback: toOpenApiRoute(routes.getCasePlayback),
  getCaseEvaluations: toOpenApiRoute(routes.getCaseEvaluations),
  reportRule: toOpenApiRoute(routes.reportRule),
  draftCaseIntake: toOpenApiRoute(routes.draftCaseIntake),
  leaveCase: toOpenApiRoute(routes.leaveCase),
  getComparison: toOpenApiRoute(routes.getComparison),
  writeComparisonPreferences: toOpenApiRoute(routes.writeComparisonPreferences),
  activateVersion: toOpenApiRoute(routes.activateVersion),
  rejectVersion: toOpenApiRoute(routes.rejectVersion),
  activateCheckedVersions: toOpenApiRoute(routes.activateCheckedVersions),
  activateComparison: toOpenApiRoute(routes.activateComparison),
  rejectComparison: toOpenApiRoute(routes.rejectComparison),
  listKnowledgeVersions: toOpenApiRoute(routes.listKnowledgeVersions),
  getVersionView: toOpenApiRoute(routes.getVersionView),
  getComparisonView: toOpenApiRoute(routes.getComparisonView),
  getVersionSummary: toOpenApiRoute(routes.getVersionSummary),
  summarizeVersion: toOpenApiRoute(routes.summarizeVersion),
  listRuleReports: toOpenApiRoute(routes.listRuleReports),
  closeRuleReports: toOpenApiRoute(routes.closeRuleReports),
  fileCorrectionRequest: toOpenApiRoute(routes.fileCorrectionRequest),
  listCorrectionRequests: toOpenApiRoute(routes.listCorrectionRequests),
  closeCorrectionRequest: toOpenApiRoute(routes.closeCorrectionRequest),
  startVersionChecks: toOpenApiRoute(routes.startVersionChecks),
  getVersionCheck: toOpenApiRoute(routes.getVersionCheck),
  startVersionCheck: toOpenApiRoute(routes.startVersionCheck),
  getVersionCheckProgress: toOpenApiRoute(routes.getVersionCheckProgress),
  listCaseAdmins: toOpenApiRoute(routes.listCaseAdmins),
  grantAdmin: toOpenApiRoute(routes.grantAdmin),
  removeAdmin: toOpenApiRoute(routes.removeAdmin),
} as const;

export const openApiInfo = { title: 'Arca API', version: '1.0.0' } as const;

export function buildOpenApiDocument(): ReturnType<OpenAPIHono['getOpenAPI31Document']> {
  const app = new OpenAPIHono();
  for (const route of Object.values(openApiRoutes)) app.openAPIRegistry.registerPath(route);
  return app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: openApiInfo,
    servers: [{ url: apiBasePath }],
  });
}

export function serializeOpenApiDocument(): string {
  return `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;
}
