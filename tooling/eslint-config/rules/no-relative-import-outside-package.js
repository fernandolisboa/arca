import { dirname, relative, resolve, isAbsolute } from 'node:path';

/** @type {import('eslint').Rule.RuleModule} */
export const noRelativeImportOutsidePackage = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow relative imports that leave the package root.' },
    schema: [
      {
        type: 'object',
        properties: { rootDir: { type: 'string' } },
        required: ['rootDir'],
        additionalProperties: false,
      },
    ],
    messages: {
      outside:
        'Import "{{source}}" leaves the package. Depend on the workspace package by name instead.',
    },
  },
  create(context) {
    const [{ rootDir }] = /** @type {[{ rootDir: string }]} */ (context.options);

    /** @param {import('estree').Node | null | undefined} node */
    function check(node) {
      if (node?.type !== 'Literal' || typeof node.value !== 'string') return;
      const source = node.value;
      if (!source.startsWith('.')) return;
      const target = relative(rootDir, resolve(dirname(context.filename), source));
      if (
        target === '..' ||
        target.startsWith('../') ||
        target.startsWith('..\\') ||
        isAbsolute(target)
      ) {
        context.report({ node, messageId: 'outside', data: { source } });
      }
    }

    return {
      ImportDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          check(/** @type {import('estree').Node} */ (node.arguments[0]));
        }
      },
    };
  },
};
