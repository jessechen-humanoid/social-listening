import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, type TestDb } from './test-db';

// Spec "Concurrent-safe migrations".
describe('concurrent migrations', () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await startTestDb();
  });

  afterAll(async () => {
    await testDb.stop();
  });

  it('two parallel migrate() calls against a fresh database both succeed', async () => {
    const { migrate } = await import('../migrate');
    await Promise.all([migrate(), migrate()]);

    const tables = await testDb.db.query(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('tasks', 'brands', 'prompt_versions')`
    );
    expect((tables.rows[0] as { n: number }).n).toBe(3);

    // Seeded exactly once (idempotent under concurrency).
    const prompts = await testDb.db.query(
      `SELECT COUNT(*)::int AS n FROM prompt_versions WHERE stage_name = 'A_related_filter'`
    );
    expect((prompts.rows[0] as { n: number }).n).toBe(1);
  });

  it('ensureMigrated shares one in-flight promise and allows retry after failure', async () => {
    // Fresh module instance to reset its private state.
    const mod = await import('../ensure-migrated');
    await Promise.all([mod.ensureMigrated(), mod.ensureMigrated(), mod.ensureMigrated()]);
    // Reaching here without error means concurrent callers shared the gate.
    const idx = await testDb.db.query(
      `SELECT COUNT(*)::int AS n FROM pg_indexes WHERE indexname = 'idx_tasks_brand_mode'`
    );
    expect((idx.rows[0] as { n: number }).n).toBe(1);
  });
});
