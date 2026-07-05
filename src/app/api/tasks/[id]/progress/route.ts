import { query } from '@/lib/db';
import { getDeepTaskAggregates } from '@/lib/deep-pipeline/aggregate';
import { getStageProgress } from '@/lib/deep-pipeline/orchestrator';
import { requireSession } from '@/lib/require-session';
import { errorResponse, internalError } from '@/lib/error-response';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response: authResponse } = await requireSession();
  if (authResponse) return authResponse;

  try {
    const { id: taskId } = await params;

    const result = await query(
      `SELECT task_id, status, mode, config, total_items, completed_items, created_at, updated_at
       FROM tasks WHERE task_id = $1`,
      [taskId]
    );

    if (result.rows.length === 0) {
      return errorResponse('NOT_FOUND', '找不到此任務', 404);
    }

    const task = result.rows[0];
    const percentage = task.total_items > 0
      ? Math.round((task.completed_items / task.total_items) * 100)
      : 0;

    const stages = task.mode === 'deep' ? await getStageProgress(taskId) : [];

    // Deep tasks carry their persisted aggregates (quadrants, centroid, weekly
    // buckets) and the brand's platform display settings, so the results view
    // renders charts without extra round trips.
    let aggregates: unknown = undefined;
    let platformSettings: unknown = undefined;
    if (task.mode === 'deep') {
      aggregates = await getDeepTaskAggregates(taskId);
      const brand = await query(
        `SELECT b.platform_settings FROM brands b JOIN tasks t ON t.brand_id = b.id
         WHERE t.task_id = $1`,
        [taskId]
      );
      platformSettings =
        (brand.rows[0] as { platform_settings?: unknown } | undefined)?.platform_settings ?? null;
    }

    return Response.json({
      task_id: task.task_id,
      status: task.status,
      mode: task.mode,
      total_items: task.total_items,
      completed_items: task.completed_items,
      percentage,
      config: task.config,
      created_at: task.created_at,
      stages,
      ...(task.mode === 'deep' ? { aggregates, platform_settings: platformSettings } : {}),
    });
  } catch (error) {
    return internalError(error);
  }
}
