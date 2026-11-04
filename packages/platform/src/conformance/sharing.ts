import type { Capabilities } from '../capabilities.js';
import type { SharedFiles, Sharing } from '../sharing.js';
import { check, rejectsWith, type ConformanceCase } from './check.js';

export interface SharingHarness {
  readonly capabilities: Capabilities;
  readonly sharing: Sharing;
  readonly sharedFiles: SharedFiles;
  /** What the person does in the next share sheet. */
  readonly answerShareSheet: (answer: 'shared' | 'cancelled') => Promise<void>;
  /** Another app shares these files into Arca. */
  readonly receive: (files: readonly File[]) => Promise<void>;
}

const link = { title: 'Arca', url: 'https://arca.example.com/cases' };

export function sharingConformance(harness: SharingHarness): ConformanceCase[] {
  const { capabilities, sharing, sharedFiles, answerShareSheet, receive } = harness;
  const cases: ConformanceCase[] = [];
  if (capabilities.has('sharing')) {
    cases.push(
      {
        name: 'shares',
        run: async () => {
          await answerShareSheet('shared');
          check((await sharing.share(link)) === 'shared', 'the share was not reported');
        },
      },
      {
        name: 'reports a closed share sheet as cancelled',
        run: async () => {
          await answerShareSheet('cancelled');
          check((await sharing.share(link)) === 'cancelled', 'the cancel was not reported');
        },
      },
    );
  } else {
    cases.push({
      name: 'refuses to share while unavailable',
      run: () => rejectsWith(() => sharing.share(link), 'CapabilityUnavailableError'),
    });
  }
  if (capabilities.has('receiveSharedFiles')) {
    cases.push({
      name: 'hands over each received file once',
      run: async () => {
        await sharedFiles.take();
        await receive([new File(['synthetic'], 'shared.pdf', { type: 'application/pdf' })]);
        const [file, ...rest] = await sharedFiles.take();
        check(file?.name === 'shared.pdf' && rest.length === 0, 'the shared file differs');
        check((await sharedFiles.take()).length === 0, 'a file was handed over twice');
      },
    });
  } else {
    cases.push({
      name: 'refuses to take shared files while unavailable',
      run: () => rejectsWith(() => sharedFiles.take(), 'CapabilityUnavailableError'),
    });
  }
  return cases;
}
