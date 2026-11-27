import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

/** A position in a list ordered by (created_at, id) descending, at microsecond precision. */
export interface Position {
  at: string;
  id: string;
}

const POSITION_PATTERN =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** `column` as UTC text with microseconds: a JavaScript Date would round it to milliseconds. */
export function preciseTimestamp(column: AnyColumn): SQL<string> {
  return sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/** Rows strictly after `position` in (created_at, id) descending order. */
export function after(createdAt: AnyColumn, id: AnyColumn, position: Position): SQL {
  return sql`(${createdAt}, ${id}) < (${position.at}::timestamptz, ${position.id}::uuid)`;
}

export function encodeCursor(position: Position): string {
  return Buffer.from(`${position.at}|${position.id}`).toString('base64url');
}

/** The position in `cursor`, or null when it is not one this API made. */
export function decodeCursor(cursor: string): Position | null {
  const match = POSITION_PATTERN.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  return match?.[1] && match[2] ? { at: match[1], id: match[2] } : null;
}
