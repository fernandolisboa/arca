import type { VersionView } from '@arca/api-contract/client';
import type { StatusTone } from '@arca/ui';

/** A version's state as a status chip's tone: active is ok, proposed waits, rejected is out. */
export function stateTone(state: VersionView['state']): StatusTone {
  switch (state) {
    case 'active':
      return 'ok';
    case 'proposed':
      return 'warn';
    case 'rejected':
      return 'unknown';
  }
}
