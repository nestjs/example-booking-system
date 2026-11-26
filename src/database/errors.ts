import { DrizzleQueryError } from 'drizzle-orm';
import { DatabaseError } from 'pg';

/** Whether a query failed because it would have violated the named exclusion constraint. */
export function isExclusionViolation(error: unknown, constraint: string): boolean {
  // Drizzle wraps the driver's error: the PostgreSQL error is its `cause`.
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  // 23P01 is exclusion_violation.
  return cause instanceof DatabaseError && cause.code === '23P01' && cause.constraint === constraint;
}
