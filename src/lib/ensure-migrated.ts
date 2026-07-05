import { migrate } from './migrate';

// Single shared migration gate for lazy route checks (spec "Concurrent-safe
// migrations"): concurrent callers share one in-flight promise; a failure
// clears it so the next request retries instead of being stuck forever.
let inFlight: Promise<void> | null = null;
let completed = false;

export async function ensureMigrated(): Promise<void> {
  if (completed) return;
  if (!inFlight) {
    inFlight = migrate()
      .then(() => {
        completed = true;
      })
      .catch((err) => {
        inFlight = null; // allow retry on the next request
        throw err;
      });
  }
  await inFlight;
}
