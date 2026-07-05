import { query } from '@/lib/db';
import { requireSession } from '@/lib/require-session';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response: authResponse } = await requireSession();
  if (authResponse) return authResponse;

  try {
    const { id: taskId } = await params;

    // CASCADE will delete task_files and task_results
    const result = await query(
      'DELETE FROM tasks WHERE task_id = $1 RETURNING task_id',
      [taskId]
    );

    if (result.rows.length === 0) {
      return Response.json({ error: '找不到此任務' }, { status: 404 });
    }

    return Response.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
