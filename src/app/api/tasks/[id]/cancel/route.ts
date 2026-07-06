import { query } from '@/lib/db';
import { requireSession } from '@/lib/require-session';
import { errorResponse, internalError } from '@/lib/error-response';

// Cooperative cancellation entry point (spec "Cooperative task cancellation"):
// sets the persistent flag; the running loop observes it via the heartbeat
// read-back within 30 seconds, the batch runner before starting a queued
// task, and startup recovery for tasks whose runner died first.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response: authResponse } = await requireSession();
  if (authResponse) return authResponse;

  try {
    const { id: taskId } = await params;
    const flagged = await query(
      `UPDATE tasks SET cancel_requested = TRUE, updated_at = NOW()
       WHERE task_id = $1 AND status IN ('pending', 'processing')
       RETURNING status`,
      [taskId]
    );
    if (flagged.rows.length === 0) {
      const existing = await query(`SELECT status FROM tasks WHERE task_id = $1`, [taskId]);
      if (existing.rows.length === 0) {
        return errorResponse('NOT_FOUND', '找不到此任務', 404);
      }
      return errorResponse('VALIDATION', '任務已結束，無法取消', 400);
    }
    return Response.json({ task_id: taskId, cancel_requested: true });
  } catch (error) {
    return internalError(error);
  }
}
