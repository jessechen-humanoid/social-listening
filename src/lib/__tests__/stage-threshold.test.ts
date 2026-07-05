import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from './test-db';

const createMock = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: createMock } };
  },
}));

// Spec "Stage failure threshold" — contract item 4 boundary scenarios.
describe('runDeepTask stage failure threshold', () => {
  let testDb: TestDb;
  let runDeepTask: typeof import('../deep-pipeline/orchestrator').runDeepTask;
  const BRAND = '11111111-1111-1111-1111-111111111111';

  async function insertDeepTask(id: string, failCount: number, total: number) {
    await testDb.db.query(
      `INSERT INTO tasks (task_id, browser_uuid, status, mode, platform, brand_id, total_items, config)
       VALUES ($1, 'test', 'pending', 'deep', 'ig', $2, $3, '{}')`,
      [id, BRAND, total]
    );
    await testDb.db.query(
      `INSERT INTO task_files (file_id, task_id, filename, column_mapping, row_count)
       VALUES ($1, $2, 'f.xlsx', '{}', $3)`,
      [`file-${id}`, id, total]
    );
    for (let i = 0; i < total; i++) {
      const content = i < failCount ? `FAIL_ME_${i}` : `正常內容 ${i}`;
      await testDb.db.query(
        `INSERT INTO task_results (result_id, task_id, file_id, row_index, content_text, post_url, engagement_value, posted_at, platform, stage_name, status)
         VALUES ($1, $2, $3, $4, $5, $6, 5, '2026-04-10T10:00:00+08:00', 'ig', 'A', 'pending')`,
        [`res-${id}-${i}`, id, `file-${id}`, i, content, `https://x.com/${id}/${i}`]
      );
    }
    for (const stage of ['A_related_filter', 'A_emotion_favor']) {
      await testDb.db.query(
        `INSERT INTO deep_task_stages (task_id, stage_name, status, input_count, output_count)
         VALUES ($1, $2, 'pending', 0, 0)`,
        [id, stage]
      );
    }
    const pv = await import('../prompt-versions');
    const bindings = await pv.getDefaultStageBindings(['A_related_filter', 'A_emotion_favor']);
    await pv.bindPromptVersionsToTask(id, bindings as never);
  }

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    testDb = await startTestDb();
    const { migrate } = await import('../migrate');
    await migrate();
    await testDb.db.query(`INSERT INTO brands (id, name) VALUES ($1, '麥當勞')`, [BRAND]);
    runDeepTask = (await import('../deep-pipeline/orchestrator')).runDeepTask;

    createMock.mockImplementation((req: { messages: Array<{ content: string }> }) => {
      if (req.messages[1].content.includes('FAIL_ME')) {
        return Promise.reject(new Error('simulated per-row failure'));
      }
      return Promise.resolve({
        choices: [
          {
            message: {
              content: JSON.stringify({
                關聯性分數: 10,
                情緒分數: 6,
                好感分數: 7,
                NotRealUser: 'False',
              }),
            },
          },
        ],
      });
    });
  });

  afterAll(async () => {
    await testDb.stop();
  });

  it('fails the task when 3 of 200 rows error (1.5% > threshold)', async () => {
    await insertDeepTask('t-over', 3, 200);
    await runDeepTask('t-over');

    const task = await testDb.db.query(
      `SELECT status, sheet_sync_status FROM tasks WHERE task_id = 't-over'`
    );
    expect((task.rows[0] as { status: string }).status).toBe('error');
    expect((task.rows[0] as { sheet_sync_status: string | null }).sheet_sync_status).toBeNull();

    const agg = await testDb.db.query(
      `SELECT COUNT(*)::int AS n FROM deep_task_aggregates WHERE task_id = 't-over'`
    );
    expect((agg.rows[0] as { n: number }).n).toBe(0);

    const stage = await testDb.db.query(
      `SELECT status, error FROM deep_task_stages WHERE task_id = 't-over' AND stage_name = 'A_related_filter'`
    );
    expect((stage.rows[0] as { status: string }).status).toBe('error');
    expect((stage.rows[0] as { error: string }).error).toContain('3/200');
  }, 60_000);

  it('completes the task when 1 of 200 rows errors (0.5% within threshold)', async () => {
    await insertDeepTask('t-under', 1, 200);
    await runDeepTask('t-under');

    const task = await testDb.db.query(`SELECT status FROM tasks WHERE task_id = 't-under'`);
    expect((task.rows[0] as { status: string }).status).toBe('completed');

    const stage = await testDb.db.query(
      `SELECT input_count, output_count FROM deep_task_stages
       WHERE task_id = 't-under' AND stage_name = 'A_related_filter'`
    );
    expect(stage.rows[0]).toMatchObject({ input_count: 200, output_count: 199 });

    const agg = await testDb.db.query(
      `SELECT COUNT(*)::int AS n FROM deep_task_aggregates WHERE task_id = 't-under'`
    );
    expect((agg.rows[0] as { n: number }).n).toBe(1);
  }, 60_000);
});
