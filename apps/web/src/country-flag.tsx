import { useState } from 'react';
import { flagUrl } from './flags.js';

const flagClass =
  'inline-block h-[0.85em] w-[1.14em] shrink-0 rounded-[2px] object-cover ring-1 ring-ink/20';

/**
 * A country's flag at the size of the text beside it. Decoration only: the country's name always
 * sits next to it, so it has no name of its own and leaves no gap when it cannot load.
 */
export function CountryFlag({
  code,
  className = '',
}: {
  readonly code: string;
  readonly className?: string;
}) {
  const src = flagUrl(code);
  const [failed, setFailed] = useState(false);
  if (src === undefined || failed) return null;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      className={`${flagClass} ${className}`}
      onError={() => {
        setFailed(true);
      }}
    />
  );
}

/** A country's flag before a line of text that starts with its name. */
export function FlagLead({ code }: { readonly code: string }) {
  return <CountryFlag code={code} className="mr-[0.45em] align-[-0.06em]" />;
}

/** The flag a country select shows inside its field; none while no country, or one without a flag, is chosen. */
export function selectFlag(code: string) {
  return flagUrl(code) === undefined ? undefined : <CountryFlag code={code} />;
}
