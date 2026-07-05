import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, type TestDb } from './test-db';

// Spec "Startup recovery of incomplete tasks". Uses a light task whose rows
// are all already scored: resuming it exercises claim → resume → completed
// without issuing any OpenAI call (the pending-row set is empty).
describe('recoverIncompleteTasks', () => {
  let testDb: TestDb;

  async function insertLightTask(id: string, status: string, heartbeatSql: string) {
    await testDb.db.query(
      `INSERT INTO tasks (task_id, browser_uuid, status, mode, total_items, completed_items, config, heartbeat_at)
       VALUES ($1, 'test-browser', $2, 'light', 1, 1, '{}', ${heartbeatSql})`,
      [id, status]
    );
    await testDb.db.query(
      `INSERT INTO task_files (file_id, task_id, filename, column_mapping, row_count)
       VALUES ($1, $2, 'f.csv', '{}', 1)`,
      [`file-${id}`, id]
    );
    await testDb.db.query(
      `INSERT INTO task_results (result_id, task_id, file_id, row_index, content_text, status, x_score, y_score)
       VALUES ($1, $2, $3, 0, 'hello', 'completed', 7.5, 3.0)`,
      [`res-${id}`, id, `file-${id}`]
    );
  }

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'test-key-never-called';
    testDb = await startTestDb();
    const { migrate } = await import('../migrate');
    await migrate();
  });

  afterAll(async () => {
    await testDb.stop();
  });

  it('resumes stale tasks to completion without re-scoring, skips live ones, and survives a broken task', async () => {
    // Oldest: a broken deep task (no brand) — must not block the rest.
    await testDb.db.query(
      `INSERT INTO tasks (task_id, browser_uuid, status, mode, config, heartbeat_at, created_at)
       VALUES ('t-broken-deep', 'test-browser', 'processing', 'deep', '{}',
               NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '2 hours')`
    );
    // A stale light task with all rows already scored.
    await insertLightTask('t-orphaned', 'processing', "NOW() - INTERVAL '10 minutes'");
    // A live task with a fresh heartbeat — recovery must leave it alone.
    await insertLightTask('t-live', 'processing', "NOW() - INTERVAL '5 seconds'");

    const { recoverIncompleteTasks } = await import('../task-recovery');
    await recoverIncompleteTasks();

    // Orphaned task resumed to completion; existing score untouched.
    const orphaned = await testDb.db.query(
      `SELECT status FROM tasks WHERE task_id = 't-orphaned'`
    );
    expect((orphaned.rows[0] as { status: string }).status).toBe('completed');
    const score = await testDb.db.query(
      `SELECT x_score::float AS x, y_score::float AS y, status FROM task_results WHERE result_id = 'res-t-orphaned'`
    );
    expect(score.rows[0]).toEqual({ x: 7.5, y: 3.0, status: 'completed' });

    // Live task untouched (still processing, heartbeat not overwritten by a claim).
    const live = await testDb.db.query(
      `SELECT status, heartbeat_at > NOW() - INTERVAL '1 minute' AS fresh FROM tasks WHERE task_id = 't-live'`
    );
    expect(live.rows[0]).toMatchObject({ status: 'processing', fresh: true });

    // Broken deep task was attempted (claimed) but its failure did not
    // prevent the orphaned task after it from being recovered.
    const broken = await testDb.db.query(
      `SELECT status FROM tasks WHERE task_id = 't-broken-deep'`
    );
    expect((broken.rows[0] as { status: string }).status).not.toBe('completed');
  });
});
