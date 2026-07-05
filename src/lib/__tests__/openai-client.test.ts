import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptVersion } from '../prompt-versions';

const createMock = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: createMock } };
  },
}));

import { callJson, parseScore } from '../deep-pipeline/openai-client';

const PROMPT = {
  prompt_text: '請判斷品牌「{brand}」與內容「{content}」的關聯性',
  model_snapshot: 'gpt-4o-2024-05-13',
  temperature: 0,
  response_format: 'json_object',
} as PromptVersion;

describe('callJson', () => {
  beforeEach(() => createMock.mockReset());

  // Spec "Single prompt transmission per call"
  it('sends a fixed short system message and exactly one filled user message', async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: '{"ok":1}' } }] });
    const filled = '請判斷品牌「麥當勞」與內容「好吃」的關聯性';
    await callJson({ prompt: PROMPT, userMessage: filled });

    const req = createMock.mock.calls[0][0];
    expect(req.messages).toHaveLength(2);
    expect(req.messages[0].role).toBe('system');
    expect(req.messages[0].content).not.toContain('{brand}');
    expect(req.messages[0].content).not.toContain(PROMPT.prompt_text);
    expect(req.messages[1]).toEqual({ role: 'user', content: filled });
  });

  // Spec "Empty AI responses are failures"
  it('treats empty content as a failed attempt and exhausts retries', async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: '' } }] });
    await expect(
      callJson({ prompt: PROMPT, userMessage: 'x', retries: 2 })
    ).rejects.toThrow('empty AI response content');
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('recovers when a retry succeeds after an empty response', async () => {
    createMock
      .mockResolvedValueOnce({ choices: [{ message: { content: null } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"score":7}' } }] });
    const result = await callJson<{ score: number }>({ prompt: PROMPT, userMessage: 'x' });
    expect(result.score).toBe(7);
  });
});

// Spec "Score range validation"
describe('parseScore range validation', () => {
  it.each([
    [0, 0],
    [10, 10],
    ['7.5', 7.5],
    [-1, null],
    [11, null],
    [100, null],
    ['NAN', null],
    [null, null],
  ])('parseScore(%j) → %j', (input, expected) => {
    expect(parseScore(input)).toBe(expected);
  });
});
