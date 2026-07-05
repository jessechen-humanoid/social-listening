import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from './test-db';

vi.mock('google-auth-library', () => ({
  JWT: class MockJWT {
    authorize = async () => ({ access_token: 'fake-token' });
  },
}));

// Spec "Idempotent sync with summary row as completion marker" +
// "Startup retry of failed syncs".
describe('sheet sync idempotency', () => {
  let testDb: TestDb;
  let sheets: typeof import('../google-sheets');
  const BRAND = '33333333-3333-3333-3333-333333333333';
  const TASK = 'sync-task-1';

  // Fetch stub: records calls; summary read returns `existingSummaryIds`.
  let fetchCalls: Array<{ url: string; method: string }>;
  let existingSummaryIds: string[];

  beforeAll(async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'svc@test.iam';
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = 'fake-key';
    process.env.OPENAI_API_KEY = 'test-key'; // task-recovery import chain constructs the client
    testDb = await startTestDb();
    const { migrate } = await import('../migrate');
    await migrate();
    sheets = await import('../google-sheets');

    await testDb.db.query(`INSERT INTO brands (id, name) VALUES ($1, '麥當勞')`, [BRAND]);
    await testDb.db.query(
      `INSERT INTO google_sheet_links (brand_id, spreadsheet_id, sheet_tab_map)
       VALUES ($1, 'sheet-123', '{"summary":0,"fb":1}')`,
      [BRAND]
    );
    await testDb.db.query(
      `INSERT INTO tasks (task_id, browser_uuid, status, mode, platform, brand_id,
                          time_range_start, time_range_end, config, sheet_sync_status)
       VALUES ($1, 'test', 'completed', 'deep', 'fb', $2, '2026-04-01', '2026-06-30', '{}', 'failed')`,
      [TASK, BRAND]
    );
    await testDb.db.query(
      `INSERT INTO task_files (file_id, task_id, filename, column_mapping, row_count)
       VALUES ('sync-file', $1, 'f.xlsx', '{}', 2)`,
      [TASK]
    );
    for (let i = 0; i < 2; i++) {
      await testDb.db.query(
        `INSERT INTO task_results (result_id, task_id, file_id, row_index, content_text,
                                   favor_calibrated, emotion_calibrated, platform, stage_name, status)
         VALUES ($1, $2, 'sync-file', $3, '內容', 7, 6, 'fb', 'A', 'A_emotion_favor_done')`,
        [`sync-res-${i}`, TASK, i]
      );
    }
    await testDb.db.query(
      `INSERT INTO deep_task_aggregates (task_id, platform, weighted_avg_favor, weighted_avg_emotion,
                                         total_weight, sample_count,
                                         quadrant_tr_pct, quadrant_tl_pct, quadrant_bl_pct, quadrant_br_pct, weekly_buckets)
       VALUES ($1, 'fb', 7, 6, 4, 2, 100, 0, 0, 0, '[]')`,
      [TASK]
    );
  });

  beforeEach(() => {
    fetchCalls = [];
    existingSummaryIds = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url: String(url), method: init?.method ?? 'GET' });
        if (String(url).includes('/values/summary!A:A')) {
          return new Response(
            JSON.stringify({ values: [['task_id'], ...existingSummaryIds.map((id) => [id])] }),
            { status: 200 }
          );
        }
        return new Response('{}', { status: 200 });
      })
    );
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await testDb.stop();
  });

  it('appends details before the summary row', async () => {
    await sheets.syncDeepTaskToSheet(TASK);

    const appends = fetchCalls.filter((c) => c.url.includes(':append'));
    expect(appends).toHaveLength(2);
    expect(appends[0].url).toContain('/values/fb!A:Z:append');
    expect(appends[1].url).toContain('/values/summary!A:Z:append');
    // The idempotency read happened before any append.
    expect(fetchCalls[0].url).toContain('/values/summary!A:A');
  });

  it('skips the entire sync when the summary row already exists', async () => {
    existingSummaryIds = [TASK];
    await sheets.syncDeepTaskToSheet(TASK);

    const appends = fetchCalls.filter((c) => c.url.includes(':append'));
    expect(appends).toHaveLength(0);
  });

  it('retryFailedSheetSyncs re-syncs completed tasks with failed sync status', async () => {
    const { retryFailedSheetSyncs } = await import('../task-recovery');
    await retryFailedSheetSyncs();

    expect(fetchCalls.some((c) => c.url.includes(':append'))).toBe(true);
    const status = await testDb.db.query(
      `SELECT sheet_sync_status FROM tasks WHERE task_id = $1`,
      [TASK]
    );
    expect((status.rows[0] as { sheet_sync_status: string }).sheet_sync_status).toBe('synced');
  });
});
