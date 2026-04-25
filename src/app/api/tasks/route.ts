import { query } from '@/lib/db';
import { migrate } from '@/lib/migrate';
import { processTask } from '@/lib/scoring';
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

let migrated = false;

async function ensureMigrated() {
  if (!migrated) {
    await migrate();
    migrated = true;
  }
}

// Stages applicable to a deep task vary by platform: FB runs A+B+C, others run A only.
function deepStagesForPlatform(platform: Platform): Array<typeof ALL_DEEP_STAGES[number]> {
  if (platform === 'fb') return [...ALL_DEEP_STAGES];
  return ALL_DEEP_STAGES.filter((s) => s.startsWith('A_'));
}

export async function POST(request: Request) {
  try {
    await ensureMigrated();

    const body = await request.json();
    const { browserUuid, config, files, mode } = body;

    if (!browserUuid || !config || !files || !Array.isArray(files) || files.length === 0) {
      return Response.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    const taskMode: 'light' | 'deep' = mode === 'deep' ? 'deep' : 'light';
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
          return Response.json({ error: err.message, field: err.field }, { status: 400 });
        }
        throw err;
      }

      const platform = config.platform as Platform;
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
            mode, brand_id, time_range_start, time_range_end, platform)
         VALUES ($1, $2, 'pending', $3, 0, 'deep', $4, $5, $6, $7)`,
        [
          taskId,
          browserUuid,
          JSON.stringify(config),
          config.brandId,
          config.timeRangeStart,
          config.timeRangeEnd,
          platform,
        ]
      );

      await bindPromptVersionsToTask(taskId, stageBindings);

      // Files for deep mode arrive as { filename, role, columnMapping, data, forumFilter? }.
      const deepFiles: DeepFileInput[] = (files as DeepFileInput[]).map((f) => ({
        filename: f.filename,
        role: f.role,
        columnMapping: f.columnMapping,
        data: f.data,
        forumFilter: f.forumFilter ?? null,
      }));

      const init = await initializeDeepTask({ taskId, platform, files: deepFiles });
      runDeepTask(taskId).catch((err) => {
        console.error(`Deep task ${taskId} failed:`, err);
      });

      return Response.json({
        task_id: taskId,
        mode: 'deep',
        stages,
        total_items: init.totalItems,
      });
    }

    // Light-mode path (unchanged from prior behavior)
    let totalItems = 0;

    await query(
      `INSERT INTO tasks (task_id, browser_uuid, status, config, total_items, mode)
       VALUES ($1, $2, 'pending', $3, 0, 'light')`,
      [taskId, browserUuid, JSON.stringify(config)]
    );

    const maxRows = config.maxRows > 0 ? config.maxRows : Infinity;

    for (const file of files) {
      if (totalItems >= maxRows) break;

      const fileId = uuidv4();
      const rowsToProcess = Math.min(file.data.length, maxRows - totalItems);

      await query(
        `INSERT INTO task_files (file_id, task_id, filename, column_mapping, row_count)
         VALUES ($1, $2, $3, $4, $5)`,
        [fileId, taskId, file.filename, JSON.stringify(file.columnMapping), rowsToProcess]
      );

      for (let i = 0; i < rowsToProcess; i++) {
        const row = file.data[i];
        const resultId = uuidv4();
        const contentText = String(row[file.contentColumn] || '');
        const engagementValue = file.engagementColumn
          ? Number(row[file.engagementColumn]) || 0
          : null;

        await query(
          `INSERT INTO task_results (result_id, task_id, file_id, row_index, content_text, engagement_value, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
          [resultId, taskId, fileId, totalItems + i, contentText, engagementValue]
        );
      }

      totalItems += rowsToProcess;
    }

    await query('UPDATE tasks SET total_items = $1 WHERE task_id = $2', [totalItems, taskId]);
    processTask(taskId).catch(() => {});

    return Response.json({ task_id: taskId, mode: 'light' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    await ensureMigrated();

    const { searchParams } = new URL(request.url);
    const browserUuid = searchParams.get('browserUuid');

    if (!browserUuid) {
      return Response.json({ error: '缺少 browserUuid' }, { status: 400 });
    }

    const result = await query(
      `SELECT task_id, status, config, total_items, completed_items, created_at, updated_at,
              mode, brand_id, time_range_start, time_range_end, platform, sheet_sync_status
       FROM tasks
       WHERE browser_uuid = $1
       ORDER BY created_at DESC`,
      [browserUuid]
    );

    return Response.json({ tasks: result.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}

