// Runs once when a new Next.js server instance starts (before it serves
// requests): apply DB migrations, then resume tasks orphaned by the previous
// process — deploys on Zeabur restart the container, killing in-flight tasks.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Dynamic imports keep pg and friends out of non-node bundles.
  try {
    const { migrate } = await import('./lib/migrate');
    await migrate();
  } catch (err) {
    // DB may be unreachable (e.g. local dev without a database). Routes still
    // have their lazy ensureMigrated fallback, so log and keep the server up.
    console.error('startup migrate failed', err);
    return;
  }

  const { recoverIncompleteTasks } = await import('./lib/task-recovery');
  // Recovery resumes tasks sequentially and can run for hours — it must not
  // block server readiness, so it is intentionally not awaited.
  recoverIncompleteTasks().catch((err) => {
    console.error('task recovery failed', err);
  });
}
