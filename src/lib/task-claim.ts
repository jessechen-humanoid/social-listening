import { query } from './db';

// A processing task whose heartbeat is older than this is presumed dead and
// becomes claimable (4x margin over the 30s refresh interval).
export const STALE_HEARTBEAT = '2 minutes';
export const HEARTBEAT_REFRESH_MS = 30_000;

// Atomic compare-and-swap claim (spec "Single-runner task claim"): at most one
// runner wins. Claimable states: pending, or processing with a NULL (legacy)
// or stale heartbeat. Returns false when another live runner holds the task.
export async function claimTask(taskId: string): Promise<boolean> {
  const result = await query(
    `UPDATE tasks
     SET status = 'processing', heartbeat_at = NOW(), updated_at = NOW()
     WHERE task_id = $1
       AND (
         status = 'pending'
         OR (status = 'processing' AND heartbeat_at IS NULL)
         OR (status = 'processing' AND heartbeat_at < NOW() - $2::interval)
       )
     RETURNING task_id`,
    [taskId, STALE_HEARTBEAT]
  );
  return result.rows.length > 0;
}

// Thrown by the heartbeat when the task's cancel_requested flag is observed
// (spec "Cooperative task cancellation"). Row-level catches MUST rethrow it so
// it reaches the task runner instead of being recorded as a row failure.
export class TaskCancelledError extends Error {
  constructor(taskId: string) {
    super(`task ${taskId} was cancelled`);
    this.name = 'TaskCancelledError';
  }
}

// Throttled heartbeat for a runner's processing loop: call it as often as you
// like (each row / each AI call); it only hits the DB once per 30 seconds.
// The heartbeat doubles as the cancellation consumption point (spec
// "Cooperative task cancellation"): the refresh reads back cancel_requested,
// so a cancel takes effect within HEARTBEAT_REFRESH_MS plus in-flight calls.
export function createHeartbeat(taskId: string): () => Promise<void> {
  let lastBeat = 0;
  let cancelled = false;
  return async () => {
    if (cancelled) throw new TaskCancelledError(taskId);
    const now = Date.now();
    if (now - lastBeat < HEARTBEAT_REFRESH_MS) return;
    lastBeat = now;
    try {
      const result = await query(
        `UPDATE tasks SET heartbeat_at = NOW() WHERE task_id = $1 RETURNING cancel_requested`,
        [taskId]
      );
      cancelled = Boolean((result.rows[0] as { cancel_requested?: boolean } | undefined)?.cancel_requested);
    } catch (err) {
      // A missed beat must never kill the task itself.
      console.error(`heartbeat update failed for task ${taskId}`, err);
    }
    if (cancelled) throw new TaskCancelledError(taskId);
  };
}
