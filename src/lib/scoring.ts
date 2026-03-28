import OpenAI from 'openai';
import { query } from './db';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
  reasoning: string;
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
- reasoning 請用繁體中文簡短說明你的判斷依據

## 待分析內容

${content}

## 回傳格式

請嚴格回傳以下 JSON 格式，不要包含任何其他文字：
${hasCondition
    ? '{"condition": true/false, "x_score": 0.0, "y_score": 0.0, "reasoning": "..."}'
    : '{"x_score": 0.0, "y_score": 0.0, "reasoning": "..."}'
  }`;
}

async function scoreContent(config: ScoringConfig, content: string): Promise<ScoringResult> {
  const prompt = buildPrompt(config, content);

  const response = await openai.chat.completions.create({
    model: config.model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    response_format: { type: 'json_object' },
  });

  const text = response.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(text);

  return {
    condition: parsed.condition ?? null,
    x_score: Math.round(Number(parsed.x_score) * 10) / 10,
    y_score: Math.round(Number(parsed.y_score) * 10) / 10,
    reasoning: parsed.reasoning || '',
  };
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function processTask(taskId: string) {
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

    await query(
      "UPDATE tasks SET status = 'processing', updated_at = NOW() WHERE task_id = $1",
      [taskId]
    );

    for (const row of pendingResults.rows) {
      try {
        let lastError: Error | null = null;

        // Retry up to 3 times with exponential backoff
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const result = await scoreContent(config, row.content_text);

            await query(
              `UPDATE task_results SET
                condition_result = $1, x_score = $2, y_score = $3,
                reasoning = $4, status = 'completed', created_at = NOW()
               WHERE result_id = $5`,
              [result.condition, result.x_score, result.y_score, result.reasoning, row.result_id]
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
          await query(
            "UPDATE task_results SET status = 'error', reasoning = $1 WHERE result_id = $2",
            [lastError.message, row.result_id]
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

    await query(
      "UPDATE tasks SET status = 'completed', updated_at = NOW() WHERE task_id = $1",
      [taskId]
    );
  } catch {
    await query(
      "UPDATE tasks SET status = 'error', updated_at = NOW() WHERE task_id = $1",
      [taskId]
    );
  }
}
