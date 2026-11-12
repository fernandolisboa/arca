import { createHash } from 'node:crypto';
import type { TreeFile } from './git-tree.ts';
import { hostOf } from './host.ts';
import { JsonSubsetError, parseJsonSubset } from './json-subset.ts';
import { isRecord, type Violation } from './report.ts';
import {
  entryProblems,
  parseSources,
  parseVendored,
  type VendoredEntry,
  type VendoredSource,
} from './vendored.ts';

/**
 * The directories the check watches, each with its ancestors a directory, or absent, in the
 * change: the knowledge data, the vendored files and the synthetic families cases pin (R8).
 */
export const knowledgeRoots = [
  'packages/knowledge/data',
  'packages/knowledge/vendor',
  'eval/families',
] as const;
export const dataRoot = `${knowledgeRoots[0]}/`;
export const vendorRoot = `${knowledgeRoots[1]}/`;
export const domainSource = 'packages/domain/src';
export const vendoredPolicy = '.github/policy/vendored.json';
/** The roots and their ancestors, and the policy files' directories, so none of them is a link. */
const watchedDirectories = [
  ...new Set(
    [...knowledgeRoots, '.github/policy'].flatMap((root) =>
      root.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/')),
    ),
  ),
];
export const vendoredSources = '.github/policy/vendored-sources.json';
const hashesPath = `${dataRoot}hashes.json`;
const casesPattern = /^packages\/knowledge\/data\/routes\/[^/]+\/[^/]+\.cases\.json$/;
const officialPattern = /^packages\/knowledge\/data\/official-domains\/([^/]+)\/([0-9]+)\.json$/;
const guidePattern = /^packages\/knowledge\/data\/guides\/[^/]+\/[0-9]+\.json$/;
/**
 * Trust roots (ADR-0014, ADR-0027): what counts as official, and what the independent check is
 * told about a country. Each kind changes in a pull request of its own, with only its hashes.
 */
const trustRoots = [
  { pattern: officialPattern, kind: 'an official-domain list' },
  { pattern: guidePattern, kind: 'a country guide' },
] as const;
const regularFile = { mode: '100644', type: 'blob' };
/** At least the build's nesting limit; the build applies its own, stricter one. */
const maxJsonDepth = 64;

/** One side of the comparison: its files under the watched paths and a way to read them. */
export interface Side {
  readonly files: ReadonlyMap<string, TreeFile>;
  read(path: string): Promise<Buffer>;
}

export interface KnowledgeChange {
  readonly base: Side;
  readonly head: Side;
  /** Whether the change touches `packages/domain/src`, which can change an expected result. */
  readonly domainChanged: boolean;
}

export interface KnowledgeVerdict {
  readonly violations: Violation[];
  /** New vendored.json entries that passed the offline checks and still need upstream checks. */
  readonly newEntries: VendoredEntry[];
}

/**
 * The `knowledge-immutable` rules (spec 0002, R6 to R8): nothing under `data`, `vendor` or
 * `eval/families` that the base has may change, move or disappear; cases files, hashes.json and vendored.json only gain
 * entries; official-domain lists and country guides change alone; new vendored files match an entry already on main.
 */
export async function checkKnowledgeChange(change: KnowledgeChange): Promise<KnowledgeVerdict> {
  const check = new Check(change);
  await check.run();
  return { violations: check.violations, newEntries: check.newEntries };
}

class Check {
  readonly violations: Violation[] = [];
  readonly newEntries: VendoredEntry[] = [];
  readonly #change: KnowledgeChange;
  /** Knowledge paths the change adds or modifies, and those it adds. */
  readonly #changed: string[] = [];
  readonly #added: string[] = [];

  constructor(change: KnowledgeChange) {
    this.#change = change;
  }

  async run(): Promise<void> {
    const { base, head } = this.#change;
    for (const directory of watchedDirectories) {
      const entry = head.files.get(directory);
      if (entry !== undefined && entry.type !== 'tree') {
        this.#add(directory, 'must be a directory, not a link or a submodule');
      }
    }
    for (const policy of [vendoredPolicy, vendoredSources]) {
      const entry = head.files.get(policy);
      if (
        entry !== undefined &&
        (entry.mode !== regularFile.mode || entry.type !== regularFile.type)
      ) {
        this.#add(policy, 'must be a regular file');
      }
    }
    for (const [path, file] of knowledgeFiles(base.files)) {
      const after = head.files.get(path);
      if (after === undefined) {
        this.#add(path, 'exists on the base branch and was deleted or renamed; it is immutable');
      } else if (after.mode !== file.mode || after.type !== file.type) {
        this.#add(path, 'changed its file mode or type; it is immutable');
      } else if (after.object !== file.object) {
        this.#changed.push(path);
        await this.#checkModified(path);
      }
    }
    for (const [path, file] of knowledgeFiles(head.files)) {
      if (base.files.has(path)) continue;
      this.#changed.push(path);
      this.#added.push(path);
      if (file.mode !== regularFile.mode || file.type !== regularFile.type) {
        this.#add(path, 'must be a regular file');
      } else if (casesPattern.test(path)) {
        this.#checkCases(path, undefined, await this.#json(head, path));
      }
    }
    this.#checkTrustRootsAlone();
    await this.#checkHostProofs();
    await this.#checkVendored();
  }

  async #checkModified(path: string): Promise<void> {
    const { base, head } = this.#change;
    if (path === hashesPath) {
      this.#checkHashes(await this.#json(base, path), await this.#json(head, path));
    } else if (casesPattern.test(path)) {
      this.#checkCases(path, await this.#json(base, path), await this.#json(head, path));
    } else {
      this.#add(path, 'was modified; it is immutable, so add a new numbered file instead');
    }
  }

  /** hashes.json keeps every `vectors` entry by name and every `files` entry by path. */
  #checkHashes(before: unknown, after: unknown): void {
    if (!isRecord(before) || !isRecord(after)) {
      this.#add(hashesPath, 'is not a JSON object');
      return;
    }
    this.#sameExcept(hashesPath, before, after, ['vectors', 'files']);
    this.#keepsEntries(hashesPath, before['vectors'], after['vectors'], 'name');
    this.#keepsEntries(hashesPath, before['files'], after['files'], 'path');
  }

  /**
   * A cases file keeps every entry by `id`. A new entry may supersede an existing one only when
   * the change also touches the domain code and the two differ only in their expected results.
   */
  #checkCases(path: string, before: unknown, after: unknown): void {
    if ((before !== undefined && !isRecord(before)) || !isRecord(after)) {
      this.#add(path, 'is not a JSON object');
      return;
    }
    if (before !== undefined) this.#sameExcept(path, before, after, ['cases']);
    const kept = this.#keepsEntries(path, before?.['cases'], after['cases'], 'id');
    if (kept === undefined) return;
    const { old, added } = kept;
    for (const entry of added) {
      const supersedes = entry['supersedes'];
      if (supersedes === undefined) continue;
      const target = typeof supersedes === 'string' ? supersedes : JSON.stringify(supersedes);
      const where = `${path} case ${String(entry['id'])}`;
      const original = typeof supersedes === 'string' ? old.get(target) : undefined;
      if (original === undefined) {
        this.#add(where, 'supersedes a case that is not on the base branch');
        continue;
      }
      if ([...old.values()].some((other) => other['supersedes'] === target)) {
        this.#add(where, `supersedes case ${target}, which is already superseded`);
      }
      if (added.filter((other) => other['supersedes'] === target).length > 1) {
        this.#add(where, `supersedes case ${target}, which another new case supersedes too`);
      }
      if (!this.#change.domainChanged) {
        this.#add(where, `supersedes a case, but the change does not touch ${domainSource}`);
      }
      if (typeof entry['reason'] !== 'string' || entry['reason'].trim() === '') {
        this.#add(where, 'supersedes a case without a reason');
      }
      const ignored = ['id', 'supersedes', 'reason', 'expected'];
      if (canonical(omit(entry, ignored)) !== canonical(omit(original, ignored))) {
        this.#add(where, `differs from case ${target} in more than its expected results`);
      } else if (canonical(entry['expected']) === canonical(original['expected'])) {
        this.#add(where, `expects the same results as case ${target}`);
      }
    }
  }

  /**
   * Every entry of `before` (an array of objects keyed by `key`) is in `after`, unchanged and once.
   * Returns the old entries by key and the entries `after` adds.
   */
  #keepsEntries(
    path: string,
    before: unknown,
    after: unknown,
    key: string,
  ): { old: Map<string, Record<string, unknown>>; added: Record<string, unknown>[] } | undefined {
    const oldEntries = keyed(before, key);
    const newEntries = keyed(after, key);
    if (oldEntries === undefined || newEntries === undefined) {
      this.#add(path, `has entries that are not objects with a string "${key}"`);
      return undefined;
    }
    const counts = new Map<string, number>();
    for (const entry of newEntries) {
      const name = entry[key] as string;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    for (const [name, count] of counts) {
      if (count > 1) this.#add(path, `has ${String(count)} entries with ${key} ${name}`);
    }
    const old = new Map(oldEntries.map((entry) => [entry[key] as string, entry]));
    const current = new Map(newEntries.map((entry) => [entry[key] as string, entry]));
    for (const [name, entry] of old) {
      const now = current.get(name);
      if (now === undefined) this.#add(path, `lost the entry with ${key} ${name}`);
      else if (canonical(now) !== canonical(entry)) {
        this.#add(path, `changed the entry with ${key} ${name}; entries are append-only`);
      }
    }
    return { old, added: newEntries.filter((entry) => !old.has(entry[key] as string)) };
  }

  #sameExcept(
    path: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    lists: readonly string[],
  ): void {
    if (canonical(omit(before, lists)) !== canonical(omit(after, lists))) {
      this.#add(path, `changed a field other than ${lists.join(' and ')}`);
    }
  }

  #checkTrustRootsAlone(): void {
    for (const { pattern, kind } of trustRoots) {
      const roots = this.#changed.filter((path) => pattern.test(path));
      const others = this.#changed.filter((path) => !pattern.test(path) && path !== hashesPath);
      if (roots.length === 0 || others.length === 0) continue;
      for (const path of roots) {
        this.#add(path, `changes ${kind} together with other knowledge data`);
      }
    }
  }

  /**
   * A host added to an existing issuer's list cites proof on a host of a list already on main. The
   * first list for an issuer has no such host, so it goes in a pull request of its own, and no
   * host of it may vouch for itself or any host of the same list: its proof is a registry
   * elsewhere (spec 0002, R6). A host with no dot, a bare top-level domain, is never a list's.
   */
  async #checkHostProofs(): Promise<void> {
    const { base, head } = this.#change;
    const official = this.#added.flatMap((path) => {
      const match = officialPattern.exec(path);
      return match === null ? [] : [{ path, issuer: match[1] ?? '', number: Number(match[2]) }];
    });
    const baseLists = [...base.files.keys()].filter((path) => officialPattern.test(path));
    const mergedHosts = new Set<string>();
    for (const path of baseLists) {
      for (const entry of hostEntries(await this.#json(base, path)) ?? []) {
        mergedHosts.add(entry.host);
      }
    }
    for (const { path, issuer, number } of official) {
      const listed = hostEntries(await this.#json(head, path));
      if (listed === undefined) {
        this.#add(path, 'is not an official-domain list with hosts and sources');
        continue;
      }
      const issuerPrefix = `${dataRoot}official-domains/${issuer}/`;
      if (!baseLists.some((other) => other.startsWith(issuerPrefix))) {
        if (official.length > 1) {
          this.#add(path, 'is the first list for its issuer, so it goes in a pull request alone');
        }
        const ownHosts = new Set(listed.map((entry) => entry.host));
        for (const entry of listed) {
          const proof = hostOf(entry.url);
          if (!entry.host.includes('.')) {
            this.#add(path, `lists ${entry.host}, a top-level domain, not a host`);
          } else if (proof === undefined || isOnHost(proof, ownHosts)) {
            this.#add(
              path,
              `is a first list whose host ${entry.host} cites proof on ${proof ?? 'an unreadable URL'}, a host of the same list, not a registry`,
            );
          }
        }
        continue;
      }
      const previousPath = `${issuerPrefix}${String(number - 1)}.json`;
      const previous = head.files.has(previousPath)
        ? (hostEntries(await this.#json(head, previousPath)) ?? [])
        : [];
      const previousHosts = new Set(previous.map((entry) => entry.host));
      for (const entry of listed) {
        if (previousHosts.has(entry.host)) continue;
        const proof = hostOf(entry.url);
        if (proof === undefined || !isOnHost(proof, mergedHosts)) {
          this.#add(
            path,
            `adds host ${entry.host} with proof on ${proof ?? 'an unreadable URL'}, which is not a host of an official-domain list on main`,
          );
        }
      }
    }
  }

  /**
   * vendored.json only gains entries, each valid against vendored-sources.json on main, and changes
   * in a policy pull request of its own. A new file under `vendor` sits beside a manifest equal to
   * an entry already on main, and hashes to that entry's data or license file.
   */
  async #checkVendored(): Promise<void> {
    const { base, head } = this.#change;
    const sources = parseSources(
      await this.#json(base, vendoredSources, { schemaVersion: 1, sources: [] }),
    );
    if (typeof sources === 'string') {
      this.#add(vendoredSources, `on the base branch ${sources}`);
      return;
    }
    const empty = { schemaVersion: 1, entries: [] };
    const approved = parseVendored(await this.#json(base, vendoredPolicy, empty));
    if (typeof approved === 'string') {
      this.#add(vendoredPolicy, `on the base branch ${approved}`);
      return;
    }
    const entries = parseVendored(await this.#json(head, vendoredPolicy, empty));
    const policyChanged = canonical(entries) !== canonical(approved);
    if (policyChanged) this.#checkVendoredEntries(approved, entries, sources);
    if (
      changedObject(this.#change, vendoredSources) &&
      (policyChanged || this.#changed.length > 0)
    ) {
      this.#add(vendoredSources, 'changes in a policy pull request of its own');
    }
    await this.#checkVendorFiles(approved.filter(isRecord));
  }

  #checkVendoredEntries(
    approved: unknown[],
    entries: unknown[] | string,
    sources: readonly VendoredSource[],
  ): void {
    if (this.#changed.length > 0) {
      this.#add(
        vendoredPolicy,
        'changes in a policy pull request of its own, before any vendored file',
      );
    }
    if (typeof entries === 'string') {
      this.#add(vendoredPolicy, entries);
      return;
    }
    const unmatched = [...entries];
    for (const entry of approved) {
      const index = unmatched.findIndex((candidate) => canonical(candidate) === canonical(entry));
      if (index === -1)
        this.#add(vendoredPolicy, 'changed or removed an approved entry; it is append-only');
      else unmatched.splice(index, 1);
    }
    for (const entry of unmatched) {
      const problems = entryProblems(entry, sources);
      for (const problem of problems) this.#add(`${vendoredPolicy} new entry`, problem);
      if (problems.length === 0) this.newEntries.push(entry as VendoredEntry);
    }
  }

  async #checkVendorFiles(approved: readonly Record<string, unknown>[]): Promise<void> {
    const { head } = this.#change;
    const added = this.#added.filter((path) => path.startsWith(vendorRoot));
    const directories = new Set(added.map((path) => path.slice(0, path.lastIndexOf('/') + 1)));
    for (const directory of directories) {
      const manifestPath = `${directory}manifest.json`;
      const manifest = head.files.has(manifestPath)
        ? await this.#json(head, manifestPath)
        : undefined;
      const entry = approved.find((candidate) => canonical(candidate) === canonical(manifest));
      if (entry === undefined) {
        this.#add(manifestPath, 'must exist and equal an entry of vendored.json on main');
        continue;
      }
      const files = [...head.files]
        .filter(
          ([path, file]) =>
            file.type === 'blob' &&
            path.startsWith(directory) &&
            path !== manifestPath &&
            !path.slice(directory.length).includes('/'),
        )
        .map(([path]) => path);
      const digests = new Map<string, string>();
      for (const path of files) digests.set(path, sha256(await head.read(path)));
      for (const path of added.filter((path) => files.includes(path))) {
        const digest = digests.get(path);
        if (digest !== entry['sha256'] && digest !== entry['licenseSha256']) {
          this.#add(path, 'hashes to neither the data file nor the license of its approved entry');
        }
      }
      for (const key of ['sha256', 'licenseSha256']) {
        if (![...digests.values()].includes(entry[key] as string)) {
          this.#add(directory, `has no file with the approved ${key}`);
        }
      }
    }
  }

  async #json(side: Side, path: string, missing?: unknown): Promise<unknown> {
    if (side.files.get(path)?.type !== 'blob') return missing;
    try {
      return parseJsonSubset(await side.read(path), maxJsonDepth);
    } catch (error) {
      if (!(error instanceof JsonSubsetError)) throw error;
      this.#add(path, `is not in the accepted JSON subset: ${error.message}`);
      return undefined;
    }
  }

  #add(where: string, problem: string): void {
    this.violations.push({ where, problem });
  }
}

function knowledgeFiles(files: ReadonlyMap<string, TreeFile>): [string, TreeFile][] {
  return [...files].filter(
    ([path, file]) =>
      file.type !== 'tree' && knowledgeRoots.some((root) => path.startsWith(`${root}/`)),
  );
}

function changedObject({ base, head }: KnowledgeChange, path: string): boolean {
  return base.files.get(path)?.object !== head.files.get(path)?.object;
}

function keyed(list: unknown, key: string): Record<string, unknown>[] | undefined {
  if (list === undefined) return [];
  if (!Array.isArray(list)) return undefined;
  const entries = list.filter(
    (entry): entry is Record<string, unknown> => isRecord(entry) && typeof entry[key] === 'string',
  );
  return entries.length === list.length ? entries : undefined;
}

function hostEntries(list: unknown): { host: string; url: string }[] | undefined {
  if (!isRecord(list) || !Array.isArray(list['hosts'])) return undefined;
  const entries = list['hosts'].flatMap((entry: unknown) => {
    if (!isRecord(entry) || typeof entry['host'] !== 'string' || !isRecord(entry['source']))
      return [];
    const url = entry['source']['url'];
    return typeof url === 'string' ? [{ host: entry['host'], url }] : [];
  });
  return entries.length === list['hosts'].length ? entries : undefined;
}

/** The matching `@arca/domain`'s `hostMatches` applies: the host itself or a subdomain of it. */
function isOnHost(host: string, hosts: ReadonlySet<string>): boolean {
  return [...hosts].some((listed) => host === listed || host.endsWith(`.${listed}`));
}

function omit(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
}

/** JSON with sorted keys, so two values compare equal whatever their key order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  if (Object.is(value, -0)) return '-0';
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
