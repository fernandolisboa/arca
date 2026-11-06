import type { VersionView as DomainVersionView } from '@arca/domain';
import { expectTypeOf, it } from 'vitest';
import type { VersionView } from '../src/routes/knowledge.js';

// Checked by the typecheck: a field the domain view gains and the contract drops fails it.
it('carries every field of the domain view', () => {
  expectTypeOf<VersionView>().toExtend<DomainVersionView>();
});
