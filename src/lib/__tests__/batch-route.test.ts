import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from './test-db';

const requireSessionMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/require-session', () => ({ requireSession: requireSessionMock }));

const runBatchMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/lib/deep-pipeline/batch-runner', () => ({ runBatch: runBatchMock }));

// Spec "Batch upload creates one task per platform".
describe('POST /api/tasks deep-batch branch', () => {
  let testDb: TestDb;
  let POST: typeof import('../../app/api/tasks/route').POST;
  const BRAND = '55555555-5555-5555-5555-555555555555';

  const igFile = {
    filename: 'ig.xlsx',
    role: 'hotpost',
    columnMapping: { content: 'content', engagement_value: 'eng', posted_at: 'time', post_url: 'url' },
    data: [
      { content: 'ig 貼文', eng: 3, time: '2026-04-10T10:00:00+08:00', url: 'https://ig/1' },
    ],
  };
  const threadsFiles = [0, 1].map((i) => ({
    filename: `threads-part${i + 1}.xlsx`,
    role: 'hotpost',
    columnMapping: { content: 'content', engagement_value: 'eng', posted_at: 'time', post_url: 'url' },
    data: [
      { content: `threads 貼文 ${i}`, eng: 1, time: '2026-04-11T10:00:00+08:00', url: `https://th/${i}` },
    ],
  }));

  function batchRequest(bodyOverride?: Record<string, unknown>) {
    const body = {
      browserUuid: 'test-browser',
      mode: 'deep-batch',
      config: {
        projectName: '麥當勞 2026 Q2',
        brandId: BRAND,
        timeRangeStart: '2026-04-01',
        timeRangeEnd: '2026-06-30',
      },
      platforms: [
        { platform: 'ig', files: [igFile] },
        { platform: 'threads', files: threadsFiles },
      ],
      ...bodyOverride,
    };
    const json = JSON.stringify(body);
    return new Request('http://test/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'content-length': String(json.length) },
      body: json,
    });
  }

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    requireSessionMock.mockResolvedValue({ session: { user: { email: 'a@b.c' } }, response: null });
    testDb = await startTestDb();
    const { migrate } = await import('../migrate');
    await migrate();
    await testDb.db.query(`INSERT INTO brands (id, name) VALUES ($1, '麥當勞')`, [BRAND]);
    POST = (await import('../../app/api/tasks/route')).POST;
  });

  afterAll(async () => {
    await testDb.stop();
  });

  it('creates exactly one task per platform sharing brand and time range, then starts the runner', async () => {
    const res = await POST(batchRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mode: string;
      tasks: Array<{ task_id: string; platform: string; total_items: number }>;
    };
    expect(body.mode).toBe('deep-batch');
    expect(body.tasks).toHaveLength(2);
    expect(body.tasks.map((t) => t.platform)).toEqual(['ig', 'threads']);
    // Threads task merges its two files' rows.
    expect(body.tasks[1].total_items).toBe(2);

    const rows = await testDb.db.query(
      `SELECT platform, brand_id, time_range_start::text, status FROM tasks ORDER BY created_at`
    );
    expect(rows.rows).toHaveLength(2);
    for (const row of rows.rows as Array<{ brand_id: string; time_range_start: string; status: string }>) {
      expect(row.brand_id).toBe(BRAND);
      expect(row.time_range_start).toBe('2026-04-01');
      expect(row.status).toBe('pending');
    }

    // Runner invoked once with the created ids in creation order.
    expect(runBatchMock).toHaveBeenCalledTimes(1);
    expect(runBatchMock).toHaveBeenCalledWith(body.tasks.map((t) => t.task_id));

    // Spec "Batch grouping and single-card history": one shared batch_id.
    const batchIds = await testDb.db.query(`SELECT DISTINCT batch_id FROM tasks WHERE batch_id IS NOT NULL`);
    expect(batchIds.rows).toHaveLength(1);
    expect((batchIds.rows[0] as { batch_id: string }).batch_id).toBeTruthy();
  });

  it('rejects an incomplete fb group with 400 and creates zero tasks', async () => {
    runBatchMock.mockClear();
    const before = await testDb.db.query(`SELECT COUNT(*)::int AS n FROM tasks`);

    const res = await POST(
      batchRequest({
        platforms: [{ platform: 'fb', files: [igFile] }], // fb missing two roles
      })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('fb');

    const after = await testDb.db.query(`SELECT COUNT(*)::int AS n FROM tasks`);
    expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n);
    expect(runBatchMock).not.toHaveBeenCalled();
  });
});
