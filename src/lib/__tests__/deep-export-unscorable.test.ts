import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { startTestDb, type TestDb } from './test-db';

// Spec "Empty AI responses are failures" (modified): unscorable rows appear in
// the xlsx export with their full text and an unscorable marker.
describe('generateDeepXlsx unscorable visibility', () => {
  let testDb: TestDb;
  const BRAND = '66666666-6666-6666-6666-666666666666';
  const TASK = 'xlsx-unscorable-task';

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    testDb = await startTestDb();
    const { migrate } = await import('../migrate');
    await migrate();
    await testDb.db.query(`INSERT INTO brands (id, name) VALUES ($1, '麥當勞')`, [BRAND]);
    await testDb.db.query(
      `INSERT INTO tasks (task_id, browser_uuid, status, mode, platform, brand_id,
                          time_range_start, time_range_end, config, total_items)
       VALUES ($1, 'test', 'completed', 'deep', 'fb', $2, '2026-04-01', '2026-06-30', '{}', 2)`,
      [TASK, BRAND]
    );
    await testDb.db.query(
      `INSERT INTO task_files (file_id, task_id, filename, column_mapping, row_count)
       VALUES ('xlsx-file', $1, 'f.xlsx', '{}', 2)`,
      [TASK]
    );
    await testDb.db.query(
      `INSERT INTO task_results (result_id, task_id, file_id, row_index, content_text,
                                 favor_calibrated, emotion_calibrated, platform, stage_name, status)
       VALUES ('xlsx-scored', $1, 'xlsx-file', 0, '正常評分的留言', 7, 6, 'fb', 'B', 'B_emotion_favor_done')`,
      [TASK]
    );
    await testDb.db.query(
      `INSERT INTO task_results (result_id, task_id, file_id, row_index, content_text,
                                 platform, stage_name, status, reasoning, filtered_out)
       VALUES ('xlsx-refused', $1, 'xlsx-file', 1, '卓榮泰 賴清德 該提告，請不要手軟',
               'fb', 'B', 'unscorable', 'B_emotion_favor: scoring failed after retries', FALSE)`,
      [TASK]
    );
  });

  afterAll(async () => {
    await testDb.stop();
  });

  it('includes the unscorable row with its text and marker', async () => {
    const { generateDeepXlsx } = await import('../deep-export');
    const buf = await generateDeepXlsx(TASK);
    const wb = XLSX.read(buf, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['current_detail']);

    expect(rows).toHaveLength(2);
    const refused = rows.find((r) => String(r.content_text).includes('卓榮泰'));
    expect(refused).toBeDefined();
    expect(String(refused!.unscorable)).toContain('B_emotion_favor');
    expect(refused!.favor_calibrated ?? null).toBeNull();

    const scored = rows.find((r) => String(r.content_text).includes('正常評分'));
    expect(scored!.unscorable ?? null).toBeNull();
  });
});
