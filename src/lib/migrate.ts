import { query } from './db';
import { seedPromptVersions } from './seed-prompts';

export async function migrate() {
  await query(`
    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      browser_uuid TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      config JSONB NOT NULL DEFAULT '{}',
      total_items INTEGER NOT NULL DEFAULT 0,
      completed_items INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS task_files (
      file_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      column_mapping JSONB NOT NULL DEFAULT '{}',
      row_count INTEGER NOT NULL DEFAULT 0
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS task_results (
      result_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
      file_id TEXT NOT NULL REFERENCES task_files(file_id) ON DELETE CASCADE,
      row_index INTEGER NOT NULL,
      content_text TEXT NOT NULL,
      condition_result BOOLEAN,
      x_score DECIMAL(3,1),
      y_score DECIMAL(3,1),
      reasoning TEXT,
      engagement_value DECIMAL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_tasks_browser_uuid ON tasks(browser_uuid)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_task_results_task_id ON task_results(task_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_task_files_task_id ON task_files(task_id)`);

  // ==========================================================================
  // Deep Sentiment Analysis — batch 1
  // brands, prompt_versions, task_prompt_bindings, tasks new columns
  // ==========================================================================

  await query(`
    CREATE TABLE IF NOT EXISTS brands (
      id UUID PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      platform_settings JSONB NOT NULL DEFAULT '{
        "scatter_alpha": {"fb": 0.08, "ig": 0.12, "threads": 0.02, "dcard": 0.18},
        "timeline_colors": {"positive": "#3B82F6", "negative": "#EF4444"}
      }'::jsonb,
      calibration_set_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_brands_name ON brands(name)`);

  await query(`
    CREATE TABLE IF NOT EXISTS prompt_versions (
      id UUID PRIMARY KEY,
      stage_name TEXT NOT NULL,
      version_label TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      model_snapshot TEXT NOT NULL,
      temperature NUMERIC NOT NULL DEFAULT 0,
      response_format TEXT NOT NULL DEFAULT 'json_object',
      active BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (stage_name, version_label)
    )
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_versions_one_active
      ON prompt_versions(stage_name)
      WHERE active = TRUE
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_prompt_versions_stage ON prompt_versions(stage_name)`);

  await query(`
    CREATE TABLE IF NOT EXISTS task_prompt_bindings (
      task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
      stage_name TEXT NOT NULL,
      prompt_version_id UUID NOT NULL REFERENCES prompt_versions(id),
      PRIMARY KEY (task_id, stage_name)
    )
  `);

  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'light'`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS brand_id UUID`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS time_range_start DATE`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS time_range_end DATE`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sheet_sync_status TEXT`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sheet_sync_error TEXT`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS platform TEXT`);

  // Add FK on tasks.brand_id (no IF NOT EXISTS for ALTER TABLE ADD CONSTRAINT)
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'tasks_brand_id_fkey'
          AND table_name = 'tasks'
      ) THEN
        ALTER TABLE tasks
          ADD CONSTRAINT tasks_brand_id_fkey
          FOREIGN KEY (brand_id) REFERENCES brands(id);
      END IF;
    END
    $$
  `);

  // ==========================================================================
  // Deep Sentiment Analysis — batch 2
  // task_files role + column_mapping (column_mapping already exists)
  // ==========================================================================

  await query(`ALTER TABLE task_files ADD COLUMN IF NOT EXISTS role TEXT`);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_task_files_role ON task_files(role) WHERE role IS NOT NULL`
  );

  // ==========================================================================
  // Deep Sentiment Analysis — batch 3
  // deep_task_stages + task_results extension
  // ==========================================================================

  await query(`
    CREATE TABLE IF NOT EXISTS deep_task_stages (
      task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
      stage_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      input_count INTEGER NOT NULL DEFAULT 0,
      output_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      PRIMARY KEY (task_id, stage_name)
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_deep_task_stages_status ON deep_task_stages(status)`
  );

  // Extend task_results for deep pipeline (all nullable for backward compatibility)
  await query(`ALTER TABLE task_results ADD COLUMN IF NOT EXISTS stage_name TEXT`);
  await query(`ALTER TABLE task_results ADD COLUMN IF NOT EXISTS related_score NUMERIC`);
  await query(`ALTER TABLE task_results ADD COLUMN IF NOT EXISTS emotion_raw NUMERIC`);
  await query(`ALTER TABLE task_results ADD COLUMN IF NOT EXISTS emotion_calibrated NUMERIC`);
  await query(`ALTER TABLE task_results ADD COLUMN IF NOT EXISTS favor_raw NUMERIC`);
  await query(`ALTER TABLE task_results ADD COLUMN IF NOT EXISTS favor_calibrated NUMERIC`);
  await query(`ALTER TABLE task_results ADD COLUMN IF NOT EXISTS not_real_user BOOLEAN`);
  await query(`ALTER TABLE task_results ADD COLUMN IF NOT EXISTS not_real_user_reason TEXT`);
  await query(`ALTER TABLE task_results ADD COLUMN IF NOT EXISTS tag_friend BOOLEAN`);
  await query(`ALTER TABLE task_results ADD COLUMN IF NOT EXISTS filtered_out BOOLEAN`);
  await query(`ALTER TABLE task_results ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ`);
  await query(`ALTER TABLE task_results ADD COLUMN IF NOT EXISTS post_url TEXT`);
  await query(`ALTER TABLE task_results ADD COLUMN IF NOT EXISTS parent_post_url TEXT`);
  await query(`ALTER TABLE task_results ADD COLUMN IF NOT EXISTS platform TEXT`);

  await query(
    `CREATE INDEX IF NOT EXISTS idx_task_results_task_stage ON task_results(task_id, stage_name)`
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_task_results_post_url ON task_results(task_id, post_url) WHERE post_url IS NOT NULL`
  );

  // ==========================================================================
  // Deep Sentiment Analysis — batch 4
  // calibration_sets, calibration_posts, calibration_mappings
  // ==========================================================================

  await query(`
    CREATE TABLE IF NOT EXISTS calibration_sets (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      golden_model TEXT NOT NULL,
      golden_prompt_version_id UUID NOT NULL REFERENCES prompt_versions(id),
      post_count INTEGER NOT NULL DEFAULT 0,
      locked BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_calibration_sets_brand ON calibration_sets(brand_id)`
  );

  await query(`
    CREATE TABLE IF NOT EXISTS calibration_posts (
      id UUID PRIMARY KEY,
      set_id UUID NOT NULL REFERENCES calibration_sets(id) ON DELETE CASCADE,
      row_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      platform TEXT NOT NULL,
      engagement NUMERIC,
      golden_emotion NUMERIC NOT NULL,
      golden_favor NUMERIC NOT NULL,
      UNIQUE (set_id, row_index)
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_calibration_posts_set ON calibration_posts(set_id)`
  );

  await query(`
    CREATE TABLE IF NOT EXISTS calibration_mappings (
      id UUID PRIMARY KEY,
      set_id UUID NOT NULL REFERENCES calibration_sets(id) ON DELETE CASCADE,
      new_model TEXT NOT NULL,
      new_prompt_version_id UUID NOT NULL REFERENCES prompt_versions(id),
      rank_rho_emotion NUMERIC,
      rank_rho_favor NUMERIC,
      mapping_function_emotion JSONB,
      mapping_function_favor JSONB,
      mae_emotion NUMERIC,
      mae_favor NUMERIC,
      accepted BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (set_id, new_model, new_prompt_version_id)
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_calibration_mappings_set ON calibration_mappings(set_id)`
  );

  // FK on brands.calibration_set_id (added in batch 1, FK added now after table exists)
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'brands_calibration_set_id_fkey'
          AND table_name = 'brands'
      ) THEN
        ALTER TABLE brands
          ADD CONSTRAINT brands_calibration_set_id_fkey
          FOREIGN KEY (calibration_set_id) REFERENCES calibration_sets(id);
      END IF;
    END
    $$
  `);

  // ==========================================================================
  // Deep Sentiment Analysis — batch 5
  // deep_task_aggregates
  // ==========================================================================

  await query(`
    CREATE TABLE IF NOT EXISTS deep_task_aggregates (
      task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      weighted_avg_favor NUMERIC,
      weighted_avg_emotion NUMERIC,
      total_weight NUMERIC,
      sample_count INTEGER,
      quadrant_tr_pct NUMERIC,
      quadrant_tl_pct NUMERIC,
      quadrant_bl_pct NUMERIC,
      quadrant_br_pct NUMERIC,
      weekly_buckets JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (task_id, platform)
    )
  `);

  // ==========================================================================
  // Deep Sentiment Analysis — batch 6
  // google_sheet_links
  // ==========================================================================

  await query(`
    CREATE TABLE IF NOT EXISTS google_sheet_links (
      brand_id UUID PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
      spreadsheet_id TEXT NOT NULL,
      sheet_tab_map JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_synced_at TIMESTAMPTZ
    )
  `);

  // Seed prompt versions (idempotent — skip if version_label already exists per stage)
  await seedPromptVersions();
}
