import { SourceLine } from '@arca/ui';
import { useTranslation } from 'react-i18next';

interface ListedSource {
  readonly url: string;
  readonly title: string;
  readonly verifiedAt: string;
}

/**
 * The official pages an item of reviewed data rests on (ADR-0038, ADR-0040): each title, its host
 * as a link and the day it was read. `message` keeps the `{host}` and `{date}` placeholders.
 */
export function SourceList({
  sources,
  message,
}: {
  readonly sources: readonly ListedSource[];
  readonly message: string;
}) {
  const { i18n } = useTranslation();
  return (
    <ul className="flex flex-col gap-1 text-caption text-muted">
      {sources.map((source) => (
        <li key={source.url} className="flex flex-col">
          <span>{source.title}</span>
          <SourceLine
            href={source.url}
            verifiedOn={source.verifiedAt}
            locale={i18n.language}
            message={message}
          />
        </li>
      ))}
    </ul>
  );
}
