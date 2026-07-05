import { describe, expect, it } from 'vitest';
import { MAX_TOTAL_ROWS, validateTaskInput } from '../validate-task-input';

// Spec "Task creation input validation" — validation boundaries example table.
describe('validateTaskInput', () => {
  const rows = (n: number) => Array.from({ length: n }, () => ({}));

  it('accepts a deep task with valid roles and 59999 rows', () => {
    const result = validateTaskInput({
      mode: 'deep',
      config: {},
      files: [
        { role: 'hotpost', data: rows(29999) },
        { role: 'hotcomment', data: rows(15000) },
        { role: 'comments_from_posts', data: rows(15000) },
      ],
    });
    expect(result).toEqual({ ok: true, mode: 'deep' });
  });

  it('rejects an invalid deep file role with 400 naming the role', () => {
    const result = validateTaskInput({
      mode: 'deep',
      config: {},
      files: [{ role: 'hotposts', data: rows(10) }],
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect((result as { error: string }).error).toContain('hotposts');
  });

  it('rejects a light task exceeding the row limit with 413', () => {
    const result = validateTaskInput({
      mode: 'light',
      config: { model: 'gpt-4o' },
      files: [{ data: rows(MAX_TOTAL_ROWS + 1) }],
    });
    expect(result).toMatchObject({ ok: false, status: 413 });
  });

  it('rejects an unknown mode with 400', () => {
    const result = validateTaskInput({ mode: 'batch', config: {}, files: [] });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect((result as { error: string }).error).toContain('batch');
  });

  it('rejects a light task whose model is outside the server-side allowlist', () => {
    const result = validateTaskInput({
      mode: 'light',
      config: { model: 'gpt-5-ultra-expensive' },
      files: [{ data: rows(1) }],
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect((result as { error: string }).error).toContain('gpt-5-ultra-expensive');
  });

  it('accepts a light task with an allowlisted model', () => {
    const result = validateTaskInput({
      mode: 'light',
      config: { model: 'gpt-4o-mini' },
      files: [{ data: rows(100) }],
    });
    expect(result).toEqual({ ok: true, mode: 'light' });
  });
});
