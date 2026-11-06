// First, so it runs before the route schemas are built.
import './jitless.js';
import type { z } from 'zod';
import { apiBasePath, ErrorResponse, type RouteDefinition } from '../routes/index.js';

export {
  addCaseMemberAction,
  apiBasePath,
  answerCanBeUnknown,
  choiceSets,
  currencyCodes,
  languageCodes,
  questionFlow,
  questionSteps,
  apiPathSegments,
  deleteDocumentsAction,
  deletionWaitDays,
  documentQuota,
  handOverCasePersonAction,
  inviteLifetimeHours,
  leaveCaseAction,
  maxCaseMembers,
  maxCasePeople,
  maxDocumentBatch,
  maxDocumentBytes,
  maxSharingStateBytes,
  maxOpenInvites,
  maxPushChannels,
  pendingPasskeyHours,
  recoveryLinkMinutes,
  replaceDocumentsAction,
  routes,
  stepUpNonceHeader,
  webPathSegments,
} from '../routes/index.js';
export type {
  AccountLink,
  AddCaseMemberRequest,
  AnswerCaseQuestionsRequest,
  AuditEvent,
  AuditEventCode,
  AuditEventsQuery,
  AuditEventsResponse,
  CasePerson,
  CaseQuestions,
  CaseRelationship,
  ChoiceSet,
  FieldInput,
  Question,
  QuestionField,
  QuestionId,
  QuestionInput,
  QuestionStep,
  CaseView,
  DataExport,
  DeviceDescription,
  DevicePasskey,
  DeviceSession,
  DevicesResponse,
  DocumentUpload,
  HealthResponse,
  Invite,
  InviteDetails,
  NotificationChannel,
  NotificationChannelsResponse,
  PasskeyAssertion,
  PasskeyAttestation,
  PasskeyCreationOptions,
  PasskeyRequestOptions,
  RecoveryKitStatus,
  SessionResponse,
  StepUpAction,
  StepUpOptionsRequest,
  StepUpPurpose,
  SharingStateChange,
  SignOutResponse,
  StoredSharingState,
  VaultDocument,
  VaultEnvelopesResponse,
} from '../routes/index.js';

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  /** Origin of the API: empty for the web build (same origin), absolute for native builds. */
  readonly origin: string;
  readonly fetch?: Fetch;
  /** Sent with every request, besides the client's own. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** The API answered with an error status; `code` comes from its `{ error: { code } }` body. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`API error ${String(status)}: ${code}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** The response did not match the contract, so client and server have drifted apart. */
export class ContractViolationError extends Error {
  readonly operationId: string;

  constructor(operationId: string) {
    super(`Response for ${operationId} does not match the API contract`);
    this.name = 'ContractViolationError';
    this.operationId = operationId;
  }
}

/** The body a route takes, as a caller writes it. */
export type RouteBody<Route extends RouteDefinition> = Route['body'] extends z.ZodType
  ? z.input<Route['body']>
  : never;

/** The body a route takes, when it takes one, or else its optional query parameters. */
type InputOf<Route extends RouteDefinition> = Route['body'] extends z.ZodType
  ? [body: z.input<Route['body']>]
  : Route['query'] extends z.ZodObject
    ? [query?: z.input<Route['query']>]
    : [];

function queryString(route: RouteDefinition, input: unknown): string {
  if (route.query === undefined || input === undefined) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(route.query.parse(input))) {
    if (typeof value === 'string' || typeof value === 'number') search.set(key, String(value));
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

export interface ApiClient {
  call<Route extends RouteDefinition>(
    route: Route,
    ...input: InputOf<Route>
  ): Promise<z.infer<Route['response']['schema']>>;
  /** The same client sending these headers too, such as a guarded route's step-up nonce. */
  withHeaders(headers: Readonly<Record<string, string>>): ApiClient;
}

export function createApiClient({
  origin,
  fetch = globalThis.fetch,
  headers: extra = {},
}: ApiClientOptions): ApiClient {
  return {
    withHeaders: (headers) => createApiClient({ origin, fetch, headers: { ...extra, ...headers } }),
    async call<Route extends RouteDefinition>(
      route: Route,
      ...[input]: InputOf<Route>
    ): Promise<z.infer<Route['response']['schema']>> {
      const response = await fetch(
        `${origin}${apiBasePath}${route.path}${queryString(route, input)}`,
        {
          method: route.method.toUpperCase(),
          headers: {
            ...extra,
            accept: 'application/json',
            ...(route.body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          ...(route.body === undefined ? {} : { body: JSON.stringify(route.body.parse(input)) }),
        },
      );
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        const parsed = ErrorResponse.safeParse(body);
        throw new ApiError(response.status, parsed.success ? parsed.data.error.code : 'unknown');
      }
      const parsed = route.response.schema.safeParse(body);
      if (!parsed.success) throw new ContractViolationError(route.operationId);
      return parsed.data as z.infer<Route['response']['schema']>;
    },
  };
}
