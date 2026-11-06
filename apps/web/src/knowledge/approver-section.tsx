import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { knowledgeVersionsQuery, sessionQuery } from '../api.js';
import { textLinkClass } from '../forms/text-link.js';

/** The way to the activation screen, in the settings of an approver only (spec 0007, R7). */
export function ApproverSection() {
  const { t } = useTranslation();
  const session = useQuery(sessionQuery);
  // Anyone else gets 403 not_approver, and the section stays hidden.
  const versions = useQuery({ ...knowledgeVersionsQuery, enabled: session.isSuccess });
  if (!versions.isSuccess) return null;
  return (
    <section aria-labelledby="approver-title" className="flex flex-col items-start gap-3">
      <h3 id="approver-title" className="text-title font-medium">
        {t('knowledge.settings.title')}
      </h3>
      <p className="text-muted">{t('knowledge.settings.intro')}</p>
      <Link to="/knowledge" className={textLinkClass}>
        {t('knowledge.settings.open')}
      </Link>
    </section>
  );
}
