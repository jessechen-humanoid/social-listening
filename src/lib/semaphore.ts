// Concurrency primitives for the scoring pipeline. Zero dependencies, pure
// in-process state — safe because Next.js runs one Node process per instance
// and per-task mutual exclusion is already handled by the DB claim.

// Counting semaphore with a FIFO waiter queue.
export interface Semaphore {
  acquire(): Promise<void>;
  release(): void;
  /** Current number of held permits (for tests / observability). */
  inFlight(): number;
}

export function createSemaphore(limit: number): Semaphore {
  if (limit < 1) throw new Error(`semaphore limit must be >= 1, got ${limit}`);
  let held = 0;
  const waiters: Array<() => void> = [];

  return {
    async acquire() {
      if (held < limit) {
        held++;
        return;
      }
      await new Promise<void>((resolve) => waiters.push(resolve));
      held++;
    },
    release() {
      held--;
      const next = waiters.shift();
      if (next) next();
    },
    inFlight: () => held,
  };
}

// Run fn over items with at most `limit` concurrent executions. Results keep
// item order; a rejection propagates after in-flight items settle, mirroring
// the sequential loop's "one bad row doesn't corrupt others" behavior when fn
// catches its own errors (which every stage row handler does).
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let firstError: unknown = null;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length || firstError) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        if (firstError === null) firstError = err;
        return;
      }
    }
  });

  await Promise.all(workers);
  if (firstError !== null) throw firstError;
  return results;
}
