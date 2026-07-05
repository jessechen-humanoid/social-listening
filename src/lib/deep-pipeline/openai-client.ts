import OpenAI from 'openai';
import type { PromptVersion } from '../prompt-versions';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Fixed short system message. The filled prompt goes ONLY in the user message —
// sending prompt_text as system used to transmit the whole template a second
// time (with unfilled {placeholders}), doubling input tokens and deviating
// from the Python pipeline the fossil prompts were calibrated against.
const SYSTEM_MESSAGE = '你是行銷領域的文本分析工作者，請一律以 JSON 格式回覆。';

export interface CallOptions {
  // Only the model/temperature/format fields are read — the filled prompt
  // travels in userMessage, so light mode can pass a synthetic descriptor.
  prompt: Pick<PromptVersion, 'model_snapshot' | 'temperature' | 'response_format'>;
  userMessage: string;
  retries?: number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Call OpenAI with the given prompt version's model + temperature.
// Retries up to N times with exponential backoff. Returns parsed JSON.
export async function callJson<T = unknown>({
  prompt,
  userMessage,
  retries = 3,
}: CallOptions): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: prompt.model_snapshot,
        temperature: Number(prompt.temperature),
        response_format:
          prompt.response_format === 'json_object'
            ? { type: 'json_object' }
            : { type: 'text' },
        messages: [
          { role: 'system', content: SYSTEM_MESSAGE },
          { role: 'user', content: userMessage },
        ],
      });
      const text = response.choices[0]?.message?.content;
      if (!text || !text.trim()) {
        // Refusal / content filter / length cutoff: a failed attempt for the
        // retry loop, never a silently-empty result object.
        throw new Error('empty AI response content');
      }
      return JSON.parse(text) as T;
    } catch (err) {
      lastError = err;
      if (attempt < retries - 1) {
        await sleep(Math.pow(2, attempt) * 500);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// Substitute {key} placeholders in the prompt's user-template region.
// Used for stages whose prompts have {brand} / {content} / {message} / etc.
export function fillPlaceholders(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    return values[key] ?? match;
  });
}

// Content-level failures are properties of the text being scored (refusals,
// mangled JSON, out-of-range scores) — rows hitting these become 'unscorable'
// and are excluded from analysis without tripping the system-failure
// threshold. Everything else (API/network) is a real error.
export function isContentLevelFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /empty AI response content|invalid scores in AI response|Unexpected token|is not valid JSON|JSON/i.test(msg);
}

// Coerce the AI's "score" field (which may be int, float, or "NAN") to a finite number,
// or null if unparseable. Scores live on a 0–10 scale; out-of-range values are
// treated as unparseable (logged) so an outlier can never distort aggregates.
export function parseScore(raw: unknown): number | null {
  const n = coerceFinite(raw);
  if (n === null) return null;
  if (n < 0 || n > 10) {
    console.warn(`parseScore: out-of-range score ${n} rejected`);
    return null;
  }
  return n;
}

function coerceFinite(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.toUpperCase() === 'NAN') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return null;
}

// Coerce a string-or-bool flag from the AI. The Python prompts use "True"/"False" strings.
export function parseBoolFlag(raw: unknown): boolean | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  return null;
}
