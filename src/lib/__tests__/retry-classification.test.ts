import { describe, expect, it, vi } from 'vitest';
import type { PromptVersion } from '../prompt-versions';

const createMock = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: createMock } };
  },
}));

import { callJson } from '../deep-pipeline/openai-client';

const PROMPT = {
  model_snapshot: 'gpt-4o-2024-05-13',
  temperature: 0,
  response_format: 'json_object',
} as PromptVersion;

function apiError(status: number, headers?: Record<string, string>) {
  const err = new Error(`API ${status}`) as Error & {
    status: number;
    headers?: Record<string, string>;
  };
  err.status = status;
  err.headers = headers;
  return err;
}

// Spec "Classified retry strategy".
// NOTE: no beforeEach mock reset — vitest v4's reset + rejection arming
// combination misattributes an unhandled rejection to the test. Each test
// arms the mock lazily at its start instead.
describe('callJson retry classification', () => {
  it('honors Retry-After: 3 on 429 before the next attempt', async () => {
    createMock
      .mockImplementationOnce(() => Promise.reject(apiError(429, { 'retry-after': '3' })))
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"ok":1}' } }] });

    const started = Date.now();
    const result = await callJson<{ ok: number }>({ prompt: PROMPT, userMessage: 'x' });
    const elapsed = Date.now() - started;

    expect(result.ok).toBe(1);
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(elapsed).toBeGreaterThanOrEqual(3000);
  }, 15_000);

  it('retries 5xx and succeeds on recovery', async () => {
    createMock.mockClear();
    createMock
      .mockImplementationOnce(() => Promise.reject(apiError(503)))
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"ok":2}' } }] });
    const result = await callJson<{ ok: number }>({ prompt: PROMPT, userMessage: 'x' });
    expect(result.ok).toBe(2);
    expect(createMock).toHaveBeenCalledTimes(2);
  }, 15_000);

  it('fails fast on 401 with exactly one request', async () => {
    createMock.mockClear();
    createMock.mockImplementation(() => Promise.reject(apiError(401)));
    let caught: unknown = null;
    try {
      await callJson({ prompt: PROMPT, userMessage: 'x' });
    } catch (err) {
      caught = err;
    }
    expect((caught as Error)?.message).toBe('API 401');
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
