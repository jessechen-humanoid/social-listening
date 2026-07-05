import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from './test-db';
import { exceedsErrorThreshold } from '../error-threshold';

const createMock = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: createMock } };
  },
}));

// Spec "Light task completion failure threshold" boundary values.
describe('exceedsErrorThreshold', () => {
  it.each([
    [300, 300, true], // all rows failed → fail
    [1, 300, false], // 0.33% → completes
    [3, 200, true], // 1.5% → fail (deep stage scenario)
    [1, 200, false], // 0.5% → completes
    [0, 0, false], // zero input never triggers
  ])('errors=%i of input=%i → exceeds=%s', (errors, input, expected) => {
    expect(exceedsErrorThreshold(errors, input)).toBe(expected);
  });
});

describe('processTask completion threshold', () => {
  let testDb: TestDb;
  let processTask: typeof import('../scoring').processTask;

  async function insertLightTask(id: string, rows: Array<{ status: string }>) {
    await testDb.db.query(
      `INSERT INTO tasks (task_id, browser_uuid, status, mode, total_items, config)
       VALUES ($1, 'test', 'pending', 'light', $2,
               '{"conditionText":"","xAxis":{"name":"x","zeroDescription":"z","tenDescription":"t"},"yAxis":{"name":"y","zeroDescription":"z","tenDescription":"t"},"model":"gpt-4o"}')`,
      [id, rows.length]
    );
    await testDb.db.query(
      `INSERT INTO task_files (file_id, task_id, filename, column_mapping, row_count)
       VALUES ($1, $2, 'f.csv', '{}', $3)`,
      [`file-${id}`, id, rows.length]
    );
    for (let i = 0; i < rows.length; i++) {
      await testDb.db.query(
        `INSERT INTO task_results (result_id, task_id, file_id, row_index, content_text, status)
         VALUES ($1, $2, $3, $4, 'content', $5)`,
        [`res-${id}-${i}`, id, `file-${id}`, i, rows[i].status]
      );
    }
  }

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    testDb = await startTestDb();
    const { migrate } = await import('../migrate');
    await migrate();
    processTask = (await import('../scoring')).processTask;
  });

  afterAll(async () => {
    await testDb.stop();
  });

  it('marks the task error when every row fails scoring', async () => {
    createMock.mockRejectedValue(new Error('simulated outage'));
    await insertLightTask('t-all-fail', [
      { status: 'pending' },
      { status: 'pending' },
      { status: 'pending' },
    ]);
    await processTask('t-all-fail');

    const task = await testDb.db.query(`SELECT status FROM tasks WHERE task_id = 't-all-fail'`);
    expect((task.rows[0] as { status: string }).status).toBe('error');
  });

  it('completes when the error ratio stays within 1%', async () => {
    createMock.mockReset();
    // 200 rows already scored, 1 pre-existing error, nothing pending.
    const rows = Array.from({ length: 201 }, (_, i) => ({
      status: i === 0 ? 'error' : 'completed',
    }));
    await insertLightTask('t-ok', rows);
    await processTask('t-ok');

    const task = await testDb.db.query(`SELECT status FROM tasks WHERE task_id = 't-ok'`);
    expect((task.rows[0] as { status: string }).status).toBe('completed');
    expect(createMock).not.toHaveBeenCalled();
  });
});
