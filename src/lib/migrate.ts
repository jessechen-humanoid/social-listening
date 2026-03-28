import { query } from './db';

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

  await query(`
    CREATE INDEX IF NOT EXISTS idx_tasks_browser_uuid ON tasks(browser_uuid)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_task_results_task_id ON task_results(task_id)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_task_files_task_id ON task_files(task_id)
  `);
}
