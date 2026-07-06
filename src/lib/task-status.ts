// task_results.status value set (design「品質雜項」): a union type so a typo
// in a status string is a compile error instead of a silently-dead filter.
// Type-level only — the DB column stays unconstrained.
export const TASK_RESULT_STATUSES = [
  // light-mode row lifecycle
  'pending',
  'completed',
  // deep pipeline per-stage completion markers
  'A_related_filter_done',
  'A_emotion_favor_done',
  'B_link_done',
  'B_tag_friend_filter_done',
  'B_emotion_favor_done',
  'C_dedupe_done',
  'C_emotion_favor_done',
  // content-level refusal (visible in exports for manual review)
  'unscorable',
  // transport/system failure
  'error',
] as const;

export type TaskResultStatus = (typeof TASK_RESULT_STATUSES)[number];

// Task-level status set. 'cancelled' is a terminal state (spec "Cooperative
// task cancellation"): scored rows are kept, aggregation and ledger sync are
// skipped, and recovery never resumes a cancelled task.
export const TASK_STATUSES = [
  'pending',
  'processing',
  'completed',
  'error',
  'cancelled',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
