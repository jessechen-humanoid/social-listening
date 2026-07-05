import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, type TestDb } from './test-db';

describe('withTransaction', () => {
  const TABLE = 'test_tx_with_transaction';
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await startTestDb();
    await testDb.db.query(`CREATE TABLE ${TABLE} (id TEXT PRIMARY KEY)`);
  });

  afterAll(async () => {
    await testDb.stop();
  });

  it('commits all writes on success and returns the callback result', async () => {
    const result = await testDb.db.withTransaction(async (client) => {
      await client.query(`INSERT INTO ${TABLE} (id) VALUES ('commit-1')`);
      await client.query(`INSERT INTO ${TABLE} (id) VALUES ('commit-2')`);
      return 'done';
    });
    expect(result).toBe('done');

    const rows = await testDb.db.query(
      `SELECT id FROM ${TABLE} WHERE id LIKE 'commit-%' ORDER BY id`
    );
    expect(rows.rows.map((r) => (r as { id: string }).id)).toEqual(['commit-1', 'commit-2']);
  });

  it('rolls back all writes when the callback throws mid-way', async () => {
    await expect(
      testDb.db.withTransaction(async (client) => {
        await client.query(`INSERT INTO ${TABLE} (id) VALUES ('rollback-1')`);
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    const rows = await testDb.db.query(`SELECT id FROM ${TABLE} WHERE id = 'rollback-1'`);
    expect(rows.rows).toHaveLength(0);
  });

  it('releases the client and leaves no idle-in-transaction connection', async () => {
    await testDb.db.withTransaction(async (client) => {
      await client.query('SELECT 1');
    });
    await expect(
      testDb.db.withTransaction(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    const pool = testDb.db.default;
    // Every checked-out client is back in the pool...
    expect(pool.idleCount).toBe(pool.totalCount);
    // ...and no connection is stuck in an open transaction.
    const zombie = await testDb.db.query(
      `SELECT COUNT(*)::int AS n FROM pg_stat_activity
       WHERE state = 'idle in transaction' AND datname = current_database()`
    );
    expect((zombie.rows[0] as { n: number }).n).toBe(0);
  });
});
