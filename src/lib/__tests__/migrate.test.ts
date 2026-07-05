import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, type TestDb } from './test-db';

describe('migrate', () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await startTestDb();
  });

  afterAll(async () => {
    await testDb.stop();
  });

  it('runs twice without error and creates tasks.heartbeat_at', async () => {
    const { migrate } = await import('../migrate');
    await migrate();
    await migrate(); // idempotency: second run must not throw

    const col = await testDb.db.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = 'tasks' AND column_name = 'heartbeat_at'`
    );
    expect(col.rows).toHaveLength(1);
    expect((col.rows[0] as { data_type: string }).data_type).toBe('timestamp with time zone');
  });
});
