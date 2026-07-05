import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from './test-db';

const createMock = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: createMock } };
  },
}));

// Spec "Unique comment scoring per stage run".
describe('runStageBEmotionFavor', () => {
  let testDb: TestDb;
  let runStageBEmotionFavor: typeof import('../deep-pipeline/stages').runStageBEmotionFavor;
  let prompts: Map<string, import('../prompt-versions').PromptVersion>;
  const TASK = 'b-emotion-task';
  const POST_URL = 'https://www.facebook.com/reel/123/';

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    testDb = await startTestDb();
    const { migrate } = await import('../migrate');
    await migrate();
    const stages = await import('../deep-pipeline/stages');
    runStageBEmotionFavor = stages.runStageBEmotionFavor;
    const pv = await import('../prompt-versions');
    const active = await pv.getActivePrompt('B_emotion_favor');
    prompts = new Map([['B_emotion_favor', active!]]);

    await testDb.db.query(
      `INSERT INTO tasks (task_id, browser_uuid, status, mode) VALUES ($1, 'test', 'processing', 'deep')`,
      [TASK]
    );
    await testDb.db.query(
      `INSERT INTO task_files (file_id, task_id, filename, column_mapping, row_count)
       VALUES ('b-file', $1, 'f.xlsx', '{}', 0)`,
      [TASK]
    );
    // TWO stage-A rows with the SAME post_url — the old JOIN fanned out on this.
    for (const [i, id] of ['post-dup-1', 'post-dup-2'].entries()) {
      await testDb.db.query(
        `INSERT INTO task_results (result_id, task_id, file_id, row_index, content_text, post_url, stage_name, filtered_out, status)
         VALUES ($1, $2, 'b-file', $3, '一樣的貼文', $4, 'A', FALSE, 'A_emotion_favor_done')`,
        [id, TASK, i, POST_URL]
      );
    }
    // 10 comments referencing that post.
    for (let i = 0; i < 10; i++) {
      await testDb.db.query(
        `INSERT INTO task_results (result_id, task_id, file_id, row_index, content_text, parent_post_url, stage_name, filtered_out, status)
         VALUES ($1, $2, 'b-file', $3, $4, $5, 'B', FALSE, 'B_link_done')`,
        [`cmt-${i}`, TASK, 100 + i, `CMT${i}END`, POST_URL]
      );
    }
  });

  afterAll(async () => {
    await testDb.stop();
  });

  it('scores each comment exactly once despite duplicate post URLs', async () => {
    createMock.mockImplementation((req: { messages: Array<{ content: string }> }) => {
      // Echo back one score entry per bundled comment (contents are CMT<n>END).
      const bundle = req.messages[1].content;
      const n = (bundle.match(/CMT\d+END/g) ?? []).length;
      return Promise.resolve({
        choices: [
          {
            message: {
              content: JSON.stringify({
                result: Array.from({ length: n }, () => ({ 情緒分數: 6, 好感分數: 7 })),
              }),
            },
          },
        ],
      });
    });

    const outcome = await runStageBEmotionFavor({
      taskId: TASK,
      brandName: '麥當勞',
      prompts: prompts as never,
    });

    // 10 comments → exactly 2 batches of 5 → 2 API calls (fan-out would double both).
    expect(outcome.inputCount).toBe(10);
    expect(outcome.outputCount).toBe(10);
    expect(createMock).toHaveBeenCalledTimes(2);

    const scored = await testDb.db.query(
      `SELECT COUNT(*)::int AS n FROM task_results
       WHERE task_id = $1 AND stage_name = 'B' AND emotion_raw IS NOT NULL`,
      [TASK]
    );
    expect((scored.rows[0] as { n: number }).n).toBe(10);
  });

  it('marks rows error when scoring fails after retries', async () => {
    await testDb.db.query(
      `INSERT INTO task_results (result_id, task_id, file_id, row_index, content_text, parent_post_url, stage_name, filtered_out, status)
       VALUES ('cmt-fail', $1, 'b-file', 200, '會失敗的留言', $2, 'B', FALSE, 'B_link_done')`,
      [TASK, POST_URL]
    );
    createMock.mockRejectedValue(new Error('simulated failure'));

    await runStageBEmotionFavor({ taskId: TASK, brandName: '麥當勞', prompts: prompts as never });

    const failed = await testDb.db.query(
      `SELECT status, reasoning FROM task_results WHERE result_id = 'cmt-fail'`
    );
    expect((failed.rows[0] as { status: string }).status).toBe('error');
    expect((failed.rows[0] as { reasoning: string }).reasoning).toContain('B_emotion_favor');
  });
});
