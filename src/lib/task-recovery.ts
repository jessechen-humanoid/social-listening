import { query } from './db';
import { processTask } from './scoring';
import { runDeepTask } from './deep-pipeline/orchestrator';
import { syncDeepTaskWithRetry } from './google-sheets';
import { STALE_HEARTBEAT } from './task-claim';

// Resume tasks orphaned by a dead runner (spec "Startup recovery of incomplete
// tasks"): pending tasks, plus processing tasks whose heartbeat is stale or
// NULL. Tasks run sequentially — one at a time — to avoid stampeding the
// OpenAI quota after a restart. Each entry point re-checks via the atomic
// claim, so a task that a live runner picked up in the meantime is skipped.
export async function recoverIncompleteTasks() {
  let rows: Array<{ task_id: string; mode: string }>;
  try {
    const result = await query(
      `SELECT task_id, mode FROM tasks
       WHERE status = 'pending'
          OR (status = 'processing'
              AND (heartbeat_at IS NULL OR heartbeat_at < NOW() - $1::interval))
       ORDER BY created_at`,
      [STALE_HEARTBEAT]
    );
    rows = result.rows as Array<{ task_id: string; mode: string }>;
  } catch (err) {
    console.error('task recovery: failed to scan for incomplete tasks', err);
    return;
  }

  if (rows.length === 0) return;
  console.log(`task recovery: found ${rows.length} incomplete task(s)`);

  for (const row of rows) {
    try {
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

  await retryFailedSheetSyncs();
}

// Spec "Startup retry of failed syncs": completed tasks whose ledger sync
// never landed get another idempotent attempt. Failures stay non-fatal.
export async function retryFailedSheetSyncs() {
  let rows: Array<{ task_id: string }>;
  try {
    const result = await query(
      `SELECT task_id FROM tasks
       WHERE status = 'completed'
         AND sheet_sync_status IN ('failed', 'pending_retry')
       ORDER BY created_at`
    );
    rows = result.rows as Array<{ task_id: string }>;
  } catch (err) {
    console.error('sheet sync retry: scan failed', err);
    return;
  }
  if (rows.length === 0) return;
  console.log(`sheet sync retry: ${rows.length} task(s) with failed sync`);
  for (const row of rows) {
    try {
      await syncDeepTaskWithRetry(row.task_id);
    } catch (err) {
      console.error(`sheet sync retry: task ${row.task_id} failed`, err);
    }
  }
}
