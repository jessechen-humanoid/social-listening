import { describe, expect, it, vi } from 'vitest';

const runDeepTaskMock = vi.hoisted(() => vi.fn());
vi.mock('../deep-pipeline/orchestrator', () => ({ runDeepTask: runDeepTaskMock }));

// The pre-start cancellation check hits the DB; this test has no DB — no task
// here is flagged, so the check resolving to zero rows is the correct stub.
const queryMock = vi.hoisted(() => vi.fn(async () => ({ rows: [] })));
vi.mock('../db', () => ({ query: queryMock }));

import { runBatch } from '../deep-pipeline/batch-runner';

// Spec "Batch tasks execute concurrently".
describe('runBatch', () => {
  it('starts all tasks concurrently and isolates a mid-batch failure', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const completed: string[] = [];

    runDeepTaskMock.mockImplementation(async (taskId: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      if (taskId === 't-ig') throw new Error('ig 資料壞掉');
      completed.push(taskId);
    });

    await runBatch(['t-fb', 't-ig', 't-threads']);

    // All three ran at the same time — no platform waited on another —
    // and the failed middle task did not affect the other two.
    expect(maxInFlight).toBe(3);
    expect(completed.sort()).toEqual(['t-fb', 't-threads']);
    expect(runDeepTaskMock).toHaveBeenCalledTimes(3);
  });
});
