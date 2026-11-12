/**
 * Whole numbers a law writes in words ("quatro meses", "twenty-one", "dieciocho", 五年), for the
 * value check of a quote (ADR-0027). A word reads as a number only in the languages a page is
 * likely written in, the country's main language and English, so a word that is a number in one
 * language and something else in another ("due", "dos", "sei") never states a value by accident.
 * A language with no table here fails closed: its words state nothing and the item stays
 * could not be checked, as before.
 */

/** The largest number read from words: ages, durations and counts in laws stay below it. */
const maxSpelled = 100;

interface Spelling {
  /** 0 to 19, each with its variants. */
  readonly units: readonly (readonly string[])[];
  /** 20, 30, ... 90, each with its variants. */
  readonly tens: readonly (readonly string[])[];
  /** The ways a ten and a unit join, from the ten's and the unit's words. */
  readonly join: (ten: string, unit: string, tenValue: number, unitValue: number) => string[];
  readonly hundred: readonly string[];
  /** 1st, 2nd, ... as words, by number, each with its variants. */
  readonly ordinals: ReadonlyMap<number, readonly string[]>;
}

const ordinals = (rows: readonly (readonly string[])[]) =>
  new Map(rows.map((words, index) => [index + 1, words]));

const english: Spelling = {
  units: [
    ['zero'],
    ['one'],
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
  hundred: ['one hundred', 'a hundred'],
  ordinals: ordinals([
    ['first'],
    ['second'],
    ['third'],
    ['fourth'],
    ['fifth'],
    ['sixth'],
    ['seventh'],
    ['eighth'],
    ['ninth'],
    ['tenth'],
  ]),
};

const portuguese: Spelling = {
  units: [
    ['zero'],
    ['um', 'uma'],
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
  hundred: ['cem'],
  ordinals: ordinals([
    ['primeiro', 'primeira'],
    // "segundo" also means "according to", so it never reads as an ordinal.
    [],
    ['terceiro', 'terceira'],
    ['quarto', 'quarta'],
    ['quinto', 'quinta'],
    ['sexto', 'sexta'],
    ['sétimo', 'sétima'],
    ['oitavo', 'oitava'],
    ['nono', 'nona'],
    ['décimo', 'décima'],
  ]),
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
    ['uno', 'una', 'un'],
    ['dos'],
    ['tres'],
    ['cuatro'],
    ['cinco'],
    ['seis'],
    ['siete'],
    ['ocho'],
    ['nueve'],
    ['diez'],
    ['once'],
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
  hundred: ['cien'],
  ordinals: ordinals([
    ['primero', 'primera', 'primer'],
    ['segundo', 'segunda'],
    ['tercero', 'tercera', 'tercer'],
    ['cuarto', 'cuarta'],
    ['quinto', 'quinta'],
    ['sexto', 'sexta'],
    ['séptimo', 'séptima'],
    ['octavo', 'octava'],
    ['noveno', 'novena'],
    ['décimo', 'décima'],
  ]),
};

const italian: Spelling = {
  units: [
    ['zero'],
    ['uno', 'una', 'un'],
    ['due'],
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
  hundred: ['cento'],
  ordinals: ordinals([
    ['primo', 'prima'],
    ['secondo', 'seconda'],
    ['terzo', 'terza'],
    ['quarto', 'quarta'],
    ['quinto', 'quinta'],
    ['sesto', 'sesta'],
    ['settimo', 'settima'],
    ['ottavo', 'ottava'],
    ['nono', 'nona'],
    ['decimo', 'decima'],
  ]),
};

const spellings: Readonly<Record<string, Spelling>> = {
  en: english,
  es: spanish,
  it: italian,
  pt: portuguese,
};

/** Every way a language writes `value` in words, cardinal or ordinal. */
function wordsFor(spelling: Spelling, value: number): string[] {
  if (value === maxSpelled) return [...spelling.hundred];
  const ordinal = spelling.ordinals.get(value) ?? [];
  if (value < 20) return [...(spelling.units[value] ?? []), ...ordinal];
  const tenValue = Math.floor(value / 10) * 10;
  const unitValue = value % 10;
  const tens = spelling.tens[tenValue / 10 - 2] ?? [];
  if (unitValue === 0) return [...tens, ...ordinal];
  const units = spelling.units[unitValue] ?? [];
  return tens.flatMap((ten) =>
    units.flatMap((unit) => spelling.join(ten, unit, tenValue, unitValue)),
  );
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
const kanjiRun = /[〇一二三四五六七八九十百千]+/gu;

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

const isWordChar = (char: string) => /[\p{L}\p{M}\p{Nd}]/u.test(char);

/** Whether `phrase` stands in `text` as words of its own, not inside a longer word. */
function standsIn(text: string, phrase: string): boolean {
  for (let at = text.indexOf(phrase); at !== -1; at = text.indexOf(phrase, at + 1)) {
    const before = text.charAt(at - 1);
    const after = text.charAt(at + phrase.length);
    if (!isWordChar(before) && !isWordChar(after)) return true;
  }
  return false;
}

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
 * Whether the text writes the whole number `value` (a canonical decimal) in words of one of
 * `languages`, or in kanji numerals when one of them writes numbers so. Case and composed accents
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
      for (const [run] of text.matchAll(kanjiRun)) {
        if (kanjiNumber(run) === number) return true;
      }
    }
    const spelling = spellings[language];
    if (spelling === undefined) continue;
    if (wordsFor(spelling, number).some((words) => standsIn(lower, words))) return true;
  }
  return false;
}
