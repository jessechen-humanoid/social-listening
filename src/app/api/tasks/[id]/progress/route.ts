import { query } from '@/lib/db';
import { getStageProgress } from '@/lib/deep-pipeline/orchestrator';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;

    const result = await query(
      `SELECT task_id, status, mode, config, total_items, completed_items, created_at, updated_at
       FROM tasks WHERE task_id = $1`,
      [taskId]
    );

    if (result.rows.length === 0) {
      return Response.json({ error: '找不到此任務' }, { status: 404 });
    }

    const task = result.rows[0];
    const percentage = task.total_items > 0
      ? Math.round((task.completed_items / task.total_items) * 100)
      : 0;

    const stages = task.mode === 'deep' ? await getStageProgress(taskId) : [];

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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
