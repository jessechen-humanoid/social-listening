import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from './test-db';

// Spec "Connection pool resilience": a dropped idle connection (DB restart)
// is logged and discarded without crashing the Node.js process.
describe('connection pool resilience', () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await startTestDb();
  });

  afterAll(async () => {
    await testDb.stop();
  });

  it('survives the database server going away while holding idle clients', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Ensure the pool holds at least one idle client.
    await testDb.db.query('SELECT 1');
    expect(testDb.db.default.idleCount).toBeGreaterThan(0);

    // Kill the server out from under the pool.
    await testDb.pg.stop();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Reaching this line at all means the idle-client error did not become an
    // uncaught exception; the registered listener logged it instead.
    const loggedPoolError = errorSpy.mock.calls.some(
      (call) => call[0] === 'pg pool idle client error'
    );
    expect(loggedPoolError).toBe(true);

    errorSpy.mockRestore();
  });
});
