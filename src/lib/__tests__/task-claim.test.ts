import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, type TestDb } from './test-db';

// Spec "Single-runner task claim" — claim decision table + concurrency.
describe('claimTask', () => {
  let testDb: TestDb;
  let claimTask: typeof import('../task-claim').claimTask;

  async function insertTask(id: string, status: string, heartbeatSql: string) {
    await testDb.db.query(
      `INSERT INTO tasks (task_id, browser_uuid, status, mode, heartbeat_at)
       VALUES ($1, 'test-browser', $2, 'light', ${heartbeatSql})`,
      [id, status]
    );
  }

  beforeAll(async () => {
    testDb = await startTestDb();
    const { migrate } = await import('../migrate');
    await migrate();
    claimTask = (await import('../task-claim')).claimTask;
  });

  afterAll(async () => {
    await testDb.stop();
  });

  it('claims a pending task', async () => {
    await insertTask('t-pending', 'pending', 'NULL');
    expect(await claimTask('t-pending')).toBe(true);
    const row = await testDb.db.query(
      `SELECT status, heartbeat_at FROM tasks WHERE task_id = 't-pending'`
    );
    expect((row.rows[0] as { status: string }).status).toBe('processing');
    expect((row.rows[0] as { heartbeat_at: Date | null }).heartbeat_at).not.toBeNull();
  });

  it('rejects a processing task with a fresh heartbeat (10 seconds ago)', async () => {
    await insertTask('t-fresh', 'processing', "NOW() - INTERVAL '10 seconds'");
    expect(await claimTask('t-fresh')).toBe(false);
  });

  it('claims a processing task with a stale heartbeat (3 minutes ago)', async () => {
    await insertTask('t-stale', 'processing', "NOW() - INTERVAL '3 minutes'");
    expect(await claimTask('t-stale')).toBe(true);
  });

  it('claims a processing task with a NULL heartbeat (legacy row)', async () => {
    await insertTask('t-legacy', 'processing', 'NULL');
    expect(await claimTask('t-legacy')).toBe(true);
  });

  it('rejects a completed task', async () => {
    await insertTask('t-completed', 'completed', 'NULL');
    expect(await claimTask('t-completed')).toBe(false);
  });

  it('rejects an errored task', async () => {
    await insertTask('t-error', 'error', 'NULL');
    expect(await claimTask('t-error')).toBe(false);
  });

  it('grants exactly one of two concurrent claims on the same pending task', async () => {
    await insertTask('t-race', 'pending', 'NULL');
    const outcomes = await Promise.all([claimTask('t-race'), claimTask('t-race')]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
  });
});
