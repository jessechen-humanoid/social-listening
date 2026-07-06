import { ALLOWED_LIGHT_MODELS } from './analysis-models';
import { FILE_ROLES, type FileRole } from './column-mapping';
import { SUPPORTED_PLATFORMS, type Platform } from './platforms';

// Sized for real quarterly Qsearch exports: a single FB comment file has been
// observed at 26,786 rows, and three FB files JSON-serialized exceed 20MB.
export const MAX_BODY_BYTES = 100 * 1024 * 1024; // 100MB
export const MAX_TOTAL_ROWS = 100000;

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

// ---------------------------------------------------------------------------
// Batch input (spec "Platform role completeness validation"): one submission
// carrying files for several platforms, fanned out into one task per platform.
// ---------------------------------------------------------------------------

export interface BatchPlatformGroup {
  platform?: unknown;
  files?: Array<{ role?: unknown; data?: unknown }> | null;
}

export type BatchValidation =
  | { ok: true; platforms: Platform[] }
  | { ok: false; status: 400 | 413; error: string };

// Roles a platform's group must carry (at least one file each).
export const REQUIRED_ROLES_BY_PLATFORM: Record<Platform, FileRole[]> = {
  fb: ['hotpost', 'hotcomment', 'comments_from_posts'],
  ig: ['hotpost'],
  threads: ['hotpost'],
  dcard: ['hotpost'],
};

export function validateBatchInput(groups: unknown): BatchValidation {
  if (!Array.isArray(groups) || groups.length === 0) {
    return { ok: false, status: 400, error: '批次至少需要一個平台的檔案' };
  }

  const seen = new Set<Platform>();
  let totalRows = 0;

  for (const group of groups as BatchPlatformGroup[]) {
    const platform = group?.platform;
    if (typeof platform !== 'string' || !(SUPPORTED_PLATFORMS as string[]).includes(platform)) {
      return { ok: false, status: 400, error: `不支援的平台：${String(platform)}` };
    }
    if (seen.has(platform as Platform)) {
      return { ok: false, status: 400, error: `平台 ${platform} 在批次中出現多次` };
    }
    seen.add(platform as Platform);

    const files = group.files ?? [];
    if (files.length === 0) {
      return { ok: false, status: 400, error: `平台 ${platform} 沒有任何檔案` };
    }

    const rolesPresent = new Set<string>();
    for (const f of files) {
      if (typeof f?.role !== 'string' || !(FILE_ROLES as string[]).includes(f.role)) {
        return { ok: false, status: 400, error: `無效的檔案 role：${String(f?.role)}` };
      }
      rolesPresent.add(f.role);
      totalRows += Array.isArray(f.data) ? f.data.length : 0;
    }

    for (const required of REQUIRED_ROLES_BY_PLATFORM[platform as Platform]) {
      if (!rolesPresent.has(required)) {
        return {
          ok: false,
          status: 400,
          error: `平台 ${platform} 缺少角色：${required}`,
        };
      }
    }
  }

  if (totalRows > MAX_TOTAL_ROWS) {
    return {
      ok: false,
      status: 413,
      error: `批次總列數 ${totalRows} 超過上限 ${MAX_TOTAL_ROWS}`,
    };
  }

  return { ok: true, platforms: Array.from(seen) };
}
