import { isYear, numericDate } from './dates.js';

/**
 * Masking before a member's own text goes to a model (spec 0008, R2; ADR-0023). Known names become
 * placeholders, and anything shaped like a document, account or phone number, or an e-mail
 * address, is masked. Dates and years stay, since the draft needs them.
 */

export interface MaskedIntakeText {
  readonly masked: string;
  /**
   * The placeholders the masked text holds, and the writer's, each to its person's ID; it never
   * leaves the API.
   */
  readonly placeholders: ReadonlyMap<string, string>;
  /** The writer's placeholder, so the model can refer to them when the text says "eu". */
  readonly writer?: string;
}

export interface NamedPerson {
  readonly id: string;
  readonly displayName: string;
}

export const sharedNamePlaceholder = '[nome]';
export const numberPlaceholder = '[número]';
export const emailPlaceholder = '[e-mail]';

const particles: ReadonlySet<string> = new Set([
  'de',
  'da',
  'do',
  'dos',
  'das',
  'di',
  'del',
  'la',
  'le',
  'van',
  'von',
  'der',
]);

const wordPattern = /[\p{L}\p{M}]+/gu;

const alphanumeric = /[\p{L}\p{N}]/u;

/**
 * Each whitespace-separated token with an `@` between a letter or digit on each side, stripped of
 * the punctuation around it, is an e-mail address. Token by token, so the cost stays linear.
 */
function maskEmails(text: string): string {
  return text.replace(/\S+/gu, (token) => {
    if (!token.includes('@')) return token;
    let start = 0;
    let end = token.length;
    while (start < end && !alphanumeric.test(token.charAt(start))) start += 1;
    while (end > start && !alphanumeric.test(token.charAt(end - 1))) end -= 1;
    const core = token.slice(start, end);
    return /[\p{L}\p{N}]@[\p{L}\p{N}]/u.test(core)
      ? `${token.slice(0, start)}${emailPlaceholder}${token.slice(end)}`
      : token;
  });
}

/** Letters and digits that hold both, six or more: a passport, a codice fiscale, an IBAN. */
const maskMixedTokens = (text: string): string =>
  text.replace(/[\p{L}\p{N}]+/gu, (token) =>
    token.length >= 6 && /\p{L}/u.test(token) && /\p{N}/u.test(token) ? numberPlaceholder : token,
  );

/** Digits, with spaces, or one dash, dot, comma or slash amid spaces, between them. */
const digitRunPattern =
  /(?<!\p{Nd})\+?\p{Nd}(?:(?:\p{Zs}*[\p{Pd}.,/]\p{Zs}*|\p{Zs}{1,3})?\p{Nd})*/gu;

const separatorPattern = /(\p{Zs}*[\p{Pd}.,/]\p{Zs}*|\p{Zs}+)/u;
const soft = (separator: string) => /[\p{Zs},]/u.test(separator);

const isDateOrYear = (segment: string) => numericDate(segment) !== undefined || isYear(segment);

const digitCount = (segment: string) => (segment.match(/\p{Nd}/gu) ?? []).length;

/**
 * Whether a soft separator ends a date or a year: when it holds a comma, or when the number on the
 * other side is a count or an age (two digits at most) or a full date. So "2005, 2 filhos" and
 * "1985 - 3 filhos" keep their years, while a phone such as "3456 2010" stays one number.
 */
function endsDate(before: string, after: string, separator: string): boolean {
  const ends = (date: string, other: string) =>
    isDateOrYear(date) &&
    (separator.includes(',') || digitCount(other) <= 2 || numericDate(other) !== undefined);
  return ends(before, after) || ends(after, before);
}

/**
 * A piece stays when it is a real date, years joined by slashes ("2014/2019") or under five
 * digits; any other piece, such as a CPF, an account or a phone number, is masked.
 */
function maskPiece(piece: string): string {
  const groups = piece.match(/\p{Nd}+/gu) ?? [];
  if (groups.join('').length < 5) return piece;
  if (numericDate(piece) !== undefined) return piece;
  if (/^\p{Nd}{4}(?:\/\p{Nd}{4})+$/u.test(piece) && groups.every(isYear)) return piece;
  return numberPlaceholder;
}

interface Piece {
  text: string;
  last: string;
}

/**
 * A run is cut where a soft separator ends a date or a year, and each piece is then judged on its
 * own.
 */
function maskDigitRun(run: string): string {
  const [first = '', ...rest] = run.split(new RegExp(separatorPattern.source, 'gu'));
  const segments = [first];
  const softSeparators: string[] = [];
  for (let index = 0; index < rest.length; index += 2) {
    const separator = rest[index] ?? '';
    const digits = rest[index + 1] ?? '';
    if (soft(separator)) {
      softSeparators.push(separator);
      segments.push(digits);
    } else {
      segments.push(`${segments.pop() ?? ''}${separator}${digits}`);
    }
  }
  let current: Piece = { text: segments[0] ?? '', last: segments[0] ?? '' };
  const pieces: Piece[] = [current];
  const between: string[] = [];
  segments.slice(1).forEach((segment, index) => {
    const separator = softSeparators[index] ?? '';
    if (endsDate(current.last, segment, separator)) {
      between.push(separator);
      current = { text: segment, last: segment };
      pieces.push(current);
    } else {
      current.text += separator + segment;
      current.last = segment;
    }
  });
  return pieces.map(({ text }, index) => maskPiece(text) + (between[index] ?? '')).join('');
}

const foldedLetters: Readonly<Record<string, string>> = {
  ł: 'l',
  ø: 'o',
  ß: 'ss',
  đ: 'd',
  æ: 'ae',
  œ: 'oe',
};

const fold = (word: string): string =>
  word
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[łøßđæœ]/gu, (letter) => foldedLetters[letter] ?? letter);

const nameWords = (displayName: string): string[] =>
  (displayName.match(wordPattern) ?? []).map(fold);

interface Candidate {
  readonly words: readonly string[];
  readonly people: ReadonlySet<string>;
}

/** Each full display name, then each word of it worth matching, longest first. */
function nameCandidates(people: readonly NamedPerson[]): Candidate[] {
  const byKey = new Map<string, { words: string[]; people: Set<string> }>();
  const add = (words: string[], id: string) => {
    if (words.length === 0) return;
    const key = words.join(' ');
    const found = byKey.get(key) ?? { words, people: new Set<string>() };
    found.people.add(id);
    byKey.set(key, found);
  };
  for (const { id, displayName } of people) {
    const words = nameWords(displayName);
    add(words, id);
    for (const word of words) {
      if (word.length >= 2 && !particles.has(word)) add([word], id);
    }
  }
  return [...byKey.values()].sort((a, b) => b.words.length - a.words.length);
}

interface Word {
  readonly folded: string;
  readonly start: number;
  readonly end: number;
}

function maskNames(
  text: string,
  people: readonly NamedPerson[],
  placeholderOf: (id: string) => string,
): string {
  const candidates = nameCandidates(people);
  const words: Word[] = [...text.matchAll(wordPattern)].map((match) => ({
    folded: fold(match[0]),
    start: match.index,
    end: match.index + match[0].length,
  }));
  const joinedBySpace = (from: number, count: number) =>
    words
      .slice(from, from + count - 1)
      .every((word, offset) =>
        /^\s+$/u.test(text.slice(word.end, words[from + offset + 1]?.start)),
      );
  let out = '';
  let cursor = 0;
  let index = 0;
  while (index < words.length) {
    const match = candidates.find(
      (candidate) =>
        candidate.words.every((word, offset) => words[index + offset]?.folded === word) &&
        joinedBySpace(index, candidate.words.length),
    );
    if (match === undefined) {
      index += 1;
      continue;
    }
    const first = words[index];
    const last = words[index + match.words.length - 1];
    if (first === undefined || last === undefined) break;
    const [only, ...others] = [...match.people];
    out +=
      text.slice(cursor, first.start) +
      (only !== undefined && others.length === 0 ? placeholderOf(only) : sharedNamePlaceholder);
    cursor = last.end;
    index += match.words.length;
  }
  return out + text.slice(cursor);
}

/**
 * The text with known names, e-mail addresses and number-shaped tokens masked. People get
 * placeholders `[P1]`, `[P2]` … in the order given; a name word several people share, usually a
 * surname, becomes `[nome]`. Matching is by whole words, ignoring case and accents. The writer, when
 * given, keeps their placeholder even when the text does not name them.
 */
export function maskIntakeText(
  text: string,
  people: readonly NamedPerson[],
  writerId?: string,
): MaskedIntakeText {
  const placeholders = new Map(people.map(({ id }, index) => [id, `[P${String(index + 1)}]`]));
  const placeholderOf = (id: string) => placeholders.get(id) ?? sharedNamePlaceholder;
  // NFKC turns full-width digits and non-breaking spaces into the plain ones the patterns read;
  // brackets the member typed become parentheses, so the text cannot fake a placeholder.
  const plain = text.normalize('NFKC').replace(/\[/gu, '(').replace(/\]/gu, ')');
  const withoutEmails = maskEmails(plain);
  const withoutNames = maskNames(withoutEmails, people, placeholderOf);
  const masked = maskMixedTokens(withoutNames).replace(digitRunPattern, maskDigitRun);
  const used = new Map<string, string>();
  for (const [id, placeholder] of placeholders) {
    if (id === writerId || masked.includes(placeholder)) used.set(placeholder, id);
  }
  const writer = writerId === undefined ? undefined : placeholders.get(writerId);
  return { masked, placeholders: used, ...(writer === undefined ? {} : { writer }) };
}
