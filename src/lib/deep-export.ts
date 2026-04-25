import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { query } from './db';

interface DeepRow {
  task_id: string;
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
}

interface AggregateRow {
  platform: string;
  weighted_avg_favor: number | null;
  weighted_avg_emotion: number | null;
  total_weight: number;
  sample_count: number;
  quadrant_tr_pct: number;
  quadrant_tl_pct: number;
  quadrant_bl_pct: number;
  quadrant_br_pct: number;
}

interface TaskMeta {
  task_id: string;
  brand_id: string;
  brand_name: string;
  platform: string;
  time_range_start: string;
  time_range_end: string;
  created_at: string;
  project_name: string;
  prompt_version_ids: string[];
  model_snapshots: string[];
  calibration_set_id: string | null;
  calibration_mapping_id: string | null;
  rho_emotion: number | null;
  rho_favor: number | null;
}

const ROW_THRESHOLD_FOR_ASYNC = 2000;

async function loadTaskMeta(taskId: string): Promise<TaskMeta> {
  const row = await query(
    `SELECT t.task_id, t.brand_id, t.platform, t.time_range_start, t.time_range_end,
            t.created_at, t.config, b.name AS brand_name, b.calibration_set_id
     FROM tasks t JOIN brands b ON b.id = t.brand_id
     WHERE t.task_id = $1`,
    [taskId]
  );
  if (row.rows.length === 0) throw new Error(`Task ${taskId} not found`);
  const t = row.rows[0] as {
    task_id: string;
    brand_id: string;
    platform: string;
    time_range_start: string;
    time_range_end: string;
    created_at: Date | string;
    config: Record<string, unknown>;
    brand_name: string;
    calibration_set_id: string | null;
  };

  const bindings = await query(
    `SELECT pb.prompt_version_id, pv.model_snapshot
     FROM task_prompt_bindings pb JOIN prompt_versions pv ON pv.id = pb.prompt_version_id
     WHERE pb.task_id = $1`,
    [taskId]
  );
  const pvIds: string[] = (bindings.rows as Array<{ prompt_version_id: string }>).map(
    (r) => r.prompt_version_id
  );
  const models: string[] = Array.from(
    new Set(
      (bindings.rows as Array<{ model_snapshot: string }>).map((r) => r.model_snapshot)
    )
  );

  // Look up the calibration mapping in use, if any
  let mappingId: string | null = null;
  let rhoEmotion: number | null = null;
  let rhoFavor: number | null = null;
  if (t.calibration_set_id && bindings.rows.length > 0 && models.length > 0) {
    const m = await query(
      `SELECT id, rank_rho_emotion, rank_rho_favor
       FROM calibration_mappings
       WHERE set_id = $1 AND new_model = $2 AND new_prompt_version_id = ANY($3::uuid[])
       LIMIT 1`,
      [t.calibration_set_id, models[0], pvIds]
    );
    if (m.rows[0]) {
      const mr = m.rows[0] as {
        id: string;
        rank_rho_emotion: number | null;
        rank_rho_favor: number | null;
      };
      mappingId = mr.id;
      rhoEmotion = mr.rank_rho_emotion;
      rhoFavor = mr.rank_rho_favor;
    }
  }

  return {
    task_id: t.task_id,
    brand_id: t.brand_id,
    brand_name: t.brand_name,
    platform: t.platform,
    time_range_start: t.time_range_start,
    time_range_end: t.time_range_end,
    created_at:
      t.created_at instanceof Date ? t.created_at.toISOString() : String(t.created_at),
    project_name: String((t.config as { projectName?: string }).projectName ?? ''),
    prompt_version_ids: pvIds,
    model_snapshots: models,
    calibration_set_id: t.calibration_set_id,
    calibration_mapping_id: mappingId,
    rho_emotion: rhoEmotion,
    rho_favor: rhoFavor,
  };
}

async function loadCurrentDetail(taskId: string): Promise<DeepRow[]> {
  const result = await query(
    `SELECT task_id, stage_name, content_text, emotion_raw, emotion_calibrated,
            favor_raw, favor_calibrated, related_score, engagement_value,
            posted_at, post_url, parent_post_url, platform
     FROM task_results
     WHERE task_id = $1
       AND COALESCE(filtered_out, FALSE) = FALSE
       AND COALESCE(not_real_user, FALSE) = FALSE
       AND favor_calibrated IS NOT NULL
     ORDER BY platform, favor_calibrated DESC, engagement_value DESC NULLS LAST`,
    [taskId]
  );
  return result.rows as DeepRow[];
}

async function loadCurrentAggregates(taskId: string): Promise<AggregateRow[]> {
  const result = await query(
    `SELECT platform, weighted_avg_favor, weighted_avg_emotion, total_weight, sample_count,
            quadrant_tr_pct, quadrant_tl_pct, quadrant_bl_pct, quadrant_br_pct
     FROM deep_task_aggregates WHERE task_id = $1`,
    [taskId]
  );
  return result.rows as AggregateRow[];
}

async function loadHistoricalSummary(brandId: string): Promise<Array<Record<string, unknown>>> {
  const result = await query(
    `SELECT t.task_id, t.created_at, t.platform, t.time_range_start, t.time_range_end,
            a.sample_count, a.weighted_avg_favor, a.weighted_avg_emotion,
            a.quadrant_tr_pct, a.quadrant_tl_pct, a.quadrant_bl_pct, a.quadrant_br_pct
     FROM tasks t LEFT JOIN deep_task_aggregates a
       ON a.task_id = t.task_id AND a.platform = t.platform
     WHERE t.brand_id = $1 AND t.mode = 'deep' AND t.status = 'completed'
     ORDER BY t.created_at`,
    [brandId]
  );
  return result.rows as Array<Record<string, unknown>>;
}

// Build a deep XLSX with 4 sheets: current_detail, current_aggregate,
// historical_summary, metadata.
export async function generateDeepXlsx(taskId: string): Promise<Buffer> {
  const meta = await loadTaskMeta(taskId);
  const [detail, aggregates, historical] = await Promise.all([
    loadCurrentDetail(taskId),
    loadCurrentAggregates(taskId),
    loadHistoricalSummary(meta.brand_id),
  ]);

  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      detail.map((r) => ({
        ...r,
        posted_at: r.posted_at ? new Date(r.posted_at).toISOString() : null,
      }))
    ),
    'current_detail'
  );

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(aggregates), 'current_aggregate');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(historical), 'historical_summary');

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { key: 'task_id', value: meta.task_id },
      { key: 'brand', value: meta.brand_name },
      { key: 'platform', value: meta.platform },
      { key: 'time_range', value: `${meta.time_range_start} ~ ${meta.time_range_end}` },
      { key: 'created_at', value: meta.created_at },
      { key: 'prompt_version_ids', value: meta.prompt_version_ids.join(',') },
      { key: 'model_snapshots', value: meta.model_snapshots.join(',') },
      { key: 'calibration_set_id', value: meta.calibration_set_id ?? '' },
      { key: 'calibration_mapping_id', value: meta.calibration_mapping_id ?? '' },
      { key: 'rho_emotion', value: meta.rho_emotion ?? '' },
      { key: 'rho_favor', value: meta.rho_favor ?? '' },
    ]),
    'metadata'
  );

  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return out;
}

// Build a ZIP bundle containing chart PNGs + metadata.json. The PNG bytes are
// passed in by the caller — they are rendered client-side and uploaded if the
// generation runs server-side, or assembled directly in the browser.
export interface ChartBundleInputs {
  taskId: string;
  charts: Array<{ filename: string; pngBytes: Uint8Array }>;
}

export async function generateChartBundle(input: ChartBundleInputs): Promise<Buffer> {
  const meta = await loadTaskMeta(input.taskId);
  const zip = new JSZip();
  for (const chart of input.charts) {
    zip.file(chart.filename, chart.pngBytes);
  }
  zip.file(
    'metadata.json',
    JSON.stringify(
      {
        task_id: meta.task_id,
        brand: meta.brand_name,
        platform: meta.platform,
        time_range: { start: meta.time_range_start, end: meta.time_range_end },
        prompt_version_ids: meta.prompt_version_ids,
        model_snapshots: meta.model_snapshots,
        calibration_set_id: meta.calibration_set_id,
        calibration_mapping_id: meta.calibration_mapping_id,
        rho_emotion: meta.rho_emotion,
        rho_favor: meta.rho_favor,
      },
      null,
      2
    )
  );
  return await zip.generateAsync({ type: 'nodebuffer' });
}

// Decide whether to run async based on row count.
export async function shouldRunBundleAsync(taskId: string): Promise<boolean> {
  const result = await query(
    `SELECT COUNT(*)::int AS n FROM task_results WHERE task_id = $1`,
    [taskId]
  );
  const n = (result.rows[0] as { n: number }).n;
  return n > ROW_THRESHOLD_FOR_ASYNC;
}
