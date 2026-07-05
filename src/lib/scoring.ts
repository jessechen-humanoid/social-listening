import { query } from './db';
import { callJson, isContentLevelFailure, parseScore } from './deep-pipeline/openai-client';
import { exceedsErrorThreshold } from './error-threshold';
import { claimTask, createHeartbeat } from './task-claim';

interface ScoringConfig {
  conditionText: string;
  xAxis: { name: string; zeroDescription: string; tenDescription: string };
  yAxis: { name: string; zeroDescription: string; tenDescription: string };
  model: string;
}

interface ScoringResult {
  condition: boolean | null;
  x_score: number;
  y_score: number;
}

function buildPrompt(config: ScoringConfig, content: string): string {
  const hasCondition = config.conditionText.trim().length > 0;

  let conditionInstruction = '';
  if (hasCondition) {
    conditionInstruction = `
3. **條件判斷 (condition)**：判斷這則內容是否符合以下條件：「${config.conditionText}」
   - 回傳 true 或 false`;
  }

  return `你是一位社群輿情分析專家。請仔細閱讀以下社群內容，並給出精確的評分。

## 評分維度

1. **${config.xAxis.name} (x_score)**：從 0.0 到 10.0
   - 0.0 分 = ${config.xAxis.zeroDescription}
   - 10.0 分 = ${config.xAxis.tenDescription}

2. **${config.yAxis.name} (y_score)**：從 0.0 到 10.0
   - 0.0 分 = ${config.yAxis.zeroDescription}
   - 10.0 分 = ${config.yAxis.tenDescription}
${conditionInstruction}

## 評分要求

- 分數必須精確到小數點第一位（例如：7.3、4.8、6.1）
- 不要只給整數分數，要根據內容的細微差異給出不同的小數分數
- 仔細考慮每則內容的語氣、用詞、情感強度來區分差異
- 善用 0.0-10.0 的完整範圍，不要集中在某幾個分數

## 待分析內容

${content}

## 回傳格式

請嚴格回傳以下 JSON 格式，不要包含任何其他文字：
${hasCondition
    ? '{"condition": true/false, "x_score": 0.0, "y_score": 0.0}'
    : '{"x_score": 0.0, "y_score": 0.0}'
  }`;
}

async function scoreContent(config: ScoringConfig, content: string): Promise<ScoringResult> {
  // Shared OpenAI path (retry/empty-content/JSON handling live in callJson).
  // retries: 1 — the caller's loop owns retrying, so attempts don't multiply.
  const parsed = await callJson<{ condition?: boolean; x_score?: unknown; y_score?: unknown }>({
    prompt: { model_snapshot: config.model, temperature: 0.3, response_format: 'json_object' },
    userMessage: buildPrompt(config, content),
    retries: 1,
  });

  const x = parseScore(parsed.x_score);
  const y = parseScore(parsed.y_score);
  if (x === null || y === null) {
    // Missing/out-of-range scores are a failed attempt — never NaN into the DB.
    throw new Error('invalid scores in AI response');
  }
  return {
    condition: parsed.condition ?? null,
    x_score: Math.round(x * 10) / 10,
    y_score: Math.round(y * 10) / 10,
  };
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function processTask(taskId: string) {
  // Single-runner claim: if another live runner holds this task, do nothing.
  // Claiming also sets status = 'processing' and stamps heartbeat_at.
  if (!(await claimTask(taskId))) {
    console.log(`Task ${taskId} is held by another runner, skipping`);
    return;
  }
  const heartbeat = createHeartbeat(taskId);

  try {
    // Get task config
    const taskResult = await query('SELECT config FROM tasks WHERE task_id = $1', [taskId]);
    if (taskResult.rows.length === 0) return;
    const config = taskResult.rows[0].config as ScoringConfig;

    // Get all pending results
    const pendingResults = await query(
      `SELECT r.result_id, r.content_text, r.row_index
       FROM task_results r
       WHERE r.task_id = $1 AND r.status = 'pending'
       ORDER BY r.row_index`,
      [taskId]
    );

    for (const row of pendingResults.rows) {
      try {
        let lastError: Error | null = null;

        // Retry up to 3 times with exponential backoff
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await heartbeat();
            const result = await scoreContent(config, row.content_text);

            await query(
              `UPDATE task_results SET
                condition_result = $1, x_score = $2, y_score = $3,
                status = 'completed', created_at = NOW()
               WHERE result_id = $4`,
              [result.condition, result.x_score, result.y_score, row.result_id]
            );

            await query(
              'UPDATE tasks SET completed_items = completed_items + 1, updated_at = NOW() WHERE task_id = $1',
              [taskId]
            );

            lastError = null;
            break;
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            if (attempt < 2) {
              await sleep(Math.pow(2, attempt) * 1000);
            }
          }
        }

        if (lastError) {
          const status = isContentLevelFailure(lastError) ? 'unscorable' : 'error';
          await query(
            'UPDATE task_results SET status = $1 WHERE result_id = $2',
            [status, row.result_id]
          );
          await query(
            'UPDATE tasks SET completed_items = completed_items + 1, updated_at = NOW() WHERE task_id = $1',
            [taskId]
          );
        }
      } catch {
        // Continue processing remaining items even if one fails catastrophically
        continue;
      }
    }

    // Completion failure threshold: a task whose errored rows exceed 1% of
    // its total is a failed task, not a quietly incomplete "completed" one.
    const counts = await query(
      `SELECT COUNT(*) FILTER (WHERE status = 'error')::int AS errors, COUNT(*)::int AS total
       FROM task_results WHERE task_id = $1`,
      [taskId]
    );
    const { errors, total } = counts.rows[0] as { errors: number; total: number };
    const finalStatus = exceedsErrorThreshold(errors, total) ? 'error' : 'completed';
    await query(
      `UPDATE tasks SET status = $2, updated_at = NOW() WHERE task_id = $1`,
      [taskId, finalStatus]
    );
  } catch {
    await query(
      "UPDATE tasks SET status = 'error', updated_at = NOW() WHERE task_id = $1",
      [taskId]
    );
  }
}
