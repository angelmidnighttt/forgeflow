/** Injection token for the validated environment (`ApiEnv`). */
export const API_ENV = Symbol('API_ENV');

/** Injection token for the shared connection pool and Drizzle instance (`DatabaseHandle`). */
export const DATABASE = Symbol('DATABASE');

/** Injection token for the current time (`Clock`), so expiry logic can be tested without waiting. */
export const CLOCK = Symbol('CLOCK');
