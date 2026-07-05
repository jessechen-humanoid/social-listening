import { describe, expect, it } from 'vitest';
import { MAX_TOTAL_ROWS, validateBatchInput } from '../validate-task-input';

// Spec "Platform role completeness validation".
describe('validateBatchInput', () => {
  const rows = (n: number) => Array.from({ length: n }, () => ({}));
  const file = (role: string, n = 10) => ({ role, data: rows(n) });

  it('accepts a three-platform quarterly batch', () => {
    const result = validateBatchInput([
      { platform: 'fb', files: [file('hotpost'), file('hotcomment'), file('comments_from_posts')] },
      { platform: 'ig', files: [file('hotpost')] },
      { platform: 'threads', files: [file('hotpost'), file('hotpost'), file('hotpost')] },
    ]);
    expect(result).toEqual({ ok: true, platforms: ['fb', 'ig', 'threads'] });
  });

  it('rejects an fb group missing hotcomment, naming platform and role', () => {
    const result = validateBatchInput([
      { platform: 'fb', files: [file('hotpost'), file('comments_from_posts')] },
    ]);
    expect(result).toMatchObject({ ok: false, status: 400 });
    const error = (result as { error: string }).error;
    expect(error).toContain('fb');
    expect(error).toContain('hotcomment');
  });

  it('rejects a batch whose total rows exceed the limit with 413', () => {
    const result = validateBatchInput([
      { platform: 'ig', files: [{ role: 'hotpost', data: rows(MAX_TOTAL_ROWS + 1) }] },
    ]);
    expect(result).toMatchObject({ ok: false, status: 413 });
  });

  it('rejects unknown platforms, duplicate platforms, empty groups, and bad roles', () => {
    expect(validateBatchInput([{ platform: 'youtube', files: [file('hotpost')] }])).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(
      validateBatchInput([
        { platform: 'ig', files: [file('hotpost')] },
        { platform: 'ig', files: [file('hotpost')] },
      ])
    ).toMatchObject({ ok: false, status: 400 });
    expect(validateBatchInput([{ platform: 'ig', files: [] }])).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(validateBatchInput([{ platform: 'ig', files: [file('hotposts')] }])).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(validateBatchInput([])).toMatchObject({ ok: false, status: 400 });
  });
});
