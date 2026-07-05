import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from './test-db';

// Spec "Execution heartbeat": the processing loop refreshes heartbeat_at when
// more than 30 seconds have elapsed since the last refresh.
describe('createHeartbeat', () => {
  let testDb: TestDb;
  let createHeartbeat: typeof import('../task-claim').createHeartbeat;

  beforeAll(async () => {
    testDb = await startTestDb();
    const { migrate } = await import('../migrate');
    await migrate();
    createHeartbeat = (await import('../task-claim')).createHeartbeat;
    await testDb.db.query(
      `INSERT INTO tasks (task_id, browser_uuid, status, mode)
       VALUES ('t-beat', 'test-browser', 'processing', 'light')`
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await testDb.stop();
  });

  async function readBeat(): Promise<Date | null> {
    const row = await testDb.db.query(
      `SELECT heartbeat_at FROM tasks WHERE task_id = 't-beat'`
    );
    return (row.rows[0] as { heartbeat_at: Date | null }).heartbeat_at;
  }

  it('updates on first call, throttles within 30s, updates again after 30s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); // fake Date.now for the throttle only
    const beat = createHeartbeat('t-beat');

    await beat();
    const first = await readBeat();
    expect(first).not.toBeNull();

    // 10 seconds later: throttled, no DB write.
    await testDb.db.query(`UPDATE tasks SET heartbeat_at = NULL WHERE task_id = 't-beat'`);
    vi.advanceTimersByTime(10_000);
    await beat();
    expect(await readBeat()).toBeNull();

    // 31 more seconds: past the refresh interval, writes again.
    vi.advanceTimersByTime(31_000);
    await beat();
    expect(await readBeat()).not.toBeNull();
  });
});
