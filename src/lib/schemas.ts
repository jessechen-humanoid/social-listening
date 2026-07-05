import { z } from 'zod';

// Structural validation at route entries (spec "Task creation input
// validation", zod clause): zod owns SHAPE (types, enums, date format);
// business rules (row caps, role completeness, model allowlist) stay in
// validate-task-input / validate-batch-input, which run AFTER these parse.
// Routes keep using the original body object — schemas gate, they don't
// transform.

const RoleEnum = z.enum(['hotpost', 'hotcomment', 'comments_from_posts']);
const PlatformEnum = z.enum(['fb', 'ig', 'threads', 'dcard']);
const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '需為 YYYY-MM-DD 日期');

const DataRow = z.record(z.string(), z.unknown());

export const DeepFileSchema = z.object({
  filename: z.string().min(1),
  role: RoleEnum,
  columnMapping: z.record(z.string(), z.unknown()).optional(),
  data: z.array(DataRow),
  forumFilter: z.array(z.string()).nullable().optional(),
});

const LightFileSchema = z.object({
  filename: z.string().min(1),
  data: z.array(DataRow),
  contentColumn: z.string().optional(),
  engagementColumn: z.string().nullable().optional(),
  columnMapping: z.record(z.string(), z.unknown()).optional(),
});

export const LightTaskInputSchema = z.object({
  mode: z.literal('light'),
  browserUuid: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
  files: z.array(LightFileSchema).min(1),
});

const DeepConfigSchema = z
  .object({
    brandId: z.string().min(1),
    timeRangeStart: DateString,
    timeRangeEnd: DateString,
  })
  .loose();

export const DeepTaskInputSchema = z.object({
  mode: z.literal('deep'),
  browserUuid: z.string().min(1),
  config: DeepConfigSchema.extend({ platform: PlatformEnum }).loose(),
  files: z.array(DeepFileSchema).min(1),
});

export const DeepBatchInputSchema = z.object({
  mode: z.literal('deep-batch'),
  browserUuid: z.string().min(1),
  config: DeepConfigSchema,
  platforms: z
    .array(z.object({ platform: PlatformEnum, files: z.array(DeepFileSchema).min(1) }))
    .min(1),
});

// One gate for POST /api/tasks: the mode discriminator yields a field-named
// error for unknown modes (spec example: mode "batch" → 400).
export const TaskInputSchema = z.discriminatedUnion('mode', [
  LightTaskInputSchema,
  DeepTaskInputSchema,
  DeepBatchInputSchema,
]);

export const BrandInputSchema = z.object({ name: z.string().trim().min(1) });

export const BrandSettingsSchema = z.object({
  platform_settings: z.record(z.string(), z.unknown()),
});

export const ExportBundleInputSchema = z.object({
  charts: z
    .array(z.object({ filename: z.string().min(1), base64: z.string() }))
    .optional(),
});

// safeParse → 400 body text: name the first offending field path
// (spec "Unified error response shape", validation scenario).
export function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue?.path?.length ? issue.path.join('.') : 'body';
  return `${path}: ${issue?.message ?? 'invalid input'}`;
}
