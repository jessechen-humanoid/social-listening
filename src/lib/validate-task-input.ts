import { ALLOWED_LIGHT_MODELS } from './analysis-models';
import { FILE_ROLES } from './column-mapping';

// Sized for real quarterly Qsearch exports: a single FB comment file has been
// observed at 26,786 rows, and three FB files JSON-serialized exceed 20MB.
export const MAX_BODY_BYTES = 100 * 1024 * 1024; // 100MB
export const MAX_TOTAL_ROWS = 60000;

export type TaskInputValidation =
  | { ok: true; mode: 'light' | 'deep' }
  | { ok: false; status: 400 | 413; error: string };

// Validates POST /api/tasks input after authentication and before any DB
// write. Pure function so the boundary table from the spec is unit-testable.
export function validateTaskInput(body: {
  mode?: unknown;
  config?: { model?: unknown } | null;
  files?: Array<{ role?: unknown; data?: unknown }> | null;
}): TaskInputValidation {
  const { mode, config, files } = body;

  if (mode !== 'light' && mode !== 'deep') {
    return { ok: false, status: 400, error: `不支援的 mode：${String(mode)}` };
  }

  const totalRows = (files ?? []).reduce(
    (sum, f) => sum + (Array.isArray(f?.data) ? f.data.length : 0),
    0
  );
  if (totalRows > MAX_TOTAL_ROWS) {
    return {
      ok: false,
      status: 413,
      error: `資料列數 ${totalRows} 超過上限 ${MAX_TOTAL_ROWS}`,
    };
  }

  if (mode === 'deep') {
    for (const f of files ?? []) {
      if (typeof f?.role !== 'string' || !(FILE_ROLES as string[]).includes(f.role)) {
        return { ok: false, status: 400, error: `無效的檔案 role：${String(f?.role)}` };
      }
    }
  }

  if (mode === 'light') {
    const model = config?.model;
    if (typeof model !== 'string' || !ALLOWED_LIGHT_MODELS.includes(model)) {
      return { ok: false, status: 400, error: `不支援的 model：${String(model)}` };
    }
  }

  return { ok: true, mode };
}
