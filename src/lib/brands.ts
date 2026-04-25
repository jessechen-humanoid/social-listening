import { v4 as uuidv4 } from 'uuid';
import { query } from './db';
import { SUPPORTED_PLATFORMS, type Platform, type PlatformSettings } from './platforms';

export { SUPPORTED_PLATFORMS };
export type { Platform, PlatformSettings };

export interface Brand {
  id: string;
  name: string;
  platform_settings: PlatformSettings;
  calibration_set_id: string | null;
  created_at: string;
}

export async function createBrand(name: string): Promise<Brand> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new BrandValidationError('Brand name must not be empty');
  }
  const id = uuidv4();
  try {
    const result = await query(
      `INSERT INTO brands (id, name)
       VALUES ($1, $2)
       RETURNING id, name, platform_settings, calibration_set_id, created_at`,
      [id, trimmed]
    );
    return result.rows[0] as Brand;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new BrandValidationError(`Brand "${trimmed}" already exists`);
    }
    throw err;
  }
}

export async function getBrand(id: string): Promise<Brand | null> {
  const result = await query(
    `SELECT id, name, platform_settings, calibration_set_id, created_at
     FROM brands WHERE id = $1`,
    [id]
  );
  return (result.rows[0] as Brand | undefined) ?? null;
}

export async function getBrandByName(name: string): Promise<Brand | null> {
  const result = await query(
    `SELECT id, name, platform_settings, calibration_set_id, created_at
     FROM brands WHERE name = $1`,
    [name.trim()]
  );
  return (result.rows[0] as Brand | undefined) ?? null;
}

export async function listBrands(): Promise<Brand[]> {
  const result = await query(
    `SELECT id, name, platform_settings, calibration_set_id, created_at
     FROM brands ORDER BY created_at DESC`
  );
  return result.rows as Brand[];
}

export async function updatePlatformSettings(
  id: string,
  settings: Partial<PlatformSettings>
): Promise<Brand> {
  const result = await query(
    `UPDATE brands
     SET platform_settings = platform_settings || $2::jsonb
     WHERE id = $1
     RETURNING id, name, platform_settings, calibration_set_id, created_at`,
    [id, JSON.stringify(settings)]
  );
  if (!result.rows[0]) {
    throw new BrandValidationError(`Brand ${id} not found`);
  }
  return result.rows[0] as Brand;
}

// List a brand's deep tasks newest-first.
export async function listBrandTasks(brandId: string) {
  const result = await query(
    `SELECT task_id, status, mode, platform, time_range_start, time_range_end,
            total_items, completed_items, created_at, updated_at,
            sheet_sync_status
     FROM tasks
     WHERE brand_id = $1 AND mode = 'deep'
     ORDER BY created_at DESC`,
    [brandId]
  );
  return result.rows;
}

export class BrandValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrandValidationError';
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}

// Validate a deep-mode task config has a brand and a valid time range.
export interface DeepTaskRequiredFields {
  brandId: string | null | undefined;
  platform: Platform | null | undefined;
  timeRangeStart: string | null | undefined; // ISO date YYYY-MM-DD
  timeRangeEnd: string | null | undefined;
}

export class DeepTaskValidationError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(message);
    this.field = field;
    this.name = 'DeepTaskValidationError';
  }
}

export function validateDeepTaskFields(input: DeepTaskRequiredFields): void {
  if (!input.brandId) {
    throw new DeepTaskValidationError('brandId', 'Deep tasks require brandId');
  }
  if (!input.platform || !SUPPORTED_PLATFORMS.includes(input.platform)) {
    throw new DeepTaskValidationError(
      'platform',
      `Deep tasks require platform in [${SUPPORTED_PLATFORMS.join(', ')}]`
    );
  }
  if (!input.timeRangeStart) {
    throw new DeepTaskValidationError('timeRangeStart', 'Deep tasks require time_range_start');
  }
  if (!input.timeRangeEnd) {
    throw new DeepTaskValidationError('timeRangeEnd', 'Deep tasks require time_range_end');
  }
  if (input.timeRangeEnd < input.timeRangeStart) {
    throw new DeepTaskValidationError(
      'timeRangeEnd',
      'time_range_end must not be earlier than time_range_start'
    );
  }
}

// Inspect uploaded rows' posted_at values vs declared time range.
// Used by the preview step to warn users about out-of-range data before scoring.
export interface RangeCheckResult {
  inRange: number;
  outOfRange: number;
  unparseable: number;
  outOfRangeSamples: Array<{ rowIndex: number; postedAt: string }>;
}

export function checkPostedAtRange(
  rows: Array<{ posted_at?: string | Date | null }>,
  timeRangeStart: string,
  timeRangeEnd: string
): RangeCheckResult {
  const start = new Date(timeRangeStart);
  const endExclusive = new Date(timeRangeEnd);
  endExclusive.setDate(endExclusive.getDate() + 1); // include the end date itself

  const result: RangeCheckResult = {
    inRange: 0,
    outOfRange: 0,
    unparseable: 0,
    outOfRangeSamples: [],
  };

  rows.forEach((row, idx) => {
    const raw = row.posted_at;
    if (raw === null || raw === undefined || raw === '') {
      result.unparseable++;
      return;
    }
    const dt = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(dt.getTime())) {
      result.unparseable++;
      return;
    }
    if (dt >= start && dt < endExclusive) {
      result.inRange++;
    } else {
      result.outOfRange++;
      if (result.outOfRangeSamples.length < 10) {
        result.outOfRangeSamples.push({
          rowIndex: idx,
          postedAt: dt.toISOString(),
        });
      }
    }
  });

  return result;
}
