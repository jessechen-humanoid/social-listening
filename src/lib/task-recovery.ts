import { query } from './db';
import { processTask } from './scoring';
import { runDeepTask } from './deep-pipeline/orchestrator';
import { STALE_HEARTBEAT } from './task-claim';

// Resume tasks orphaned by a dead runner (spec "Startup recovery of incomplete
// tasks"): pending tasks, plus processing tasks whose heartbeat is stale or
// NULL. Tasks run sequentially — one at a time — to avoid stampeding the
// OpenAI quota after a restart. Each entry point re-checks via the atomic
// claim, so a task that a live runner picked up in the meantime is skipped.
export async function recoverIncompleteTasks() {
  let rows: Array<{ task_id: string; mode: string; cancel_requested?: boolean }>;
  try {
    const result = await query(
      `SELECT task_id, mode, cancel_requested FROM tasks
       WHERE status = 'pending'
          OR (status = 'processing'
              AND (heartbeat_at IS NULL OR heartbeat_at < NOW() - $1::interval))
       ORDER BY created_at`,
      [STALE_HEARTBEAT]
    );
    rows = result.rows as Array<{ task_id: string; mode: string; cancel_requested?: boolean }>;
  } catch (err) {
    console.error('task recovery: failed to scan for incomplete tasks', err);
    return;
  }

  if (rows.length === 0) return;
  console.log(`task recovery: found ${rows.length} incomplete task(s)`);

  for (const row of rows) {
    try {
      // Cancelled-while-dead (spec "Startup recovery of incomplete tasks"):
      // the runner died before observing the flag — mark cancelled, never resume.
      if (row.cancel_requested) {
        await query(
          `UPDATE tasks SET status = 'cancelled', updated_at = NOW()
           WHERE task_id = $1 AND status IN ('pending', 'processing')`,
          [row.task_id]
        );
        console.log(`task recovery: task ${row.task_id} was cancelled, not resuming`);
        continue;
      }
      console.log(`task recovery: resuming ${row.mode} task ${row.task_id}`);
      if (row.mode === 'deep') {
        await runDeepTask(row.task_id);
      } else {
        await processTask(row.task_id);
      }
    } catch (err) {
      // One broken task must not block recovery of the rest.
      console.error(`task recovery: task ${row.task_id} failed`, err);
    }
  }
  console.log('task recovery: done');

}


