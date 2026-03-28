import { query } from './db';
import { processTask } from './scoring';

export async function recoverIncompleteTasks() {
  try {
    const result = await query(
      "SELECT task_id FROM tasks WHERE status = 'processing'"
    );

    for (const row of result.rows) {
      console.log(`Recovering incomplete task: ${row.task_id}`);
      processTask(row.task_id).catch(err => {
        console.error(`Failed to recover task ${row.task_id}:`, err);
      });
    }

    if (result.rows.length > 0) {
      console.log(`Recovered ${result.rows.length} incomplete task(s)`);
    }
  } catch {
    // DB might not be ready yet, silently ignore
  }
}
