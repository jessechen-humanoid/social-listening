import { query } from './db';
import { processTask } from './scoring';
import { runDeepTask } from './deep-pipeline/orchestrator';

export async function recoverIncompleteTasks() {
  try {
    const result = await query(
      `SELECT task_id, mode FROM tasks WHERE status IN ('processing', 'pending')`
    );

    let recovered = 0;
    for (const row of result.rows as Array<{ task_id: string; mode: string }>) {
      // Light tasks: re-run scoring loop (idempotent over pending rows).
      // Deep tasks: re-enter the orchestrator, which skips already-completed stages.
      if (row.mode === 'deep') {
        console.log(`Recovering deep task: ${row.task_id}`);
        runDeepTask(row.task_id).catch((err) => {
          console.error(`Failed to recover deep task ${row.task_id}:`, err);
        });
      } else {
        console.log(`Recovering light task: ${row.task_id}`);
        processTask(row.task_id).catch((err) => {
          console.error(`Failed to recover light task ${row.task_id}:`, err);
        });
      }
      recovered++;
    }

    if (recovered > 0) {
      console.log(`Recovered ${recovered} incomplete task(s)`);
    }
  } catch {
    // DB might not be ready yet, silently ignore
  }
}
