/** A string as a SQL literal, for the migrations the scripts generate. */
export const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/** A value as a SQL `jsonb` literal. */
export const json = (value: unknown): string => `${literal(JSON.stringify(value))}::jsonb`;
