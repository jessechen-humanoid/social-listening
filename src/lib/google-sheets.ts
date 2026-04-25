import { JWT } from 'google-auth-library';
import { query } from './db';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4';

const PLATFORM_TABS = ['fb', 'ig', 'threads', 'dcard'] as const;
const ANALYST_NOTES_TAB = 'analyst_notes';

const SUMMARY_HEADERS = [
  'task_id',
  'created_at',
  'project_name',
  'platform',
  'time_range_start',
  'time_range_end',
  'sample_count',
  'weighted_avg_favor',
  'weighted_avg_emotion',
  'quadrant_tr_pct',
  'quadrant_tl_pct',
  'quadrant_bl_pct',
  'quadrant_br_pct',
  'prompt_version_ids',
  'model_snapshots',
  'calibration_set_id',
  'calibration_mapping_id',
  'rho_emotion',
  'rho_favor',
];

const DETAIL_HEADERS = [
  'task_id',
  'stage',
  'content',
  'emotion_raw',
  'emotion_calibrated',
  'favor_raw',
  'favor_calibrated',
  'related_score',
  'engagement',
  'posted_at',
  'post_url',
  'parent_post_url',
  'platform',
];

function authClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !privateKey) {
    throw new Error('Missing Google service account credentials');
  }
  return new JWT({
    email,
    key: privateKey.replace(/\\n/g, '\n'),
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ],
  });
}

async function authorizedFetch(
  url: string,
  init: RequestInit & { method?: string } = {}
): Promise<Response> {
  const auth = authClient();
  const token = await auth.authorize();
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google API ${res.status}: ${text}`);
  }
  return res;
}

interface GoogleSheetLink {
  brand_id: string;
  spreadsheet_id: string;
  sheet_tab_map: Record<string, number>; // tab name -> sheetId (gid)
  last_synced_at: string | null;
}

export async function getBrandSheetLink(brandId: string): Promise<GoogleSheetLink | null> {
  const result = await query(
    `SELECT brand_id, spreadsheet_id, sheet_tab_map, last_synced_at
     FROM google_sheet_links WHERE brand_id = $1`,
    [brandId]
  );
  return (result.rows[0] as GoogleSheetLink | undefined) ?? null;
}

// Idempotent provisioning: if a link already exists, return it.
// Otherwise, create a new spreadsheet with summary tab + 4 platform tabs +
// analyst_notes tab, write headers, and persist the link.
export async function provisionBrandSheet(
  brandId: string,
  brandName: string
): Promise<GoogleSheetLink> {
  const existing = await getBrandSheetLink(brandId);
  if (existing) return existing;

  // 1. Create spreadsheet with all tabs in one call
  const tabs = ['summary', ...PLATFORM_TABS, ANALYST_NOTES_TAB];
  const createBody = {
    properties: { title: `${brandName} 深度輿情分析 ledger` },
    sheets: tabs.map((title) => ({ properties: { title } })),
  };
  const createRes = await authorizedFetch(`${SHEETS_BASE}/spreadsheets`, {
    method: 'POST',
    body: JSON.stringify(createBody),
  });
  const created = (await createRes.json()) as {
    spreadsheetId: string;
    sheets: Array<{ properties: { sheetId: number; title: string } }>;
  };
  const tabMap: Record<string, number> = {};
  for (const s of created.sheets) {
    tabMap[s.properties.title] = s.properties.sheetId;
  }

  // 2. Write headers per tab
  const headerData = [
    { range: 'summary!A1', values: [SUMMARY_HEADERS] },
    ...PLATFORM_TABS.map((p) => ({ range: `${p}!A1`, values: [DETAIL_HEADERS] })),
  ];
  await authorizedFetch(
    `${SHEETS_BASE}/spreadsheets/${created.spreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'RAW', data: headerData }),
    }
  );

  // 3. Protect app-managed ranges (everything except analyst_notes)
  await protectRanges(created.spreadsheetId, tabMap);

  // 4. Persist link
  await query(
    `INSERT INTO google_sheet_links (brand_id, spreadsheet_id, sheet_tab_map)
     VALUES ($1, $2, $3)
     ON CONFLICT (brand_id) DO UPDATE SET
       spreadsheet_id = EXCLUDED.spreadsheet_id,
       sheet_tab_map = EXCLUDED.sheet_tab_map`,
    [brandId, created.spreadsheetId, JSON.stringify(tabMap)]
  );
  const link = await getBrandSheetLink(brandId);
  if (!link) throw new Error('provisionBrandSheet: failed to persist link');
  return link;
}

async function protectRanges(spreadsheetId: string, tabMap: Record<string, number>) {
  const requests = [];
  for (const tab of ['summary', ...PLATFORM_TABS]) {
    const sheetId = tabMap[tab];
    if (sheetId === undefined) continue;
    requests.push({
      addProtectedRange: {
        protectedRange: {
          range: { sheetId },
          description: 'App-managed — edits via app only',
          warningOnly: true,
        },
      },
    });
  }
  await authorizedFetch(
    `${SHEETS_BASE}/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: 'POST',
      body: JSON.stringify({ requests }),
    }
  );
}

export async function appendSummaryRow(
  spreadsheetId: string,
  values: Array<string | number | null>
): Promise<void> {
  await authorizedFetch(
    `${SHEETS_BASE}/spreadsheets/${spreadsheetId}/values/summary!A:Z:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      body: JSON.stringify({ values: [values] }),
    }
  );
}

export async function appendDetailRows(
  spreadsheetId: string,
  platform: string,
  rows: Array<Array<string | number | null>>
): Promise<void> {
  if (rows.length === 0) return;
  await authorizedFetch(
    `${SHEETS_BASE}/spreadsheets/${spreadsheetId}/values/${platform}!A:Z:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      body: JSON.stringify({ values: rows }),
    }
  );
}

// Sync a deep task's results: 1 summary row + N detail rows on the platform tab.
// Throws on failure — caller is responsible for retry / status tracking.
export async function syncDeepTaskToSheet(taskId: string): Promise<void> {
  const taskRow = await query(
    `SELECT t.task_id, t.brand_id, t.platform, t.time_range_start, t.time_range_end,
            t.config, t.created_at, b.name AS brand_name
     FROM tasks t JOIN brands b ON b.id = t.brand_id
     WHERE t.task_id = $1`,
    [taskId]
  );
  if (taskRow.rows.length === 0) throw new Error(`Task ${taskId} not found`);
  const task = taskRow.rows[0] as {
    task_id: string;
    brand_id: string;
    platform: string;
    time_range_start: string;
    time_range_end: string;
    config: Record<string, unknown>;
    created_at: string;
    brand_name: string;
  };

  const link = await provisionBrandSheet(task.brand_id, task.brand_name);

  const aggRow = await query(
    `SELECT * FROM deep_task_aggregates WHERE task_id = $1 AND platform = $2`,
    [taskId, task.platform]
  );
  const agg = aggRow.rows[0] as
    | {
        weighted_avg_favor: number | null;
        weighted_avg_emotion: number | null;
        sample_count: number;
        quadrant_tr_pct: number;
        quadrant_tl_pct: number;
        quadrant_bl_pct: number;
        quadrant_br_pct: number;
      }
    | undefined;

  const promptBindings = await query(
    `SELECT pb.stage_name, pv.id AS pv_id, pv.model_snapshot
     FROM task_prompt_bindings pb
     JOIN prompt_versions pv ON pv.id = pb.prompt_version_id
     WHERE pb.task_id = $1`,
    [taskId]
  );
  const pvIds = (promptBindings.rows as Array<{ pv_id: string }>).map((r) => r.pv_id).join(',');
  const models = Array.from(
    new Set((promptBindings.rows as Array<{ model_snapshot: string }>).map((r) => r.model_snapshot))
  ).join(',');

  const calibrationRow = await query(
    `SELECT calibration_set_id FROM brands WHERE id = $1`,
    [task.brand_id]
  );
  const calibrationSetId =
    (calibrationRow.rows[0] as { calibration_set_id?: string | null } | undefined)
      ?.calibration_set_id ?? null;

  const summaryRow: Array<string | number | null> = [
    task.task_id,
    new Date(task.created_at).toISOString(),
    String((task.config as { projectName?: string }).projectName ?? ''),
    task.platform,
    task.time_range_start,
    task.time_range_end,
    agg?.sample_count ?? 0,
    agg?.weighted_avg_favor ?? null,
    agg?.weighted_avg_emotion ?? null,
    agg?.quadrant_tr_pct ?? null,
    agg?.quadrant_tl_pct ?? null,
    agg?.quadrant_bl_pct ?? null,
    agg?.quadrant_br_pct ?? null,
    pvIds,
    models,
    calibrationSetId,
    null, // calibration_mapping_id (resolved at calibration time, not stored on task)
    null, // rho_emotion (lives on calibration_mappings)
    null, // rho_favor
  ];
  await appendSummaryRow(link.spreadsheet_id, summaryRow);

  const detail = await query(
    `SELECT stage_name, content_text, emotion_raw, emotion_calibrated,
            favor_raw, favor_calibrated, related_score, engagement_value,
            posted_at, post_url, parent_post_url, platform
     FROM task_results
     WHERE task_id = $1
       AND COALESCE(filtered_out, FALSE) = FALSE
       AND COALESCE(not_real_user, FALSE) = FALSE
       AND favor_calibrated IS NOT NULL
     ORDER BY favor_calibrated DESC, engagement_value DESC NULLS LAST`,
    [taskId]
  );
  const detailRows: Array<Array<string | number | null>> = (
    detail.rows as Array<{
      stage_name: string | null;
      content_text: string;
      emotion_raw: number | null;
      emotion_calibrated: number | null;
      favor_raw: number | null;
      favor_calibrated: number | null;
      related_score: number | null;
      engagement_value: number | null;
      posted_at: Date | string | null;
      post_url: string | null;
      parent_post_url: string | null;
      platform: string | null;
    }>
  ).map((r) => [
    taskId,
    r.stage_name,
    r.content_text,
    r.emotion_raw,
    r.emotion_calibrated,
    r.favor_raw,
    r.favor_calibrated,
    r.related_score,
    r.engagement_value,
    r.posted_at ? new Date(r.posted_at).toISOString() : null,
    r.post_url,
    r.parent_post_url,
    r.platform,
  ]);
  await appendDetailRows(link.spreadsheet_id, task.platform, detailRows);

  await query(
    `UPDATE google_sheet_links SET last_synced_at = NOW() WHERE brand_id = $1`,
    [task.brand_id]
  );
}

const MAX_RETRIES = 5;
const BASE_RETRY_DELAY_MS = 1000;

// Sync wrapper that records sheet_sync_status on the task and retries with
// exponential backoff. Per spec: failures do NOT block task completion.
export async function syncDeepTaskWithRetry(taskId: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await query(
        `UPDATE tasks SET sheet_sync_status = 'syncing', sheet_sync_error = NULL WHERE task_id = $1`,
        [taskId]
      );
      await syncDeepTaskToSheet(taskId);
      await query(
        `UPDATE tasks SET sheet_sync_status = 'synced', sheet_sync_error = NULL WHERE task_id = $1`,
        [taskId]
      );
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await query(
        `UPDATE tasks SET sheet_sync_status = $2, sheet_sync_error = $3 WHERE task_id = $1`,
        [taskId, attempt < MAX_RETRIES - 1 ? 'pending_retry' : 'failed', msg]
      );
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, BASE_RETRY_DELAY_MS * 2 ** attempt));
      }
    }
  }
}

// Admin: rebuild a brand's spreadsheet from DB.
// Clears summary + per-platform tabs (preserves analyst_notes), then re-appends.
export async function rebuildBrandSheet(brandId: string): Promise<void> {
  const link = await getBrandSheetLink(brandId);
  if (!link) throw new Error(`No sheet linked for brand ${brandId}`);

  // Clear app-managed tabs (leave analyst_notes alone)
  const tabsToClear = ['summary', ...PLATFORM_TABS];
  await authorizedFetch(
    `${SHEETS_BASE}/spreadsheets/${link.spreadsheet_id}/values:batchClear`,
    {
      method: 'POST',
      body: JSON.stringify({
        ranges: tabsToClear.map((t) => `${t}!A2:Z`),
      }),
    }
  );

  // Re-write headers (in case of new schema) and re-append from DB.
  // Headers were already written at provision time — skip if unchanged.

  const tasks = await query(
    `SELECT task_id FROM tasks
     WHERE brand_id = $1 AND mode = 'deep' AND status = 'completed'
     ORDER BY created_at`,
    [brandId]
  );
  for (const row of tasks.rows as Array<{ task_id: string }>) {
    await syncDeepTaskToSheet(row.task_id);
  }
}
