import { sql } from 'drizzle-orm';
import { timestamp } from 'drizzle-orm/pg-core';

/** `timestamp with time zone`, read as a JS Date. Every timestamp column uses it. */
export const timestamptz = () => timestamp({ withTimezone: true, mode: 'date' });

/** `'a', 'b'` for an IN (...) list inside a CHECK constraint. Values are constants of the schema. */
export function sqlList(values: readonly string[]) {
  return sql.raw(values.map((value) => `'${value}'`).join(', '));
}
