import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from './test-db';

const state = vi.hoisted(() => ({ inFlight: 0, maxInFlight: 0 }));
const createMock = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: createMock } };
  },
}));

// Spec "Concurrent scoring under a global limit": rows run in parallel inside
// a stage, and every row still gets exactly one persisted outcome.
describe('stage row-level concurrency', () => {
  let testDb: TestDb;
  const BRAND = '77777777-7777-7777-7777-777777777777';
  const TASK = 'concurrency-task';
  const TOTAL = 30;

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    testDb = await startTestDb();
    const { migrate } = await import('../migrate');
    await migrate();
    await testDb.db.query(`INSERT INTO brands (id, name) VALUES ($1, '麥當勞')`, [BRAND]);
    await testDb.db.query(
      `INSERT INTO tasks (task_id, browser_uuid, status, mode, platform, brand_id, total_items, config)
       VALUES ($1, 'test', 'pending', 'deep', 'ig', $2, $3, '{}')`,
      [TASK, BRAND, TOTAL]
    );
    await testDb.db.query(
      `INSERT INTO task_files (file_id, task_id, filename, column_mapping, row_count)
       VALUES ('conc-file', $1, 'f.xlsx', '{}', $2)`,
      [TASK, TOTAL]
    );
    for (let i = 0; i < TOTAL; i++) {
      await testDb.db.query(
        `INSERT INTO task_results (result_id, task_id, file_id, row_index, content_text, post_url,
                                   engagement_value, posted_at, platform, stage_name, status)
         VALUES ($1, $2, 'conc-file', $3, $4, $5, 3, '2026-04-10T10:00:00+08:00', 'ig', 'A', 'pending')`,
        [`conc-${i}`, TASK, i, `內容 ${i}`, `https://x.com/${i}`]
      );
    }
    for (const stage of ['A_related_filter', 'A_emotion_favor']) {
      await testDb.db.query(
        `INSERT INTO deep_task_stages (task_id, stage_name, status, input_count, output_count)
         VALUES ($1, $2, 'pending', 0, 0)`,
        [TASK, stage]
      );
    }
    const pv = await import('../prompt-versions');
    const bindings = await pv.getDefaultStageBindings(['A_related_filter', 'A_emotion_favor']);
    await pv.bindPromptVersionsToTask(TASK, bindings as never);

    createMock.mockImplementation(async () => {
      state.inFlight++;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      await new Promise((r) => setTimeout(r, 15));
      state.inFlight--;
      return {
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
      };
    });
  });

  afterAll(async () => {
    await testDb.stop();
  });

  it('runs rows in parallel while persisting exactly one outcome per row', async () => {
    const { runDeepTask } = await import('../deep-pipeline/orchestrator');
    await runDeepTask(TASK);

    // Parallelism observed (row concurrency 10, global cap 16).
    expect(state.maxInFlight).toBeGreaterThan(1);
    expect(state.maxInFlight).toBeLessThanOrEqual(16);

    // Every row scored exactly once; task completed.
    const rows = await testDb.db.query(
      `SELECT COUNT(*)::int AS scored FROM task_results
       WHERE task_id = $1 AND emotion_raw IS NOT NULL`,
      [TASK]
    );
    expect((rows.rows[0] as { scored: number }).scored).toBe(TOTAL);
    const task = await testDb.db.query(`SELECT status FROM tasks WHERE task_id = $1`, [TASK]);
    expect((task.rows[0] as { status: string }).status).toBe('completed');
  }, 60_000);
});
