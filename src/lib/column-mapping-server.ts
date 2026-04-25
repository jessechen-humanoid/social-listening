import 'server-only';
import { query } from './db';
import type { Platform } from './platforms';
import type { ColumnMapping, FileRole } from './column-mapping';

// Fetch the most recent confirmed column mapping for a (brand, platform, role)
// triple. Returns null if no prior task has been completed for that combination.
// Spec: qsearch-column-mapping "Mapping memory per brand"
export async function getMemorizedMapping(
  brandId: string,
  platform: Platform,
  role: FileRole
): Promise<ColumnMapping | null> {
  const result = await query(
    `SELECT tf.column_mapping
     FROM task_files tf
     JOIN tasks t ON t.task_id = tf.task_id
     WHERE t.brand_id = $1
       AND t.platform = $2
       AND tf.role = $3
       AND tf.column_mapping IS NOT NULL
       AND tf.column_mapping <> '{}'::jsonb
     ORDER BY t.created_at DESC
     LIMIT 1`,
    [brandId, platform, role]
  );
  const row = result.rows[0] as { column_mapping: ColumnMapping } | undefined;
  return row?.column_mapping ?? null;
}
