import { query } from '@/lib/db';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;

    const result = await query(
      `SELECT task_id, status, config, total_items, completed_items, created_at, updated_at
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

    return Response.json({
      task_id: task.task_id,
      status: task.status,
      total_items: task.total_items,
      completed_items: task.completed_items,
      percentage,
      config: task.config,
      created_at: task.created_at,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
