import OpenAI from 'openai';
import type { PromptVersion } from '../prompt-versions';
import { createSemaphore } from '../semaphore';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Global concurrency cap across ALL tasks and modes (spec "Concurrent scoring
// under a global limit" — the precondition the batch spec demands before
// row-level parallelism may multiply platform parallelism).
export const GLOBAL_OPENAI_CONCURRENCY = 16;
const globalGate = createSemaphore(GLOBAL_OPENAI_CONCURRENCY);

// Classified retry (spec "Classified retry strategy"): only 429/5xx/transport
// failures are retryable; other 4xx (bad key, bad request) fail immediately.
const MAX_BACKOFF_MS = 45_000;

function statusOf(err: unknown): number | null {
  const st = (err as { status?: unknown })?.status;
  return typeof st === 'number' ? st : null;
}

function retryAfterMs(err: unknown): number | null {
  const headers = (err as { headers?: Record<string, string> })?.headers;
  const raw = headers?.['retry-after'];
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

function isRetryable(err: unknown): boolean {
  const status = statusOf(err);
  if (status === null) return true; // transport / non-HTTP failure
  if (status === 429) return true;
  if (status >= 500) return true;
  return false;
}

function backoffMs(attempt: number, err: unknown): number {
  const hinted = retryAfterMs(err);
  const base = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
  const jittered = base * (1 + Math.random() * 0.3);
  return Math.min(Math.max(hinted ?? 0, jittered), MAX_BACKOFF_MS);
}

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
      await globalGate.acquire();
      let response;
      try {
        response = await client.chat.completions.create({
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
      } finally {
        globalGate.release();
      }
      const text = response.choices[0]?.message?.content;
      if (!text || !text.trim()) {
        // Refusal / content filter / length cutoff: a failed attempt for the
        // retry loop, never a silently-empty result object.
        throw new Error('empty AI response content');
      }
      return JSON.parse(text) as T;
    } catch (err) {
      lastError = err;
      // Non-retryable client errors (401/400/404...) fail fast — retrying an
      // invalid API key thousands of times helps nobody.
      if (!isContentLevelFailure(err) && !isRetryable(err)) break;
      if (attempt < retries - 1) {
        await sleep(backoffMs(attempt, err));
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
