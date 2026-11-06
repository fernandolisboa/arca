import type { CasePerson, CaseView } from '@arca/api-contract/client';

/**
 * What changed in the family area since the viewer last looked, on this device (spec 0007, R2):
 * members who joined, so each keeper decides what they see, and what other keepers started or
 * stopped sharing with the viewer. Only IDs are stored, never names.
 */
export interface Seen {
  readonly members: readonly string[];
  readonly shared: readonly string[];
}

export interface FamilyNews {
  readonly joined: readonly CasePerson[];
  readonly granted: readonly {
    readonly person: CasePerson;
    readonly scope: 'profile' | 'finances';
  }[];
  readonly revoked: readonly {
    readonly person: CasePerson;
    readonly scope: 'profile' | 'finances';
  }[];
}

const shareKey = (personId: string, scope: string) => `${personId}:${scope}`;

/** The viewer's view as it would be stored once looked at. */
export function seenOf(view: CaseView): Seen {
  return {
    members: view.people.flatMap((person) =>
      person.accountId === null || person.id === view.me ? [] : [person.accountId],
    ),
    shared: view.people.flatMap((person) =>
      person.sharedWithMe.map((scope) => shareKey(person.id, scope)),
    ),
  };
}

/** The news against what was seen; nothing when this device never looked before. */
export function newsOf(view: CaseView, seen: Seen | undefined): FamilyNews {
  if (seen === undefined) return { joined: [], granted: [], revoked: [] };
  const members = new Set(seen.members);
  const shared = new Set(seen.shared);
  const scopes = ['profile', 'finances'] as const;
  return {
    joined: view.people.filter(
      (person) =>
        person.accountId !== null && person.id !== view.me && !members.has(person.accountId),
    ),
    granted: view.people.flatMap((person) =>
      person.sharedWithMe
        .filter((scope) => !shared.has(shareKey(person.id, scope)))
        .map((scope) => ({ person, scope })),
    ),
    revoked: view.people.flatMap((person) =>
      person.keptByMe
        ? []
        : scopes
            .filter(
              (scope) =>
                shared.has(shareKey(person.id, scope)) && !person.sharedWithMe.includes(scope),
            )
            .map((scope) => ({ person, scope })),
    ),
  };
}

const storageKey = (accountId: string) => `arca.family-seen.${accountId}`;

/** What this device stored; undefined when nothing was, or storage is unavailable. */
export function readSeen(accountId: string): Seen | undefined {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey(accountId)) ?? 'null');
    if (
      typeof stored === 'object' &&
      stored !== null &&
      'members' in stored &&
      'shared' in stored &&
      Array.isArray(stored.members) &&
      Array.isArray(stored.shared)
    ) {
      return {
        members: stored.members.filter((id): id is string => typeof id === 'string'),
        shared: stored.shared.filter((id): id is string => typeof id === 'string'),
      };
    }
  } catch {
    // Storage blocked or garbled: start over, as on a new device.
  }
  return undefined;
}

export function writeSeen(accountId: string, seen: Seen): void {
  try {
    localStorage.setItem(storageKey(accountId), JSON.stringify(seen));
  } catch {
    // Without storage, the news shows again next time; nothing else depends on it.
  }
}
