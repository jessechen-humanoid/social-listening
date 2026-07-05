import { query } from '@/lib/db';
import { applyTaskCalibration } from '@/lib/calibration';
import { aggregateDeepTask } from '@/lib/deep-pipeline/aggregate';
import { requireSession } from '@/lib/require-session';
import { errorResponse, internalError } from '@/lib/error-response';

// Recompute a completed deep task's calibrated scores and aggregates from the
// raw scores already in the DB — zero AI calls. Exists so historical tasks can
// be re-based onto a changed weight formula or a newly accepted calibration.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response: authResponse } = await requireSession();
  if (authResponse) return authResponse;

  try {
    const { id: taskId } = await params;
    const task = await query(
      `SELECT mode, status FROM tasks WHERE task_id = $1`,
      [taskId]
    );
    if (task.rows.length === 0) {
      return errorResponse('NOT_FOUND', '找不到此任務', 404);
    }
    const { mode, status } = task.rows[0] as { mode: string; status: string };
    if (mode !== 'deep' || status !== 'completed') {
      return errorResponse('VALIDATION', '只能重算已完成的深度任務', 400);
    }

    await applyTaskCalibration(taskId);
    const aggregates = await aggregateDeepTask(taskId);
    return Response.json({ ok: true, aggregates });
  } catch (error) {
    return internalError(error);
  }
}
