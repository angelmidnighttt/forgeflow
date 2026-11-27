/** PostgreSQL's unique_violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505';

/**
 * Whether `error` is a unique violation of `constraint` (a unique index or constraint name).
 * Drizzle wraps the driver's error, so the PostgreSQL fields may be on `cause`.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const candidates = [error, (error as { cause?: unknown } | undefined)?.cause];
  return candidates.some((candidate) => {
    const pg = candidate as { code?: unknown; constraint?: unknown } | undefined;
    return pg?.code === UNIQUE_VIOLATION && pg.constraint === constraint;
  });
}
