import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from './test-db';

const requireSessionMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/require-session', () => ({ requireSession: requireSessionMock }));

// Spec "Chart-weight results retrieval".
describe('GET results view=chart', () => {
  let testDb: TestDb;
  const TASK = 'chartview-task';

  beforeAll(async () => {
    requireSessionMock.mockResolvedValue({ session: { user: { email: 'a@b.c' } }, response: null });
    testDb = await startTestDb();
    const { migrate } = await import('../migrate');
    await migrate();
    await testDb.db.query(
      `INSERT INTO tasks (task_id, browser_uuid, status, mode, total_items, config)
       VALUES ($1, 'test', 'completed', 'deep', 1, '{}')`,
      [TASK]
    );
    await testDb.db.query(
      `INSERT INTO task_files (file_id, task_id, filename, column_mapping, row_count)
       VALUES ('cv-file', $1, 'source.xlsx', '{}', 1)`,
      [TASK]
    );
    await testDb.db.query(
      `INSERT INTO task_results (result_id, task_id, file_id, row_index, content_text, reasoning,
                                 favor_calibrated, emotion_calibrated, engagement_value, platform, stage_name, status)
       VALUES ('cv-row', $1, 'cv-file', 0, '很長的貼文全文內容', '評分理由', 7, 6, 42, 'fb', 'A', 'A_emotion_favor_done')`,
      [TASK]
    );
  });

  afterAll(async () => {
    await testDb.stop();
  });

  async function fetchRows(url: string) {
    const { GET } = await import('../../app/api/tasks/[id]/results/route');
    const res = await GET(new Request(url), { params: Promise.resolve({ id: TASK }) });
    expect(res.status).toBe(200);
    return ((await res.json()) as { results: Array<Record<string, unknown>> }).results;
  }

  it('chart view carries chart fields but no text payload', async () => {
    const rows = await fetchRows('http://test/api/tasks/x/results?view=chart');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.content_text).toBe('');
    expect(row.reasoning ?? null).toBeNull();
    expect(row.source_file ?? null).toBeNull();
    expect(row.favor_calibrated).toBe(7);
    expect(row.emotion_calibrated).toBe(6);
    expect(row.engagement_value).toBe(42);
    expect(row.platform).toBe('fb');
    expect(row.row_index).toBe(0);
    expect(row.status).toBe('A_emotion_favor_done');
  });

  it('default view keeps the full text payload', async () => {
    const rows = await fetchRows('http://test/api/tasks/x/results');
    const row = rows[0];
    expect(row.content_text).toBe('很長的貼文全文內容');
    expect(row.reasoning).toBe('評分理由');
    expect(row.source_file).toBe('source.xlsx');
  });
});
