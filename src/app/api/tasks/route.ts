import { query } from '@/lib/db';
import { migrate } from '@/lib/migrate';
import { processTask } from '@/lib/scoring';
import { v4 as uuidv4 } from 'uuid';

let migrated = false;

async function ensureMigrated() {
  if (!migrated) {
    await migrate();
    migrated = true;
  }
}

export async function POST(request: Request) {
  try {
    await ensureMigrated();

    const body = await request.json();
    const { browserUuid, config, files } = body;

    if (!browserUuid || !config || !files || !Array.isArray(files) || files.length === 0) {
      return Response.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    const taskId = uuidv4();
    let totalItems = 0;

    // Create task
    await query(
      `INSERT INTO tasks (task_id, browser_uuid, status, config, total_items)
       VALUES ($1, $2, 'pending', $3, 0)`,
      [taskId, browserUuid, JSON.stringify(config)]
    );

    // Create file records and result records
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

    // Update total_items
    await query('UPDATE tasks SET total_items = $1 WHERE task_id = $2', [totalItems, taskId]);

    // Start processing in background (don't await)
    processTask(taskId).catch(() => {});

    return Response.json({ task_id: taskId });
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
      `SELECT task_id, status, config, total_items, completed_items, created_at, updated_at
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
