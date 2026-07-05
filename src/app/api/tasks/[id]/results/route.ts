import { query } from '@/lib/db';
import { requireSession } from '@/lib/require-session';
import { internalError } from '@/lib/error-response';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response: authResponse } = await requireSession();
  if (authResponse) return authResponse;

  try {
    const { id: taskId } = await params;

    // view=chart (spec "Chart-weight results retrieval"): drop the large text
    // columns — charts need coordinates and flags, not full post texts.
    const chartView = new URL(request.url).searchParams.get('view') === 'chart';
    const textColumns = chartView
      ? `'' AS content_text, NULL AS reasoning, NULL AS source_file`
      : `r.content_text, r.reasoning, f.filename AS source_file`;

    const result = await query(
      `SELECT r.result_id, r.task_id, r.file_id, r.row_index,
              r.condition_result, r.x_score, r.y_score,
              r.engagement_value, r.status,
              r.emotion_calibrated, r.favor_calibrated,
              r.filtered_out, r.not_real_user, r.platform,
              ${textColumns}
       FROM task_results r
       JOIN task_files f ON r.file_id = f.file_id
       WHERE r.task_id = $1
       ORDER BY r.row_index`,
      [taskId]
    );

    const rows = result.rows.map(row => ({
      ...row,
      x_score: row.x_score !== null ? parseFloat(row.x_score) : null,
      y_score: row.y_score !== null ? parseFloat(row.y_score) : null,
      engagement_value: row.engagement_value !== null ? parseFloat(row.engagement_value) : null,
      // Deep-mode fields: the weighted scatter plots calibrated scores.
      emotion_calibrated: row.emotion_calibrated !== null ? parseFloat(row.emotion_calibrated) : null,
      favor_calibrated: row.favor_calibrated !== null ? parseFloat(row.favor_calibrated) : null,
    }));

    return Response.json({ results: rows });
  } catch (error) {
    return internalError(error);
  }
}
