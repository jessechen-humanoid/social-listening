import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from './test-db';

const requireSessionMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/require-session', () => ({ requireSession: requireSessionMock }));

// Count AI calls; scores are always valid so rows complete unless cancelled.
const callJsonMock = vi.hoisted(() => vi.fn());
vi.mock('../deep-pipeline/openai-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../deep-pipeline/openai-client')>();
  return { ...actual, callJson: callJsonMock };
});

// Spec "Cooperative task cancellation" + MODIFIED "Startup recovery of
// incomplete tasks" (cancelled-while-dead).
describe('task cancellation', () => {
  let testDb: TestDb;
  let seq = 0;

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    requireSessionMock.mockResolvedValue({ session: { user: { email: 'a@b.c' } }, response: null });
    testDb = await startTestDb();
    const { migrate } = await import('../migrate');
    await migrate();
  });

  afterAll(async () => {
    await testDb.stop();
  });

  afterEach(() => {
    vi.useRealTimers();
    callJsonMock.mockReset();
  });

  async function createLightTask(rows: number): Promise<string> {
    const taskId = `cancel-task-${++seq}`;
    await testDb.db.query(
      `INSERT INTO tasks (task_id, browser_uuid, status, mode, total_items, config)
       VALUES ($1, 'test', 'pending', 'light', $2, $3)`,
      [taskId, rows, JSON.stringify({
        conditionText: '',
        xAxis: { name: 'x', zeroDescription: 'lo', tenDescription: 'hi' },
        yAxis: { name: 'y', zeroDescription: 'lo', tenDescription: 'hi' },
        model: 'gpt-4o',
      })]
    );
    await testDb.db.query(
      `INSERT INTO task_files (file_id, task_id, filename, column_mapping, row_count)
       VALUES ($1, $2, 'f.csv', '{}', $3)`,
      [`${taskId}-file`, taskId, rows]
    );
    for (let i = 0; i < rows; i++) {
      await testDb.db.query(
        `INSERT INTO task_results (result_id, task_id, file_id, row_index, content_text, status)
         VALUES ($1, $2, $3, $4, '內容', 'pending')`,
        [`${taskId}-r${i}`, taskId, `${taskId}-file`, i]
      );
    }
    return taskId;
  }

  it('heartbeat read-back throws TaskCancelledError once the flag is set', async () => {
    const taskId = await createLightTask(1);
    const { createHeartbeat, TaskCancelledError } = await import('../task-claim');
    await testDb.db.query(`UPDATE tasks SET cancel_requested = TRUE WHERE task_id = $1`, [taskId]);
    const beat = createHeartbeat(taskId);
    await expect(beat()).rejects.toThrow(TaskCancelledError);
  });

  it('a processing task stops issuing AI calls and ends cancelled with scored rows kept', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const taskId = await createLightTask(25);
    const { processTask } = await import('../scoring');

    let flagged = false;
    callJsonMock.mockImplementation(async () => {
      if (!flagged) {
        flagged = true;
        // Cancel arrives while the first wave is in flight; advancing Date
        // past the throttle lets the next heartbeat observe it.
        await testDb.db.query(`UPDATE tasks SET cancel_requested = TRUE WHERE task_id = $1`, [taskId]);
        vi.setSystemTime(Date.now() + 31_000);
      }
      await new Promise(r => setTimeout(r, 30));
      return { x_score: 7, y_score: 6 };
    });

    await processTask(taskId);

    const task = await testDb.db.query(`SELECT status FROM tasks WHERE task_id = $1`, [taskId]);
    expect((task.rows[0] as { status: string }).status).toBe('cancelled');

    // Far fewer calls than rows: the loop stopped at the cancellation
    // checkpoint instead of scoring all 25.
    expect(callJsonMock.mock.calls.length).toBeLessThan(25);
    expect(callJsonMock.mock.calls.length).toBeGreaterThan(0);

    const scored = await testDb.db.query(
      `SELECT COUNT(*)::int AS n FROM task_results WHERE task_id = $1 AND x_score IS NOT NULL`,
      [taskId]
    );
    // Already-scored rows are preserved.
    expect((scored.rows[0] as { n: number }).n).toBeGreaterThan(0);
  });

  it('a queued batch task flagged before start is cancelled without any AI call', async () => {
    const taskId = await createLightTask(3);
    await testDb.db.query(
      `UPDATE tasks SET mode = 'deep', cancel_requested = TRUE WHERE task_id = $1`,
      [taskId]
    );
    const { runBatch } = await import('../deep-pipeline/batch-runner');
    await runBatch([taskId]);

    const task = await testDb.db.query(`SELECT status FROM tasks WHERE task_id = $1`, [taskId]);
    expect((task.rows[0] as { status: string }).status).toBe('cancelled');
    expect(callJsonMock).not.toHaveBeenCalled();
  });

  it('recovery marks a cancelled-while-dead task cancelled instead of resuming it', async () => {
    const taskId = await createLightTask(3);
    await testDb.db.query(
      `UPDATE tasks SET status = 'processing', cancel_requested = TRUE,
                       heartbeat_at = NOW() - interval '10 minutes'
       WHERE task_id = $1`,
      [taskId]
    );
    const { recoverIncompleteTasks } = await import('../task-recovery');
    await recoverIncompleteTasks();

    const task = await testDb.db.query(`SELECT status FROM tasks WHERE task_id = $1`, [taskId]);
    expect((task.rows[0] as { status: string }).status).toBe('cancelled');
    expect(callJsonMock).not.toHaveBeenCalled();
  });

  it('cancel API flags a pending task and rejects finished or unknown tasks', async () => {
    const { POST } = await import('../../app/api/tasks/[id]/cancel/route');
    const post = (id: string) =>
      POST(new Request('http://test/cancel', { method: 'POST' }), {
        params: Promise.resolve({ id }),
      });

    const pendingId = await createLightTask(1);
    const ok = await post(pendingId);
    expect(ok.status).toBe(200);
    const flag = await testDb.db.query(
      `SELECT cancel_requested FROM tasks WHERE task_id = $1`, [pendingId]);
    expect((flag.rows[0] as { cancel_requested: boolean }).cancel_requested).toBe(true);

    const doneId = await createLightTask(1);
    await testDb.db.query(`UPDATE tasks SET status = 'completed' WHERE task_id = $1`, [doneId]);
    const rejected = await post(doneId);
    expect(rejected.status).toBe(400);
    const body = (await rejected.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION');

    const missing = await post('no-such-task');
    expect(missing.status).toBe(404);
  });

  it('cancel API requires an authenticated session', async () => {
    requireSessionMock.mockResolvedValueOnce({
      session: null,
      response: Response.json(
        { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
        { status: 401 }
      ),
    });
    const { POST } = await import('../../app/api/tasks/[id]/cancel/route');
    const res = await POST(new Request('http://test/cancel', { method: 'POST' }), {
      params: Promise.resolve({ id: 'any' }),
    });
    expect(res.status).toBe(401);
  });
});
