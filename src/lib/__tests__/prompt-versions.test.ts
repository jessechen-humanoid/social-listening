import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, type TestDb } from './test-db';

// Spec "Atomic multi-statement database operations": prompt promotion is
// atomic — a failure mid-promotion leaves the previously active version
// active; at no point is a stage left with zero active versions.
describe('prompt version promotion atomicity', () => {
  let testDb: TestDb;
  let pv: typeof import('../prompt-versions');
  const STAGE = 'A_related_filter' as const;

  beforeAll(async () => {
    testDb = await startTestDb();
    const { migrate } = await import('../migrate');
    await migrate(); // seeds prompt_versions with one active version per stage
    pv = await import('../prompt-versions');
  });

  afterAll(async () => {
    await testDb.stop();
  });

  it('failed promotion preserves the previously active version', async () => {
    const before = await pv.getActivePrompt(STAGE);
    expect(before).not.toBeNull();

    // Replicate the promotion statement sequence with the activate step
    // failing, exactly the mid-transaction failure the spec scenario names.
    await expect(
      testDb.db.withTransaction(async (client) => {
        await client.query(
          `UPDATE prompt_versions SET active = FALSE WHERE stage_name = $1 AND active = TRUE`,
          [STAGE]
        );
        throw new Error('activate step failed');
      })
    ).rejects.toThrow('activate step failed');

    const after = await pv.getActivePrompt(STAGE);
    expect(after?.id).toBe(before!.id);
    expect(after?.active).toBe(true);
  });

  it('successful promotion flips active atomically, leaving exactly one active version', async () => {
    const original = await pv.getActivePrompt(STAGE);
    const created = await pv.createPromptVersion({
      stageName: STAGE,
      versionLabel: 'test-v2',
      promptText: 'test prompt',
      modelSnapshot: 'test-model',
    });

    const { promoted } = await pv.promoteToActive(created.id);
    expect(promoted.id).toBe(created.id);
    expect(promoted.active).toBe(true);

    const actives = await testDb.db.query(
      `SELECT id FROM prompt_versions WHERE stage_name = $1 AND active = TRUE`,
      [STAGE]
    );
    expect(actives.rows).toHaveLength(1);
    expect((actives.rows[0] as { id: string }).id).toBe(created.id);

    // Restore the seeded version so other assertions see the original state.
    await pv.promoteToActive(original!.id);
  });

  it('bindPromptVersionsToTask writes all bindings atomically', async () => {
    // tasks table has no FK from task_prompt_bindings.task_id in migrate, but
    // create a real task row to be safe against future constraints.
    await testDb.db.query(
      `INSERT INTO tasks (task_id, browser_uuid, status, mode)
       VALUES ('tx-bind-test', 'test-browser', 'pending', 'deep')
       ON CONFLICT DO NOTHING`
    );
    const active = await pv.getActivePrompt(STAGE);
    await pv.bindPromptVersionsToTask('tx-bind-test', {
      [STAGE]: active!.id,
    } as Record<import('../seed-prompts').DeepStageName, string>);

    const bindings = await pv.getTaskPromptBindings('tx-bind-test');
    expect(bindings).toHaveLength(1);
    expect(bindings[0].prompt_version_id).toBe(active!.id);
  });
});
