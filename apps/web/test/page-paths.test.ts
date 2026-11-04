import type { webPathSegments } from '@arca/api-contract/client';
import { expectTypeOf, it } from 'vitest';
import type { FileRoutesByFullPath } from '../src/routeTree.gen.js';

type Segments<Path> = Path extends `/${infer Head}/${infer Rest}`
  ? Head | Segments<`/${Rest}`>
  : Path extends `/${infer Last}`
    ? Last
    : never;

// Checked by the typecheck: a page with a segment the tunnel does not know fails it (spec 0004, R5).
it('names every static segment of the pages in the shared list', () => {
  expectTypeOf<Exclude<Segments<keyof FileRoutesByFullPath>, ''>>().toExtend<
    (typeof webPathSegments)[number]
  >();
});
