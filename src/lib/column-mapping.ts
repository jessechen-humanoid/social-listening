// Pure logic — safe to import from client components. The DB-backed
// `getMemorizedMapping` lives in column-mapping-server.ts.
import type { Platform } from './platforms';

export type FileRole = 'hotpost' | 'hotcomment' | 'comments_from_posts';

export type LogicalField =
  | 'content'
  | 'engagement_value'
  | 'posted_at'
  | 'post_url'
  | 'comment_url'
  | 'parent_post_url'
  | 'forum'
  | 'author_id'
  | 'author_name';

export type ColumnMapping = Partial<Record<LogicalField, string>>;

interface FieldSpec {
  field: LogicalField;
  required: boolean;
}

// Required / optional logical fields per file role.
// Spec: qsearch-column-mapping "Column mapping step after upload"
const HOTPOST_FIELDS: FieldSpec[] = [
  { field: 'content', required: true },
  { field: 'engagement_value', required: true },
  { field: 'posted_at', required: true },
  { field: 'post_url', required: true },
  { field: 'author_id', required: false },
  { field: 'author_name', required: false },
];

const HOTCOMMENT_FIELDS: FieldSpec[] = [
  { field: 'content', required: true },
  { field: 'engagement_value', required: true },
  { field: 'posted_at', required: true },
  { field: 'comment_url', required: true },
];

const COMMENTS_FROM_POSTS_FIELDS: FieldSpec[] = [
  { field: 'content', required: true },
  { field: 'engagement_value', required: true },
  { field: 'posted_at', required: true },
  { field: 'comment_url', required: true },
  { field: 'parent_post_url', required: true },
];

const FIELDS_BY_ROLE: Record<FileRole, FieldSpec[]> = {
  hotpost: HOTPOST_FIELDS,
  hotcomment: HOTCOMMENT_FIELDS,
  comments_from_posts: COMMENTS_FROM_POSTS_FIELDS,
};

export function getLogicalFields(role: FileRole): FieldSpec[] {
  return FIELDS_BY_ROLE[role];
}

// Whether a given role + platform combination needs a forum filter
// (used by the Dcard forum filter UI).
export function rolePlatformNeedsForumFilter(
  role: FileRole,
  platform: Platform
): boolean {
  return platform === 'dcard' && role === 'hotpost';
}

// Heuristic patterns mapping logical fields to common Qsearch column names.
// Earlier entries take priority. All matches are case-insensitive.
const GUESS_PATTERNS: Record<LogicalField, string[]> = {
  content: ['content', 'message', 'text', 'title'],
  engagement_value: [
    'engagement_score',
    'engagement_value',
    'engagement',
    'reaction_count',
    'like_count',
  ],
  posted_at: ['created_time', 'created_at', 'posted_at', 'post_time', 'time', '貼文時間'],
  post_url: ['permalink', 'post_url', 'url', 'link'],
  comment_url: ['comment_url', 'permalink', 'url', 'link'],
  parent_post_url: [
    'parent_post_url',
    'parent_permalink',
    'parent_url',
    'post_permalink',
    'post_url',
  ],
  forum: ['forum_name', 'forum', 'source', 'site'],
  author_id: ['poster_id', 'author_id', 'user_id', 'poster_username'],
  author_name: ['poster_name', 'author_name', 'user_name', 'name'],
};

// Best-guess mapping from a file's columns to logical fields.
// Returns only fields where a candidate column was found.
export function guessColumnMapping(
  columns: string[],
  role: FileRole,
  platform: Platform
): ColumnMapping {
  const lowerToOriginal = new Map<string, string>();
  for (const col of columns) {
    lowerToOriginal.set(col.toLowerCase(), col);
  }

  const guess: ColumnMapping = {};
  const fields = FIELDS_BY_ROLE[role].map((f) => f.field);
  if (rolePlatformNeedsForumFilter(role, platform)) {
    fields.push('forum');
  }

  for (const field of fields) {
    const patterns = GUESS_PATTERNS[field] ?? [];
    for (const pattern of patterns) {
      const original = lowerToOriginal.get(pattern.toLowerCase());
      if (original) {
        guess[field] = original;
        break;
      }
    }
  }
  return guess;
}

export interface MappingValidationResult {
  ok: boolean;
  missing: LogicalField[];
}

// Validate a user-confirmed mapping has every required field set
// to a column that actually exists in the file.
export function validateMapping(
  mapping: ColumnMapping,
  role: FileRole,
  availableColumns: string[]
): MappingValidationResult {
  const columnSet = new Set(availableColumns);
  const missing: LogicalField[] = [];
  for (const { field, required } of FIELDS_BY_ROLE[role]) {
    if (!required) continue;
    const mapped = mapping[field];
    if (!mapped || !columnSet.has(mapped)) {
      missing.push(field);
    }
  }
  return { ok: missing.length === 0, missing };
}

export interface MemorizedMappingApplied {
  mapping: ColumnMapping;
  requiresReview: boolean;
  unmappedFields: LogicalField[];
  newColumns: string[];
}

// Apply a memorized mapping to a fresh upload's columns.
// Per spec, if any memorized target column is missing from the new file
// (renamed or removed) OR the new file has columns we have never seen before
// for required fields without a guess match, mark the mapping as requires_review.
export function applyMemorizedMapping(
  memorized: ColumnMapping,
  currentColumns: string[],
  role: FileRole,
  platform: Platform
): MemorizedMappingApplied {
  const columnSet = new Set(currentColumns);
  const survivors: ColumnMapping = {};
  const unmappedFields: LogicalField[] = [];

  for (const [field, column] of Object.entries(memorized) as Array<
    [LogicalField, string]
  >) {
    if (column && columnSet.has(column)) {
      survivors[field] = column;
    } else {
      unmappedFields.push(field);
    }
  }

  // Fill any gaps from heuristics so the user sees something pre-filled,
  // but flag for review.
  const guessed = guessColumnMapping(currentColumns, role, platform);
  for (const field of unmappedFields) {
    if (guessed[field] && !survivors[field]) {
      survivors[field] = guessed[field];
    }
  }

  // Surface columns this brand has never seen in any prior mapping —
  // worth a glance from the user.
  const memorizedColumns = new Set(Object.values(memorized).filter(Boolean));
  const newColumns = currentColumns.filter((c) => !memorizedColumns.has(c));

  const requiresReview = unmappedFields.length > 0 || newColumns.length > 0;
  return {
    mapping: survivors,
    requiresReview,
    unmappedFields,
    newColumns,
  };
}
