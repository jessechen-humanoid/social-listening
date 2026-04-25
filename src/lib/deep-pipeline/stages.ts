import { query } from '../db';
import type { PromptVersion } from '../prompt-versions';
import { DEEP_STAGES, type DeepStageName } from '../seed-prompts';
import { callJson, fillPlaceholders, parseScore, parseBoolFlag } from './openai-client';

export interface StageContext {
  taskId: string;
  brandName: string;
  // stage_name -> active prompt version bound to this task at start time
  prompts: Map<DeepStageName, PromptVersion>;
}

export interface StageOutcome {
  inputCount: number;
  outputCount: number;
}

interface ScoredRow {
  result_id: string;
  content_text: string;
  parent_post_url?: string | null;
  post_url?: string | null;
}

const RELATED_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// Stage A_related_filter
// ---------------------------------------------------------------------------

export async function runStageARelatedFilter(ctx: StageContext): Promise<StageOutcome> {
  const prompt = ctx.prompts.get(DEEP_STAGES.A_RELATED_FILTER);
  if (!prompt) throw new Error(`No prompt bound for ${DEEP_STAGES.A_RELATED_FILTER}`);

  // Pending rows: stage A, never scored on related_score
  const pending = await query(
    `SELECT result_id, content_text
     FROM task_results
     WHERE task_id = $1 AND stage_name = 'A' AND related_score IS NULL`,
    [ctx.taskId]
  );
  const rows: ScoredRow[] = pending.rows;
  let outputCount = 0;

  for (const row of rows) {
    const userMessage = fillPlaceholders(prompt.prompt_text, {
      brand: ctx.brandName,
      content: row.content_text || '',
    });
    try {
      const result = await callJson<Record<string, unknown>>({ prompt, userMessage });
      const score = parseScore(result['關聯性分數']);
      const filteredOut = score === null ? true : score <= RELATED_THRESHOLD;
      await query(
        `UPDATE task_results
         SET related_score = $1, filtered_out = $2, status = 'A_related_filter_done'
         WHERE result_id = $3`,
        [score, filteredOut, row.result_id]
      );
      outputCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await query(
        `UPDATE task_results SET status = 'error', reasoning = $1 WHERE result_id = $2`,
        [`A_related_filter: ${msg}`, row.result_id]
      );
    }
  }

  return { inputCount: rows.length, outputCount };
}

// ---------------------------------------------------------------------------
// Stage A_emotion_favor
// ---------------------------------------------------------------------------

export async function runStageAEmotionFavor(ctx: StageContext): Promise<StageOutcome> {
  const prompt = ctx.prompts.get(DEEP_STAGES.A_EMOTION_FAVOR);
  if (!prompt) throw new Error(`No prompt bound for ${DEEP_STAGES.A_EMOTION_FAVOR}`);

  const pending = await query(
    `SELECT result_id, content_text
     FROM task_results
     WHERE task_id = $1 AND stage_name = 'A'
       AND filtered_out = FALSE
       AND emotion_raw IS NULL`,
    [ctx.taskId]
  );
  const rows: ScoredRow[] = pending.rows;
  let outputCount = 0;

  for (const row of rows) {
    const userMessage = fillPlaceholders(prompt.prompt_text, {
      brand: ctx.brandName,
      content: row.content_text || '',
    });
    try {
      const result = await callJson<Record<string, unknown>>({ prompt, userMessage });
      const emotion = parseScore(result['情緒分數']);
      const favor = parseScore(result['好感分數']);
      const notRealUser = parseBoolFlag(result['NotRealUser']);
      const notRealUserReason =
        typeof result['NotRealUser_reason'] === 'string'
          ? (result['NotRealUser_reason'] as string)
          : null;

      // not_real_user counts as filtered_out for downstream aggregation
      const filteredOut = notRealUser === true ? true : false;

      await query(
        `UPDATE task_results
         SET emotion_raw = $1,
             favor_raw = $2,
             not_real_user = $3,
             not_real_user_reason = $4,
             filtered_out = CASE WHEN $5 THEN TRUE ELSE filtered_out END,
             status = 'A_emotion_favor_done'
         WHERE result_id = $6`,
        [emotion, favor, notRealUser, notRealUserReason, filteredOut, row.result_id]
      );
      outputCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await query(
        `UPDATE task_results SET status = 'error', reasoning = $1 WHERE result_id = $2`,
        [`A_emotion_favor: ${msg}`, row.result_id]
      );
    }
  }

  return { inputCount: rows.length, outputCount };
}

// ---------------------------------------------------------------------------
// Stage B_link — non-AI: filter stage B comments down to those whose parent
// post passed stage A. Marks filtered_out=true on orphans.
// ---------------------------------------------------------------------------

export async function runStageBLink(ctx: StageContext): Promise<StageOutcome> {
  const passedPosts = await query(
    `SELECT DISTINCT post_url
     FROM task_results
     WHERE task_id = $1 AND stage_name = 'A'
       AND filtered_out = FALSE
       AND post_url IS NOT NULL`,
    [ctx.taskId]
  );
  const passedSet = new Set<string>(
    (passedPosts.rows as Array<{ post_url: string }>).map((r) => r.post_url)
  );

  const stageB = await query(
    `SELECT result_id, parent_post_url
     FROM task_results
     WHERE task_id = $1 AND stage_name = 'B' AND filtered_out IS NULL`,
    [ctx.taskId]
  );

  let kept = 0;
  for (const row of stageB.rows as Array<{ result_id: string; parent_post_url: string | null }>) {
    const orphan = !row.parent_post_url || !passedSet.has(row.parent_post_url);
    await query(
      `UPDATE task_results SET filtered_out = $1, status = 'B_link_done' WHERE result_id = $2`,
      [orphan, row.result_id]
    );
    if (!orphan) kept++;
  }

  return { inputCount: stageB.rows.length, outputCount: kept };
}

// ---------------------------------------------------------------------------
// Stage B_tag_friend_filter
// ---------------------------------------------------------------------------

export async function runStageBTagFriendFilter(ctx: StageContext): Promise<StageOutcome> {
  const prompt = ctx.prompts.get(DEEP_STAGES.B_TAG_FRIEND_FILTER);
  if (!prompt) throw new Error(`No prompt bound for ${DEEP_STAGES.B_TAG_FRIEND_FILTER}`);

  const pending = await query(
    `SELECT result_id, content_text
     FROM task_results
     WHERE task_id = $1 AND stage_name = 'B'
       AND filtered_out = FALSE
       AND tag_friend IS NULL`,
    [ctx.taskId]
  );
  const rows: ScoredRow[] = pending.rows;
  let kept = 0;

  for (const row of rows) {
    const userMessage = fillPlaceholders(prompt.prompt_text, {
      message: row.content_text || '',
    });
    try {
      const result = await callJson<Record<string, unknown>>({ prompt, userMessage });
      const tagFriend = parseBoolFlag(result['Tag_Friend']);
      const filteredOut = tagFriend === true;
      await query(
        `UPDATE task_results
         SET tag_friend = $1,
             filtered_out = CASE WHEN $2 THEN TRUE ELSE filtered_out END,
             status = 'B_tag_friend_filter_done'
         WHERE result_id = $3`,
        [tagFriend, filteredOut, row.result_id]
      );
      if (!filteredOut) kept++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await query(
        `UPDATE task_results SET status = 'error', reasoning = $1 WHERE result_id = $2`,
        [`B_tag_friend_filter: ${msg}`, row.result_id]
      );
    }
  }

  return { inputCount: rows.length, outputCount: kept };
}

// ---------------------------------------------------------------------------
// Stage B_emotion_favor — batched up to 5 comments per parent post.
// On response-length mismatch, downgrades to batch=1 and retries.
// ---------------------------------------------------------------------------

const COMMENT_BATCH_SIZE = 5;

interface CommentBatchRow {
  result_id: string;
  content_text: string;
  parent_post_url: string;
  post_content?: string;
}

export async function runStageBEmotionFavor(ctx: StageContext): Promise<StageOutcome> {
  const prompt = ctx.prompts.get(DEEP_STAGES.B_EMOTION_FAVOR);
  if (!prompt) throw new Error(`No prompt bound for ${DEEP_STAGES.B_EMOTION_FAVOR}`);

  // Fetch pending B rows + their parent post content (from stage A).
  const pending = await query(
    `SELECT b.result_id, b.content_text, b.parent_post_url, a.content_text AS post_content
     FROM task_results b
     LEFT JOIN task_results a
       ON a.task_id = b.task_id
      AND a.stage_name = 'A'
      AND a.post_url = b.parent_post_url
     WHERE b.task_id = $1 AND b.stage_name = 'B'
       AND b.filtered_out = FALSE
       AND b.emotion_raw IS NULL
     ORDER BY b.parent_post_url, b.row_index`,
    [ctx.taskId]
  );
  const rows = pending.rows as CommentBatchRow[];

  // Group by parent_post_url and process in batches of 5.
  const groups = new Map<string, CommentBatchRow[]>();
  for (const r of rows) {
    if (!groups.has(r.parent_post_url)) groups.set(r.parent_post_url, []);
    groups.get(r.parent_post_url)!.push(r);
  }

  let outputCount = 0;
  for (const [, group] of groups) {
    for (let i = 0; i < group.length; i += COMMENT_BATCH_SIZE) {
      const batch = group.slice(i, i + COMMENT_BATCH_SIZE);
      const ok = await scoreCommentBatch(prompt, ctx.brandName, batch);
      outputCount += ok;
    }
  }

  return { inputCount: rows.length, outputCount };
}

async function scoreCommentBatch(
  prompt: PromptVersion,
  brand: string,
  batch: CommentBatchRow[]
): Promise<number> {
  if (batch.length === 0) return 0;

  const messageBundle = batch.map((r) => `「${r.content_text || ''}」`).join('、');
  const userMessage = fillPlaceholders(prompt.prompt_text, {
    brand,
    post: batch[0].post_content || '',
    num_comments: String(batch.length),
    message_bundle: messageBundle,
  });

  let scores: Array<{ emotion: number | null; favor: number | null }> = [];
  try {
    const result = await callJson<{ result?: Array<Record<string, unknown>> }>({
      prompt,
      userMessage,
    });
    const arr = Array.isArray(result.result) ? result.result : [];
    if (arr.length === batch.length) {
      scores = arr.map((entry) => ({
        emotion: parseScore(entry['情緒分數']),
        favor: parseScore(entry['好感分數']),
      }));
    }
  } catch {
    // fall through to per-row retry
  }

  // Length mismatch or failure → downgrade to batch=1 and retry per row
  if (scores.length !== batch.length) {
    scores = [];
    for (const r of batch) {
      const single = fillPlaceholders(prompt.prompt_text, {
        brand,
        post: r.post_content || '',
        num_comments: '1',
        message_bundle: `「${r.content_text || ''}」`,
      });
      try {
        const result = await callJson<{ result?: Array<Record<string, unknown>> }>({
          prompt,
          userMessage: single,
        });
        const entry = Array.isArray(result.result) ? result.result[0] : (result as Record<string, unknown>);
        scores.push({
          emotion: parseScore((entry as Record<string, unknown>)?.['情緒分數']),
          favor: parseScore((entry as Record<string, unknown>)?.['好感分數']),
        });
      } catch {
        scores.push({ emotion: null, favor: null });
      }
    }
  }

  let written = 0;
  for (let i = 0; i < batch.length; i++) {
    const { emotion, favor } = scores[i];
    await query(
      `UPDATE task_results
       SET emotion_raw = $1, favor_raw = $2, status = 'B_emotion_favor_done'
       WHERE result_id = $3`,
      [emotion, favor, batch[i].result_id]
    );
    if (emotion !== null && favor !== null) written++;
  }
  return written;
}

// ---------------------------------------------------------------------------
// Stage C_dedupe — non-AI: mark stage C rows whose URL already appears in stage B.
// ---------------------------------------------------------------------------

export async function runStageCDedupe(ctx: StageContext): Promise<StageOutcome> {
  const stageBUrls = await query(
    `SELECT DISTINCT post_url
     FROM task_results
     WHERE task_id = $1 AND stage_name = 'B'
       AND filtered_out = FALSE
       AND post_url IS NOT NULL`,
    [ctx.taskId]
  );
  const seen = new Set<string>(
    (stageBUrls.rows as Array<{ post_url: string }>).map((r) => r.post_url)
  );

  const stageC = await query(
    `SELECT result_id, post_url
     FROM task_results
     WHERE task_id = $1 AND stage_name = 'C' AND filtered_out IS NULL`,
    [ctx.taskId]
  );

  let kept = 0;
  for (const row of stageC.rows as Array<{ result_id: string; post_url: string | null }>) {
    const dup = row.post_url ? seen.has(row.post_url) : false;
    await query(
      `UPDATE task_results SET filtered_out = $1, status = 'C_dedupe_done' WHERE result_id = $2`,
      [dup, row.result_id]
    );
    if (!dup) kept++;
  }

  return { inputCount: stageC.rows.length, outputCount: kept };
}

// ---------------------------------------------------------------------------
// Stage C_emotion_favor — single comment per call (also evaluates relevance).
// ---------------------------------------------------------------------------

export async function runStageCEmotionFavor(ctx: StageContext): Promise<StageOutcome> {
  const prompt = ctx.prompts.get(DEEP_STAGES.C_EMOTION_FAVOR);
  if (!prompt) throw new Error(`No prompt bound for ${DEEP_STAGES.C_EMOTION_FAVOR}`);

  const pending = await query(
    `SELECT result_id, content_text
     FROM task_results
     WHERE task_id = $1 AND stage_name = 'C'
       AND filtered_out = FALSE
       AND emotion_raw IS NULL`,
    [ctx.taskId]
  );
  const rows: ScoredRow[] = pending.rows;
  let outputCount = 0;

  for (const row of rows) {
    const userMessage = fillPlaceholders(prompt.prompt_text, {
      brand: ctx.brandName,
      comment: row.content_text || '',
    });
    try {
      const result = await callJson<Record<string, unknown>>({ prompt, userMessage });
      const related = parseScore(result['關聯性分數']);
      const emotion = parseScore(result['情緒分數']);
      const favor = parseScore(result['好感分數']);
      const filteredOut = related !== null && related <= RELATED_THRESHOLD;
      await query(
        `UPDATE task_results
         SET related_score = $1,
             emotion_raw = $2,
             favor_raw = $3,
             filtered_out = CASE WHEN $4 THEN TRUE ELSE filtered_out END,
             status = 'C_emotion_favor_done'
         WHERE result_id = $5`,
        [related, emotion, favor, filteredOut, row.result_id]
      );
      outputCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await query(
        `UPDATE task_results SET status = 'error', reasoning = $1 WHERE result_id = $2`,
        [`C_emotion_favor: ${msg}`, row.result_id]
      );
    }
  }

  return { inputCount: rows.length, outputCount };
}
