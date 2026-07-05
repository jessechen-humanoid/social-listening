import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, type TestDb } from './test-db';

// Spec "Atomic batched task initialization".
describe('initializeDeepTask atomicity and batching', () => {
  let testDb: TestDb;
  const TASK = 'init-atomic-task';

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    testDb = await startTestDb();
    const { migrate } = await import('../migrate');
    await migrate();
    await testDb.db.query(
      `INSERT INTO tasks (task_id, browser_uuid, status, mode, platform, total_items, config)
       VALUES ($1, 'test', 'pending', 'deep', 'ig', 0, '{}')`,
      [TASK]
    );
  });

  afterAll(async () => {
    await testDb.stop();
  });

  const mapping = { content: 'c', engagement_value: 'e', posted_at: 't', post_url: 'u' };
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      c: `內容 ${i}`,
      e: i,
      t: '2026-04-10T10:00:00+08:00',
      u: `https://x.com/${i}`,
    }));

  it('an interrupted initialization leaves zero rows in all three tables', async () => {
    const { initializeDeepTask } = await import('../deep-pipeline/orchestrator');
    await expect(
      initializeDeepTask({
        taskId: TASK,
        platform: 'ig',
        files: [
          { filename: 'good.xlsx', role: 'hotpost', columnMapping: mapping, data: rows(700) },
          // filename NOT NULL violation fires AFTER the first file's batches
          // were written inside the transaction.
          {
            filename: undefined as unknown as string,
            role: 'hotpost',
            columnMapping: mapping,
            data: rows(5),
          },
        ],
      })
    ).rejects.toThrow();

    const residues = await testDb.db.query(
      `SELECT
         (SELECT COUNT(*) FROM task_files WHERE task_id = $1)::int AS files,
         (SELECT COUNT(*) FROM task_results WHERE task_id = $1)::int AS results,
         (SELECT COUNT(*) FROM deep_task_stages WHERE task_id = $1)::int AS stages`,
      [TASK]
    );
    expect(residues.rows[0]).toEqual({ files: 0, results: 0, stages: 0 });
  });

  it('initializes 1200 rows in batched statements and records the total', async () => {
    const { initializeDeepTask } = await import('../deep-pipeline/orchestrator');
    const { totalItems } = await initializeDeepTask({
      taskId: TASK,
      platform: 'ig',
      files: [{ filename: 'big.xlsx', role: 'hotpost', columnMapping: mapping, data: rows(1200) }],
    });
    expect(totalItems).toBe(1200);

    const count = await testDb.db.query(
      `SELECT COUNT(*)::int AS n,
              (SELECT total_items FROM tasks WHERE task_id = $1) AS total
       FROM task_results WHERE task_id = $1`,
      [TASK]
    );
    expect(count.rows[0]).toMatchObject({ n: 1200, total: 1200 });

    // Row indexes are contiguous (batching preserved ordering).
    const idx = await testDb.db.query(
      `SELECT MIN(row_index)::int AS lo, MAX(row_index)::int AS hi FROM task_results WHERE task_id = $1`,
      [TASK]
    );
    expect(idx.rows[0]).toEqual({ lo: 0, hi: 1199 });
  });
});
