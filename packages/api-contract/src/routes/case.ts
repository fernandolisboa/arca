import {
  countryCodeSchema,
  displayNameSchema,
  maxCaseMembers,
  maxCasePeople,
  questionFlow,
  questionIds,
  questionSteps,
  shareScopeSchema,
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

export { maxCaseMembers, maxCasePeople };

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
  "Saves answers to the guided questions of a person the viewer keeps: facts, dependence, finances, the assets the person holds a confirmed share of (an asset left out loses the person's owner row) and their relationships' details; 409 case_invalid when an answer does not fit its question, 409 case_limit as for assets",
  AnswerCaseQuestionsRequest,
);

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
  answerCanBeUnknown,
  choiceSets,
  currencyCodes,
  languageCodes,
  questionFlow,
  questionSteps,
} from '@arca/domain';
