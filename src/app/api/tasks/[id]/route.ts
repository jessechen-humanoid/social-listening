import { query } from '@/lib/db';
import { requireSession } from '@/lib/require-session';
import { errorResponse, internalError } from '@/lib/error-response';

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
      return errorResponse('NOT_FOUND', '找不到此任務', 404);
    }

    return Response.json({ success: true });
  } catch (error) {
    return internalError(error);
  }
}
