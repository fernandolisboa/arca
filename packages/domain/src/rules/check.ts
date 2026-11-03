import type { FactType } from '../case/facts.js';
import { countryCodeSchema } from '../case/snapshot.js';
import type { CurrencyCode } from '../money/currency.js';
import { type CollectionName, type Expression, maxExpressionDepth, depth } from './expression.js';
import { type FactTarget, resolveFactReference } from './fact-reference.js';

/** A version that reads an age states how a 29 February birthday counts (spec 0002, R2). */
export const ageNeedsLeapDay = 'An age needs the version to set leapDayBirthday';

/** The static type of an expression. A `set` is a country set or a literal list of tokens. */
export type ExpressionType =
  | { readonly kind: 'boolean' }
  | { readonly kind: 'number'; readonly currency?: CurrencyCode }
  | { readonly kind: 'date' }
  | { readonly kind: 'token'; readonly domain: TokenDomain; readonly values?: readonly string[] }
  | { readonly kind: 'list'; readonly domain: TokenDomain }
  | { readonly kind: 'set'; readonly domain: TokenDomain; readonly values?: readonly string[] };

/** Countries, the values of a catalog enumeration, or a literal whose domain its use decides. */
export type TokenDomain = 'country' | 'literal' | readonly string[];

/** Where an expression sits, which decides the facts and collections it may read. */
export interface CheckScope {
  /** Who `person.*` binds to, if anyone. */
  readonly current: boolean;
  readonly unit: boolean;
  readonly edge: boolean;
  /** Inside a line of ancestors: at the ancestor itself, or at a link below it. */
  readonly lineage?: 'ancestor' | 'link';
  /** Inside a collection, where only `lineage.links` (inside ancestors) may nest. */
  readonly nested?: boolean;
}

export interface CheckContext {
  readonly currency: CurrencyCode;
  /** IDs of the country sets the route version pins. */
  readonly countrySets: ReadonlySet<string>;
  readonly leapDayBirthday: boolean;
  /** Names of the reference dates the version declares. */
  readonly referenceDates: ReadonlySet<string>;
}

export interface CheckIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * Type-checks an expression against the fact catalog (spec 0002, R4) and returns its type, or
 * `undefined` after recording why it is ill-typed. Issue messages are for knowledge authors.
 */
export function checkExpression(
  expression: Expression,
  scope: CheckScope,
  context: CheckContext,
  issues: CheckIssue[],
  path = '',
): ExpressionType | undefined {
  if (depth(expression) > maxExpressionDepth) {
    issues.push({ path, message: `Nesting is deeper than ${String(maxExpressionDepth)}` });
    return undefined;
  }
  return new Checker(context, issues).check(expression, scope, path);
}

const boolean: ExpressionType = { kind: 'boolean' };

class Checker {
  private readonly context: CheckContext;
  private readonly issues: CheckIssue[];

  constructor(context: CheckContext, issues: CheckIssue[]) {
    this.context = context;
    this.issues = issues;
  }

  check(expression: Expression, scope: CheckScope, path: string): ExpressionType | undefined {
    const at = (key: string): string => `${path}/${key}`;
    switch (expression.op) {
      case 'bool':
        return boolean;
      case 'int':
      case 'decimal':
        return { kind: 'number' };
      case 'money':
        return { kind: 'number', currency: expression.currency as CurrencyCode };
      case 'date':
        return { kind: 'date' };
      case 'token':
        return { kind: 'token', domain: 'literal', values: [expression.value] };
      case 'tokens':
        return { kind: 'set', domain: 'literal', values: expression.values };
      case 'set':
        if (!this.context.countrySets.has(expression.id)) {
          return this.fail(path, `Country set ${expression.id} is not pinned by the version`);
        }
        return { kind: 'set', domain: 'country' };
      case 'fact':
        if (!this.declared(expression.at, path)) return undefined;
        return this.fact(expression.key, scope, path);
      case 'eq':
      case 'ne':
      case 'lt':
      case 'lte':
      case 'gt':
      case 'gte': {
        const left = this.check(expression.left, scope, at('left'));
        const right = this.check(expression.right, scope, at('right'));
        if (left === undefined || right === undefined) return undefined;
        const ordered = expression.op !== 'eq' && expression.op !== 'ne';
        return this.comparable(left, right, ordered, path) ? boolean : undefined;
      }
      case 'in':
      case 'intersects': {
        const isIn = expression.op === 'in';
        const item = this.check(
          isIn ? expression.item : expression.list,
          scope,
          at(isIn ? 'item' : 'list'),
        );
        const set = this.check(expression.set, scope, at('set'));
        if (item === undefined || set === undefined) return undefined;
        const wanted = isIn ? 'token' : 'list';
        if (item.kind !== wanted || set.kind !== 'set') {
          return this.fail(path, `${expression.op} takes a ${wanted} and a set`);
        }
        return this.tokensFit(item.domain, set, path) ? boolean : undefined;
      }
      case 'all':
      case 'any':
        return this.allBoolean(
          expression.operands.map((operand, index) => [operand, at(`operands/${String(index)}`)]),
          scope,
        )
          ? boolean
          : undefined;
      case 'not':
        return this.allBoolean([[expression.operand, at('operand')]], scope) ? boolean : undefined;
      case 'add':
      case 'sub':
        return this.numbers(
          [
            [expression.left, at('left')],
            [expression.right, at('right')],
          ],
          path,
          scope,
        );
      case 'min':
      case 'max':
        return this.numbers(
          expression.operands.map((operand, index) => [operand, at(`operands/${String(index)}`)]),
          path,
          scope,
        );
      case 'mul': {
        const operand = this.check(expression.operand, scope, at('operand'));
        if (operand === undefined) return undefined;
        return operand.kind === 'number' ? operand : this.fail(path, 'mul takes a number');
      }
      case 'convert': {
        const operand = this.check(expression.operand, scope, at('operand'));
        if (operand === undefined) return undefined;
        if (operand.kind !== 'number' || operand.currency === undefined) {
          return this.fail(path, 'convert takes an amount of money');
        }
        return { kind: 'number', currency: expression.currency as CurrencyCode };
      }
      case 'since': {
        if (!this.declared(expression.at, path)) return undefined;
        const date = this.check(expression.date, scope, at('date'));
        if (date === undefined) return undefined;
        if (date.kind !== 'date') return this.fail(path, 'since takes a date');
        if (
          expression.date.op === 'fact' &&
          resolveFactReference(expression.date.key)?.definition.isBirthDate === true
        ) {
          return this.fail(path, 'An age goes through person.ageYears, never since');
        }
        return boolean;
      }
      case 'count':
      case 'some':
      case 'every': {
        const inner = this.collection(expression.over, expression.generations, scope, path);
        if (inner === undefined) return undefined;
        if (!this.allBoolean([[expression.where, at('where')]], inner)) return undefined;
        return expression.op === 'count' ? { kind: 'number' } : boolean;
      }
      case 'sum': {
        const inner = this.collection(expression.over, expression.generations, scope, path);
        if (inner === undefined) return undefined;
        if (
          expression.where !== undefined &&
          !this.allBoolean([[expression.where, at('where')]], inner)
        ) {
          return undefined;
        }
        const value = this.check(expression.value, inner, at('value'));
        if (value === undefined) return undefined;
        return value.kind === 'number' ? value : this.fail(path, 'sum takes a number');
      }
    }
  }

  /** Whether a named reference date is one the version declares. */
  private declared(name: string | undefined, path: string): boolean {
    if (name === undefined || this.context.referenceDates.has(name)) return true;
    this.fail(path, `Reference date ${name} is not declared by the version`);
    return false;
  }

  private fact(reference: string, scope: CheckScope, path: string): ExpressionType | undefined {
    const resolved = resolveFactReference(reference);
    if (resolved === undefined) return this.fail(path, `Unknown fact ${reference}`);
    if (!reachable(resolved.target, scope)) {
      return this.fail(path, `${reference} cannot be read here`);
    }
    if (resolved.definition.readsAge === true && !this.context.leapDayBirthday) {
      return this.fail(path, ageNeedsLeapDay);
    }
    return typeOf(resolved.definition.type, this.context.currency);
  }

  private collection(
    over: CollectionName,
    generations: number | undefined,
    scope: CheckScope,
    path: string,
  ): CheckScope | undefined {
    // Nesting multiplies the work by the size of each collection, so only a line's links nest.
    if (scope.nested === true && !(over === 'lineage.links' && scope.lineage === 'ancestor')) {
      this.fail(path, 'Collections do not nest, except lineage.links inside principal.ancestors');
      return undefined;
    }
    if ((over === 'principal.ancestors') !== (generations !== undefined)) {
      this.fail(path, 'generations is given for principal.ancestors, and only there');
      return undefined;
    }
    switch (over) {
      case 'unit.members':
      case 'unit.dependents':
        if (!scope.unit) {
          this.fail(path, `${over} cannot be read here`);
          return undefined;
        }
        return { current: true, unit: true, edge: false, nested: true };
      case 'principal.ancestors':
        return { current: true, unit: scope.unit, edge: false, lineage: 'ancestor', nested: true };
      case 'lineage.links':
        if (scope.lineage === undefined) {
          this.fail(path, 'lineage.links is read inside principal.ancestors');
          return undefined;
        }
        return { current: true, unit: scope.unit, edge: false, lineage: 'link', nested: true };
    }
  }

  private comparable(
    left: ExpressionType,
    right: ExpressionType,
    ordered: boolean,
    path: string,
  ): boolean {
    if (left.kind === 'number' && right.kind === 'number') {
      if (left.currency === right.currency) return true;
      this.fail(path, 'Amounts in different currencies need convert');
      return false;
    }
    if (left.kind === 'date' && right.kind === 'date') return true;
    if (!ordered && left.kind === 'boolean' && right.kind === 'boolean') return true;
    if (!ordered && left.kind === 'token' && right.kind === 'token') {
      if (left.domain === 'literal' && right.domain === 'literal') {
        this.fail(path, 'Two literals are compared');
        return false;
      }
      return left.domain === 'literal'
        ? this.tokensFit(right.domain, left, path)
        : this.tokensFit(left.domain, right, path);
    }
    this.fail(
      path,
      ordered ? 'Only numbers and dates are ordered' : 'The operands have different types',
    );
    return false;
  }

  /** Whether the tokens of a set or a token can be values of a domain. */
  private tokensFit(domain: TokenDomain, tokens: ExpressionType, path: string): boolean {
    if (tokens.kind !== 'set' && tokens.kind !== 'token') return false;
    const fits =
      tokens.domain === 'literal'
        ? (tokens.values ?? []).every((value) =>
            domain === 'country'
              ? countryCodeSchema.safeParse(value).success
              : domain === 'literal' || domain.includes(value),
          )
        : sameDomain(domain, tokens.domain);
    if (!fits) this.fail(path, 'The values are outside the domain of the fact');
    return fits;
  }

  private allBoolean(
    operands: readonly (readonly [Expression, string])[],
    scope: CheckScope,
  ): boolean {
    return operands
      .map(([operand, path]) => {
        const type = this.check(operand, scope, path);
        if (type === undefined) return false;
        if (type.kind !== 'boolean') this.fail(path, 'A condition is needed');
        return type.kind === 'boolean';
      })
      .every(Boolean);
  }

  private numbers(
    operands: readonly (readonly [Expression, string])[],
    path: string,
    scope: CheckScope,
  ): ExpressionType | undefined {
    const types = operands.map(([operand, at]) => this.check(operand, scope, at));
    if (types.some((type) => type === undefined)) return undefined;
    const [first, ...rest] = types as ExpressionType[];
    if (first?.kind !== 'number' || rest.some((type) => type.kind !== 'number')) {
      return this.fail(path, 'Arithmetic takes numbers');
    }
    if (rest.some((type) => type.kind === 'number' && type.currency !== first.currency)) {
      return this.fail(path, 'Amounts in different currencies need convert');
    }
    return first;
  }

  private fail(path: string, message: string): ExpressionType | undefined {
    this.issues.push({ path, message });
    return undefined;
  }
}

function reachable(target: FactTarget, scope: CheckScope): boolean {
  switch (target) {
    case 'principal':
      return true;
    case 'current':
      return scope.current;
    case 'unit':
      return scope.unit;
    case 'edge':
      return scope.edge;
    case 'lineage':
    case 'ancestor':
      return scope.lineage !== undefined;
  }
}

function typeOf(type: FactType, currency: CurrencyCode): ExpressionType {
  switch (type.kind) {
    case 'boolean':
      return { kind: 'boolean' };
    case 'integer':
      return { kind: 'number' };
    case 'money':
      return { kind: 'number', currency };
    case 'date':
      return { kind: 'date' };
    case 'country':
      return { kind: 'token', domain: 'country' };
    case 'countries':
      return { kind: 'list', domain: 'country' };
    case 'enum':
      return { kind: 'token', domain: type.values };
    case 'enum-list':
      return { kind: 'list', domain: type.values };
  }
}

function sameDomain(left: TokenDomain, right: TokenDomain): boolean {
  if (typeof left === 'string' || typeof right === 'string') return left === right;
  return left.length === right.length && left.every((value) => right.includes(value));
}
