import { sql } from 'drizzle-orm';
import { customType, timestamp } from 'drizzle-orm/pg-core';

/** `timestamp with time zone`, read as a JS Date. Every timestamp column uses it. */
export const timestamptz = () => timestamp({ withTimezone: true, mode: 'date' });

/** `bytea`, read and written as a Buffer (drizzle-orm has no built-in type for it yet). */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/** `'a', 'b'` for an IN (...) list inside a CHECK constraint. Values are constants of the schema. */
export function sqlList(values: readonly string[]) {
  return sql.raw(values.map((value) => `'${value}'`).join(', '));
}
