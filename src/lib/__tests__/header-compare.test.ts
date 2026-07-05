import { describe, expect, it } from 'vitest';
import { compareHeaderSets, describeHeaderMismatch } from '../header-compare';

// Spec "Multiple files per role slot" — mismatched headers are rejected with
// an error naming the differing headers.
describe('compareHeaderSets', () => {
  it('accepts identical headers regardless of order', () => {
    const cmp = compareHeaderSets(['a', 'b', 'c'], ['c', 'a', 'b']);
    expect(cmp.same).toBe(true);
  });

  it('names a missing column', () => {
    const cmp = compareHeaderSets(['content', 'like_count', 'time'], ['content', 'time']);
    expect(cmp.same).toBe(false);
    expect(cmp.missing).toEqual(['like_count']);
    expect(describeHeaderMismatch(cmp)).toContain('like_count');
  });

  it('names an extra column', () => {
    const cmp = compareHeaderSets(['content'], ['content', 'sentiment']);
    expect(cmp.same).toBe(false);
    expect(cmp.extra).toEqual(['sentiment']);
    expect(describeHeaderMismatch(cmp)).toContain('sentiment');
  });

  it('names a renamed column as one missing plus one extra', () => {
    const cmp = compareHeaderSets(['message'], ['content']);
    expect(cmp.missing).toEqual(['message']);
    expect(cmp.extra).toEqual(['content']);
  });
});
