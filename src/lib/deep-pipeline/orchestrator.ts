import { v4 as uuidv4 } from 'uuid';
import { query } from '../db';
import type { Platform } from '../brands';
import type { PromptVersion } from '../prompt-versions';
import { getPromptByVersionId, getTaskPromptBindings } from '../prompt-versions';
import type { DeepStageName } from '../seed-prompts';
import type { FileRole, ColumnMapping } from '../column-mapping';
import { applyTaskCalibration } from '../calibration';
import { aggregateDeepTask } from './aggregate';
import { syncDeepTaskWithRetry } from '../google-sheets';
import {
  runStageARelatedFilter,
  runStageAEmotionFavor,
  runStageBLink,
  runStageBTagFriendFilter,
  runStageBEmotionFavor,
  runStageCDedupe,
  runStageCEmotionFavor,
  type StageContext,
  type StageOutcome,
} from './stages';

// Pipeline-level stage names: same as DeepStageName plus the non-AI link/dedupe steps.
export type PipelineStageName =
  | DeepStageName
  | 'B_link'
  | 'C_dedupe';

const STAGE_RUNNERS: Record<
  PipelineStageName,
  (ctx: StageContext) => Promise<StageOutcome>
> = {
  A_related_filter: runStageARelatedFilter,
  A_emotion_favor: runStageAEmotionFavor,
  B_link: runStageBLink,
  B_tag_friend_filter: runStageBTagFriendFilter,
  B_emotion_favor: runStageBEmotionFavor,
  C_dedupe: runStageCDedupe,
  C_emotion_favor: runStageCEmotionFavor,
};

export function pipelineStagesForPlatform(platform: Platform): PipelineStageName[] {
  if (platform === 'fb') {
    return [
      'A_related_filter',
      'A_emotion_favor',
      'B_link',
      'B_tag_friend_filter',
      'B_emotion_favor',
      'C_dedupe',
      'C_emotion_favor',
    ];
  }
  return ['A_related_filter', 'A_emotion_favor'];
}

// Map a pipeline stage to the broad task_results.stage_name bucket (A / B / C).
// B_link and C_dedupe operate on the bucket their prefix names.
function stageBucket(stage: PipelineStageName): 'A' | 'B' | 'C' {
  if (stage.startsWith('A_')) return 'A';
  if (stage.startsWith('B_')) return 'B';
  return 'C';
}

// Stage rows (for task_results inserts) per file role.
const ROLE_TO_BUCKET: Record<FileRole, 'A' | 'B' | 'C'> = {
  hotpost: 'A',
  hotcomment: 'C',
  comments_from_posts: 'B',
};

export interface DeepFileInput {
  filename: string;
  role: FileRole;
  columnMapping: ColumnMapping;
  data: Array<Record<string, unknown>>;
  forumFilter?: string[] | null; // for Dcard
}

// Initialize task_files + task_results + deep_task_stages records for a deep task.
// Idempotent at the deep_task_stages level (caller guarantees task_id is fresh).
export async function initializeDeepTask(input: {
  taskId: string;
  platform: Platform;
  files: DeepFileInput[];
}): Promise<{ totalItems: number; stages: PipelineStageName[] }> {
  const stages = pipelineStagesForPlatform(input.platform);

  let totalItems = 0;

  for (const file of input.files) {
    const fileId = uuidv4();
    const bucket = ROLE_TO_BUCKET[file.role];
    const filteredRows = applyForumFilter(file.data, file.columnMapping, file.forumFilter);

    await query(
      `INSERT INTO task_files (file_id, task_id, filename, column_mapping, row_count, role)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        fileId,
        input.taskId,
        file.filename,
        JSON.stringify(file.columnMapping),
        filteredRows.length,
        file.role,
      ]
    );

    for (let i = 0; i < filteredRows.length; i++) {
      const row = filteredRows[i];
      const m = file.columnMapping;
      const content = m.content ? String(row[m.content] ?? '') : '';
      const engagement = m.engagement_value ? toNumber(row[m.engagement_value]) : null;
      const postedAt = m.posted_at ? toIsoOrNull(row[m.posted_at]) : null;
      const postUrl = m.post_url ? toStringOrNull(row[m.post_url]) : null;
      const commentUrl = m.comment_url ? toStringOrNull(row[m.comment_url]) : null;
      const parentPostUrl = m.parent_post_url
        ? toStringOrNull(row[m.parent_post_url])
        : null;

      await query(
        `INSERT INTO task_results
           (result_id, task_id, file_id, row_index, content_text,
            engagement_value, posted_at, post_url, parent_post_url, platform,
            stage_name, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')`,
        [
          uuidv4(),
          input.taskId,
          fileId,
          totalItems + i,
          content,
          engagement,
          postedAt,
          // For comment-bucket rows, post_url is the comment's own URL; for stage A rows
          // it's the post's URL. Both share the column.
          bucket === 'A' ? postUrl : commentUrl ?? postUrl,
          parentPostUrl,
          input.platform,
          bucket,
        ]
      );
    }
    totalItems += filteredRows.length;
  }

  for (const stage of stages) {
    await query(
      `INSERT INTO deep_task_stages (task_id, stage_name, status, input_count, output_count)
       VALUES ($1, $2, 'pending', 0, 0)
       ON CONFLICT (task_id, stage_name) DO NOTHING`,
      [input.taskId, stage]
    );
  }

  await query(`UPDATE tasks SET total_items = $1 WHERE task_id = $2`, [totalItems, input.taskId]);

  return { totalItems, stages };
}

// Run pending stages for a task. Picks up where it left off (idempotent).
// Stages already marked 'completed' are skipped.
export async function runDeepTask(taskId: string): Promise<void> {
  const taskRow = await query(
    `SELECT brand_id, platform FROM tasks WHERE task_id = $1`,
    [taskId]
  );
  if (taskRow.rows.length === 0) {
    throw new Error(`Task ${taskId} not found`);
  }
  const { brand_id: brandId, platform } = taskRow.rows[0] as {
    brand_id: string;
    platform: Platform;
  };

  const brandRow = await query(`SELECT name FROM brands WHERE id = $1`, [brandId]);
  if (brandRow.rows.length === 0) {
    throw new Error(`Brand ${brandId} not found`);
  }
  const brandName = (brandRow.rows[0] as { name: string }).name;

  const prompts = await loadPromptBindings(taskId);
  const ctx: StageContext = { taskId, brandName, prompts };

  const stages = pipelineStagesForPlatform(platform);
  await query(
    `UPDATE tasks SET status = 'processing', updated_at = NOW() WHERE task_id = $1`,
    [taskId]
  );

  try {
    for (const stage of stages) {
      const status = await getStageStatus(taskId, stage);
      if (status === 'completed') continue;

      // Skip B/C stages if the bucket has no rows (e.g., Dcard with no comments_from_posts)
      if (await stageBucketEmpty(taskId, stageBucket(stage))) {
        await query(
          `UPDATE deep_task_stages
           SET status = 'completed', started_at = NOW(), completed_at = NOW(),
               input_count = 0, output_count = 0
           WHERE task_id = $1 AND stage_name = $2`,
          [taskId, stage]
        );
        continue;
      }

      await query(
        `UPDATE deep_task_stages
         SET status = 'running', started_at = COALESCE(started_at, NOW()), error = NULL
         WHERE task_id = $1 AND stage_name = $2`,
        [taskId, stage]
      );

      const runner = STAGE_RUNNERS[stage];
      try {
        const outcome = await runner(ctx);
        await query(
          `UPDATE deep_task_stages
           SET status = 'completed', completed_at = NOW(),
               input_count = $3, output_count = $4
           WHERE task_id = $1 AND stage_name = $2`,
          [taskId, stage, outcome.inputCount, outcome.outputCount]
        );
        // Use completed_items as a coarse running total (per-row updates already
        // happen inside stage runners; this counter is best-effort UI feedback).
        await query(
          `UPDATE tasks SET completed_items = completed_items + $2, updated_at = NOW()
           WHERE task_id = $1`,
          [taskId, outcome.outputCount]
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await query(
          `UPDATE deep_task_stages
           SET status = 'error', error = $3, completed_at = NOW()
           WHERE task_id = $1 AND stage_name = $2`,
          [taskId, stage, msg]
        );
        await query(
          `UPDATE tasks SET status = 'error', updated_at = NOW() WHERE task_id = $1`,
          [taskId]
        );
        throw err;
      }
    }

    // Apply calibration mapping (raw → calibrated). Identity if no mapping exists.
    await applyTaskCalibration(taskId);

    // Compute weighted quadrants + weekly timeline aggregates
    await aggregateDeepTask(taskId);

    await query(
      `UPDATE tasks SET status = 'completed', updated_at = NOW() WHERE task_id = $1`,
      [taskId]
    );

    // Append to brand's Google Sheet ledger (best-effort; isolated from task status).
    syncDeepTaskWithRetry(taskId).catch((err) => {
      console.error(`Sheet sync failed for ${taskId}:`, err);
    });
  } catch (err) {
    // Already recorded above; rethrow for caller logging
    throw err;
  }
}

async function loadPromptBindings(
  taskId: string
): Promise<Map<DeepStageName, PromptVersion>> {
  const bindings = await getTaskPromptBindings(taskId);
  const map = new Map<DeepStageName, PromptVersion>();
  for (const b of bindings) {
    const pv = await getPromptByVersionId(b.prompt_version_id);
    if (pv) map.set(b.stage_name, pv);
  }
  return map;
}

async function getStageStatus(taskId: string, stage: PipelineStageName): Promise<string> {
  const result = await query(
    `SELECT status FROM deep_task_stages WHERE task_id = $1 AND stage_name = $2`,
    [taskId, stage]
  );
  return (result.rows[0] as { status?: string } | undefined)?.status ?? 'pending';
}

async function stageBucketEmpty(
  taskId: string,
  bucket: 'A' | 'B' | 'C'
): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM task_results WHERE task_id = $1 AND stage_name = $2 LIMIT 1`,
    [taskId, bucket]
  );
  return result.rows.length === 0;
}

function applyForumFilter(
  rows: Array<Record<string, unknown>>,
  mapping: ColumnMapping,
  forumFilter: string[] | null | undefined
): Array<Record<string, unknown>> {
  if (!forumFilter || !mapping.forum) return rows;
  const allowed = new Set(forumFilter);
  return rows.filter((r) => {
    const v = r[mapping.forum as string];
    return typeof v === 'string' && allowed.has(v.trim());
  });
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toIsoOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

// Stage-level snapshot for UI progress. Returns ordered stage list with status + counts.
export interface StageProgress {
  stage_name: PipelineStageName;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  input_count: number;
  output_count: number;
  error: string | null;
}

export async function getStageProgress(taskId: string): Promise<StageProgress[]> {
  const result = await query(
    `SELECT stage_name, status, started_at, completed_at, input_count, output_count, error
     FROM deep_task_stages
     WHERE task_id = $1`,
    [taskId]
  );
  // Order by canonical pipeline order (DB has no inherent order)
  const rowsByName = new Map(
    (result.rows as StageProgress[]).map((r) => [r.stage_name, r])
  );
  const taskRow = await query(`SELECT platform FROM tasks WHERE task_id = $1`, [taskId]);
  const platform = (taskRow.rows[0] as { platform?: Platform } | undefined)?.platform;
  if (!platform) return result.rows as StageProgress[];
  return pipelineStagesForPlatform(platform)
    .map((s) => rowsByName.get(s))
    .filter((r): r is StageProgress => Boolean(r));
}
