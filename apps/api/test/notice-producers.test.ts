import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = join(import.meta.dirname, '..', 'src');

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return Promise.resolve(entry.name.endsWith('.ts') ? [path] : []);
    }),
  );
  return nested.flat();
}

describe('security notice producers (spec 0005, R7)', () => {
  it('sends a notice email only from the delivery, and the erasure notice from the erasure', async () => {
    const senders: string[] = [];
    for (const file of await sourceFiles(source)) {
      const text = await readFile(file, 'utf8');
      if (/\bnotices\.send\(|\bnoticeMessage\(/.test(text)) {
        senders.push(file.slice(source.length + 1));
      }
    }
    expect(senders.sort()).toEqual([
      'account/erasure.ts',
      'email/notices.ts',
      'notification/delivery.ts',
    ]);
  });
});
