import { ChoiceGroup } from '@arca/ui';
import { useTranslation } from 'react-i18next';

export type Membership = 'member' | 'relative';

/** Whether a person is part of the plan or only a relative (spec 0007, R2). */
export function MembershipChoice({
  value,
  onChange,
}: {
  readonly value: Membership;
  readonly onChange: (value: Membership) => void;
}) {
  const { t } = useTranslation();
  return (
    <ChoiceGroup<Membership>
      legend={t('family.membership.legend')}
      description={t('family.membership.hint')}
      choices={[
        { value: 'member', label: t('family.membership.member') },
        { value: 'relative', label: t('family.membership.relative') },
      ]}
      value={value}
      onChange={onChange}
    />
  );
}
