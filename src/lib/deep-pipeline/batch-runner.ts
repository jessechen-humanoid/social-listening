import { runDeepTask } from './orchestrator';

// Runs a batch's tasks concurrently (spec "Batch tasks execute concurrently"):
// every platform starts immediately — no platform waits on another. Rows stay
// sequential inside each task, so concurrent OpenAI requests = platform count.
// A failed task is logged and MUST NOT affect the others. Each runDeepTask
// call goes through the atomic claim, so this runner and startup recovery can
// never double-run a task.
//
// NOTE for Phase 2 (per-row concurrency inside tasks): add a global rate
// limiter before letting batch parallelism multiply row-level concurrency.
export async function runBatch(taskIds: string[]): Promise<void> {
  await Promise.all(
    taskIds.map(async (taskId) => {
      try {
        await runDeepTask(taskId);
      } catch (err) {
        console.error(`batch runner: task ${taskId} failed, others continue`, err);
      }
    })
  );
  console.log(`batch runner: finished ${taskIds.length} task(s)`);
}
