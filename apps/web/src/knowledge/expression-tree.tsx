import { comparisonOperators } from '@arca/api-contract/client';
import { type KnowledgeWords, useKnowledgeWords } from './words.js';

type Node = Readonly<Record<string, unknown>>;

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  typeof (value as Node)['op'] === 'string';

/** The node's sub-expressions in the order the version writes them, each with its field. */
function children(node: Node): readonly (readonly [string, Node, string])[] {
  return Object.entries(node).flatMap(([field, value]) =>
    Array.isArray(value)
      ? value
          .filter(isNode)
          .map((child, index) => [field, child, `${field}.${String(index)}`] as const)
      : isNode(value)
        ? [[field, value, field] as const]
        : [],
  );
}

const text = (value: unknown) => (typeof value === 'string' ? value : String(value));

/** One node's own words, without its sub-expressions. */
function nodeLabel(words: KnowledgeWords, node: Node): string {
  const op = text(node['op']);
  const generations = node['generations'];
  const label = words.op(op, {
    value: text(node['value']),
    values: Array.isArray(node['values']) ? words.list(node['values'].map(text)) : '',
    amount:
      typeof node['amount'] === 'string' && typeof node['currency'] === 'string'
        ? words.money(node['amount'], node['currency'])
        : '',
    date: op === 'date' && typeof node['value'] === 'string' ? words.date(node['value']) : '',
    id: text(node['id']),
    fact:
      op === 'fact'
        ? words.fact({
            reference: text(node['reference']),
            key: typeof node['key'] === 'string' ? node['key'] : null,
            target: typeof node['target'] === 'string' ? node['target'] : null,
          })
        : '',
    by: text(node['by']),
    currency: text(node['currency']),
    duration: typeof node['duration'] === 'string' ? words.duration(node['duration']) : '',
    over: typeof node['over'] === 'string' ? words.collection(node['over']) : '',
    generations:
      typeof generations === 'number' ? words.t('knowledge.generations', { generations }) : '',
  });
  return typeof node['at'] === 'string'
    ? `${label} · ${words.t('knowledge.at', { at: words.referenceDate(node['at']) })}`
    : label;
}

// Operators with two operands, which read as one sentence between them.
const binary = new Set<string>([...comparisonOperators, 'in', 'intersects', 'within']);

function ExpressionNode({ node, lead }: { readonly node: Node; readonly lead?: string }) {
  const words = useKnowledgeWords();
  const inner = children(node);
  const [left, right] = inner;
  const leaves = inner.every(([, child]) => children(child).length === 0);
  // A comparison of two plain values reads as one sentence: "idade … é maior ou igual a 18".
  const sentence =
    binary.has(text(node['op'])) && inner.length === 2 && leaves && left && right
      ? `${nodeLabel(words, left[1])} ${nodeLabel(words, node)} ${nodeLabel(words, right[1])}`
      : null;
  const own = sentence ?? nodeLabel(words, node);
  const leadOf = (field: string) =>
    field === 'where'
      ? words.t('knowledge.where')
      : field === 'value' && node['op'] === 'sum'
        ? words.t('knowledge.ofValue')
        : undefined;
  return (
    <li className="flex flex-col gap-1">
      <span>{lead === undefined ? own : `${lead} ${own}`}</span>
      {sentence === null && inner.length > 0 && (
        <ul className="ml-2 flex flex-col gap-1 border-l-2 border-line pl-3">
          {inner.map(([field, child, key]) => {
            const childLead = leadOf(field);
            return (
              <ExpressionNode
                key={key}
                node={child}
                {...(childLead === undefined ? {} : { lead: childLead })}
              />
            );
          })}
        </ul>
      )}
    </li>
  );
}

/** A rule expression as a tree, with fact names in the screen's language; display only. */
export function ExpressionTree({ expression }: { readonly expression: Node }) {
  return (
    <ul className="flex flex-col gap-1">
      <ExpressionNode node={expression} />
    </ul>
  );
}
