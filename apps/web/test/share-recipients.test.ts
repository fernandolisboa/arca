import type { SharingState } from '@arca/vault';
import { describe, expect, it } from 'vitest';
import type { OpenedDocument } from '../src/documents.js';
import {
  moveBatchBytes,
  moveBatches,
  sharedInState,
  sharedState,
  sharePerson,
  shareRecipients,
  type SharingView,
} from '../src/share-recipients.js';

const owner = { accountId: '00000000-0000-4000-8000-000000000001', recipient: 'age1owner' };
const pinnedId = '00000000-0000-4000-8000-000000000002';
const otherId = '00000000-0000-4000-8000-000000000003';
const documentId = '00000000-0000-4000-8000-0000000000d1';

const viewOf = (state: SharingState): SharingView => ({
  status: 'verified',
  storedVersion: 3,
  highestSeen: 3,
  state,
});

const view = viewOf({
  pins: { [pinnedId]: 'age1pinned' },
  documents: { [documentId]: [pinnedId] },
});

const link = (accountId: string, recipient: string | null) => ({
  accountId,
  email: `${accountId.slice(-1)}@example.com`,
  recipient,
});

describe('a linked person on the share screen (ADR-0018)', () => {
  it('keeps the pinned recipient when the server reports the same one', async () => {
    const person = await sharePerson(view, link(pinnedId, 'age1pinned'));
    expect(person.trust).toBe('pinned');
    expect(person.pinned?.recipient).toBe('age1pinned');
    expect(person.offered).toBeNull();
  });

  it('keeps the pin when the server reports no vault for a pinned person', async () => {
    const person = await sharePerson(view, link(pinnedId, null));
    expect(person.trust).toBe('pinned');
    expect(person.offered).toBeNull();
  });

  it('marks a different reported recipient as changed, offering it beside the pin', async () => {
    const person = await sharePerson(view, link(pinnedId, 'age1rotated'));
    expect(person.trust).toBe('changed');
    expect(person.pinned?.recipient).toBe('age1pinned');
    expect(person.offered?.recipient).toBe('age1rotated');
    expect(person.offered?.fingerprint).not.toBe(person.pinned?.fingerprint);
  });

  it('marks an unpinned person with a vault as new and one without as having none', async () => {
    expect((await sharePerson(view, link(otherId, 'age1other'))).trust).toBe('new');
    const none = await sharePerson(view, link(otherId, null));
    expect(none.trust).toBe('no_vault');
    expect(none.pinned).toBeNull();
    expect(none.offered).toBeNull();
  });

  it('does not read a pin from the prototype chain', async () => {
    const person = await sharePerson(view, link('constructor', 'age1other'));
    expect(person.trust).toBe('new');
  });
});

describe('the recipients a share encrypts to', () => {
  it('uses the pin for a changed key until the owner accepts the new one', async () => {
    const people = [await sharePerson(view, link(pinnedId, 'age1rotated'))];
    const chosen = new Set([pinnedId]);
    expect(shareRecipients(people, chosen, new Set())).toEqual([
      { accountId: pinnedId, recipient: 'age1pinned' },
    ]);
    expect(shareRecipients(people, chosen, new Set([pinnedId]))).toEqual([
      { accountId: pinnedId, recipient: 'age1rotated' },
    ]);
  });

  it('shares only with chosen people who have a vault', async () => {
    const people = await Promise.all([
      sharePerson(view, link(pinnedId, 'age1pinned')),
      sharePerson(view, link(otherId, 'age1other')),
      sharePerson(view, link('00000000-0000-4000-8000-000000000004', null)),
    ]);
    const chosen = new Set([otherId, '00000000-0000-4000-8000-000000000004']);
    expect(shareRecipients(people, chosen, new Set())).toEqual([
      { accountId: otherId, recipient: 'age1other' },
    ]);
  });
});

describe('the sharing state after a share', () => {
  it('pins the owner and each person, and lists this document sorted', () => {
    const next = sharedState(view.state, owner, documentId, [
      { accountId: otherId, recipient: 'age1other' },
      { accountId: pinnedId, recipient: 'age1rotated' },
    ]);
    expect(next.pins).toEqual({
      [owner.accountId]: 'age1owner',
      [pinnedId]: 'age1rotated',
      [otherId]: 'age1other',
    });
    expect(next.documents).toEqual({ [documentId]: [pinnedId, otherId] });
  });

  it('drops the document when nobody is left, keeping the others', () => {
    const other = '00000000-0000-4000-8000-0000000000d2';
    const state = { ...view.state, documents: { ...view.state.documents, [other]: [otherId] } };
    const next = sharedState(state, owner, documentId, []);
    expect(next.documents).toEqual({ [other]: [otherId] });
    expect(next.pins[pinnedId]).toBe('age1pinned');
    expect(sharedInState(viewOf(next), documentId)).toEqual([]);
    expect(sharedInState(viewOf(next), other)).toEqual([otherId]);
  });
});

const openedOf = (id: string, size = 1000): OpenedDocument => ({
  document: {
    id,
    typeKey: 'other',
    size,
    sha256: '',
    label: '',
    createdAt: '2026-01-01T00:00:00Z',
    ownerId: owner.accountId,
    sharedWith: [],
  },
  label: { name: `${id}.txt`, type: 'text/plain' },
  stale: true,
});

const idOf = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

describe('moving documents to a rotated identity', () => {
  it('groups documents by the people the state shares each with, using their pins', () => {
    const lone = idOf(900);
    const batches = moveBatches(view, [openedOf(documentId), openedOf(lone)]);
    expect(
      batches.map(({ sharedWith, documents }) => [
        sharedWith,
        documents.map(({ document }) => document.id),
      ]),
    ).toEqual([
      [[{ accountId: pinnedId, recipient: 'age1pinned' }], [documentId]],
      [[], [lone]],
    ]);
  });

  it('splits a group at 32 documents and before it holds too much ciphertext', () => {
    const many = Array.from({ length: 33 }, (_, index) => openedOf(idOf(index)));
    expect(moveBatches(view, many).map(({ documents }) => documents.length)).toEqual([32, 1]);
    const large = [0, 1, 2].map((index) => openedOf(idOf(index), moveBatchBytes / 2));
    expect(moveBatches(view, large).map(({ documents }) => documents.length)).toEqual([2, 1]);
  });

  it('moves a document alone even when it is larger than a batch', () => {
    const huge = openedOf(idOf(1), moveBatchBytes + 1);
    expect(
      moveBatches(view, [huge, openedOf(idOf(2))]).map(({ documents }) => documents.length),
    ).toEqual([1, 1]);
  });
});
