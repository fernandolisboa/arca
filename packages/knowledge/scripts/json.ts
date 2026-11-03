/** A JSON value in the accepted subset (spec 0002, R6). */
export type Json =
  null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export class JsonSubsetError extends Error {
  override readonly name = 'JsonSubsetError';
}

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * Parses a knowledge file strictly: UTF-8 with no byte order mark, RFC 8259 syntax, integers only
 * and within ±(2^53 - 1), strings and keys in NFC, well formed and free of control, format or
 * invisible characters, no duplicate keys, and nesting no deeper than `maxDepth`. Strings are
 * checked, never normalized, so the bytes hashed are the bytes reviewed.
 */
export function parseJsonSubset(bytes: Uint8Array, maxDepth: number): Json {
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    throw new JsonSubsetError('The file is not valid UTF-8');
  }
  return new Parser(text, maxDepth).document();
}

const whitespace = new Set([' ', '\t', '\n', '\r']);
const escapes: Readonly<Record<string, string>> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};
const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const integerPattern = /^-?(?:0|[1-9]\d*)$/;
const hexPattern = /^[0-9a-fA-F]{4}$/;
/**
 * Controls, format and default-ignorable characters, which hide or reorder text, so a reviewer
 * would not see what is hashed. Knowledge strings are single-line, so this includes line breaks.
 */
export const hiddenCharacters = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;

class Parser {
  private position = 0;
  private readonly text: string;
  private readonly maxDepth: number;

  constructor(text: string, maxDepth: number) {
    this.text = text;
    this.maxDepth = maxDepth;
  }

  document(): Json {
    const value = this.value(0);
    this.skipWhitespace();
    if (this.position !== this.text.length) this.fail('Unexpected content after the value');
    return value;
  }

  private value(depth: number): Json {
    if (depth > this.maxDepth) this.fail(`Nesting is deeper than ${String(this.maxDepth)}`);
    this.skipWhitespace();
    const next = this.text[this.position];
    if (next === '{') return this.object(depth);
    if (next === '[') return this.array(depth);
    if (next === '"') return this.string();
    if (next === '-' || (next !== undefined && next >= '0' && next <= '9')) return this.number();
    for (const [literal, value] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (this.text.startsWith(literal, this.position)) {
        this.position += literal.length;
        return value;
      }
    }
    return this.fail('Unexpected character');
  }

  private object(depth: number): Json {
    this.position += 1;
    const entries = new Map<string, Json>();
    this.skipWhitespace();
    if (this.consume('}')) return Object.fromEntries(entries);
    do {
      this.skipWhitespace();
      if (this.text[this.position] !== '"') this.fail('Expected a key');
      const key = this.string();
      if (entries.has(key)) this.fail(`Duplicate key ${JSON.stringify(key)}`);
      this.skipWhitespace();
      if (!this.consume(':')) this.fail('Expected a colon');
      entries.set(key, this.value(depth + 1));
      this.skipWhitespace();
    } while (this.consume(','));
    if (!this.consume('}')) this.fail('Expected a comma or a closing brace');
    // Object.fromEntries defines own properties, so a "__proto__" key stays data.
    return Object.fromEntries(entries);
  }

  private array(depth: number): Json {
    this.position += 1;
    const items: Json[] = [];
    this.skipWhitespace();
    if (this.consume(']')) return items;
    do {
      items.push(this.value(depth + 1));
      this.skipWhitespace();
    } while (this.consume(','));
    if (!this.consume(']')) this.fail('Expected a comma or a closing bracket');
    return items;
  }

  private string(): string {
    this.position += 1;
    let result = '';
    for (;;) {
      const char = this.text[this.position];
      if (char === undefined) this.fail('Unterminated string');
      this.position += 1;
      if (char === '"') break;
      if (char < ' ') this.fail('A control character must be escaped');
      if (char !== '\\') {
        result += char;
        continue;
      }
      const escape = this.text[this.position] ?? '';
      this.position += 1;
      if (escape === 'u') {
        const hex = this.text.slice(this.position, this.position + 4);
        if (!hexPattern.test(hex)) this.fail('Invalid unicode escape');
        result += String.fromCharCode(Number.parseInt(hex, 16));
        this.position += 4;
      } else {
        const decoded = escapes[escape];
        if (decoded === undefined) this.fail('Invalid escape');
        result += decoded;
      }
    }
    if (!result.isWellFormed()) this.fail('A string holds a lone surrogate');
    if (result.normalize('NFC') !== result) this.fail('A string is not in NFC');
    if (hiddenCharacters.test(result)) {
      this.fail('A string holds a control, format or invisible character');
    }
    return result;
  }

  private number(): number {
    numberPattern.lastIndex = this.position;
    const match = numberPattern.exec(this.text);
    if (match === null) return this.fail('Invalid number');
    const [literal] = match;
    if (!integerPattern.test(literal)) this.fail('Only integers are allowed');
    const value = Number(literal);
    if (!Number.isSafeInteger(value))
      this.fail('An integer is outside the safe range, ±(2^53 - 1)');
    this.position += literal.length;
    return value;
  }

  private skipWhitespace(): void {
    while (whitespace.has(this.text[this.position] ?? '')) this.position += 1;
  }

  private consume(char: string): boolean {
    if (this.text[this.position] !== char) return false;
    this.position += 1;
    return true;
  }

  private fail(message: string): never {
    throw new JsonSubsetError(`${message} at offset ${String(this.position)}`);
  }
}
