import type { Capabilities } from '../capabilities.js';
import type { DocumentCapture, FilePicking } from '../files.js';
import { check, rejectsWith, type ConformanceCase } from './check.js';

export interface ChosenFile {
  readonly name: string;
  readonly type: string;
  readonly content: string;
}

export interface FilesHarness {
  readonly capabilities: Capabilities;
  readonly filePicking: FilePicking;
  readonly documentCapture: DocumentCapture;
  /** What the person will choose in the next chooser; none means they cancel. */
  readonly respond: (choice: readonly ChosenFile[]) => Promise<void>;
}

const scan: ChosenFile = { name: 'scan.png', type: 'image/png', content: 'synthetic scan' };
const letter: ChosenFile = { name: 'letter.pdf', type: 'application/pdf', content: 'synthetic' };

async function matches(file: File | undefined, expected: ChosenFile): Promise<boolean> {
  return (
    file?.name === expected.name &&
    file.type === expected.type &&
    (await file.text()) === expected.content
  );
}

export function filesConformance(harness: FilesHarness): ConformanceCase[] {
  const { capabilities, filePicking, documentCapture, respond } = harness;
  return [
    {
      name: 'picks the chosen files',
      run: async () => {
        if (!capabilities.has('filePicking')) {
          await rejectsWith(() => filePicking.pick(), 'CapabilityUnavailableError');
          return;
        }
        await respond([scan, letter]);
        const files = await filePicking.pick({ multiple: true });
        check(files.length === 2, `picked ${String(files.length)} files`);
        check(await matches(files[0], scan), 'the first file differs');
        check(await matches(files[1], letter), 'the second file differs');
      },
    },
    {
      name: 'picks nothing when the person cancels',
      run: async () => {
        if (!capabilities.has('filePicking')) return;
        await respond([]);
        check((await filePicking.pick()).length === 0, 'a cancelled pick returned files');
      },
    },
    {
      name: 'captures one document',
      run: async () => {
        if (!capabilities.has('documentCapture')) {
          await rejectsWith(() => documentCapture.capture(), 'CapabilityUnavailableError');
          return;
        }
        await respond([scan]);
        check(await matches(await documentCapture.capture(), scan), 'the capture differs');
      },
    },
    {
      name: 'captures nothing when the person cancels',
      run: async () => {
        if (!capabilities.has('documentCapture')) return;
        await respond([]);
        check((await documentCapture.capture()) === undefined, 'a cancelled capture returned');
      },
    },
  ];
}
