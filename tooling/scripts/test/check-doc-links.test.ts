import { describe, expect, it } from 'vitest';
import { checkDocLinks, headingAnchor, type Document } from '../src/check-doc-links.ts';

const files = new Set(['apps/api/src/app.ts', 'docs/runbooks/images/flow.png']);
const directories = new Set(['apps', 'apps/api', 'docs', 'docs/runbooks']);

function check(...documents: Document[]) {
  return checkDocLinks({
    documents: [
      {
        path: 'docs/SECURITY.md',
        text: '# Security\n\n## Required controls\n\n## Required controls\n\n### R11. Incident `response`\n',
      },
      ...documents,
    ],
    exists: (path) => files.has(path) || directories.has(path),
  });
}

describe('docs link check', () => {
  it.each([
    'a file, [code](../../apps/api/src/app.ts)',
    'a directory, [api](../../apps/api/)',
    'a heading, [controls](../SECURITY.md#required-controls)',
    'a repeated heading, [again](../SECURITY.md#required-controls-1)',
    'a heading with code, [R11](../SECURITY.md#r11-incident-response)',
    'an image, ![flow](images/flow.png)',
    'a heading in the same file, [top](#runbook)',
    'another site, [Vercel](https://vercel.com/docs/instant-rollback)',
    'mail, [us](mailto:security@example.com)',
    'code, `[x](missing.md)`',
    '[ref]: ../SECURITY.md',
  ])('accepts %s', (line) => {
    expect(check({ path: 'docs/runbooks/a.md', text: `# Runbook\n\n${line}\n` })).toEqual([]);
  });

  it.each([
    ['[gone](gone.md)', 'gone.md does not exist'],
    ['[heading](../SECURITY.md#nope)', '../SECURITY.md#nope names a heading that does not exist'],
    ['[here](#nope)', '#nope names a heading that does not exist'],
    ['[out](../../../etc/passwd)', '../../../etc/passwd points outside the repository'],
    ['[bad](%E0%A4%A.md)', '%E0%A4%A.md is not a valid link'],
    ['[ref]: missing.md', 'missing.md does not exist'],
  ])('rejects %s', (line, problem) => {
    expect(check({ path: 'docs/runbooks/a.md', text: `# Runbook\n\n${line}\n` })).toEqual([
      { where: 'docs/runbooks/a.md', problem },
    ]);
  });

  it('ignores links inside fenced code', () => {
    expect(check({ path: 'docs/a.md', text: '```md\n[gone](gone.md)\n```\n' })).toEqual([]);
  });

  it('builds anchors the way GitHub does', () => {
    expect(headingAnchor('R4. Errors, traces & [CSP](x.md)')).toBe('r4-errors-traces--csp');
    expect(headingAnchor('Notificação à ANPD')).toBe('notificação-à-anpd');
  });
});
