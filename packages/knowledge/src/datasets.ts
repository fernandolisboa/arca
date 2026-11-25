import type { Classification } from '@arca/domain';

/**
 * The kind, and fixed ID, of the classification file each pin of a route version names: the
 * directory under `data` that holds its numbered files.
 */
export const classificationKinds = {
  occupations: 'occupations',
  studyFields: 'study-fields',
} as const satisfies Record<Classification, string>;
