import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { isRecord } from './report.ts';

const run = promisify(execFile);

/** An approved vendored file (spec 0002, R7), as `.github/policy/vendored.json` lists it. */
export interface VendoredEntry {
  readonly repository: string;
  readonly tag: string;
  readonly commit: string;
  readonly path: string;
  readonly sha256: string;
  readonly licensePath: string;
  readonly licenseSha256: string;
  readonly license: string;
}

/** A repository files may be vendored from, with the license texts pinned for it. */
export interface VendoredSource {
  readonly repository: string;
  readonly licenses: readonly { readonly license: string; readonly sha256: string }[];
}

const entryKeys = [
  'repository',
  'tag',
  'commit',
  'path',
  'sha256',
  'licensePath',
  'licenseSha256',
  'license',
] as const;
const commitPattern = /^[0-9a-f]{40}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const tagPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const segmentPattern = /^[A-Za-z0-9._-]+$/;
const rawHost = 'raw.githubusercontent.com';
const maxDownloadBytes = 4 * 1024 * 1024;
const networkTimeoutMs = 30_000;

/** The `entries` of a vendored.json, or a problem. Entries are checked by `entryProblems`. */
export function parseVendored(json: unknown): unknown[] | string {
  if (!isRecord(json) || json['schemaVersion'] !== 1 || !Array.isArray(json['entries'])) {
    return 'is not { "schemaVersion": 1, "entries": [...] }';
  }
  if (Object.keys(json).length !== 2) return 'has keys other than schemaVersion and entries';
  return json['entries'] as unknown[];
}

/** The sources of a vendored-sources.json, or a problem. */
export function parseSources(json: unknown): VendoredSource[] | string {
  const shape = 'is not { "schemaVersion": 1, "sources": [{ "repository", "licenses" }] }';
  if (!isRecord(json) || json['schemaVersion'] !== 1 || !Array.isArray(json['sources'])) {
    return shape;
  }
  const sources: VendoredSource[] = [];
  for (const source of json['sources']) {
    if (!isRecord(source) || typeof source['repository'] !== 'string') return shape;
    const licenses = source['licenses'];
    if (!Array.isArray(licenses)) return shape;
    const pinned = licenses.filter(
      (license): license is { license: string; sha256: string } =>
        isRecord(license) &&
        typeof license['license'] === 'string' &&
        typeof license['sha256'] === 'string' &&
        sha256Pattern.test(license['sha256']),
    );
    if (pinned.length !== licenses.length) return shape;
    sources.push({ repository: source['repository'], licenses: pinned });
  }
  return sources;
}

/**
 * What is wrong with a new entry before anything is fetched: every field against its grammar, the
 * repository allow-listed and the license text pinned in vendored-sources.json on main.
 */
export function entryProblems(entry: unknown, sources: readonly VendoredSource[]): string[] {
  if (!isRecord(entry)) return ['is not an object'];
  const keys = Object.keys(entry);
  if (keys.length !== entryKeys.length || !entryKeys.every((key) => keys.includes(key))) {
    return [`has exactly the keys ${entryKeys.join(', ')}`];
  }
  if (!entryKeys.every((key) => typeof entry[key] === 'string')) return ['has a non-string field'];
  const fields = entry as unknown as VendoredEntry;
  const problems: string[] = [];
  const source = sources.find((candidate) => candidate.repository === fields.repository);
  if (source === undefined) problems.push('names a repository not in vendored-sources.json');
  if (!commitPattern.test(fields.commit)) problems.push('has a commit that is not 40 hex digits');
  if (!tagPattern.test(fields.tag) || fields.tag.includes('..')) {
    problems.push('has a tag outside [A-Za-z0-9][A-Za-z0-9._-]* or with ".."');
  }
  for (const key of ['path', 'licensePath'] as const) {
    if (!isPlainPath(fields[key]))
      problems.push(`has a ${key} that is not plain relative segments`);
  }
  for (const key of ['sha256', 'licenseSha256'] as const) {
    if (!sha256Pattern.test(fields[key])) problems.push(`has a ${key} that is not 64 hex digits`);
  }
  const pinned = source?.licenses.some(
    ({ license, sha256 }) => license === fields.license && sha256 === fields.licenseSha256,
  );
  if (source !== undefined && pinned !== true) {
    problems.push('has a license and license hash not pinned in vendored-sources.json');
  }
  return problems;
}

function isPlainPath(path: string): boolean {
  return path
    .split('/')
    .every((segment) => segmentPattern.test(segment) && segment !== '.' && segment !== '..');
}

/**
 * The raw URL of a file at a commit, built here from checked fields. The parsed pathname must be
 * exactly the one intended, so no ref other than the commit and no other repository can be named.
 */
export function rawUrl(entry: VendoredEntry, path: string): URL {
  const expected = `/${entry.repository}/${entry.commit}/${path}`;
  const url = new URL(`https://${rawHost}${expected}`);
  if (url.host !== rawHost || url.pathname !== expected || url.search !== '' || url.hash !== '') {
    throw new Error(`${path} does not make a plain raw URL`);
  }
  return url;
}

/**
 * The commit a tag names in `git ls-remote` output: only the exact tag and its peeled form count,
 * the peeled commit wins, and any other ref fails.
 */
export function tagCommit(output: string, tag: string): string | undefined {
  const names = new Set([`refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
  let direct: string | undefined;
  let peeled: string | undefined;
  for (const line of output.split('\n')) {
    if (line === '') continue;
    const [commit = '', name = '', ...rest] = line.split('\t');
    if (!names.has(name) || rest.length > 0 || !commitPattern.test(commit)) return undefined;
    if (name.endsWith('^{}')) peeled = commit;
    else direct = commit;
  }
  return peeled ?? direct;
}

/** How an entry is checked against upstream; injected so tests run offline. */
export interface Upstream {
  lsRemote(repository: string, tag: string): Promise<string>;
  download(url: URL): Promise<Uint8Array>;
}

/** Problems found by resolving the tag and hashing both files at the entry's commit. */
export async function verifyEntry(entry: VendoredEntry, upstream: Upstream): Promise<string[]> {
  const problems: string[] = [];
  const resolved = tagCommit(await upstream.lsRemote(entry.repository, entry.tag), entry.tag);
  if (resolved !== entry.commit) {
    problems.push(`tag ${entry.tag} of ${entry.repository} does not resolve to ${entry.commit}`);
  }
  for (const [path, sha256] of [
    [entry.path, entry.sha256],
    [entry.licensePath, entry.licenseSha256],
  ] as const) {
    const digest = createHash('sha256')
      .update(await upstream.download(rawUrl(entry, path)))
      .digest('hex');
    if (digest !== sha256) problems.push(`${path} at ${entry.commit} hashes to ${digest}`);
  }
  return problems;
}

/** The real upstream: git and HTTPS to GitHub only, no redirects, a timeout and a size cap. */
export const githubUpstream: Upstream = {
  async lsRemote(repository, tag) {
    const empty = await mkdtemp(join(tmpdir(), 'arca-ls-remote-'));
    try {
      const { stdout } = await run(
        'git',
        [
          '-c',
          'http.followRedirects=false',
          '-c',
          'protocol.allow=never',
          '-c',
          'protocol.https.allow=always',
          'ls-remote',
          '--tags',
          '--',
          `https://github.com/${repository}`,
          `refs/tags/${tag}`,
          `refs/tags/${tag}^{}`,
        ],
        { cwd: empty, env: gitEnvironment(empty), timeout: networkTimeoutMs, maxBuffer: 64 * 1024 },
      );
      return stdout;
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  },
  async download(url) {
    const response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(networkTimeoutMs),
    });
    if (!response.ok || response.body === null) {
      throw new Error(`${url.href} answered ${String(response.status)}`);
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > maxDownloadBytes) throw new Error(`${url.href} is over the size cap`);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  },
};

/** Only what git needs to reach GitHub; no GIT_CONFIG_* variable or user configuration. */
function gitEnvironment(empty: string): NodeJS.ProcessEnv {
  const passed = [
    'PATH',
    'HTTPS_PROXY',
    'https_proxy',
    'NO_PROXY',
    'no_proxy',
    'GIT_SSL_CAINFO',
    'SSL_CERT_FILE',
  ];
  const environment: NodeJS.ProcessEnv = {
    HOME: empty,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CEILING_DIRECTORIES: tmpdir(),
  };
  for (const name of passed) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}
