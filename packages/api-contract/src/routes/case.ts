import {
  calendarDateSchema,
  caseIntakeDraftSchema,
  countryCodeSchema,
  decimalSchema,
  durationSchema,
  routeIdSchema,
  slugSchema,
  sourceSchema,
  displayNameSchema,
  isNewReference,
  maxCaseMembers,
  maxCasePeople,
  questionFlow,
  questionIds,
  questionSteps,
  sentenceSchema,
  shareScopeSchema,
  startsInPlan,
  storedAssetSchema,
  storedFinancesSchema,
  storedOwnerShareSchema,
  storedProfileFactsSchema,
  storedRelationshipSchema,
} from '@arca/domain';
import { z } from 'zod';
import type { RouteDefinition } from './index.js';

/*
 * The family's case (spec 0007, R3). Every route needs a session and a confirmed account
 * (401 without a session, 403 account_unconfirmed); writes count against 300 per hour per
 * account (429 rate_limited) and answer the case as the viewer now sees it. A person, asset or
 * relationship the viewer may not write answers 404 not_found, the same as one that does not
 * exist; 409 case_limit says only that a limit is reached, never what a hidden row holds.
 */

export { isNewReference, maxCaseMembers, maxCasePeople, startsInPlan };

export const CaseProfile = z.strictObject({
  facts: storedProfileFactsSchema,
  /** The people this person depends on financially; null while that is unknown. */
  dependsOn: z.array(z.uuid()).max(20).nullable(),
});
export type CaseProfile = z.infer<typeof CaseProfile>;

const grantees = z.array(z.uuid()).max(maxCaseMembers);
export const CaseShares = z.strictObject({ profile: grantees, finances: grantees });
export type CaseShares = z.infer<typeof CaseShares>;

export const CasePerson = z.object({
  id: z.uuid(),
  displayName: displayNameSchema,
  /** A member of the case, whom results are for, or a relative outside it. */
  caseMember: z.boolean(),
  /** The person's own account; null for a person without one, such as a child. */
  accountId: z.uuid().nullable(),
  /** The viewer keeps this person, so writes their rows and decides who sees them. */
  keptByMe: z.boolean(),
  /** Null when not written yet, or not shared with the viewer. */
  profile: CaseProfile.nullable(),
  finances: storedFinancesSchema.nullable(),
  /** The members who see this person's profile and finances; only for people the viewer keeps. */
  shares: CaseShares.nullable(),
  /** What the keeper of a person the viewer does not keep shares with the viewer. */
  sharedWithMe: z.array(shareScopeSchema).max(2),
});
export type CasePerson = z.infer<typeof CasePerson>;

export const CaseRelationship = z.object({
  id: z.uuid(),
  /** The viewer keeps one of its two people, so may remove it. */
  editable: z.boolean(),
  relationship: storedRelationshipSchema,
});
export type CaseRelationship = z.infer<typeof CaseRelationship>;

export const CaseAssetOwner = z.object({
  personId: z.uuid(),
  share: storedOwnerShareSchema,
  /** A pending row waits for the person's keeper; results count confirmed rows only. */
  confirmed: z.boolean(),
});

export const CaseAsset = z.object({
  id: z.uuid(),
  /** The viewer keeps a confirmed owner, so may change or remove it and name co-owners. */
  editable: z.boolean(),
  asset: storedAssetSchema,
  /** The owner rows the viewer sees. */
  owners: z.array(CaseAssetOwner),
});
export type CaseAsset = z.infer<typeof CaseAsset>;

export const CaseView = z.object({
  caseId: z.uuid(),
  /** The viewer's own person. */
  me: z.uuid(),
  people: z.array(CasePerson),
  relationships: z.array(CaseRelationship),
  /** The assets with an owner row the viewer sees. */
  assets: z.array(CaseAsset),
});
export type CaseView = z.infer<typeof CaseView>;

/** The case as the viewer sees it; null before the account is in one. */
export const CaseResponse = z.object({ case: CaseView.nullable() });
export type CaseResponse = z.infer<typeof CaseResponse>;

const person = { personId: z.uuid() };
const owned = { assetId: z.uuid() };

export const CreateCaseRequest = z.strictObject({ displayName: displayNameSchema });
export const AddCasePersonRequest = z.strictObject({
  displayName: displayNameSchema,
  caseMember: z.boolean(),
});
export const UpdateCasePersonRequest = AddCasePersonRequest.extend(person);
export const CasePersonReference = z.strictObject(person);
export const HandOverCasePersonRequest = z.strictObject({ ...person, accountId: z.uuid() });
/** A new member: a new person with their name, or a person the viewer keeps who has no account. */
export const AddCaseMemberRequest = z.union([
  z.strictObject({ accountId: z.uuid(), displayName: displayNameSchema }),
  z.strictObject({ accountId: z.uuid(), ...person }),
]);
export const WriteCaseProfileRequest = CaseProfile.extend(person);
export const WriteCaseFinancesRequest = storedFinancesSchema.extend(person);
export const ReplaceCaseSharesRequest = CaseShares.extend(person);
export const CaseRelationshipReference = z.strictObject({ relationshipId: z.uuid() });
export const AddCaseAssetRequest = z.strictObject({
  ...person,
  share: storedOwnerShareSchema,
  asset: storedAssetSchema,
});
export const UpdateCaseAssetRequest = z.strictObject({ ...owned, asset: storedAssetSchema });
export const CaseAssetReference = z.strictObject(owned);
export const SetCaseAssetOwnerRequest = z.strictObject({
  ...owned,
  ...person,
  share: storedOwnerShareSchema,
});
export const CaseAssetOwnerReference = z.strictObject({ ...owned, ...person });

export type HandOverCasePersonRequest = z.infer<typeof HandOverCasePersonRequest>;
export type AddCaseMemberRequest = z.infer<typeof AddCaseMemberRequest>;

export const LeaveCaseResponse = z.object({});

/**
 * The guided questions of every person the viewer keeps (spec 0007, R4), in flow order, with each
 * one's answer while it has one. An answer has the stored shape, but for amounts, decimal strings
 * in the currency's units, and assets and relationships, which carry their IDs. The flow's
 * definitions are `questionFlow`.
 */
export const CaseQuestions = z.object({
  people: z.array(
    z.object({
      personId: z.uuid(),
      steps: z.array(
        z.object({
          id: z.enum(questionSteps),
          questions: z.array(
            z.object({
              id: z.enum(questionIds),
              answer: z.unknown().optional(),
              /** For a completeness question, the people it is about. */
              related: z.array(z.uuid()).optional(),
            }),
          ),
        }),
      ),
    }),
  ),
  /** The pinned countries, and the former states a citizenship may name. */
  countries: z.array(countryCodeSchema),
  formerCountries: z.array(countryCodeSchema),
});
export type CaseQuestions = z.infer<typeof CaseQuestions>;

/** One step's answers; null is "Não sei". */
export const AnswerCaseQuestionsRequest = z.strictObject({
  ...person,
  answers: z
    .array(z.strictObject({ questionId: z.enum(questionIds), answer: z.unknown() }))
    .min(1)
    .max(questionFlow.length),
});
export type AnswerCaseQuestionsRequest = z.infer<typeof AnswerCaseQuestionsRequest>;

const view = { description: 'The case as the viewer now sees it', schema: CaseResponse };
const write = <Path extends `/case${string}`, Body extends z.ZodType>(
  path: Path,
  operationId: string,
  summary: string,
  body: Body,
) =>
  ({
    method: 'post',
    path,
    operationId,
    summary,
    body,
    response: view,
  }) as const satisfies RouteDefinition<typeof CaseResponse>;

export const getCase = {
  method: 'get',
  path: '/case',
  operationId: 'getCase',
  summary: 'The case as the viewer sees it, or null before the account is in one',
  response: view,
} as const satisfies RouteDefinition<typeof CaseResponse>;

export const createCase = write(
  '/case',
  'createCase',
  'Creates a case with the account as its first member and its own person; 409 case_exists when the account is in a case',
  CreateCaseRequest,
);
export const addCasePerson = write(
  '/case/people',
  'addCasePerson',
  'Adds a person without an account, kept by the viewer; 404 not_found outside a case, 409 case_limit past 60 people or 30 members',
  AddCasePersonRequest,
);
export const updateCasePerson = write(
  '/case/people/update',
  'updateCasePerson',
  "Renames a person the viewer keeps, or says whether they are a member; a member's own person stays one; 409 case_limit past 30 members",
  UpdateCasePersonRequest,
);
export const removeCasePerson = write(
  '/case/people/remove',
  'removeCasePerson',
  'Deletes a person without an account the viewer keeps, with their rows, owner rows and relationships, and assets left without a confirmed owner',
  CasePersonReference,
);
export const handOverCasePerson = write(
  '/case/people/hand-over',
  'handOverCasePerson',
  "Makes another member keep a person without an account the viewer keeps, and drops the person's shares, after a sensitive_settings step-up whose targets are the person and the account; 403 step_up_required",
  HandOverCasePersonRequest,
);
export const addCaseMember = write(
  '/case/members',
  'addCaseMember',
  "Adds to the viewer's case an account a confirmed invite links to the viewer and that is in no case, as a new person or taking over a person the viewer keeps who has no account, whose shares are dropped; taking over needs a sensitive_settings step-up whose targets are the person and the account (403 step_up_required). An account already in the case answers the case unchanged; 409 case_exists in another case, 409 case_limit past 60 people or 30 members",
  AddCaseMemberRequest,
);
export const writeCaseProfile = write(
  '/case/people/profile',
  'writeCaseProfile',
  'Replaces the facts and the dependence of a person the viewer keeps; dependence names people of the case other than the person; 409 case_invalid otherwise',
  WriteCaseProfileRequest,
);
export const writeCaseFinances = write(
  '/case/people/finances',
  'writeCaseFinances',
  'Replaces the incomes, and whether the assets are recorded in full, of a person the viewer keeps',
  WriteCaseFinancesRequest,
);
export const replaceCaseShares = write(
  '/case/people/shares',
  'replaceCaseShares',
  "Replaces the members who see a person's profile and finances, for a person the viewer keeps; 409 case_invalid for an account that is not another member",
  ReplaceCaseSharesRequest,
);
export const addCaseRelationship = write(
  '/case/relationships',
  'addCaseRelationship',
  'Adds a relationship between two people of the case, one of whom the viewer keeps; 409 case_invalid for a parent cycle, a fifth parent, a fifth couple edge or an edge twice, 409 case_limit past 200',
  storedRelationshipSchema,
);
export const removeCaseRelationship = write(
  '/case/relationships/remove',
  'removeCaseRelationship',
  'Deletes a relationship one of whose people the viewer keeps',
  CaseRelationshipReference,
);
export const addCaseAsset = write(
  '/case/assets',
  'addCaseAsset',
  'Adds an asset with a confirmed owner row for a person the viewer keeps; 409 case_limit past 100 assets in the case',
  AddCaseAssetRequest,
);
export const updateCaseAsset = write(
  '/case/assets/update',
  'updateCaseAsset',
  'Replaces the fields of an asset one of whose confirmed owners the viewer keeps',
  UpdateCaseAssetRequest,
);
export const removeCaseAsset = write(
  '/case/assets/remove',
  'removeCaseAsset',
  'Deletes an asset one of whose confirmed owners the viewer keeps, with every owner row',
  CaseAssetReference,
);
export const setCaseAssetOwner = write(
  '/case/assets/owners',
  'setCaseAssetOwner',
  'Sets the share of a person the viewer keeps in an asset, or names a co-owner of an asset the viewer confirmed, whose row waits for its keeper; 409 case_limit when the shares, pending ones included, pass 1 or the asset has 12 owner rows',
  SetCaseAssetOwnerRequest,
);
export const confirmCaseAssetOwner = write(
  '/case/assets/owners/confirm',
  'confirmCaseAssetOwner',
  'Confirms the pending owner row of a person the viewer keeps',
  CaseAssetOwnerReference,
);
export const removeCaseAssetOwner = write(
  '/case/assets/owners/remove',
  'removeCaseAssetOwner',
  'Deletes, or declines, the owner row of a person the viewer keeps; an asset left without a confirmed owner goes with it',
  CaseAssetOwnerReference,
);

export const getCaseQuestions = {
  method: 'get',
  path: '/case/questions',
  operationId: 'getCaseQuestions',
  summary:
    'The guided questions of every person the viewer keeps, with their answers, and the countries they offer; 404 not_found outside a case',
  response: { description: 'The guided questions', schema: CaseQuestions },
} as const satisfies RouteDefinition<typeof CaseQuestions>;
export const answerCaseQuestions = write(
  '/case/questions/answers',
  'answerCaseQuestions',
  "Saves answers to the guided questions of a person the viewer keeps: facts, dependence, finances, the assets the person holds a confirmed share of (an asset the answer leaves out stays as it is; one sent as { id, dropped: true } loses the person's owner row) and their relationships' details; 409 case_invalid when an answer does not fit its question, 409 case_limit as for assets",
  AnswerCaseQuestionsRequest,
);

/**
 * The case read back as sentences (spec 0007, R5): each a kind with typed values and the case's
 * person IDs, worded by the client, and the question that sets it, asked of the first person in
 * `about` the viewer keeps.
 */
export const CasePlayback = z.object({ sentences: z.array(sentenceSchema) });
export type CasePlayback = z.infer<typeof CasePlayback>;

export const getCasePlayback = {
  method: 'get',
  path: '/case/playback',
  operationId: 'getCasePlayback',
  summary:
    'The case as the viewer sees it, read back as sentences; a profile or finances not shared with the viewer reads as not shared, never as unanswered; 60 per hour per session (429 rate_limited); 404 not_found outside a case',
  response: { description: 'The case read back', schema: CasePlayback },
} as const satisfies RouteDefinition<typeof CasePlayback>;

const truth = z.union([z.boolean(), z.literal('unknown')]);
const currency = z.string().regex(/^[A-Z]{3}$/);
const unitsMoney = z.object({ amount: decimalSchema, currency });
const sources = z.array(sourceSchema).max(50);
const people = z.array(z.uuid()).max(maxCasePeople);

/** One route for one principal, as `routeResult` in the domain lays it out (spec 0007, R6). */
export const RouteResult = z.object({
  routeId: routeIdSchema,
  principalId: z.uuid(),
  status: z.enum([
    'unavailable',
    'not_eligible',
    'missing_information',
    'needs_assessment',
    'eligible',
    'pending_activation',
  ]),
  /** The active version's title and country; null while no version is active. */
  route: z.object({ title: z.string().max(200), country: countryCodeSchema }).nullable(),
  version: z
    .object({ number: z.int().min(1), hash: z.string().regex(/^[0-9a-f]{64}$/) })
    .nullable(),
  stale: z.boolean(),
  newerProposedVersion: z.object({ number: z.int().min(1), from: calendarDateSchema }).nullable(),
  dependents: people,
  possibleDependents: people,
  unitOpen: z.boolean(),
  requirements: z
    .array(z.object({ id: z.string(), title: z.string(), result: truth, sources }))
    .max(50),
  assessments: z.array(z.object({ id: z.string(), title: z.string(), sources })).max(20),
  costs: z
    .array(
      z.object({
        costId: z.string(),
        title: z.string(),
        appliesTo: z.enum(['principal', 'each_dependent', 'unit']),
        personId: z.uuid().nullable(),
        applies: truth,
        min: unitsMoney.nullable(),
        max: unitsMoney.nullable(),
        sources,
      }),
    )
    // Up to 50 costs a version, each charged once per person at most.
    .max(50 * maxCasePeople),
  durations: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        min: durationSchema,
        max: durationSchema,
        sources,
      }),
    )
    .max(20),
  /** The sources of a closed version's closure, which the screen cites with "Rota encerrada". */
  closureSources: sources,
  /** Rates the exchange table lacks; no one in the family can answer them. */
  missingRates: z.array(z.object({ from: currency, to: currency })).max(50),
  /** Reference dates the version reads that the case does not set yet. */
  missingDates: z.array(z.string().max(96)).max(20),
});
export type RouteResult = z.infer<typeof RouteResult>;

export const CaseEvaluations = z.object({
  /** The date versions were selected and facts computed at: today in São Paulo. */
  rulesAsOf: calendarDateSchema,
  engineCommit: z.string().max(64),
  results: z.array(RouteResult),
  /** Only the questions that change an answer, the most decisive first. */
  questions: z.array(
    z.object({
      personId: z.uuid(),
      question: z.enum(questionIds),
      decides: z.int().min(1),
      kept: z.boolean(),
    }),
  ),
});
export type CaseEvaluations = z.infer<typeof CaseEvaluations>;

export const getCaseEvaluations = {
  method: 'get',
  path: '/case/evaluations',
  operationId: 'getCaseEvaluations',
  summary:
    'Every route evaluated for each member of the case as principal, from what the viewer sees, with only the questions that change an answer; nothing is stored; 60 per hour per session (429 rate_limited); 404 not_found outside a case',
  response: { description: 'The evaluations', schema: CaseEvaluations },
} as const satisfies RouteDefinition<typeof CaseEvaluations>;

/** Why a member thinks a requirement may be wrong (spec 0007, R8). */
export const ruleReportReasons = [
  'outdated',
  'wrong_amount',
  'wrong_condition',
  'source_mismatch',
  'other',
] as const;

export const ReportRuleRequest = z.strictObject({
  routeId: routeIdSchema,
  versionNumber: z.int().min(1).max(1_000_000),
  requirementId: slugSchema,
  reason: z.enum(ruleReportReasons),
  note: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .regex(/^\P{Cc}*$/u)
    .optional(),
});
export type ReportRuleRequest = z.infer<typeof ReportRuleRequest>;

export const reportRule = {
  method: 'post',
  path: '/case/rule-reports',
  operationId: 'reportRule',
  summary:
    "Reports a requirement of the viewer's own results as possibly wrong, with a reason and an optional note; 20 per account per day (429 rate_limited); 404 not_found when the viewer's evaluation holds no such requirement",
  body: ReportRuleRequest,
  response: { description: 'Reported', schema: z.object({}) },
} as const satisfies RouteDefinition;

export const leaveCase = {
  method: 'post',
  path: '/case/leave',
  operationId: 'leaveCase',
  summary:
    'Leaves the case after a sensitive_settings step-up with no target, deleting every person the account keeps with their rows, and the case with its last member; 403 step_up_required, 404 not_found outside a case',
  body: z.object({}),
  response: { description: 'Left', schema: LeaveCaseResponse },
} as const satisfies RouteDefinition<typeof LeaveCaseResponse>;

/** The step-up action of a hand-over: the person, then the new keeper. */
export function handOverCasePersonAction({ personId, accountId }: HandOverCasePersonRequest) {
  return { action: handOverCasePerson.operationId, targets: [personId, accountId] };
}

/** The step-up action of an account taking over a person, when it does: the person, then the account. */
export function addCaseMemberAction(request: AddCaseMemberRequest) {
  return 'personId' in request
    ? { action: addCaseMember.operationId, targets: [request.personId, request.accountId] }
    : undefined;
}

/** The step-up action of leaving the case. */
export const leaveCaseAction = { action: leaveCase.operationId, targets: [] };

/** The most a member may write for one draft (spec 0008, R3). */
export const maxIntakeTextLength = 4_000;

export const CaseIntakeDraftRequest = z.strictObject({
  text: z
    .string()
    .trim()
    .min(1)
    .max(maxIntakeTextLength)
    // Masking normalizes to NFKC, which can grow a text many times over (U+FDFA is 18 letters).
    .refine((text) => text.normalize('NFKC').length <= maxIntakeTextLength, {
      message: `At most ${String(maxIntakeTextLength)} characters`,
    }),
});
export type CaseIntakeDraftRequest = z.infer<typeof CaseIntakeDraftRequest>;

/**
 * A draft of guided answers from the member's own words, holding only what the case takes: the
 * facts a person lacks, the list entries and edges it adds, and the details a stored edge lacks.
 * Nothing is written (spec 0008, R3). A known person is named by their case ID, the writer by
 * their own person's, a new one as `n1`, `n2` …
 */
export const CaseIntakeDraftResponse = z.object({ draft: caseIntakeDraftSchema });
export type CaseIntakeDraftResponse = z.infer<typeof CaseIntakeDraftResponse>;

export const draftCaseIntake = {
  method: 'post',
  path: '/case/intake/draft',
  operationId: 'draftCaseIntake',
  summary:
    "Sends the member's own description, with known names and number-shaped data masked, to the extraction model and answers a draft of guided answers to review; nothing of the text is stored. 10 per account per day and 3 per minute (429 rate_limited); 404 not_found outside a case; 502 intake_unparsable or intake_failed; 503 intake_unavailable when no model can be reached; 504 intake_timeout",
  body: CaseIntakeDraftRequest,
  response: { description: 'The proposed draft', schema: CaseIntakeDraftResponse },
} as const satisfies RouteDefinition<typeof CaseIntakeDraftResponse>;

export const caseRoutes = {
  getCase,
  createCase,
  addCasePerson,
  updateCasePerson,
  removeCasePerson,
  handOverCasePerson,
  addCaseMember,
  writeCaseProfile,
  writeCaseFinances,
  replaceCaseShares,
  addCaseRelationship,
  removeCaseRelationship,
  addCaseAsset,
  updateCaseAsset,
  removeCaseAsset,
  setCaseAssetOwner,
  confirmCaseAssetOwner,
  removeCaseAssetOwner,
  getCaseQuestions,
  answerCaseQuestions,
  getCasePlayback,
  getCaseEvaluations,
  reportRule,
  draftCaseIntake,
  leaveCase,
} as const;

export {
  type ChoiceSet,
  type FieldInput,
  type Question,
  type QuestionField,
  type QuestionId,
  type QuestionInput,
  type QuestionStep,
  type Sentence,
  type SentenceKind,
  answerCanBeUnknown,
  choiceSets,
  currencyCodes,
  languageCodes,
  questionFlow,
  questionSteps,
} from '@arca/domain';
