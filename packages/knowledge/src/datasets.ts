import { type Classification, type RouteVersion, classifications } from '@arca/domain';

/**
 * The kind, and fixed ID, of the classification file each pin of a route version names: the
 * directory under `data` that holds its numbered files.
 */
export const classificationKinds = {
  occupations: 'occupations',
  studyFields: 'study-fields',
} as const satisfies Record<Classification, string>;

/** A classification file a route version pins, and its key `<kind>/<id>/<number>`. */
export interface ClassificationPin {
  readonly name: Classification;
  readonly kind: (typeof classificationKinds)[Classification];
  readonly pin: NonNullable<RouteVersion[Classification]>;
  readonly key: string;
}

/** The classification files a route version pins, in the order of `classifications`. */
export function classificationPins(version: RouteVersion): ClassificationPin[] {
  return classifications.flatMap((name) => {
    const pin = version[name];
    if (pin === undefined) return [];
    const kind = classificationKinds[name];
    return [{ name, kind, pin, key: `${kind}/${pin.id}/${String(pin.number)}` }];
  });
}
