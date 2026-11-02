/**
 * Owner credentials and project identifiers the Vercel–Neon integration injects (spec 0001, R7,
 * checked 2026-11-01): DATABASE_*, PG*, POSTGRES_* and NEON_PROJECT_ID. Matched by prefix, so a
 * name Neon adds later is caught too.
 */
export const ownerVariablePattern = /^(?:DATABASE_|PG|POSTGRES_|NEON_)/;

const processModules = new Set(['process', 'node:process']);
const globalObjects = new Set(['globalThis', 'global', 'self', 'window']);

/**
 * @typedef {import('estree').Node & { parent?: import('estree').Node }} NodeWithParent
 */

/**
 * The key of a member access when it is written out: `a.b` or `a['b']`.
 *
 * @param {import('estree').MemberExpression} node
 * @returns {string | undefined}
 */
function staticKey(node) {
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.property.type === 'Literal' && typeof node.property.value === 'string') {
    return node.property.value;
  }
  return undefined;
}

/**
 * The node whose parent decides how a value is used, skipping wrappers that keep its identity:
 * `process?.env`, `process!`.
 *
 * @param {NodeWithParent} node
 * @returns {NodeWithParent}
 */
function outermost(node) {
  let current = node;
  while (
    current.parent &&
    (current.parent.type === 'ChainExpression' ||
      /** @type {{ type: string }} */ (current.parent).type === 'TSNonNullExpression')
  ) {
    current = /** @type {NodeWithParent} */ (current.parent);
  }
  return current;
}

/** @type {import('eslint').Rule.RuleModule} */
export const noOwnerEnvironment = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow reading the owner database variables and indirect access to process.env.',
    },
    schema: [],
    messages: {
      owner:
        '{{name}} belongs to the database owner role. Only the build scripts in tooling/scripts read it.',
      indirect:
        "Read environment variables one by one, by name (process.env['NAME']), in the typed config module.",
      processValue:
        'Use process through a named member such as process.argv; passing it on would expose process.env.',
    },
  },
  create(context) {
    /** @param {NodeWithParent} envNode an expression that evaluates to process.env */
    function checkEnv(envNode) {
      const node = outermost(envNode);
      const parent = node.parent;
      if (parent?.type === 'MemberExpression' && parent.object === node) {
        const name = staticKey(parent);
        if (name === undefined) context.report({ node: parent, messageId: 'indirect' });
        else if (ownerVariablePattern.test(name)) {
          context.report({ node: parent, messageId: 'owner', data: { name } });
        }
        return;
      }
      context.report({ node, messageId: 'indirect' });
    }

    /** @param {NodeWithParent} processNode an expression that evaluates to process */
    function checkProcess(processNode) {
      const node = outermost(processNode);
      const parent = node.parent;
      if (parent?.type === 'MemberExpression' && parent.object === node) {
        const name = staticKey(parent);
        if (name === undefined) context.report({ node: parent, messageId: 'indirect' });
        else if (name === 'env') checkEnv(/** @type {NodeWithParent} */ (parent));
        return;
      }
      if (parent?.type === 'UnaryExpression' && parent.operator === 'typeof') return;
      if (parent?.type === 'VariableDeclarator' && parent.init === node) {
        if (parent.id.type === 'ObjectPattern') {
          for (const property of parent.id.properties) {
            if (property.type === 'RestElement') {
              context.report({ node: property, messageId: 'indirect' });
            } else if (property.computed || property.key.type !== 'Identifier') {
              context.report({ node: property, messageId: 'indirect' });
            } else if (property.key.name === 'env') {
              context.report({ node: property, messageId: 'indirect' });
            }
          }
          return;
        }
      }
      context.report({ node, messageId: 'processValue' });
    }

    /** @param {import('eslint').Scope.Variable} variable */
    function checkReferences(variable, /** @type {(node: NodeWithParent) => void} */ check) {
      for (const reference of variable.references) {
        check(/** @type {NodeWithParent} */ (reference.identifier));
      }
    }

    return {
      ImportDeclaration(node) {
        if (typeof node.source.value !== 'string' || !processModules.has(node.source.value)) return;
        for (const specifier of node.specifiers) {
          const [variable] = context.sourceCode.getDeclaredVariables(specifier);
          if (variable === undefined) continue;
          if (specifier.type === 'ImportSpecifier') {
            const imported =
              specifier.imported.type === 'Identifier'
                ? specifier.imported.name
                : String(specifier.imported.value);
            if (imported === 'env') checkReferences(variable, checkEnv);
            else if (imported === 'default') checkReferences(variable, checkProcess);
          } else {
            checkReferences(variable, checkProcess);
          }
        }
      },
      MemberExpression(node) {
        if (
          node.object.type === 'Identifier' &&
          globalObjects.has(node.object.name) &&
          staticKey(node) === 'process'
        ) {
          checkProcess(/** @type {NodeWithParent} */ (node));
        }
      },
      'Program:exit'(program) {
        // References to the global process: resolved when it is a configured global, left in
        // `through` when it is not. A local variable named process is not the global.
        const globalScope = context.sourceCode.getScope(program);
        const declared = globalScope.set.get('process');
        if (declared !== undefined) checkReferences(declared, checkProcess);
        for (const reference of globalScope.through) {
          if (reference.identifier.name === 'process') {
            checkProcess(/** @type {NodeWithParent} */ (reference.identifier));
          }
        }
      },
    };
  },
};
