import type { Sentence } from '@arca/api-contract/client';
import type { I18n } from '@arca/i18n';
import { percentFromShare } from './entry.js';
import { formatAmount, formatDateValue } from './format.js';

export interface SentenceWords {
  readonly t: I18n['t'];
  readonly language: string;
  readonly name: (id: string) => string;
  readonly country: (code: string) => string;
  readonly languageName: (code: string) => string;
}

/** Words a sentence through i18n, with the viewer's names for the people it is about. */
export function sentenceText(
  { t, language, name, country, languageName }: SentenceWords,
  said: Sentence,
): string {
  const date = (value: string) => formatDateValue(value, language);
  const list = (items: readonly string[]) =>
    new Intl.ListFormat(language, { type: 'conjunction' }).format(items);
  const when = (key: 'since' | 'until' | 'in' | 'startSince' | 'from' | 'sold', value?: string) =>
    value === undefined || value === 'none' ? '' : t(`playback.part.${key}`, { date: date(value) });
  switch (said.kind) {
    case 'profileHidden':
      return t('playback.sentence.profileHidden', { person: name(said.person) });
    case 'financesHidden':
      return t('playback.sentence.financesHidden', { person: name(said.person) });
    case 'noCitizenship':
      return t('playback.sentence.noCitizenship', { person: name(said.person) });
    case 'noLanguage':
      return t('playback.sentence.noLanguage', { person: name(said.person) });
    case 'noJobOffer':
      return t('playback.sentence.noJobOffer', { person: name(said.person) });
    case 'noImmigrationEvent':
      return t('playback.sentence.noImmigrationEvent', { person: name(said.person) });
    case 'noIncome':
      return t('playback.sentence.noIncome', { person: name(said.person) });
    case 'independent':
      return t('playback.sentence.independent', { person: name(said.person) });
    case 'unanswered':
      return t('playback.sentence.unanswered', {
        question:
          said.question === undefined
            ? ''
            : t(`questions.asked.${said.question}`, { name: name(said.person) }),
      });
    case 'born':
      return t('playback.sentence.born', {
        person: name(said.person),
        date: date(said.date),
        age:
          said.age === undefined
            ? ''
            : said.age.min === said.age.max
              ? t('playback.part.age', { min: said.age.min })
              : t('playback.part.ageRange', said.age),
      });
    case 'citizenship':
      return t('playback.sentence.citizenship', {
        person: name(said.person),
        country: country(said.country),
        details: [
          said.basis === undefined ? '' : t('playback.part.basis', { basis: said.basis }),
          when('since', said.acquired),
          when('until', said.lost),
        ].join(''),
      });
    case 'residence':
      return t('playback.sentence.residence', {
        person: name(said.person),
        country: country(said.country),
      });
    case 'education':
      return t('playback.sentence.education', {
        person: name(said.person),
        level: t('questions.choice.educationLevel', { value: String(said.level) }),
      });
    case 'studying':
      return t('playback.sentence.studying', {
        person: name(said.person),
        studying: said.studying ? 'yes' : 'no',
      });
    case 'language':
      return t('playback.sentence.language', {
        person: name(said.person),
        language: languageName(said.language),
        level: t('questions.choice.languageLevel', { value: said.level }),
      });
    case 'jobOffer':
      return t('playback.sentence.jobOffer', {
        person: name(said.person),
        country: country(said.country),
        sector: t('questions.choice.isicSection', { value: said.sector }),
        temporary: said.temporary ? t('playback.part.temporary') : '',
      });
    case 'immigrationEvent':
      return t('playback.sentence.immigrationEvent', {
        person: name(said.person),
        event: t('questions.choice.immigrationEvent', { value: said.event }),
        country: country(said.country),
        date: when('in', said.date),
      });
    case 'dependsOn':
      return t('playback.sentence.dependsOn', {
        person: name(said.person),
        people: list(said.on.map(name)),
      });
    case 'recordedInFull':
      return t('playback.sentence.recordedInFull', {
        person: name(said.person),
        marker: said.marker,
      });
    case 'income':
      return t('playback.sentence.income', {
        person: name(said.person),
        amount: formatAmount(said.monthly, language),
        income: said.income,
        country: country(said.sourceCountry),
      });
    case 'couple': {
      const ended = said.end !== undefined && said.end !== 'none';
      const people = {
        couple: said.couple,
        first: name(said.people[0]),
        second: name(said.people[1]),
      };
      return ended
        ? t('playback.sentence.coupleEnded', {
            ...people,
            start: when('from', said.start),
            end: date(said.end ?? ''),
          })
        : t('playback.sentence.couple', { ...people, start: when('startSince', said.start) });
    }
    case 'parent':
      return t('playback.sentence.parent', {
        parent: name(said.parent),
        child: name(said.child),
        since: when('startSince', said.start),
        details: [
          said.parentKind === undefined
            ? ''
            : t('playback.part.parentKind', { parentKind: said.parentKind }),
          said.custody === undefined
            ? ''
            : t('playback.part.custody', { custody: said.custody }) +
              when('startSince', said.custodyStart),
        ].join(''),
      });
    case 'asset':
      return t('playback.sentence.asset', {
        asset: t('questions.choice.assetKind', { value: said.asset }),
        owners: list(
          said.owners.map((owner) =>
            t('playback.part.owner', {
              person: name(owner.person),
              share: percentFromShare(owner.share),
            }),
          ),
        ),
        value: formatAmount(said.value, language),
        valuedAt: date(said.valuedAt),
        liquid:
          said.liquid === undefined
            ? ''
            : t('playback.part.liquid', { liquid: said.liquid ? 'yes' : 'no' }),
        sold: when('sold', said.sold),
      });
  }
}
