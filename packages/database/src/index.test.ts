import { describe, expect, it, vi } from 'vitest';
import { createDatabase, pingDatabase } from './index.js';

// Nothing listens on port 1, so no test here needs a running PostgreSQL.
const UNREACHABLE = 'postgres://nobody:nothing@127.0.0.1:1/none';

describe('createDatabase', () => {
  it('handles idle connection errors instead of crashing the process', async () => {
    const onIdleClientError = vi.fn();
    const database = createDatabase(UNREACHABLE, { onIdleClientError });
    const failure = new Error('terminating connection due to administrator command');

    // Without a listener, EventEmitter#emit('error') throws; this is what a PostgreSQL
    // restart does to every idle pooled connection.
    expect(() => database.pool.emit('error', failure)).not.toThrow();
    expect(onIdleClientError).toHaveBeenCalledWith(failure);

    await database.close();
  });
});

describe('pingDatabase', () => {
  it('returns false instead of throwing when the database is unreachable', async () => {
    const database = createDatabase(UNREACHABLE, { onIdleClientError: () => {} });
    await expect(pingDatabase(database.pool, 1_000)).resolves.toBe(false);
    await database.close();
  });
});
