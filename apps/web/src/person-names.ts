const graphemes = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' });

function words(name: string) {
  return name.normalize('NFC').trim().split(/\s+/u).filter(Boolean);
}

function sameWord(a: string | undefined, b: string) {
  return a?.toLocaleLowerCase('pt-BR') === b.toLocaleLowerCase('pt-BR');
}

/** The first name, or first and last when one of the other names starts with the same word. */
export function shortName(name: string, otherNames: readonly string[]) {
  const [first = '', ...rest] = words(name);
  const shared = otherNames.some((other) => sameWord(words(other)[0], first));
  return shared && rest.length > 0 ? `${first} ${rest.at(-1) ?? ''}` : first;
}

/** The first letters of the first and last words of a name. */
export function initials(name: string) {
  const parts = words(name);
  const firstLetter = (word: string | undefined) => {
    for (const { segment } of graphemes.segment(word ?? '')) return segment;
    return '';
  };
  const letters = firstLetter(parts[0]) + (parts.length > 1 ? firstLetter(parts.at(-1)) : '');
  return letters.toLocaleUpperCase('pt-BR');
}
