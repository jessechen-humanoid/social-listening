import { v4 as uuidv4 } from 'uuid';
import { query } from './db';
import { DEEP_STAGES, type DeepStageName } from './seed-prompts';

export interface PromptVersion {
  id: string;
  stage_name: DeepStageName;
  version_label: string;
  prompt_text: string;
  model_snapshot: string;
  temperature: number;
  response_format: string;
  active: boolean;
  created_at: string;
}

export const ALL_DEEP_STAGES: DeepStageName[] = Object.values(DEEP_STAGES);

export async function getActivePrompt(stageName: DeepStageName): Promise<PromptVersion | null> {
  const result = await query(
    `SELECT id, stage_name, version_label, prompt_text, model_snapshot,
            temperature::float, response_format, active, created_at
     FROM prompt_versions
     WHERE stage_name = $1 AND active = TRUE
     LIMIT 1`,
    [stageName]
  );
  return (result.rows[0] as PromptVersion | undefined) ?? null;
}

export async function getPromptByVersionId(versionId: string): Promise<PromptVersion | null> {
  const result = await query(
    `SELECT id, stage_name, version_label, prompt_text, model_snapshot,
            temperature::float, response_format, active, created_at
     FROM prompt_versions
     WHERE id = $1
     LIMIT 1`,
    [versionId]
  );
  return (result.rows[0] as PromptVersion | undefined) ?? null;
}

export async function listPromptVersions(stageName?: DeepStageName): Promise<PromptVersion[]> {
  const result = stageName
    ? await query(
        `SELECT id, stage_name, version_label, prompt_text, model_snapshot,
                temperature::float, response_format, active, created_at
         FROM prompt_versions WHERE stage_name = $1 ORDER BY created_at DESC`,
        [stageName]
      )
    : await query(
        `SELECT id, stage_name, version_label, prompt_text, model_snapshot,
                temperature::float, response_format, active, created_at
         FROM prompt_versions ORDER BY stage_name, created_at DESC`
      );
  return result.rows as PromptVersion[];
}

export interface CreatePromptVersionInput {
  stageName: DeepStageName;
  versionLabel: string;
  promptText: string;
  modelSnapshot: string;
  temperature?: number;
  responseFormat?: string;
}

export async function createPromptVersion(input: CreatePromptVersionInput): Promise<PromptVersion> {
  const id = uuidv4();
  const result = await query(
    `INSERT INTO prompt_versions
       (id, stage_name, version_label, prompt_text, model_snapshot, temperature, response_format, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
     RETURNING id, stage_name, version_label, prompt_text, model_snapshot,
               temperature::float, response_format, active, created_at`,
    [
      id,
      input.stageName,
      input.versionLabel,
      input.promptText,
      input.modelSnapshot,
      input.temperature ?? 0,
      input.responseFormat ?? 'json_object',
    ]
  );
  return result.rows[0] as PromptVersion;
}

// Per spec: model_snapshot is immutable on an existing prompt version. Updates
// to model_snapshot SHALL require creating a new version. Other fields are
// equally locked once recorded — there is no "edit" API. To change anything,
// create a new version and (optionally) promote it.
export async function rejectModelSnapshotChange(
  existingVersion: PromptVersion,
  proposedModelSnapshot: string
): Promise<void> {
  if (existingVersion.model_snapshot !== proposedModelSnapshot) {
    throw new Error(
      `model_snapshot is immutable: existing version ${existingVersion.id} uses ` +
        `${existingVersion.model_snapshot}, not ${proposedModelSnapshot}. ` +
        `Create a new prompt version with the new model snapshot instead.`
    );
  }
}

export interface PromoteResult {
  promoted: PromptVersion;
  warning: {
    historicalTaskCount: number;
    message: string;
  } | null;
}

// Promote a version to active. Caller must inspect `warning` and confirm before
// committing — the function still performs the promotion in one transaction
// (atomic), so callers should pre-check via `previewPromote` if they need a
// confirmation gate.
export async function promoteToActive(versionId: string): Promise<PromoteResult> {
  const version = await getPromptByVersionId(versionId);
  if (!version) {
    throw new Error(`prompt version ${versionId} not found`);
  }

  const historicalCount = await countHistoricalTasksForStage(version.stage_name);

  // Atomic flip: deactivate existing active for this stage, then activate target.
  // Partial unique index requires both ops in one transaction.
  await query('BEGIN');
  try {
    await query(`UPDATE prompt_versions SET active = FALSE WHERE stage_name = $1 AND active = TRUE`, [
      version.stage_name,
    ]);
    await query(`UPDATE prompt_versions SET active = TRUE WHERE id = $1`, [versionId]);
    await query('COMMIT');
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }

  const promoted = (await getPromptByVersionId(versionId)) as PromptVersion;

  return {
    promoted,
    warning: historicalCount > 0
      ? {
          historicalTaskCount: historicalCount,
          message:
            'Changing the active prompt version will make new analyses non-comparable ' +
            `with ${historicalCount} historical task(s) scored by the previous version.`,
        }
      : null,
  };
}

// Count tasks that have ever bound this stage's prompt (any version), so the
// caller knows whether a switch breaks comparability.
async function countHistoricalTasksForStage(stageName: DeepStageName): Promise<number> {
  const result = await query(
    `SELECT COUNT(DISTINCT task_id)::int AS count
     FROM task_prompt_bindings
     WHERE stage_name = $1`,
    [stageName]
  );
  return (result.rows[0] as { count: number }).count;
}

// Snapshot prompt versions onto a task at start time. The mapping
// stage -> prompt_version_id is frozen for the task's lifetime.
export async function bindPromptVersionsToTask(
  taskId: string,
  stageVersionMap: Record<DeepStageName, string>
): Promise<void> {
  await query('BEGIN');
  try {
    for (const stageName of Object.keys(stageVersionMap) as DeepStageName[]) {
      await query(
        `INSERT INTO task_prompt_bindings (task_id, stage_name, prompt_version_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (task_id, stage_name) DO UPDATE SET prompt_version_id = EXCLUDED.prompt_version_id`,
        [taskId, stageName, stageVersionMap[stageName]]
      );
    }
    await query('COMMIT');
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }
}

export async function getTaskPromptBindings(
  taskId: string
): Promise<Array<{ stage_name: DeepStageName; prompt_version_id: string }>> {
  const result = await query(
    `SELECT stage_name, prompt_version_id
     FROM task_prompt_bindings
     WHERE task_id = $1
     ORDER BY stage_name`,
    [taskId]
  );
  return result.rows as Array<{ stage_name: DeepStageName; prompt_version_id: string }>;
}

// Build the default stage→version map for a new task: use whichever version is
// currently active per stage. Stages with no active version error out — the
// caller can choose to fail the task or fall back.
export async function getDefaultStageBindings(
  stages: DeepStageName[]
): Promise<Record<DeepStageName, string>> {
  const map = {} as Record<DeepStageName, string>;
  for (const stage of stages) {
    const active = await getActivePrompt(stage);
    if (!active) {
      throw new Error(`No active prompt version for stage ${stage}. Run migrate to seed prompts.`);
    }
    map[stage] = active.id;
  }
  return map;
}
