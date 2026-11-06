import type { CaseQuestions } from '@arca/api-contract/routes';
import { type QuestionState, answerOf, questionFlow, questionSteps, relatedBy } from '@arca/domain';
import type { PinnedCountries } from '@arca/knowledge';
import type { CaseRows } from './view.js';

/** What the guided questions read of one person the viewer sees (spec 0007, R4). */
export function questionState(rows: CaseRows, personId: string): QuestionState {
  const profile = rows.profiles.find((row) => row.personId === personId);
  const finances = rows.finances.find((row) => row.personId === personId);
  return {
    facts: profile?.facts ?? {},
    dependsOn:
      profile?.dependenceAnswered === true
        ? rows.dependence.filter((row) => row.personId === personId).map((row) => row.dependsOnId)
        : null,
    finances:
      finances === undefined
        ? undefined
        : {
            ...(finances.incomes === undefined ? {} : { incomes: finances.incomes }),
            assetsRecordedInFull: finances.assetsRecordedInFull,
          },
    assets: rows.owners.flatMap((owner) => {
      if (owner.personId !== personId || !owner.confirmed) return [];
      const found = rows.assets.find(({ id }) => id === owner.assetId);
      if (found === undefined) return [];
      const { id, ...asset } = found;
      return [{ id, asset, share: owner.share }];
    }),
    relationships: rows.relationships.flatMap(({ id, ...relationship }) =>
      relationship.from === personId || relationship.to === personId ? [{ id, relationship }] : [],
    ),
  };
}

export function caseQuestions(rows: CaseRows, countries: PinnedCountries): CaseQuestions {
  return {
    people: rows.people
      .filter((person) => person.keptByMe)
      .map((person) => {
        const state = questionState(rows, person.id);
        return {
          personId: person.id,
          steps: questionSteps.map((step) => ({
            id: step,
            questions: questionFlow
              .filter((question) => question.step === step)
              .map((question) => {
                const answer = answerOf(question, state);
                return {
                  id: question.id,
                  ...(answer === undefined ? {} : { answer }),
                  ...(question.target.kind === 'marker'
                    ? { related: relatedBy(person.id, question.target.marker, state.relationships) }
                    : {}),
                };
              }),
          })),
        };
      }),
    countries: [...countries.countries],
    formerCountries: [...countries.formerCountries],
  };
}
