import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseAcceptances } from '../../src/review-gate/acceptances.ts';
import { commentMarker, inert, renderComment } from '../../src/review-gate/comment.ts';
import { reviewerPrompt } from '../../src/review-gate/prompt.ts';
import {
  AgentDefinitionError,
  parseAgentDefinition,
  reviewerWeights,
  withWeights,
} from '../../src/review-gate/reviewers.ts';
import { judgeReviewer } from '../../src/review-gate/verdict.ts';

const root = new URL('../../../../', import.meta.url);

describe('acceptance rows', () => {
  it('reads rows with a number, reviewer, file, category and reason', () => {
    const markdown = `| Pull request | Reviewer | File | Category | Why accepted |
| --- | --- | --- | --- | --- |
| #42 | security-reviewer | \`apps/api/src/a.ts\` | \`injection\` | Demo table only. |
| [#43](https://github.com/x/y/pull/43) | data-access-reviewer | packages/db/m.sql | row-level-security | Public data. |
| 44 | security-reviewer | a\\|b.ts | injection | Pipe in the path. |
| #45 | security-reviewer | a.ts | injection |  |
| PR | security-reviewer | a.ts | injection | No number. |`;
    expect(parseAcceptances(markdown)).toEqual([
      {
        pullRequest: 42,
        reviewer: 'security-reviewer',
        file: 'apps/api/src/a.ts',
        category: 'injection',
        reason: 'Demo table only.',
      },
      {
        pullRequest: 43,
        reviewer: 'data-access-reviewer',
        file: 'packages/db/m.sql',
        category: 'row-level-security',
        reason: 'Public data.',
      },
      {
        pullRequest: 44,
        reviewer: 'security-reviewer',
        file: 'a|b.ts',
        category: 'injection',
        reason: 'Pipe in the path.',
      },
    ]);
  });

  it('reads the real file', async () => {
    const markdown = await readFile(new URL('docs/review-acceptances.md', root), 'utf8');
    expect(Array.isArray(parseAcceptances(markdown))).toBe(true);
  });
});

describe('agent definitions', () => {
  const definition = (frontmatter: string, body = 'Review the change.') =>
    `---\n${frontmatter}\n---\n\n${body}\n`;

  it('keeps only the read-only tools and returns the body', () => {
    expect(
      parseAgentDefinition(
        definition(
          'name: security-reviewer\ndescription: d\ntools: Read, Grep, Glob, Bash\nmodel: fable\neffort: high\ncolor: red',
        ),
      ),
    ).toEqual({
      name: 'security-reviewer',
      model: 'fable',
      effort: 'high',
      tools: ['Read', 'Grep', 'Glob'],
      body: 'Review the change.',
    });
  });

  it.each([
    [
      'a hooks block',
      'name: a\ntools: Read\nmodel: fable\nhooks:\n  PreToolUse: []',
      'frontmatter key "hooks"',
    ],
    [
      'MCP servers',
      'name: a\ntools: Read\nmodel: fable\nmcpServers: {}',
      'frontmatter key "mcpServers"',
    ],
    ['skills', 'name: a\ntools: Read\nmodel: fable\nskills: [x]', 'frontmatter key "skills"'],
    [
      'a permission mode',
      'name: a\ntools: Read\nmodel: fable\npermissionMode: bypassPermissions',
      'frontmatter key "permissionMode"',
    ],
    ['a duplicate key', 'name: a\nname: b\ntools: Read\nmodel: fable', ''],
    ['a malformed name', 'name: ../x\ntools: Read\nmodel: fable', 'malformed name'],
    ['a model ID instead of an alias', 'name: a\ntools: Read\nmodel: Fable 5', 'malformed model'],
    ['an unknown effort', 'name: a\ntools: Read\nmodel: fable\neffort: extreme', 'effort'],
    ['no tools', 'name: a\nmodel: fable', 'no tools list'],
  ])('rejects %s', (_label, frontmatter, message) => {
    expect(() => parseAgentDefinition(definition(frontmatter))).toThrow(message);
  });

  it('rejects a file without frontmatter or with an empty body', () => {
    expect(() => parseAgentDefinition('Review the change.')).toThrow(AgentDefinitionError);
    expect(() =>
      parseAgentDefinition(definition('name: a\ntools: Read\nmodel: fable', '')),
    ).toThrow('empty body');
  });

  it('parses every reviewer on main and weighs each from docs/REVIEW.md', async () => {
    const dir = new URL('.claude/agents/', root);
    const agents = await Promise.all(
      (await readdir(dir)).map(async (file) =>
        parseAgentDefinition(await readFile(new URL(file, dir), 'utf8')),
      ),
    );
    const weights = reviewerWeights(await readFile(new URL('docs/REVIEW.md', root), 'utf8'));
    const reviewers = withWeights(agents, weights);
    expect(reviewers.length).toBeGreaterThan(0);
    expect(reviewers.find((reviewer) => reviewer.name === 'security-reviewer')?.mustPass).toBe(
      true,
    );
    expect(reviewers.find((reviewer) => reviewer.name === 'standards-reviewer')?.mustPass).toBe(
      false,
    );
    const specialists = reviewers.filter((reviewer) => reviewer.areaScoped).map((r) => r.name);
    expect(specialists.sort()).toEqual([
      'ai-safety-reviewer',
      'auth-crypto-reviewer',
      'data-access-reviewer',
      'supply-chain-reviewer',
    ]);
  });

  it('reads a row without a "Runs on" cell as no row', () => {
    const weights = reviewerWeights('| [new-reviewer](x.md) |  | Must pass | `fable` |');
    expect(weights.has('new-reviewer')).toBe(false);
  });

  it('refuses a reviewer without a weight', () => {
    const agent = parseAgentDefinition(definition('name: new-reviewer\ntools: Read\nmodel: fable'));
    expect(() => withWeights([agent], new Map())).toThrow('no row in the docs/REVIEW.md table');
  });
});

describe('reviewer prompt scope', () => {
  const base = { name: 'x-reviewer', model: 'fable', effort: undefined, tools: [], body: 'Body.' };

  it('offers outside_area only to a specialist', () => {
    const specialist = reviewerPrompt({ ...base, mustPass: true, areaScoped: true }, 'n');
    const core = reviewerPrompt({ ...base, mustPass: true, areaScoped: false }, 'n');
    expect(specialist).toContain('one `unassessed` entry with reason `outside_area`');
    expect(core).toContain('never use the `outside_area` reason');
    expect(core).not.toContain('one `unassessed` entry with reason `outside_area`');
  });
});

describe('comment', () => {
  it.each([
    [
      'links',
      'see https://evil.example/x and www.evil.example',
      'see \\[link removed\\] and \\[link removed\\]',
    ],
    [
      'images and Markdown links',
      '![x](https://e.example/p.png) [a](javascript:alert)',
      '\\!\\[x\\]\\(\\[link removed\\] \\[a\\]\\(\\[link removed\\]',
    ],
    ['mentions', 'ping @owner', 'ping @\u200bowner'],
    ['issue references', 'fixes #12 and GH-3', 'fixes \\#\u200b12 and GH\\-\u200b3'],
    ['HTML', '<img src=x onerror=alert(1)>', '&lt;img src=x onerror=alert\\(1\\)&gt;'],
    ['new blocks', 'line\n# Heading\n```', 'line \\# Heading \\`\\`\\`'],
  ])('neutralizes %s', (_label, text, expected) => {
    expect(inert(text)).toBe(expected);
  });

  it('is built from schema fields and marks accepted findings', () => {
    const raw = JSON.stringify({
      findings: [
        {
          severity: 'medium',
          category: 'injection',
          file: 'a.ts',
          line: 3,
          text: 'Use a parameter @someone',
        },
      ],
      unassessed: [{ reason: 'tests_not_run', note: 'CI runs them' }],
    });
    const judgment = judgeReviewer(
      { name: 'security-reviewer', mustPass: true, areaScoped: false },
      raw,
      [
        {
          pullRequest: 7,
          reviewer: 'security-reviewer',
          file: 'a.ts',
          category: 'injection',
          reason: 'r',
        },
      ],
      7,
    );
    const comment = renderComment({
      headSha: 'a'.repeat(40),
      judgments: [judgment],
      canary: { state: 'passed' },
      verdict: { pass: true, failing: [] },
    });
    expect(comment.startsWith(commentMarker)).toBe(true);
    expect(comment).toContain('| security-reviewer | must pass | PASS | no |');
    expect(comment).toContain(
      '- **medium** `injection` a\\.ts:3 (accepted): Use a parameter @\u200bsomeone',
    );
    expect(comment).toContain('- **unassessed** `tests_not_run`: CI runs them');
  });
});
