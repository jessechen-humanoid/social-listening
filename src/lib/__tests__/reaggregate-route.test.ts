import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from './test-db';

const requireSessionMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/require-session', () => ({ requireSession: requireSessionMock }));

// Task 3.1: reaggregate endpoint (design "權重公式單一出處 engagementWeight
// 並提供免 AI 重算端點") and deep progress payload with aggregates.
describe('reaggregate route and deep progress payload', () => {
  let testDb: TestDb;
  const BRAND = '44444444-4444-4444-4444-444444444444';
  const TASK = 'reagg-task';

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    testDb = await startTestDb();
    const { migrate } = await import('../migrate');
    await migrate();

    await testDb.db.query(
      `INSERT INTO brands (id, name, platform_settings) VALUES ($1, '麥當勞', '{"scatter_alpha":{"fb":0.5}}')`,
      [BRAND]
    );
    await testDb.db.query(
      `INSERT INTO tasks (task_id, browser_uuid, status, mode, platform, brand_id, total_items, config)
       VALUES ($1, 'test', 'completed', 'deep', 'fb', $2, 2, '{}')`,
      [TASK, BRAND]
    );
    await testDb.db.query(
      `INSERT INTO task_files (file_id, task_id, filename, column_mapping, row_count)
       VALUES ('reagg-file', $1, 'f.xlsx', '{}', 2)`,
      [TASK]
    );
    // Raw scores present; engagement 0 and 99 → new-formula weights 1 and 10.
    for (const [i, engagement] of [0, 99].entries()) {
      await testDb.db.query(
        `INSERT INTO task_results (result_id, task_id, file_id, row_index, content_text,
                                   favor_raw, emotion_raw, engagement_value, platform, stage_name, status)
         VALUES ($1, $2, 'reagg-file', $3, '內容', 8, 8, $4, 'fb', 'A', 'A_emotion_favor_done')`,
        [`reagg-res-${i}`, TASK, i, engagement]
      );
    }
  });

  afterAll(async () => {
    await testDb.stop();
  });

  it('rejects unauthenticated calls with 401', async () => {
    requireSessionMock.mockResolvedValue({
      session: null,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const { POST } = await import('../../app/api/tasks/[id]/reaggregate/route');
    const res = await POST(new Request('http://test/'), {
      params: Promise.resolve({ id: TASK }),
    });
    expect(res.status).toBe(401);
  });

  it('recomputes aggregates with the current weight formula and zero AI calls', async () => {
    requireSessionMock.mockResolvedValue({ session: { user: { email: 'a@b.c' } }, response: null });
    const { POST } = await import('../../app/api/tasks/[id]/reaggregate/route');
    const res = await POST(new Request('http://test/'), {
      params: Promise.resolve({ id: TASK }),
    });
    expect(res.status).toBe(200);

    const agg = await testDb.db.query(
      `SELECT total_weight::float AS w, sample_count FROM deep_task_aggregates WHERE task_id = $1`,
      [TASK]
    );
    // sqrt(0+1) + sqrt(99+1) = 1 + 10 = 11 — the new formula, applied without any AI call.
    expect((agg.rows[0] as { w: number }).w).toBeCloseTo(11, 5);
    expect((agg.rows[0] as { sample_count: number }).sample_count).toBe(2);
  });

  it('progress payload for a deep task carries aggregates and platform settings', async () => {
    requireSessionMock.mockResolvedValue({ session: { user: { email: 'a@b.c' } }, response: null });
    const { GET } = await import('../../app/api/tasks/[id]/progress/route');
    const res = await GET(new Request('http://test/'), {
      params: Promise.resolve({ id: TASK }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      aggregates?: Array<{ platform: string; total_weight: number }>;
      platform_settings?: { scatter_alpha?: Record<string, number> };
    };
    expect(body.aggregates).toHaveLength(1);
    expect(body.aggregates![0].platform).toBe('fb');
    expect(body.platform_settings?.scatter_alpha?.fb).toBe(0.5);
  });

  it('rejects reaggregate on a light task', async () => {
    requireSessionMock.mockResolvedValue({ session: { user: { email: 'a@b.c' } }, response: null });
    await testDb.db.query(
      `INSERT INTO tasks (task_id, browser_uuid, status, mode, total_items, config)
       VALUES ('light-task', 'test', 'completed', 'light', 0, '{}')`
    );
    const { POST } = await import('../../app/api/tasks/[id]/reaggregate/route');
    const res = await POST(new Request('http://test/'), {
      params: Promise.resolve({ id: 'light-task' }),
    });
    expect(res.status).toBe(400);
  });
});
