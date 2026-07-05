import { errorResponse, internalError, validationError } from '@/lib/error-response';
import { TaskInputSchema, firstIssueMessage } from '@/lib/schemas';
import { query, withTransaction } from '@/lib/db';
import { ensureMigrated } from '@/lib/ensure-migrated';
import { requireSession } from '@/lib/require-session';
import { processTask } from '@/lib/scoring';
import {
  MAX_BODY_BYTES,
  validateBatchInput,
  validateTaskInput,
  type BatchPlatformGroup,
} from '@/lib/validate-task-input';
import { runBatch } from '@/lib/deep-pipeline/batch-runner';
import {
  DeepTaskValidationError,
  validateDeepTaskFields,
  type Platform,
} from '@/lib/brands';
import {
  ALL_DEEP_STAGES,
  bindPromptVersionsToTask,
  getDefaultStageBindings,
} from '@/lib/prompt-versions';
import {
  initializeDeepTask,
  runDeepTask,
  type DeepFileInput,
} from '@/lib/deep-pipeline/orchestrator';
import { v4 as uuidv4 } from 'uuid';

// Stages applicable to a deep task vary by platform: FB runs A+B+C, others run A only.
function deepStagesForPlatform(platform: Platform): Array<typeof ALL_DEEP_STAGES[number]> {
  if (platform === 'fb') return [...ALL_DEEP_STAGES];
  return ALL_DEEP_STAGES.filter((s) => s.startsWith('A_'));
}

// Create one deep task (tasks row + prompt bindings + rows). Shared by the
// single-platform path and the multi-platform batch fan-out. Does NOT start
// execution — callers decide (single: immediately; batch: sequential runner).
async function createDeepTask(
  browserUuid: string,
  config: Record<string, unknown>,
  platform: Platform,
  files: DeepFileInput[],
  batchId: string | null = null
): Promise<{ taskId: string; totalItems: number; stages: string[] }> {
  const taskId = uuidv4();
  const stages = deepStagesForPlatform(platform);

  // Allow per-stage prompt version override; otherwise use the active version.
  const stageBindings = await getDefaultStageBindings(stages);
  if (config.promptVersionOverrides && typeof config.promptVersionOverrides === 'object') {
    for (const stage of stages) {
      const override = (config.promptVersionOverrides as Record<string, string>)[stage];
      if (override) stageBindings[stage] = override;
    }
  }

  await query(
    `INSERT INTO tasks
       (task_id, browser_uuid, status, config, total_items,
        mode, brand_id, time_range_start, time_range_end, platform, batch_id)
     VALUES ($1, $2, 'pending', $3, 0, 'deep', $4, $5, $6, $7, $8)`,
    [
      taskId,
      browserUuid,
      JSON.stringify({ ...config, platform }),
      config.brandId,
      config.timeRangeStart,
      config.timeRangeEnd,
      platform,
      batchId,
    ]
  );

  await bindPromptVersionsToTask(taskId, stageBindings);

  const deepFiles: DeepFileInput[] = files.map((f) => ({
    filename: f.filename,
    role: f.role,
    columnMapping: f.columnMapping,
    data: f.data,
    forumFilter: f.forumFilter ?? null,
  }));

  const init = await initializeDeepTask({ taskId, platform, files: deepFiles });
  return { taskId, totalItems: init.totalItems, stages };
}

export async function POST(request: Request) {
  const { response: authResponse } = await requireSession();
  if (authResponse) return authResponse;

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) {
    return errorResponse(
      'PAYLOAD_TOO_LARGE',
      `請求內容超過 ${MAX_BODY_BYTES / 1024 / 1024}MB 上限`,
      413
    );
  }

  try {
    await ensureMigrated();

    const body = await request.json();

    // Structural gate first (spec "Task creation input validation", zod
    // clause); business validators below own row caps and role semantics.
    const parsed = TaskInputSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('VALIDATION', firstIssueMessage(parsed.error), 400);
    }

    const { browserUuid, config, files, mode } = body;

    // Multi-platform batch: one submission → one task per platform, executed
    // sequentially (spec "Batch upload creates one task per platform").
    if (mode === 'deep-batch') {
      if (!browserUuid || !config) {
        return errorResponse('VALIDATION', '缺少必要欄位', 400);
      }
      const groups = body.platforms as BatchPlatformGroup[] | undefined;
      const batchValidation = validateBatchInput(groups);
      if (!batchValidation.ok) {
        return validationError(batchValidation.error, batchValidation.status);
      }
      // Validate the shared deep fields once per platform BEFORE creating
      // anything — an invalid batch creates zero tasks.
      for (const platform of batchValidation.platforms) {
        try {
          validateDeepTaskFields({
            brandId: config.brandId,
            platform,
            timeRangeStart: config.timeRangeStart,
            timeRangeEnd: config.timeRangeEnd,
          });
        } catch (err) {
          if (err instanceof DeepTaskValidationError) {
            return errorResponse('VALIDATION', `${err.field}: ${err.message}`, 400);
          }
          throw err;
        }
      }

      // All tasks of one submission share a batch_id (single-card history).
      const batchId = uuidv4();
      const created: Array<{ task_id: string; platform: Platform; total_items: number }> = [];
      for (const group of groups as Array<{ platform: Platform; files: DeepFileInput[] }>) {
        const { taskId, totalItems } = await createDeepTask(
          browserUuid,
          config,
          group.platform,
          group.files,
          batchId
        );
        created.push({ task_id: taskId, platform: group.platform, total_items: totalItems });
      }

      // Fire-and-forget: the runner awaits each task in order; recovery takes
      // over the remainder after a restart (claim prevents double-running).
      runBatch(created.map((t) => t.task_id)).catch((err) => {
        console.error('batch runner crashed:', err);
      });

      return Response.json({ mode: 'deep-batch', tasks: created });
    }

    if (!browserUuid || !config || !files || !Array.isArray(files) || files.length === 0) {
      return errorResponse('VALIDATION', '缺少必要欄位', 400);
    }

    const validation = validateTaskInput({ mode, config, files });
    if (!validation.ok) {
      return validationError(validation.error, validation.status);
    }

    const taskMode: 'light' | 'deep' = validation.mode;
    const taskId = uuidv4();

    if (taskMode === 'deep') {
      try {
        validateDeepTaskFields({
          brandId: config.brandId,
          platform: config.platform as Platform,
          timeRangeStart: config.timeRangeStart,
          timeRangeEnd: config.timeRangeEnd,
        });
      } catch (err) {
        if (err instanceof DeepTaskValidationError) {
          return errorResponse('VALIDATION', `${err.field}: ${err.message}`, 400);
        }
        throw err;
      }

      const platform = config.platform as Platform;
      const { taskId: deepTaskId, totalItems, stages } = await createDeepTask(
        browserUuid,
        config,
        platform,
        files as DeepFileInput[]
      );
      runDeepTask(deepTaskId).catch((err) => {
        console.error(`Deep task ${deepTaskId} failed:`, err);
      });

      return Response.json({
        task_id: deepTaskId,
        mode: 'deep',
        stages,
        total_items: totalItems,
      });
    }

    // Light-mode path: batched, transactional initialization (spec "Atomic
    // batched task initialization").
    let totalItems = 0;
    const maxRows = config.maxRows > 0 ? config.maxRows : Infinity;

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO tasks (task_id, browser_uuid, status, config, total_items, mode)
         VALUES ($1, $2, 'pending', $3, 0, 'light')`,
        [taskId, browserUuid, JSON.stringify(config)]
      );

      for (const file of files) {
        if (totalItems >= maxRows) break;

        const fileId = uuidv4();
        const rowsToProcess = Math.min(file.data.length, maxRows - totalItems);

        await client.query(
          `INSERT INTO task_files (file_id, task_id, filename, column_mapping, row_count)
           VALUES ($1, $2, $3, $4, $5)`,
          [fileId, taskId, file.filename, JSON.stringify(file.columnMapping), rowsToProcess]
        );

        const BATCH = 500;
        for (let start = 0; start < rowsToProcess; start += BATCH) {
          const end = Math.min(start + BATCH, rowsToProcess);
          const params: unknown[] = [];
          const tuples: string[] = [];
          for (let i = start; i < end; i++) {
            const row = file.data[i];
            const contentText = String(row[file.contentColumn] || '');
            const engagementValue = file.engagementColumn
              ? Number(row[file.engagementColumn]) || 0
              : null;
            const base = params.length;
            params.push(uuidv4(), taskId, fileId, totalItems + i, contentText, engagementValue);
            tuples.push(
              `(${Array.from({ length: 6 }, (_, k) => `$${base + k + 1}`).join(', ')}, 'pending')`
            );
          }
          await client.query(
            `INSERT INTO task_results (result_id, task_id, file_id, row_index, content_text, engagement_value, status)
             VALUES ${tuples.join(', ')}`,
            params
          );
        }

        totalItems += rowsToProcess;
      }

      await client.query('UPDATE tasks SET total_items = $1 WHERE task_id = $2', [
        totalItems,
        taskId,
      ]);
    });

    processTask(taskId).catch(() => {});

    return Response.json({ task_id: taskId, mode: 'light' });
  } catch (error) {
    return internalError(error);
  }
}

export async function GET(request: Request) {
  const { response: authResponse } = await requireSession();
  if (authResponse) return authResponse;

  try {
    await ensureMigrated();

    const { searchParams } = new URL(request.url);
    const browserUuid = searchParams.get('browserUuid');
    const batchId = searchParams.get('batchId');

    if (!browserUuid && !batchId) {
      return errorResponse('VALIDATION', '缺少 browserUuid 或 batchId', 400);
    }

    // batchId filter serves the shareable /batch/[batchId] page: tasks are
    // team-shared, so any member may list a batch by id (browserUuid remains
    // a display-scoping convenience, not an authorization boundary).
    const result = await query(
      `SELECT task_id, status, config, total_items, completed_items, created_at, updated_at,
              mode, brand_id, time_range_start, time_range_end, platform, sheet_sync_status, batch_id
       FROM tasks
       WHERE ${batchId ? 'batch_id' : 'browser_uuid'} = $1
       ORDER BY created_at DESC`,
      [batchId ?? browserUuid]
    );

    return Response.json({ tasks: result.rows });
  } catch (error) {
    return internalError(error);
  }
}

