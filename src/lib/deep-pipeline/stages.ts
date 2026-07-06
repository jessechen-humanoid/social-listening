import { batchUpdate, query } from '../db';
import { TaskCancelledError } from '../task-claim';
import type { PromptVersion } from '../prompt-versions';
import { DEEP_STAGES, type DeepStageName } from '../seed-prompts';
import { callJson, fillPlaceholders, isContentLevelFailure, parseScore, parseBoolFlag } from './openai-client';
import { parentKey, postKey } from '../fb-post-key';
import { mapConcurrent } from '../semaphore';

// Rows scored concurrently within one task; the module-level semaphore in
// openai-client caps GLOBAL concurrency across all tasks at 16.
const ROW_CONCURRENCY = 10;

export interface StageContext {
  taskId: string;
  brandName: string;
  // stage_name -> active prompt version bound to this task at start time
  prompts: Map<DeepStageName, PromptVersion>;
  // Throttled execution heartbeat; stage loops call it before each AI call so
  // the task's lease stays fresh while waiting on OpenAI.
  heartbeat?: () => Promise<void>;
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

  await mapConcurrent(rows, ROW_CONCURRENCY, async (row) => {
    const userMessage = fillPlaceholders(prompt.prompt_text, {
      brand: ctx.brandName,
      content: row.content_text || '',
    });
    await ctx.heartbeat?.();
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
      // Cancellation must reach the runner, not become a row failure.
      if (err instanceof TaskCancelledError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      // Content refusals become 'unscorable' (excluded, not a system failure).
      const status = isContentLevelFailure(err) ? 'unscorable' : 'error';
      await query(
        `UPDATE task_results SET status = $1, reasoning = $2 WHERE result_id = $3`,
        [status, `A_related_filter: ${msg}`, row.result_id]
      );
    }
  });

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

  await mapConcurrent(rows, ROW_CONCURRENCY, async (row) => {
    const userMessage = fillPlaceholders(prompt.prompt_text, {
      brand: ctx.brandName,
      content: row.content_text || '',
    });
    await ctx.heartbeat?.();
    try {
      const result = await callJson<Record<string, unknown>>({ prompt, userMessage });
      const emotion = parseScore(result['情緒分數']);
      const favor = parseScore(result['好感分數']);
      if (emotion === null || favor === null) {
        throw new Error('invalid scores in AI response');
      }
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
      // Cancellation must reach the runner, not become a row failure.
      if (err instanceof TaskCancelledError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      // Content refusals become 'unscorable' (excluded, not a system failure).
      const status = isContentLevelFailure(err) ? 'unscorable' : 'error';
      await query(
        `UPDATE task_results SET status = $1, reasoning = $2 WHERE result_id = $3`,
        [status, `A_emotion_favor: ${msg}`, row.result_id]
      );
    }
  });

  return { inputCount: rows.length, outputCount };
}

// ---------------------------------------------------------------------------
// Stage B_link — non-AI: filter stage B comments down to those whose parent
// post passed stage A. Marks filtered_out=true on orphans.
// ---------------------------------------------------------------------------

// Origin: link_A_to_B.py —「重要濾除：抽獎文的配對沒有意義」. Comments whose
// parent post mentions giveaways are noise and are excluded from analysis.
const GIVEAWAY_KEYWORD = '抽獎';

export async function runStageBLink(ctx: StageContext): Promise<StageOutcome> {
  const passedPosts = await query(
    `SELECT post_url, author_id, content_text
     FROM task_results
     WHERE task_id = $1 AND stage_name = 'A'
       AND filtered_out = FALSE
       AND post_url IS NOT NULL`,
    [ctx.taskId]
  );

  // Each post is reachable by its raw URL (backwards compatibility) and by
  // its normalized key (Python link_A_to_B.py parity): real Qsearch exports
  // reference parents as {author_id}_{post_id} while post permalinks use
  // other shapes (e.g. /reel/{post_id}/), so raw URL equality alone matches nothing.
  interface PostRef {
    postUrl: string;
    giveaway: boolean;
  }
  const postByKey = new Map<string, PostRef>();
  for (const p of passedPosts.rows as Array<{
    post_url: string;
    author_id: string | null;
    content_text: string | null;
  }>) {
    const ref: PostRef = {
      postUrl: p.post_url,
      giveaway: (p.content_text ?? '').includes(GIVEAWAY_KEYWORD),
    };
    postByKey.set(p.post_url, ref);
    const key = postKey(p.author_id, p.post_url);
    if (key) postByKey.set(key, ref);
  }

  const stageB = await query(
    `SELECT result_id, parent_post_url
     FROM task_results
     WHERE task_id = $1 AND stage_name = 'B' AND filtered_out IS NULL`,
    [ctx.taskId]
  );

  let matched = 0;
  let kept = 0;
  // Matching stays in JS (normalized keys); write-back is set-based
  // (spec "Batched non-AI stage writes").
  const updates: Array<Array<unknown>> = [];
  for (const row of stageB.rows as Array<{ result_id: string; parent_post_url: string | null }>) {
    const ref = row.parent_post_url
      ? postByKey.get(row.parent_post_url) ?? postByKey.get(parentKey(row.parent_post_url))
      : undefined;

    if (!ref) {
      updates.push([row.result_id, true, row.parent_post_url]);
      continue;
    }

    matched++;
    // Rewrite parent_post_url to the matched post's canonical URL so downstream
    // URL joins (B_emotion_favor) keep working unchanged. Giveaway-post comments
    // are excluded here, exactly like the Python pipeline's pre-pairing skip.
    updates.push([row.result_id, ref.giveaway, ref.postUrl]);
    if (!ref.giveaway) kept++;
  }
  await batchUpdate(
    'task_results',
    'result_id',
    "filtered_out = v.f_out::boolean, parent_post_url = v.p_url, status = 'B_link_done'",
    ['f_out', 'p_url'],
    updates
  );

  console.log(
    `B_link (${ctx.taskId}): ${matched}/${stageB.rows.length} comments matched, ${kept} kept after giveaway filter`
  );
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

  await mapConcurrent(rows, ROW_CONCURRENCY, async (row) => {
    const userMessage = fillPlaceholders(prompt.prompt_text, {
      message: row.content_text || '',
    });
    await ctx.heartbeat?.();
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
      // Cancellation must reach the runner, not become a row failure.
      if (err instanceof TaskCancelledError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      // Content refusals become 'unscorable' (excluded, not a system failure).
      const status = isContentLevelFailure(err) ? 'unscorable' : 'error';
      await query(
        `UPDATE task_results SET status = $1, reasoning = $2 WHERE result_id = $3`,
        [status, `B_tag_friend_filter: ${msg}`, row.result_id]
      );
    }
  });

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

  // Parent post content via an in-memory Map instead of a SQL JOIN: duplicate
  // post URLs in the hotpost data would fan a join out and score the same
  // comment multiple times. First row per URL wins; each comment appears once.
  const posts = await query(
    `SELECT post_url, content_text
     FROM task_results
     WHERE task_id = $1 AND stage_name = 'A' AND post_url IS NOT NULL
     ORDER BY row_index`,
    [ctx.taskId]
  );
  const postContent = new Map<string, string>();
  for (const p of posts.rows as Array<{ post_url: string; content_text: string | null }>) {
    if (!postContent.has(p.post_url)) postContent.set(p.post_url, p.content_text ?? '');
  }

  const pending = await query(
    `SELECT result_id, content_text, parent_post_url
     FROM task_results
     WHERE task_id = $1 AND stage_name = 'B'
       AND filtered_out = FALSE
       AND emotion_raw IS NULL
     ORDER BY parent_post_url, row_index`,
    [ctx.taskId]
  );
  const rows = (pending.rows as CommentBatchRow[]).map((r) => ({
    ...r,
    post_content: postContent.get(r.parent_post_url) ?? '',
  }));

  // Group by parent_post_url and process in batches of 5.
  const groups = new Map<string, CommentBatchRow[]>();
  for (const r of rows) {
    if (!groups.has(r.parent_post_url)) groups.set(r.parent_post_url, []);
    groups.get(r.parent_post_url)!.push(r);
  }

  const batches: CommentBatchRow[][] = [];
  for (const [, group] of groups) {
    for (let i = 0; i < group.length; i += COMMENT_BATCH_SIZE) {
      batches.push(group.slice(i, i + COMMENT_BATCH_SIZE));
    }
  }
  let outputCount = 0;
  await mapConcurrent(batches, ROW_CONCURRENCY, async (batch) => {
    await ctx.heartbeat?.();
    const ok = await scoreCommentBatch(prompt, ctx.brandName, batch, ctx.heartbeat);
    outputCount += ok;
  });

  return { inputCount: rows.length, outputCount };
}

async function scoreCommentBatch(
  prompt: PromptVersion,
  brand: string,
  batch: CommentBatchRow[],
  heartbeat?: () => Promise<void>
): Promise<number> {
  if (batch.length === 0) return 0;

  const messageBundle = batch.map((r) => `「${r.content_text || ''}」`).join('、');
  const userMessage = fillPlaceholders(prompt.prompt_text, {
    brand,
    post: batch[0].post_content || '',
    num_comments: String(batch.length),
    message_bundle: messageBundle,
  });

  let scores: Array<{ emotion: number | null; favor: number | null; failure?: 'content' | 'error' }> = [];
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
        // Cancellation checkpoint: without this, a downgraded 25-comment
        // group would issue 25 more calls after a cancel is requested.
        await heartbeat?.();
        const result = await callJson<{ result?: Array<Record<string, unknown>> }>({
          prompt,
          userMessage: single,
        });
        const entry = Array.isArray(result.result) ? result.result[0] : (result as Record<string, unknown>);
        scores.push({
          emotion: parseScore((entry as Record<string, unknown>)?.['情緒分數']),
          favor: parseScore((entry as Record<string, unknown>)?.['好感分數']),
        });
      } catch (err) {
        if (err instanceof TaskCancelledError) throw err;
        scores.push({
          emotion: null,
          favor: null,
          failure: isContentLevelFailure(err) ? 'content' : 'error',
        });
      }
    }
  }

  let written = 0;
  for (let i = 0; i < batch.length; i++) {
    const { emotion, favor } = scores[i];
    if (emotion !== null && favor !== null) {
      await query(
        `UPDATE task_results
         SET emotion_raw = $1, favor_raw = $2, status = 'B_emotion_favor_done'
         WHERE result_id = $3`,
        [emotion, favor, batch[i].result_id]
      );
      written++;
    } else {
      // Parsed-null without a recorded transport failure = the model returned
      // junk for this text → content-level. Real API failures stay 'error'.
      const status = scores[i].failure === 'error' ? 'error' : 'unscorable';
      await query(
        `UPDATE task_results SET status = $1, reasoning = $2 WHERE result_id = $3`,
        [status, 'B_emotion_favor: scoring failed after retries', batch[i].result_id]
      );
    }
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
  const dedupeUpdates: Array<Array<unknown>> = [];
  for (const row of stageC.rows as Array<{ result_id: string; post_url: string | null }>) {
    const dup = row.post_url ? seen.has(row.post_url) : false;
    dedupeUpdates.push([row.result_id, dup]);
    if (!dup) kept++;
  }
  await batchUpdate(
    'task_results',
    'result_id',
    "filtered_out = v.f_out::boolean, status = 'C_dedupe_done'",
    ['f_out'],
    dedupeUpdates
  );

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

  await mapConcurrent(rows, ROW_CONCURRENCY, async (row) => {
    const userMessage = fillPlaceholders(prompt.prompt_text, {
      brand: ctx.brandName,
      comment: row.content_text || '',
    });
    await ctx.heartbeat?.();
    try {
      const result = await callJson<Record<string, unknown>>({ prompt, userMessage });
      const related = parseScore(result['關聯性分數']);
      const emotion = parseScore(result['情緒分數']);
      const favor = parseScore(result['好感分數']);
      if (emotion === null || favor === null) {
        throw new Error('invalid scores in AI response');
      }
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
      // Cancellation must reach the runner, not become a row failure.
      if (err instanceof TaskCancelledError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      // Content refusals become 'unscorable' (excluded, not a system failure).
      const status = isContentLevelFailure(err) ? 'unscorable' : 'error';
      await query(
        `UPDATE task_results SET status = $1, reasoning = $2 WHERE result_id = $3`,
        [status, `C_emotion_favor: ${msg}`, row.result_id]
      );
    }
  });

  return { inputCount: rows.length, outputCount };
}
