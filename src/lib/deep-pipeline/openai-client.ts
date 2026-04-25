import OpenAI from 'openai';
import type { PromptVersion } from '../prompt-versions';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface CallOptions {
  prompt: PromptVersion;
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
          { role: 'system', content: prompt.prompt_text },
          { role: 'user', content: userMessage },
        ],
      });
      const text = response.choices[0]?.message?.content ?? '{}';
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

// Coerce the AI's "score" field (which may be int, float, or "NAN") to a finite number,
// or null if unparseable.
export function parseScore(raw: unknown): number | null {
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
