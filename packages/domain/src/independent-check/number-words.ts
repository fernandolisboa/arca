/**
 * Whole numbers from 2 to 99 a law writes in words ("quatro meses", "twenty-one", "dieciocho",
 * 五年), for the value check of a quote (ADR-0027). A word reads as a number only in the languages
 * a page is likely written in, the country's main language and English, so a word that is a
 * number in one language and something else in another ("dos", "sei") never states a value by
 * accident, and a number word that is also an English word ("due", "once") is not read at all. 1
 * is never read alone, since its words are also articles and pronouns, nor are ordinals, which also
 * name paragraphs, weekdays and rooms, except an English one before "anniversary"
 * (`writesAnniversary`). A number is read only as a whole run of number words, never
 * as part of a larger one. A language with no table here fails closed: its words state nothing
 * and the item stays could not be checked, as before.
 */

/** The largest number read from words: the ages, durations and counts laws write in words. */
const maxSpelled = 99;

interface Spelling {
  /** 0 to 19, each with its variants. */
  readonly units: readonly (readonly string[])[];
  /** 20, 30, ... 90, each with its variants. */
  readonly tens: readonly (readonly string[])[];
  /** The ways a ten and a unit join, from the ten's and the unit's words. */
  readonly join: (ten: string, unit: string, tenValue: number, unitValue: number) => string[];
  /**
   * How a unit is written after a ten where it differs from, or is left out of, `units`: 1, which
   * alone is also an article (twenty-one), and Italian 2, which alone is an English word (ventidue).
   */
  readonly compoundUnits: Readonly<Partial<Record<number, readonly string[]>>>;
}

const english: Spelling = {
  units: [
    ['zero'],
    // One is also a pronoun ("one of"), so no language reads 1 from words.
    [],
    ['two'],
    ['three'],
    ['four'],
    ['five'],
    ['six'],
    ['seven'],
    ['eight'],
    ['nine'],
    ['ten'],
    ['eleven'],
    ['twelve'],
    ['thirteen'],
    ['fourteen'],
    ['fifteen'],
    ['sixteen'],
    ['seventeen'],
    ['eighteen'],
    ['nineteen'],
  ],
  tens: [
    ['twenty'],
    ['thirty'],
    ['forty'],
    ['fifty'],
    ['sixty'],
    ['seventy'],
    ['eighty'],
    ['ninety'],
  ],
  join: (ten, unit) => [`${ten}-${unit}`, `${ten} ${unit}`],
  compoundUnits: { 1: ['one'] },
};

const portuguese: Spelling = {
  units: [
    ['zero'],
    [],
    ['dois', 'duas'],
    ['três'],
    ['quatro'],
    ['cinco'],
    ['seis'],
    ['sete'],
    ['oito'],
    ['nove'],
    ['dez'],
    ['onze'],
    ['doze'],
    ['treze'],
    ['catorze', 'quatorze'],
    ['quinze'],
    ['dezasseis', 'dezesseis'],
    ['dezassete', 'dezessete'],
    ['dezoito'],
    ['dezanove', 'dezenove'],
  ],
  tens: [
    ['vinte'],
    ['trinta'],
    ['quarenta'],
    ['cinquenta', 'cinqüenta'],
    ['sessenta'],
    ['setenta'],
    ['oitenta'],
    ['noventa'],
  ],
  join: (ten, unit) => [`${ten} e ${unit}`],
  compoundUnits: { 1: ['um', 'uma'] },
};

const spanishTwenties = [
  ['veintiuno', 'veintiún', 'veintiuna'],
  ['veintidós'],
  ['veintitrés'],
  ['veinticuatro'],
  ['veinticinco'],
  ['veintiséis'],
  ['veintisiete'],
  ['veintiocho'],
  ['veintinueve'],
];

const spanish: Spelling = {
  units: [
    ['cero'],
    [],
    ['dos'],
    ['tres'],
    ['cuatro'],
    ['cinco'],
    ['seis'],
    ['siete'],
    ['ocho'],
    ['nueve'],
    ['diez'],
    // "once" is also an English word, and English is read too.
    [],
    ['doce'],
    ['trece'],
    ['catorce'],
    ['quince'],
    ['dieciséis'],
    ['diecisiete'],
    ['dieciocho'],
    ['diecinueve'],
  ],
  tens: [
    ['veinte'],
    ['treinta'],
    ['cuarenta'],
    ['cincuenta'],
    ['sesenta'],
    ['setenta'],
    ['ochenta'],
    ['noventa'],
  ],
  join: (ten, unit, tenValue, unitValue) =>
    tenValue === 20 ? [...(spanishTwenties[unitValue - 1] ?? [])] : [`${ten} y ${unit}`],
  compoundUnits: { 1: ['uno', 'un', 'una'] },
};

const italian: Spelling = {
  units: [
    ['zero'],
    [],
    // "due" is also an English word, and English is read too; ventidue is read.
    [],
    ['tre'],
    ['quattro'],
    ['cinque'],
    ['sei'],
    ['sette'],
    ['otto'],
    ['nove'],
    ['dieci'],
    ['undici'],
    ['dodici'],
    ['tredici'],
    ['quattordici'],
    ['quindici'],
    ['sedici'],
    ['diciassette'],
    ['diciotto'],
    ['diciannove'],
  ],
  tens: [
    ['venti'],
    ['trenta'],
    ['quaranta'],
    ['cinquanta'],
    ['sessanta'],
    ['settanta'],
    ['ottanta'],
    ['novanta'],
  ],
  // The ten drops its last vowel before "uno" and "otto"; a final "tre" takes an accent.
  join: (ten, unit, _tenValue, unitValue) => {
    const head = unitValue === 1 || unitValue === 8 ? ten.slice(0, -1) : ten;
    return unitValue === 3 ? [`${head}tré`, `${head}tre`] : [`${head}${unit}`];
  },
  compoundUnits: { 1: ['uno'], 2: ['due'] },
};

const spellings: Readonly<Record<string, Spelling>> = {
  en: english,
  es: spanish,
  it: italian,
  pt: portuguese,
};

/** Every way a language writes `value` in words, each as its words joined by single spaces. */
function wordsFor(spelling: Spelling, value: number): string[] {
  const tenValue = Math.floor(value / 10) * 10;
  const unitValue = value % 10;
  const tens = spelling.tens[tenValue / 10 - 2] ?? [];
  const words =
    value < 20
      ? (spelling.units[value] ?? [])
      : unitValue === 0
        ? tens
        : tens.flatMap((ten) =>
            (spelling.compoundUnits[unitValue] ?? spelling.units[unitValue] ?? []).flatMap((unit) =>
              spelling.join(ten, unit, tenValue, unitValue),
            ),
          );
  return words.map(spaced);
}

const spaced = (words: string) => words.split(/[\s\-\u2010\u2011\u2013]+/u).join(' ');

/** Words that join the parts of a number: "vinte e um", "treinta y seis", "one hundred and two". */
const joiners = new Set(['and', 'e', 'y']);

/**
 * Words that make a number larger than any read here: hundreds, thousands, millions, in the
 * languages with tables, so "cinco mil" or "three hundred" never reads as its first word.
 */
const multiplier =
  /^(?:\p{L}*(?:cent|cient|zent|nhent)\p{L}*|hundreds?|thousands?|millions?|billions?|mil|mila|mille|milhão|milhões|millón|millones|milione|milioni|miliardo|miliardi)$/u;

/** Every word any number of the language is written with. */
const vocabularies = new Map<Spelling, ReadonlySet<string>>();
function vocabulary(spelling: Spelling): ReadonlySet<string> {
  let words = vocabularies.get(spelling);
  if (words === undefined) {
    words = new Set(
      Array.from({ length: maxSpelled + 1 }, (_, value) => wordsFor(spelling, value))
        .flat()
        .flatMap((phrase) => phrase.split(' ')),
    );
    vocabularies.set(spelling, words);
  }
  return words;
}

/**
 * The runs of number words in a text, each as its words joined by single spaces: words of the
 * language, joiners and multipliers, one after another with only spaces or hyphens between them.
 * A run read whole is one number, so "twenty-one" never states twenty, nor "cinco mil" five. A
 * run ending in a joiner ("dois e meio") states nothing.
 */
function numberRuns(text: string, words: ReadonlySet<string>): string[] {
  const runs: string[] = [];
  let run: string[] = [];
  const close = () => {
    while (run.length > 0 && joiners.has(run[0] ?? '')) run.shift();
    if (run.length > 0 && !joiners.has(run.at(-1) ?? '')) runs.push(run.join(' '));
    run = [];
  };
  for (const [piece] of text.matchAll(/[\p{L}\p{M}]+|[^\p{L}\p{M}]+/gu)) {
    if (/^[\s\-\u2010\u2011\u2013]+$/u.test(piece)) continue;
    const isWord = /^[\p{L}\p{M}]/u.test(piece);
    if (isWord && (words.has(piece) || joiners.has(piece) || multiplier.test(piece))) {
      run.push(piece);
      continue;
    }
    close();
  }
  close();
  return runs;
}

const kanjiDigits = new Map(
  ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'].map(
    (digit, value) => [digit, value] as const,
  ),
);
const kanjiUnits = new Map([
  ['十', 10],
  ['百', 100],
  ['千', 1_000],
]);
/**
 * A run of kanji numerals followed by a counter (years, months, days, age, people, times, weeks),
 * so a numeral inside a word, 一般 or 十分, states nothing.
 */
const kanjiRun =
  /(?<![第〇一二三四五六七八九十百千])([〇一二三四五六七八九十百千]+)(?=年|箇?月|か月|ヶ月|ケ月|日|歳|才|人|回|週)/gu;

/** A run of kanji numerals as its number: 十八 is 18, 二十一 is 21, 五 is 5. */
function kanjiNumber(run: string): number | undefined {
  let total = 0;
  let digit: number | undefined;
  for (const char of run) {
    const unit = kanjiUnits.get(char);
    if (unit === undefined) {
      if (digit !== undefined) return undefined;
      digit = kanjiDigits.get(char);
      continue;
    }
    total += (digit ?? 1) * unit;
    digit = undefined;
  }
  return total + (digit ?? 0);
}

/** Languages whose laws write numbers in kanji. */
const kanjiLanguages = new Set(['ja', 'zh']);

/**
 * The language a country's laws are most likely written in, from the Unicode CLDR likely-subtags
 * data the runtime carries, so a country added as data needs no change here.
 */
export function likelyLanguage(country: string): string | undefined {
  try {
    return new Intl.Locale(`und-${country}`).maximize().language;
  } catch {
    return undefined;
  }
}

/**
 * The languages a country's pages are read in for numbers in words: its likely language, and
 * English, which many official pages are also published in.
 */
export function pageLanguages(country: string): string[] {
  return [...new Set([likelyLanguage(country), 'en'].filter((language) => language !== undefined))];
}

/**
 * Whether the text writes the whole number `value` (a canonical decimal) as a whole run of words
 * of one of `languages`, or in kanji numerals when one of them writes numbers so. Case and composed accents
 * do not matter.
 */
export function writesNumberInWords(
  text: string,
  value: string,
  languages: readonly string[],
): boolean {
  if (!/^\d+$/u.test(value)) return false;
  const number = Number(value);
  if (number > maxSpelled) return false;
  const lower = text.normalize('NFC').toLowerCase();
  for (const language of languages) {
    if (kanjiLanguages.has(language)) {
      for (const [, run = ''] of text.matchAll(kanjiRun)) {
        if (kanjiNumber(run) === number) return true;
      }
    }
    const spelling = spellings[language];
    if (spelling === undefined) continue;
    const phrases = new Set(wordsFor(spelling, number));
    if (numberRuns(lower, vocabulary(spelling)).some((run) => phrases.has(run))) return true;
  }
  return false;
}

/** English ordinals a law writes before "anniversary", for the years a status lasts, from 2. */
const anniversaryOrdinals = [
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
];

const anniversary = /([\p{L}\p{N}]+[\s‐‑–—-]+)?([\p{L}]+)\s+anniversar(?:y|ies)\b/gu;

const kanjiNumeral = /[〇一二三四五六七八九十百千]/u;
const wordBefore = /([\p{L}\p{M}]+)[\s\-‐‑–]+$/u;
const wordAfter = /^[\s\-‐‑–]+([\p{L}\p{M}]+)/u;
const edgeWord = /^[\p{L}\p{M}]+|[\p{L}\p{M}]+$/gu;
/** Enough of the text beside a quote to hold the next word. */
const lookaround = 40;

/**
 * The bounds of `text.slice(start, end)` widened to the whole runs of number words, in
 * `languages`, or of kanji numerals, that its first and last words belong to, so a quote cut out
 * of a number ("dois meses" from "vinte e dois meses", 一年 from 二十一年) states the whole number.
 */
export function numberRunBounds(
  text: string,
  start: number,
  end: number,
  languages: readonly string[],
): { start: number; end: number } {
  const vocabularies = languages.flatMap((language) => {
    const spelling = spellings[language];
    return spelling === undefined ? [] : [vocabulary(spelling)];
  });
  const isNumberWord = (written: string) => {
    const word = written.normalize('NFC').toLowerCase();
    return (
      joiners.has(word) ||
      multiplier.test(word) ||
      vocabularies.some((words) => words.has(word)) ||
      (languages.includes('en') && anniversaryOrdinals.includes(word))
    );
  };
  const inKanjiRun = (at: number) =>
    kanjiNumeral.test(text[at - 1] ?? '') && kanjiNumeral.test(text[at] ?? '');
  const kanji = languages.some((language) => kanjiLanguages.has(language));
  let from = start;
  let to = end;
  while (kanji && from > 0 && inKanjiRun(from)) from -= 1;
  if (kanji && text[from - 1] === '第' && kanjiNumeral.test(text[from] ?? '')) from -= 1;
  while (kanji && to < text.length && inKanjiRun(to)) to += 1;
  const before = () => wordBefore.exec(text.slice(Math.max(0, from - lookaround), from));
  const after = () => wordAfter.exec(text.slice(to, to + lookaround));
  const [first = '', last = first] = text.slice(from, to).match(edgeWord) ?? [];
  if (isNumberWord(first)) {
    for (let word = before(); word !== null && isNumberWord(word[1] ?? ''); word = before()) {
      from -= word[0].length;
    }
  }
  if (isNumberWord(last)) {
    for (let word = after(); word !== null && isNumberWord(word[1] ?? ''); word = after()) {
      to += word[0].length;
    }
  }
  return { start: from, end: to };
}

/** Whether the word before an ordinal makes it part of a larger number ("twenty-second", "hundred and second"). */
function partOfLargerNumber(word: string): boolean {
  return (
    /^\d+$/u.test(word) ||
    joiners.has(word) ||
    multiplier.test(word) ||
    vocabulary(english).has(word)
  );
}

/**
 * Whether an English text writes the whole number `value` as the ordinal of an anniversary ("the
 * second anniversary" for 2 years), the way U.S. law dates a conditional status. Only this phrase
 * reads an ordinal, since ordinals alone also name paragraphs; one after a number word, a
 * multiplier or a joiner ("twenty-second", "hundred and second") states nothing. Cut-quote widening
 * spans these ordinals anywhere, which only fails closed.
 */
export function writesAnniversary(
  text: string,
  value: string,
  languages: readonly string[],
): boolean {
  if (!languages.includes('en') || !/^\d+$/u.test(value)) return false;
  const ordinal = anniversaryOrdinals[Number(value) - 2];
  if (ordinal === undefined) return false;
  for (const [, before = '', word = ''] of text
    .normalize('NFC')
    .toLowerCase()
    .matchAll(anniversary)) {
    const previous = before
      .trim()
      .replace(/[‐‑–—-]$/u, '')
      .trim();
    if (word === ordinal && !partOfLargerNumber(previous)) return true;
  }
  return false;
}
