import { query } from '@/lib/db';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;

    const result = await query(
      `SELECT r.result_id, r.task_id, r.file_id, r.row_index, r.content_text,
              r.condition_result, r.x_score, r.y_score, r.reasoning,
              r.engagement_value, r.status,
              f.filename as source_file
       FROM task_results r
       JOIN task_files f ON r.file_id = f.file_id
       WHERE r.task_id = $1
       ORDER BY r.row_index`,
      [taskId]
    );

    return Response.json({ results: result.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
